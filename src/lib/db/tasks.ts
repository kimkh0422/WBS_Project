import { supabase } from '../supabase';
import type { TaskRow } from '../supabase';
import type { Task } from '../../types';
import { requireSupabase, getMissingColumnNameFromPgrst204, stripSelectListColumn } from './client';
import { toTaskRow, fromTaskRow } from './mappers';
import { insertAuditLog, insertAuditLogsBatch, diffTaskFields } from './audit';
import type { AuditAction } from './audit';

/** Supabase/PostgREST 기본 행 제한(1000). 이 이상은 페이지네이션으로 가져옴. */
const TASKS_PAGE_SIZE = 1000;

/** 목록·동기화 비교용 tasks SELECT (fetchTaskRows / fetchTaskRowsForProjectIds 공통) */
const TASK_LIST_COLUMNS =
  'id,project_id,parent_id,name,start_date,end_date,progress,assignee,status,expanded,dependencies,work_effort,description,checklist,deliverables,user_locked_fields,sort_order,is_milestone,is_issue,is_action_item,baseline_start_date,baseline_end_date,baseline_work_effort,weight,custom_fields,created_at,updated_at';

export const TASKS_UPSERT_BATCH_SIZE = 50;

export const TASK_OPTIONAL_DB_COLUMNS = new Set<string>([
  'is_issue',
  'is_action_item',
  'is_milestone',
  'baseline_start_date',
  'baseline_end_date',
  'baseline_work_effort',
  // 진척 가중치 (마이그레이션 20260317120000)
  'weight',
  // 사용자 정의 컬럼 값(JSONB)
  'custom_fields',
  // 낙관적 잠금·동기화 (20250308000000)
  'updated_at',
  // 계획율 수동 지정 (20260605140000)
  'planned_progress_override',
]);

/** tasks 목록 SELECT 필터: 전체(null) / 단일 프로젝트 / 다중 프로젝트(IN 배치) */
type TaskProjectFilter = string | string[] | null;

/** 세션에서 누락 확인된 컬럼을 처음부터 제외한 목록 SELECT (조회마다 같은 폴백 반복 방지) */
function taskListColumnsForSession(): string {
  if (detectedMissingTaskColumns.size === 0) return TASK_LIST_COLUMNS;
  let cols = TASK_LIST_COLUMNS;
  for (const c of detectedMissingTaskColumns) cols = stripSelectListColumn(cols, c);
  return cols;
}

/** tasks 한 페이지 쿼리 빌드 — 필터(전체/단일/IN 배치) 적용. Supabase 빌더 타입을 그대로 흘려보낸다. */
function buildTaskRowsPageQuery(columns: string, filter: TaskProjectFilter, offset: number) {
  let qb = supabase!.from('tasks').select(columns);
  if (filter != null) {
    if (Array.isArray(filter)) {
      if (filter.length > 0) qb = qb.in('project_id', filter);
    } else {
      qb = qb.eq('project_id', filter);
    }
  }
  return qb.order('sort_order', { ascending: true }).range(offset, offset + TASKS_PAGE_SIZE - 1);
}

async function fetchAllTaskRowsPages(filter: TaskProjectFilter): Promise<TaskRow[]> {
  requireSupabase();
  const all: TaskRow[] = [];
  let offset = 0;
  // 세션 캐시 기준으로 시작 → 마이그레이션 미적용 환경에서도 매 페이지 재탐지 왕복을 줄인다.
  let taskListColumns = taskListColumnsForSession();
  while (true) {
    let { data, error } = await buildTaskRowsPageQuery(taskListColumns, filter, offset);
    for (let fix = 0; fix < TASK_OPTIONAL_DB_COLUMNS.size + 2 && error; fix++) {
      const missing = getMissingColumnNameFromPgrst204(error);
      if (!missing || !TASK_OPTIONAL_DB_COLUMNS.has(missing.toLowerCase())) break;
      const nextCols = stripSelectListColumn(taskListColumns, missing);
      if (nextCols === taskListColumns) break;
      taskListColumns = nextCols;
      detectedMissingTaskColumns.add(missing.toLowerCase()); // 세션 캐시 → 이후 조회·업서트 모두 처음부터 제외
      const retry = await buildTaskRowsPageQuery(taskListColumns, filter, offset);
      data = retry.data as unknown as typeof data;
      error = retry.error;
    }
    if (error) throw error;
    const page = (data ?? []) as unknown as TaskRow[];
    all.push(...page);
    if (page.length < TASKS_PAGE_SIZE) break;
    offset += TASKS_PAGE_SIZE;
  }
  return all;
}

