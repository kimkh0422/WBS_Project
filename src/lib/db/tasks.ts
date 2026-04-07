import { supabase } from '../supabase';
import type { TaskRow } from '../supabase';
import type { Task } from '../../types';
import { requireSupabase } from './client';
import { toTaskRow, fromTaskRow } from './mappers';
import { insertAuditLog, diffTaskFields } from './audit';
import type { AuditAction } from './audit';

/** Supabase/PostgREST 기본 행 제한(1000). 이 이상은 페이지네이션으로 가져옴. */
const TASKS_PAGE_SIZE = 1000;

export const TASKS_UPSERT_BATCH_SIZE = 50;

export const TASK_OPTIONAL_DB_COLUMNS = new Set<string>([
  'is_issue',
  'is_milestone',
  'baseline_start_date',
  'baseline_end_date',
  'baseline_work_effort',
  // 진척 가중치 (마이그레이션 20260317120000)
  'weight',
]);

export function isTaskOptionalColumnSchemaError(
  err: { code?: string; message?: string },
  columnName: string
): boolean {
  const msg = (err.message ?? '').toLowerCase();
  const col = String(columnName ?? '').toLowerCase();
  return err.code === 'PGRST204' && (msg.includes(`'${col}'`) || msg.includes(col));
}

export function getMissingColumnNameFromPgrst204(err: { code?: string; message?: string }): string | null {
  if (err.code !== 'PGRST204') return null;
  const msg = err.message ?? '';
  const m = msg.match(/could not find the '([^']+)' column/i);
  return m?.[1] ? String(m[1]) : null;
}

export function stripTaskOptionalColumns(row: TaskRow, columns: string[]): TaskRow {
  const out = { ...row } as Record<string, unknown>;
  for (const c of columns) delete out[c];
  return out as unknown as TaskRow;
}

function stripIfKnownOptionalTaskColumn(row: TaskRow, columnName: string | null): TaskRow | null {
  if (!columnName) return null;
  const col = columnName.toLowerCase();
  if (!TASK_OPTIONAL_DB_COLUMNS.has(col)) return null;
  return stripTaskOptionalColumns(row, [col]);
}

export async function retryTaskRowsWithOptionalColumnFallback<T>(
  rows: TaskRow[],
  op: (payload: TaskRow[]) => Promise<{ error: { code?: string; message?: string } | null; data?: T }>
): Promise<{ error: { code?: string; message?: string } | null; data?: T }> {
  // PGRST204는 스키마 캐시 기준 "없는 컬럼"을 payload에 포함하면 발생.
  // 환경마다 누락 컬럼이 1개 이상일 수 있어, 알려진 optional 컬럼은 순차적으로 제거하며 재시도한다.
  let currentRows = rows;
  const stripped = new Set<string>();
  for (let attempt = 0; attempt < TASK_OPTIONAL_DB_COLUMNS.size + 1; attempt++) {
    const res = await op(currentRows);
    const err = res.error as { code?: string; message?: string } | null | undefined;
    if (!err) return res;
    const missing = getMissingColumnNameFromPgrst204(err);
    const col = (missing ?? '').toLowerCase();
    if (!col || !TASK_OPTIONAL_DB_COLUMNS.has(col) || stripped.has(col)) {
      return res;
    }
    stripped.add(col);
    currentRows = currentRows.map(r => stripTaskOptionalColumns(r, [col]));
  }
  return op(currentRows);
}

