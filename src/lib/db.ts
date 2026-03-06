import { supabase, ProjectRow, TaskRow, SettingsRow, isSupabaseConfigured } from './supabase';
import type { Task, Project } from '../types';
import type { WBSSettings } from '../context/WBSContext';
import type { BackupData } from './export';

const PROJECTS_STORAGE_KEY = 'wbs-projects';
const TASKS_STORAGE_KEY = 'wbs-tasks';
const SETTINGS_STORAGE_KEY = 'wbs-settings';
const CURRENT_PROJECT_STORAGE_KEY = 'wbs-current-project';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadProjectsFromLocal(): Project[] {
  return readJson<Project[]>(PROJECTS_STORAGE_KEY, []);
}

function saveProjectsToLocal(projects: Project[]) {
  writeJson(PROJECTS_STORAGE_KEY, projects);
}

function loadTasksFromLocal(): Task[] {
  return readJson<Task[]>(TASKS_STORAGE_KEY, []);
}

function saveTasksToLocal(tasks: Task[]) {
  writeJson(TASKS_STORAGE_KEY, tasks);
}

function loadSettingsFromLocal(): Partial<WBSSettings> | null {
  return readJson<Partial<WBSSettings> | null>(SETTINGS_STORAGE_KEY, null);
}

function saveSettingsToLocal(settings: WBSSettings) {
  writeJson(SETTINGS_STORAGE_KEY, settings);
}

// ─── 변환 헬퍼 ────────────────────────────────────────────────────────────────

function toTaskRow(task: Task, sortOrder: number): TaskRow {
  return {
    id: task.id,
    project_id: task.projectId,
    parent_id: task.parentId ?? null,
    name: task.name,
    start_date: task.startDate ?? '',
    end_date: task.endDate ?? '',
    progress: task.progress ?? 0,
    assignee: task.assignee ?? '',
    status: task.status ?? 'todo',
    expanded: task.expanded ?? false,
    dependencies: task.dependencies ?? [],
    work_effort: task.workEffort ?? null,
    description: task.description ?? null,
    checklist: (task.checklist ?? []) as { id: string; text: string; completed: boolean }[],
    deliverables: task.deliverables ?? null,
    sort_order: sortOrder,
  };
}

function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    assignee: row.assignee,
    status: row.status as Task['status'],
    expanded: row.expanded,
    dependencies: row.dependencies ?? [],
    workEffort: row.work_effort ?? undefined,
    description: row.description ?? undefined,
    checklist: row.checklist ?? [],
    deliverables: row.deliverables ?? undefined,
  };
}

function toProjectRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    start_date: project.startDate ?? null,
  };
}

function fromProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
  };
}

function toSettingsRow(settings: WBSSettings): SettingsRow {
  return {
    id: 'default',
    level1_prefix: settings.level1Prefix,
    level2_prefix: settings.level2Prefix,
    level3_prefix: settings.level3Prefix,
    max_level: settings.maxLevel,
  };
}

function fromSettingsRow(row: SettingsRow): Partial<WBSSettings> {
  return {
    level1Prefix: row.level1_prefix,
    level2Prefix: row.level2_prefix,
    level3Prefix: row.level3_prefix,
    maxLevel: row.max_level,
  };
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  if (!isSupabaseConfigured || !supabase) {
    return loadProjectsFromLocal();
  }
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ProjectRow[]).map(fromProjectRow);
}

export async function fetchTasks(): Promise<Task[]> {
  if (!isSupabaseConfigured || !supabase) {
    return loadTasksFromLocal();
  }
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as TaskRow[]).map(fromTaskRow);
}

export async function fetchSettings(): Promise<Partial<WBSSettings> | null> {
  if (!isSupabaseConfigured || !supabase) {
    return loadSettingsFromLocal();
  }
  const { data, error } = await supabase
    .from('wbs_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return data ? fromSettingsRow(data as SettingsRow) : null;
}

// ─── 삽입/업데이트 ────────────────────────────────────────────────────────────

export async function upsertProject(project: Project): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    const projects = loadProjectsFromLocal();
    const next = projects.some(p => p.id === project.id)
      ? projects.map(p => p.id === project.id ? project : p)
      : [...projects, project];
    saveProjectsToLocal(next);
    return;
  }
  const { error } = await supabase
    .from('projects')
    .upsert(toProjectRow(project));
  if (error) throw error;
}

