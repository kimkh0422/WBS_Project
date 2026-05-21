import { supabase } from '../supabase';
import type { Task, Project } from '../../types';
import type { WBSSettings } from '../wbsSettings';
import type { BackupData } from '../export';
import { requireSupabase, getMissingColumnNameFromPgrst204 } from './client';
import { toProjectRow, toProjectRowMinimal, toTaskRow } from './mappers';
import { fetchProjects, isAssignmentsSchemaError, isMissingColumnError } from './projects';
import {
  fetchTasks,
  orderTaskRowsParentsFirst,
  retryTaskRowsWithOptionalColumnFallback,
  TASKS_UPSERT_BATCH_SIZE,
  TASK_OPTIONAL_DB_COLUMNS,
  stripTaskOptionalColumns,
} from './tasks';
import { upsertSettings } from './settings';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return typeof s === 'string' && UUID_REGEX.test(s);
}

function stripOptionalProjectColumnFromRows(
  rows: Record<string, unknown>[],
  col: 'project_kind' | 'pm_name' | 'po_name' | 'include_in_dashboard',
): Record<string, unknown>[] {
  return rows.map((r) => {
    if (!(col in r)) return r;
    const { [col]: _, ...rest } = r;
    return rest;
  });
}

function tryStripOneMissingProjectColumn(
  err: { code?: string | number; message?: string; details?: string; hint?: string },
  rows: Record<string, unknown>[],
): Record<string, unknown>[] | null {
  const cols = ['project_kind', 'pm_name', 'po_name', 'include_in_dashboard'] as const;
  for (const col of cols) {
    if (isMissingColumnError(err, col)) {
      return stripOptionalProjectColumnFromRows(rows, col);
    }
  }
  return null;
}

/** assignments 없는 구 스키마 + 선택 컬럼 미적용 DB 대응 */
async function insertOrUpsertProjectsWithSchemaFallback(
  mode: 'insert' | 'upsert',
  rows: Record<string, unknown>[],
  getMinimalRows: () => Record<string, unknown>[],
): Promise<void> {
  let payload = rows;
  let { error } = mode === 'insert' ? await supabase!.from('projects').insert(payload) : await supabase!.from('projects').upsert(payload);
  if (error && isAssignmentsSchemaError(error)) {
    payload = getMinimalRows();
    const res = mode === 'insert' ? await supabase!.from('projects').insert(payload) : await supabase!.from('projects').upsert(payload);
    error = res.error;
  }
  for (let i = 0; i < 10 && error; i++) {
    const next = tryStripOneMissingProjectColumn(error, payload);
    if (!next) break;
    payload = next;
    const res = mode === 'insert' ? await supabase!.from('projects').insert(payload) : await supabase!.from('projects').upsert(payload);
    error = res.error;
  }
  if (error) throw error;
}

export async function restoreBackupToDB(data: BackupData, ownerId?: string): Promise<void> {
  requireSupabase();

  let snapshotProjects: Project[] = [];
  let snapshotTasks: Task[] = [];
  try {
    snapshotProjects = await fetchProjects();
    snapshotTasks = await fetchTasks();
  } catch {
    // snapshot best-effort
  }

  const rollback = async () => {
    try {
      await supabase!.from('tasks').delete().not('id', 'is', null);
      await supabase!.from('projects').delete().not('id', 'is', null);
      if (snapshotProjects.length > 0) {
        const projRows = snapshotProjects.map((p) => toProjectRow(p) as unknown as Record<string, unknown>);
        await insertOrUpsertProjectsWithSchemaFallback('insert', projRows, () =>
          snapshotProjects.map((p) => toProjectRowMinimal(p) as unknown as Record<string, unknown>),
        );
      }
      if (snapshotTasks.length > 0) {
        const taskRows = snapshotTasks.map((t, i) => toTaskRow(t, i));
        const ordered = orderTaskRowsParentsFirst(taskRows);
        for (let i = 0; i < ordered.length; i += TASKS_UPSERT_BATCH_SIZE) {
          await supabase!.from('tasks').insert(ordered.slice(i, i + TASKS_UPSERT_BATCH_SIZE));
        }
      }
    } catch {
      // rollback best-effort
    }
  };

  const { error: delTasksErr } = await supabase!.from('tasks').delete().not('id', 'is', null);
  if (delTasksErr) throw delTasksErr;

  const { error: delProjErr } = await supabase!.from('projects').delete().not('id', 'is', null);
  if (delProjErr) throw delProjErr;

  try {
    if (data.projects.length > 0) {
      const rows = data.projects.map((p) => {
        const row = toProjectRow(p);
        if (ownerId) row.owner_id = ownerId;
        return row as unknown as Record<string, unknown>;
      });
      await insertOrUpsertProjectsWithSchemaFallback('insert', rows, () =>
        data.projects.map((p) => {
          const r = toProjectRowMinimal(p) as unknown as Record<string, unknown>;
          if (ownerId) r.owner_id = ownerId;
          return r;
        }),
      );
    }

    if (data.tasks.length > 0) {
      const byId = new Map<string, Task>();
      for (const t of data.tasks) {
        if (!t?.id) continue;
        byId.set(t.id, t);
      }
      const uniqueTasks: Task[] = [];
      const seen = new Set<string>();
      for (let i = data.tasks.length - 1; i >= 0; i--) {
        const id = data.tasks[i]?.id;
        if (!id || seen.has(id)) continue;
        const latest = byId.get(id);
        if (latest) uniqueTasks.push(latest);
        seen.add(id);
      }
      uniqueTasks.reverse();

      const desiredRows = uniqueTasks.map((t, idx) => toTaskRow(t, idx));
      const orderedRows = orderTaskRowsParentsFirst(desiredRows);
      for (let i = 0; i < orderedRows.length; i += TASKS_UPSERT_BATCH_SIZE) {
        const rows = orderedRows.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
        const { error } = await retryTaskRowsWithOptionalColumnFallback(rows, async (payload) => {
          const res = await supabase!.from('tasks').insert(payload);
          return { error: res.error };
        });
        if (error) throw error;
      }
    }

    if (data.settings) {
      await upsertSettings(data.settings);
    }
  } catch (restoreErr) {
    await rollback();
    throw restoreErr;
  }
}