export function orderTaskRowsParentsFirst(rows: TaskRow[]): TaskRow[] {
  // tasks.parent_id has FK to tasks.id, so inserts must ensure parent exists.
  const byId = new Map<string, TaskRow>();
  const originalIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    byId.set(r.id, r);
    originalIndex.set(r.id, i);
  });

  const childrenByParent = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const r of rows) {
    indegree.set(r.id, 0);
  }

  for (const r of rows) {
    const pid = r.parent_id;
    if (!pid) continue;
    if (!byId.has(pid)) continue;
    childrenByParent.set(pid, [...(childrenByParent.get(pid) ?? []), r.id]);
    indegree.set(r.id, (indegree.get(r.id) ?? 0) + 1);
  }

  const zero: string[] = rows
    .map(r => r.id)
    .filter(id => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));

  const outIds: string[] = [];
  const queue = [...zero];
  while (queue.length) {
    const id = queue.shift()!;
    outIds.push(id);
    const kids = (childrenByParent.get(id) ?? []).slice().sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
    for (const childId of kids) {
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) {
        const insertAt = queue.findIndex(x => (originalIndex.get(x) ?? 0) > (originalIndex.get(childId) ?? 0));
        if (insertAt === -1) queue.push(childId);
        else queue.splice(insertAt, 0, childId);
      }
    }
  }

  if (outIds.length !== rows.length) return rows;
  return outIds.map(id => byId.get(id)!).filter(Boolean);
}

export async function fetchTasks(): Promise<Task[]> {
  const rows = await fetchTaskRows();
  return rows.map(fromTaskRow);
}

/** 단일 작업의 description, checklist 등 큰 필드를 개별 조회 (egress 절감) */
export async function fetchTaskDetail(taskId: string): Promise<{ description: string | null; checklist: { id: string; text: string; completed: boolean }[] } | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('tasks')
    .select('description, checklist')
    .eq('id', taskId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    description: (data as Record<string, unknown>).description as string | null,
    checklist: ((data as Record<string, unknown>).checklist ?? []) as { id: string; text: string; completed: boolean }[],
  };
}

export async function fetchTaskRows(): Promise<TaskRow[]> {
  requireSupabase();
  const all: TaskRow[] = [];
  let offset = 0;
  while (true) {
    // egress 절감: description, checklist은 큰 텍스트 → 목록 조회에서 제외 (작업 수정 시 개별 조회)
    const TASK_LIST_COLUMNS = 'id,project_id,parent_id,name,start_date,end_date,progress,assignee,status,expanded,dependencies,work_effort,deliverables,user_locked_fields,sort_order,is_milestone,is_issue,baseline_start_date,baseline_end_date,baseline_work_effort,weight,created_at,updated_at';
    const { data, error } = await supabase!
      .from('tasks')
      .select(TASK_LIST_COLUMNS)
      .order('sort_order', { ascending: true })
      .range(offset, offset + TASKS_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as TaskRow[];
    all.push(...page);
    if (page.length < TASKS_PAGE_SIZE) break;
    offset += TASKS_PAGE_SIZE;
  }
  return all;
}

/** 단일 작업 저장. 동시 수정 시 conflict: true 반환(낙관적 잠금). */
export async function upsertTask(
  task: Task,
  sortOrder: number
): Promise<{ conflict?: boolean }> {
  requireSupabase();
  const existing = await supabase!
    .from('tasks')
    .select('*')
    .eq('id', task.id)
    .maybeSingle();
  const existingRow = (existing.data ?? null) as TaskRow | null;
  const row = toTaskRow(task, sortOrder);
  if (task.updatedAt != null && task.updatedAt !== '') {
    let { data, error } = await supabase!
      .from('tasks')
      .update(row)
      .eq('id', task.id)
      .eq('updated_at', task.updatedAt)
      .select('id')
      .maybeSingle();
    if (error) {
      const missing = getMissingColumnNameFromPgrst204(error);
      const minimal = stripIfKnownOptionalTaskColumn(row, missing);
      if (minimal) {
        const retry = await supabase!
          .from('tasks')
          .update(minimal)
          .eq('id', task.id)
          .eq('updated_at', task.updatedAt)
          .select('id')
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      }
    }
    if (error) throw error;
    if (data == null) return { conflict: true };
    const changes = diffTaskFields(existingRow, task, row);
    await insertAuditLog({
      project_id: task.projectId,
      entity_type: 'task',
      entity_id: task.id,
      entity_name: task.name,
      action: 'update',
      changes,
    });
    return {};
  }
  let { error } = await supabase!.from('tasks').upsert(row);
  if (error) {
    const missing = getMissingColumnNameFromPgrst204(error);
    const minimal = stripIfKnownOptionalTaskColumn(row, missing);
    if (minimal) {
      const retry = await supabase!.from('tasks').upsert(minimal);
      error = retry.error;
    }
  }
  if (error) throw error;
  const action: AuditAction = existingRow ? 'update' : 'create';
  const changes = existingRow ? diffTaskFields(existingRow, task, row) : undefined;
  await insertAuditLog({
    project_id: task.projectId,
    entity_type: 'task',
    entity_id: task.id,
    entity_name: task.name,
    action,
    changes,
  });
  return {};
}

export async function upsertTasks(
  tasks: Task[],
  onBatchProgress?: (uploadedCount: number, totalRows: number) => void,
  sortOrders?: Map<string, number>
): Promise<void> {
  if (tasks.length === 0) return;
  requireSupabase();
  // PostgREST upsert can fail with 409 if the same conflict target (e.g. id) appears multiple times in one payload.
  // Defensive: dedupe by task.id (keep last occurrence), while preserving the caller's relative order for sort_order.
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    if (!t?.id) continue;
    byId.set(t.id, t);
  }
  const uniqueTasks: Task[] = [];
  const seen = new Set<string>();
  for (let i = tasks.length - 1; i >= 0; i--) {
    const id = tasks[i]?.id;
    if (!id || seen.has(id)) continue;
    const latest = byId.get(id);
    if (latest) uniqueTasks.push(latest);
    seen.add(id);
  }
  uniqueTasks.reverse();

  // Preserve caller's sort order, but insert/upsert with parents first to satisfy FK on parent_id.
  // sortOrders가 전달된 경우 전체 목록 기준 sort_order 사용 (부분 업로드 시 순서 뒤섞임 방지)
  const desiredRows = uniqueTasks.map((t, idx) => toTaskRow(t, sortOrders?.get(t.id) ?? idx));
  const orderedRows = orderTaskRowsParentsFirst(desiredRows);

  const totalRows = orderedRows.length;
  for (let i = 0; i < orderedRows.length; i += TASKS_UPSERT_BATCH_SIZE) {
    const rows = orderedRows.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
    const { error } = await retryTaskRowsWithOptionalColumnFallback(rows, async (payload) => {
      const res = await supabase!.from('tasks').upsert(payload);
      return { error: res.error };
    });
    if (error) throw error;
    onBatchProgress?.(Math.min(i + rows.length, totalRows), totalRows);
  }
  const projectId = tasks[0]?.projectId ?? null;
  if (projectId && tasks.length > 0) {
    await insertAuditLog({
      project_id: projectId,
      entity_type: 'task',
      entity_id: null,
      entity_name: null,
      action: 'bulk_update',
      changes: { count: tasks.length },
    });
  }
}