export async function upsertTask(task: Task, sortOrder: number): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    const tasks = loadTasksFromLocal().filter(t => t.id !== task.id);
    const insertAt = Math.max(0, Math.min(sortOrder, tasks.length));
    tasks.splice(insertAt, 0, task);
    saveTasksToLocal(tasks);
    return;
  }
  const { error } = await supabase
    .from('tasks')
    .upsert(toTaskRow(task, sortOrder));
  if (error) throw error;
}

export async function upsertTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  if (!isSupabaseConfigured || !supabase) {
    saveTasksToLocal(tasks);
    return;
  }
  const rows = tasks.map((t, i) => toTaskRow(t, i));
  const { error } = await supabase.from('tasks').upsert(rows);
  if (error) throw error;
}

export async function upsertSettings(settings: WBSSettings): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    saveSettingsToLocal(settings);
    return;
  }
  const { error } = await supabase
    .from('wbs_settings')
    .upsert(toSettingsRow(settings));
  if (error) throw error;
}

// ─── 삭제 ─────────────────────────────────────────────────────────────────────

export async function deleteProjectFromDB(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    saveProjectsToLocal(loadProjectsFromLocal().filter(p => p.id !== id));
    saveTasksToLocal(loadTasksFromLocal().filter(t => t.projectId !== id));
    return;
  }
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTaskFromDB(id: string): Promise<void> {
  // 하위 tasks는 DB에서 parent_id 참조 삭제 처리 (ON DELETE CASCADE 미설정으로 수동 처리)
  if (!isSupabaseConfigured || !supabase) {
    saveTasksToLocal(loadTasksFromLocal().filter(t => t.id !== id));
    return;
  }
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTasksFromDB(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!isSupabaseConfigured || !supabase) {
    const idSet = new Set(ids);
    saveTasksToLocal(loadTasksFromLocal().filter(t => !idSet.has(t.id)));
    return;
  }
  const { error } = await supabase.from('tasks').delete().in('id', ids);
  if (error) throw error;
}

export async function deleteAllTasksFromDB(projectId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    saveTasksToLocal(loadTasksFromLocal().filter(t => t.projectId !== projectId));
    return;
  }
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('project_id', projectId);
  if (error) throw error;
}

// ─── 전체 백업 복원 ───────────────────────────────────────────────────────────

export async function restoreBackupToDB(data: BackupData): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    saveProjectsToLocal(data.projects);
    saveTasksToLocal(data.tasks);
    saveSettingsToLocal(data.settings);
    return;
  }
  // 기존 데이터 전체 삭제 후 재삽입
  const { error: delTasksErr } = await supabase
    .from('tasks')
    .delete()
    .not('id', 'is', null);
  if (delTasksErr) throw delTasksErr;

  const { error: delProjErr } = await supabase
    .from('projects')
    .delete()
    .not('id', 'is', null);
  if (delProjErr) throw delProjErr;

  if (data.projects.length > 0) {
    const { error } = await supabase
      .from('projects')
      .insert(data.projects.map(toProjectRow));
    if (error) throw error;
  }

  if (data.tasks.length > 0) {
    const rows = data.tasks.map((t, i) => toTaskRow(t, i));
    const { error } = await supabase.from('tasks').insert(rows);
    if (error) throw error;
  }

  if (data.settings) {
    await upsertSettings(data.settings);
  }
}

// ─── localStorage 마이그레이션 ────────────────────────────────────────────────

export async function migrateFromLocalStorage(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const savedProjects = localStorage.getItem('wbs-projects');
  const savedTasks = localStorage.getItem('wbs-tasks');

  if (!savedProjects && !savedTasks) return false;

  try {
    const projects: Project[] = savedProjects ? JSON.parse(savedProjects) : [];
    const tasks: Task[] = savedTasks ? JSON.parse(savedTasks) : [];
    const savedSettings = localStorage.getItem('wbs-settings');
    const settings: WBSSettings | null = savedSettings ? JSON.parse(savedSettings) : null;

    if (projects.length > 0) {
      const { error } = await supabase
        .from('projects')
        .upsert(projects.map(toProjectRow));
      if (error) throw error;
    }

    if (tasks.length > 0) {
      const rows = tasks.map((t, i) => toTaskRow(t, i));
      const { error } = await supabase.from('tasks').upsert(rows);
      if (error) throw error;
    }

    if (settings) {
      await upsertSettings(settings);
    }

    // 마이그레이션 완료 후 localStorage 정리
    localStorage.removeItem('wbs-projects');
    localStorage.removeItem('wbs-tasks');
    localStorage.removeItem('wbs-settings');
    localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);

    console.log('[DB] localStorage 데이터를 Supabase로 마이그레이션 완료');
    return true;
  } catch (err) {
    console.error('[DB] 마이그레이션 실패:', err);
    return false;
  }
}