/**
 * 이번 세션 동안 "DB에 없다고 확인된" optional 컬럼.
 * 한 번 감지하면 이후 모든 업서트에서 처음부터 제외해, 같은 PGRST204(400)를 배치마다 반복하지 않는다.
 * (마이그레이션 미적용 환경에서도 콘솔 400 폭주·저장 실패 없이 동작)
 */
const detectedMissingTaskColumns = new Set<string>();

/** UI에서 "이 컬럼이 DB에 없어 저장이 안 되니 마이그레이션 적용 필요"를 안내할 때 사용. */
export function isTaskColumnMissingFromDb(column: string): boolean {
  return detectedMissingTaskColumns.has(column.toLowerCase());
}

export function isTaskOptionalColumnSchemaError(err: { code?: string; message?: string }, columnName: string): boolean {
  const msg = (err.message ?? '').toLowerCase();
  const col = String(columnName ?? '').toLowerCase();
  return err.code === 'PGRST204' && (msg.includes(`'${col}'`) || msg.includes(col));
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
  op: (payload: TaskRow[]) => Promise<{ error: { code?: string; message?: string } | null; data?: T }>,
): Promise<{ error: { code?: string; message?: string } | null; data?: T }> {
  // PGRST204는 스키마 캐시 기준 "없는 컬럼"을 payload에 포함하면 발생.
  // 환경마다 누락 컬럼이 1개 이상일 수 있어, 알려진 optional 컬럼은 순차적으로 제거하며 재시도한다.
  const stripped = new Set<string>(detectedMissingTaskColumns);
  // 이미 이번 세션에 감지된 누락 컬럼은 처음부터 제외 → 같은 400을 매 배치 반복하지 않는다.
  let currentRows = stripped.size > 0 ? rows.map((r) => stripTaskOptionalColumns(r, Array.from(stripped))) : rows;
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
    detectedMissingTaskColumns.add(col); // 세션 캐시에 기록 → 이후 배치·저장은 처음부터 제외
    currentRows = currentRows.map((r) => stripTaskOptionalColumns(r, [col]));
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
    .map((r) => r.id)
    .filter((id) => (indegree.get(id) ?? 0) === 0)
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
        const insertAt = queue.findIndex((x) => (originalIndex.get(x) ?? 0) > (originalIndex.get(childId) ?? 0));
        if (insertAt === -1) queue.push(childId);
        else queue.splice(insertAt, 0, childId);
      }
    }
  }

  if (outIds.length !== rows.length) return rows;
  return outIds.map((id) => byId.get(id)!).filter(Boolean);
}

export async function fetchTasks(): Promise<Task[]> {
  const rows = await fetchTaskRows();
  return rows.map(fromTaskRow);
}

/** 단일 작업의 description, checklist 등 큰 필드를 개별 조회 (egress 절감) */
export async function fetchTaskDetail(
  taskId: string,
): Promise<{ description: string | null; checklist: { id: string; text: string; completed: boolean }[] } | null> {
  requireSupabase();
  const { data, error } = await supabase!.from('tasks').select('description, checklist').eq('id', taskId).maybeSingle();
  if (error || !data) return null;
  return {
    description: (data as Record<string, unknown>).description as string | null,
    checklist: ((data as Record<string, unknown>).checklist ?? []) as { id: string; text: string; completed: boolean }[],
  };
}

export async function fetchTaskRows(): Promise<TaskRow[]> {
  // checklist/description은 TaskModal에서 즉시 보여야 하고, 동기화 후에도 로컬 상태가
  // 비지 않도록 목록 조회에 포함한다. 작업당 보통 수백 바이트라 egress 영향은 미미.
  return fetchAllTaskRowsPages(null);
}