export async function deleteTaskFromDB(id: string): Promise<void> {
  requireSupabase();
  const { data: task } = await supabase!
    .from('tasks')
    .select('id, project_id, name')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase!.from('tasks').delete().eq('id', id);
  if (error) throw error;
  const row = task as { id: string; project_id: string; name: string } | null;
  if (row) {
    await insertAuditLog({
      project_id: row.project_id,
      entity_type: 'task',
      entity_id: row.id,
      entity_name: row.name,
      action: 'delete',
    });
  }
}

export async function deleteTasksFromDB(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  requireSupabase();
  const { data: tasks } = await supabase!
    .from('tasks')
    .select('id, project_id, name')
    .in('id', ids);
  const rows = (tasks ?? []) as { id: string; project_id: string; name: string }[];
  const { error } = await supabase!.from('tasks').delete().in('id', ids);
  if (error) throw error;
  for (const row of rows) {
    await insertAuditLog({
      project_id: row.project_id,
      entity_type: 'task',
      entity_id: row.id,
      entity_name: row.name,
      action: 'delete',
    });
  }
}

export async function deleteAllTasksFromDB(projectId: string): Promise<void> {
  requireSupabase();
  if (projectId) {
    const { error } = await supabase!
      .from('tasks')
      .delete()
      .eq('project_id', projectId);
    if (error) throw error;
  } else {
    const { error } = await supabase!.from('tasks').delete().not('id', 'is', null);
    if (error) throw error;
  }
}