// ─── localStorage 마이그레이션 (Supabase로 이전 시 기존 데이터 가져오기) ────────

export async function migrateFromLocalStorage(ownerId?: string): Promise<boolean> {
  requireSupabase();
  const savedProjects = localStorage.getItem('wbs-projects');
  const savedTasks = localStorage.getItem('wbs-tasks');

  if (!savedProjects && !savedTasks) return false;

  try {
    const projects: Project[] = savedProjects ? JSON.parse(savedProjects) : [];
    const tasks: Task[] = savedTasks ? JSON.parse(savedTasks) : [];
    const savedSettings = localStorage.getItem('wbs-settings');
    const settings: WBSSettings | null = savedSettings ? JSON.parse(savedSettings) : null;

    const projectIdMap = new Map<string, string>();
    const taskIdMap = new Map<string, string>();
    const { v4: uuidv4 } = await import('uuid');

    const projectsWithUuid = projects.map((p) => {
      const newId = isValidUuid(p.id) ? p.id : uuidv4();
      if (!isValidUuid(p.id)) projectIdMap.set(p.id, newId);
      return { ...p, id: newId, ownerId: p.ownerId ?? ownerId };
    });

    tasks.forEach((t) => {
      if (!isValidUuid(t.id)) taskIdMap.set(t.id, uuidv4());
    });
    const tasksWithUuid = tasks.map((t) => {
      const newId = taskIdMap.get(t.id) ?? t.id;
      const newProjectId = projectIdMap.get(t.projectId) ?? (isValidUuid(t.projectId) ? t.projectId : projectsWithUuid[0]?.id);
      const newParentId = t.parentId ? (taskIdMap.get(t.parentId) ?? (isValidUuid(t.parentId) ? t.parentId : null)) : null;
      const newDeps = (t.dependencies ?? []).map((d) => taskIdMap.get(d) ?? (isValidUuid(d) ? d : null)).filter(Boolean) as string[];
      return { ...t, id: newId, projectId: newProjectId ?? t.projectId, parentId: newParentId, dependencies: newDeps };
    });

    if (projectsWithUuid.length > 0) {
      const rows = projectsWithUuid.map((p) => {
        const row = toProjectRow(p);
        if (ownerId) row.owner_id = ownerId;
        return row as unknown as Record<string, unknown>;
      });
      await insertOrUpsertProjectsWithSchemaFallback('upsert', rows, () =>
        projectsWithUuid.map((p) => {
          const r = toProjectRowMinimal(p) as unknown as Record<string, unknown>;
          if (ownerId) r.owner_id = ownerId;
          return r;
        }),
      );
    }

    if (tasksWithUuid.length > 0) {
      for (let i = 0; i < tasksWithUuid.length; i += TASKS_UPSERT_BATCH_SIZE) {
        const chunk = tasksWithUuid.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
        const rows = chunk.map((t, j) => toTaskRow(t, i + j));
        let { error } = await supabase!.from('tasks').upsert(rows);
        if (error) {
          const missing = getMissingColumnNameFromPgrst204(error);
          if (missing && TASK_OPTIONAL_DB_COLUMNS.has(missing.toLowerCase())) {
            const minimalRows = rows.map((r) => stripTaskOptionalColumns(r, [missing.toLowerCase()]));
            const retry = await supabase!.from('tasks').upsert(minimalRows);
            error = retry.error;
          }
        }
        if (error) throw error;
      }
    }

    if (settings) {
      await upsertSettings(settings);
    }

    localStorage.removeItem('wbs-projects');
    localStorage.removeItem('wbs-tasks');
    localStorage.removeItem('wbs-settings');
    localStorage.removeItem('wbs-current-project');

    if (import.meta.env.DEV) console.log('[DB] localStorage 데이터를 Supabase로 마이그레이션 완료');
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[DB] 마이그레이션 실패:', err);
    return false;
  }
}