/** 지정 프로젝트들의 작업만 서버에서 가져옴(수동 저장·current 동기화 시 egress·지연 절감).
 *  프로젝트마다 개별 쿼리(N+1) 대신 project_id IN (...) 단일 페이지네이션으로 왕복을 줄인다. */
export async function fetchTaskRowsForProjectIds(projectIds: string[]): Promise<TaskRow[]> {
  const ids = Array.from(new Set(projectIds.filter(Boolean)));
  if (ids.length === 0) return [];
  return fetchAllTaskRowsPages(ids);
}

/** 단일 작업 저장. 동시 수정 시 conflict: true 반환(낙관적 잠금). */
export async function upsertTask(task: Task, sortOrder: number): Promise<{ conflict?: boolean }> {
  requireSupabase();
  const existing = await supabase!.from('tasks').select('*').eq('id', task.id).maybeSingle();
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
  // 이번 세션에 이미 감지된 누락 컬럼은 처음부터 제외
  const firstPayload = detectedMissingTaskColumns.size > 0 ? stripTaskOptionalColumns(row, Array.from(detectedMissingTaskColumns)) : row;
  let { error } = await supabase!.from('tasks').upsert(firstPayload);
  if (error) {
    const missing = getMissingColumnNameFromPgrst204(error);
    const col = (missing ?? '').toLowerCase();
    if (col && TASK_OPTIONAL_DB_COLUMNS.has(col)) {
      detectedMissingTaskColumns.add(col);
      const retry = await supabase!.from('tasks').upsert(stripTaskOptionalColumns(row, Array.from(detectedMissingTaskColumns)));
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
  sortOrders?: Map<string, number>,
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
    // 같은 배치 안에서 id가 중복되면 PostgreSQL이 21000(ON CONFLICT DO UPDATE 두 번 적용 금지)으로 409를 던진다.
    // 상위 dedup이 있더라도 방어적으로 한 번 더 정리한다(같은 id가 보이면 마지막 row 사용).
    const dedupedRows: typeof rows = [];
    const seenIds = new Set<string>();
    for (let j = rows.length - 1; j >= 0; j--) {
      const row = rows[j];
      if (!row || seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      dedupedRows.unshift(row);
    }
    const { error } = await retryTaskRowsWithOptionalColumnFallback(dedupedRows, async (payload) => {
      // onConflict='id'를 명시해 PostgREST가 id 충돌 시 MERGE(=UPDATE)로 처리하도록 강제한다.
      const res = await supabase!.from('tasks').upsert(payload, { onConflict: 'id' });
      return { error: res.error };
    });
    if (error) {
      if (import.meta.env.DEV) {
        const dupCount = rows.length - dedupedRows.length;

        console.error('[upsertTasks] 409/오류 발생', {
          batchIndex: Math.floor(i / TASKS_UPSERT_BATCH_SIZE),
          rowCount: rows.length,
          dedupedCount: dedupedRows.length,
          duplicatesRemoved: dupCount,
          error,
          sampleIds: dedupedRows.slice(0, 3).map((r) => r.id),
        });
      }
      throw error;
    }
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
  const { data: task } = await supabase!.from('tasks').select('id, project_id, name').eq('id', id).maybeSingle();
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
  const { data: tasks } = await supabase!.from('tasks').select('id, project_id, name').in('id', ids);
  const rows = (tasks ?? []) as { id: string; project_id: string; name: string }[];
  const { error } = await supabase!.from('tasks').delete().in('id', ids);
  if (error) throw error;
  if (rows.length === 0) return;
  await insertAuditLogsBatch(
    rows.map((row) => ({
      project_id: row.project_id,
      entity_type: 'task' as const,
      entity_id: row.id,
      entity_name: row.name,
      action: 'delete' as const,
    })),
  );
}

export async function deleteAllTasksFromDB(projectId: string): Promise<void> {
  requireSupabase();
  if (projectId) {
    const { error } = await supabase!.from('tasks').delete().eq('project_id', projectId);
    if (error) throw error;
  } else {
    const { error } = await supabase!.from('tasks').delete().not('id', 'is', null);
    if (error) throw error;
  }
}
