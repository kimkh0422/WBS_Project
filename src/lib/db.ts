import { supabase, ProjectRow, TaskRow, SettingsRow, ProjectMemberRow, ProjectInviteRow, ProfileRow, isSupabaseConfigured } from './supabase';
import type { Task, Project, ProjectAssignment } from '../types';
import type { WBSSettings } from '../context/WBSContext';
import type { BackupData } from './export';

const SUPABASE_REQUIRED = 'Supabase 설정이 필요합니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.';

function requireSupabase(): asserts supabase is NonNullable<typeof supabase> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(SUPABASE_REQUIRED);
  }
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
    is_milestone: task.isMilestone ?? false,
    baseline_start_date: task.baselineStartDate ?? null,
    baseline_end_date: task.baselineEndDate ?? null,
    baseline_work_effort: task.baselineWorkEffort ?? null,
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
    updatedAt: row.updated_at ?? undefined,
    isMilestone: row.is_milestone ?? false,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineEndDate: row.baseline_end_date ?? undefined,
    baselineWorkEffort: row.baseline_work_effort ?? undefined,
  };
}

function toProjectRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    start_date: project.startDate ?? null,
    end_date: project.endDate ?? null,
    assignments: (project.assignments ?? []).map(a => ({ assignee: a.assignee, allocation_percent: a.allocationPercent })),
    owner_id: project.ownerId ?? null,
    min_work_effort_days: project.minWorkEffortDays ?? null,
  };
}

/** assignments 컬럼이 없는 구 스키마용 (PGRST204 fallback) */
function toProjectRowMinimal(project: Project): Omit<ProjectRow, 'assignments'> & { assignments?: never } {
  const { assignments: _a, ...rest } = toProjectRow(project);
  return rest;
}

function fromProjectRow(row: ProjectRow): Project {
  const assignments: ProjectAssignment[] = Array.isArray(row.assignments)
    ? row.assignments.map((a: { assignee: string; allocation_percent: number }) => ({ assignee: a.assignee, allocationPercent: a.allocation_percent }))
    : [];
  const minDays = row.min_work_effort_days != null ? Number(row.min_work_effort_days) : undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    assignments: assignments.length > 0 ? assignments : undefined,
    ownerId: row.owner_id ?? undefined,
    minWorkEffortDays: minDays != null && Number.isFinite(minDays) ? minDays : undefined,
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
  requireSupabase();
  const { data, error } = await supabase!
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as ProjectRow[];
  const seen = new Set<string>();
  return rows
    .filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map(fromProjectRow);
}

export async function fetchTasks(): Promise<Task[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('tasks')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as TaskRow[]).map(fromTaskRow);
}

export async function fetchSettings(): Promise<Partial<WBSSettings> | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('wbs_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return data ? fromSettingsRow(data as SettingsRow) : null;
}

/** 프로필에서 레벨별 색상 조회. 로그인 사용자용. profiles 없으면 null 반환. */
export async function fetchProfileLevelColors(userId: string): Promise<Array<{ r: number; g: number; b: number }> | null> {
  requireSupabase();
  try {
    const { data, error } = await supabase!
      .from('profiles')
      .select('level_colors')
      .eq('id', userId)
      .maybeSingle();
    if (error) return null;
    const colors = (data as { level_colors?: unknown } | null)?.level_colors;
    if (!Array.isArray(colors)) return null;
    const valid = colors.filter(
      (c): c is { r: number; g: number; b: number } =>
        c && typeof c === 'object' && typeof (c as any).r === 'number' && typeof (c as any).g === 'number' && typeof (c as any).b === 'number'
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

/** 프로필에 레벨별 색상 저장. colors가 null이면 기본값 사용(DB에서 제거). profiles 없으면 무시. */
export async function updateProfileLevelColors(userId: string, colors: Array<{ r: number; g: number; b: number }> | null): Promise<void> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('profiles')
      .update({ level_colors: colors })
      .eq('id', userId);
    if (error) return;
  } catch {
    // profiles 테이블 없음 등 - 무시
  }
}

// ─── 삽입/업데이트 ────────────────────────────────────────────────────────────

function isAssignmentsSchemaError(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return err.code === 'PGRST204' || msg.includes("'assignments'") || msg.includes('assignments');
}

export async function upsertProject(project: Project): Promise<void> {
  requireSupabase();
  const row = toProjectRow(project);
  const { error } = await supabase!.from('projects').upsert(row);
  if (error && isAssignmentsSchemaError(error)) {
    const { error: err2 } = await supabase!.from('projects').upsert(toProjectRowMinimal(project));
    if (err2) throw err2;
    return;
  }
  if (error) throw error;
}

/** 단일 작업 저장. 동시 수정 시 conflict: true 반환(낙관적 잠금). */
export async function upsertTask(
  task: Task,
  sortOrder: number
): Promise<{ conflict?: boolean }> {
  requireSupabase();
  const row = toTaskRow(task, sortOrder);
  if (task.updatedAt != null && task.updatedAt !== '') {
    const { data, error } = await supabase!
      .from('tasks')
      .update(row)
      .eq('id', task.id)
      .eq('updated_at', task.updatedAt)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data == null) return { conflict: true };
    return {};
  }
  const { error } = await supabase!.from('tasks').upsert(row);
  if (error) throw error;
  return {};
}

const TASKS_UPSERT_BATCH_SIZE = 50;

export async function upsertTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  requireSupabase();
  for (let i = 0; i < tasks.length; i += TASKS_UPSERT_BATCH_SIZE) {
    const chunk = tasks.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
    const rows = chunk.map((t, j) => toTaskRow(t, i + j));
    const { error } = await supabase!.from('tasks').upsert(rows);
    if (error) throw error;
  }
}

export async function upsertSettings(settings: WBSSettings): Promise<void> {
  requireSupabase();
  const { error } = await supabase!
    .from('wbs_settings')
    .upsert(toSettingsRow(settings));
  if (error) throw error;
}

// ─── 삭제 ─────────────────────────────────────────────────────────────────────

export async function deleteProjectFromDB(id: string): Promise<void> {
  requireSupabase();
  const { error } = await supabase!.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTaskFromDB(id: string): Promise<void> {
  requireSupabase();
  const { error } = await supabase!.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteTasksFromDB(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  requireSupabase();
  const { error } = await supabase!.from('tasks').delete().in('id', ids);
  if (error) throw error;
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

export async function deleteAllProjectsFromDB(): Promise<void> {
  requireSupabase();
  const { error } = await supabase!.from('projects').delete().not('id', 'is', null);
  if (error) throw error;
}

// ─── 프로젝트 멤버 및 초대 ────────────────────────────────────────────────────

export async function fetchProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_members')
    .select('*')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as ProjectMemberRow[];
}

export async function createProjectInvite(projectId: string, role: 'editor' | 'viewer' = 'editor'): Promise<{ token: string; url: string } | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_invites')
    .insert({ project_id: projectId, role })
    .select('token')
    .single();
  if (error) throw error;
  const token = data?.token as string;
  const url = `${window.location.origin}${window.location.pathname}?invite=${token}`;
  return token ? { token, url } : null;
}

export async function acceptInvite(token: string): Promise<{ success: boolean; projectId?: string; error?: string }> {
  requireSupabase();
  const { data, error } = await supabase!.rpc('accept_invite', { invite_token: token });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; project_id?: string; error?: string };
  return {
    success: result.success,
    projectId: result.project_id,
    error: result.error,
  };
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  requireSupabase();
  const { error } = await supabase!
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── 회원 관리 (관리자) ────────────────────────────────────────────────────────

/** 회원 목록. profiles 테이블 없으면 [] 반환. */
export async function fetchProfiles(): Promise<ProfileRow[]> {
  requireSupabase();
  try {
    const { data, error } = await supabase!
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as ProfileRow[];
  } catch {
    return [];
  }
}

/** 회원명(full_name) 업데이트 - 본인 또는 관리자만 가능. profiles 없으면 success: false. */
export async function updateProfileFullName(userId: string, fullName: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('profiles')
      .update({ full_name: fullName.trim() || null })
      .eq('id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch {
    return { success: false, error: 'profiles 테이블을 사용할 수 없습니다.' };
  }
}

/** 관리자: 회원 역할(is_admin) 변경. RLS로 관리자만 허용. */
export async function updateMemberRole(userId: string, isAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('profiles')
      .update({ is_admin: isAdmin })
      .eq('id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch {
    return { success: false, error: 'profiles 테이블을 사용할 수 없습니다.' };
  }
}

/** 관리자 여부. ensure_profile RPC 없으면 false 반환. */
export async function checkIsAdmin(): Promise<boolean> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.rpc('ensure_profile');
    if (error) return false;
    const result = data as { is_admin?: boolean };
    return result?.is_admin === true;
  } catch {
    return false;
  }
}

/** 관리자: 회원 삭제 (Edge Function 호출, auth.users에서 삭제) */
export async function deleteMemberAsAdmin(userId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  const { data, error } = await supabase!.functions.invoke('admin-delete-user', {
    body: { userId },
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success?: boolean; error?: string };
  if (result?.error) return { success: false, error: result.error };
  return { success: true };
}

// ─── 전체 백업 복원 ───────────────────────────────────────────────────────────

export async function restoreBackupToDB(data: BackupData, ownerId?: string): Promise<void> {
  requireSupabase();
  // 기존 데이터 전체 삭제 후 재삽입
  const { error: delTasksErr } = await supabase!
    .from('tasks')
    .delete()
    .not('id', 'is', null);
  if (delTasksErr) throw delTasksErr;

  const { error: delProjErr } = await supabase!
    .from('projects')
    .delete()
    .not('id', 'is', null);
  if (delProjErr) throw delProjErr;

  if (data.projects.length > 0) {
    const rows = data.projects.map(p => {
      const row = toProjectRow(p);
      if (ownerId) row.owner_id = ownerId;
      return row;
    });
    let { error } = await supabase!.from('projects').insert(rows);
    if (error && isAssignmentsSchemaError(error)) {
      const minimalRows = data.projects.map(p => {
        const r = toProjectRowMinimal(p) as Record<string, unknown>;
        if (ownerId) r.owner_id = ownerId;
        return r;
      });
      const res = await supabase!.from('projects').insert(minimalRows);
      error = res.error;
    }
    if (error) throw error;
  }

  if (data.tasks.length > 0) {
    for (let i = 0; i < data.tasks.length; i += TASKS_UPSERT_BATCH_SIZE) {
      const chunk = data.tasks.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
      const rows = chunk.map((t, j) => toTaskRow(t, i + j));
      const { error } = await supabase!.from('tasks').insert(rows);
      if (error) throw error;
    }
  }

  if (data.settings) {
    await upsertSettings(data.settings);
  }
}

// ─── localStorage 마이그레이션 (Supabase로 이전 시 기존 데이터 가져오기) ────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(s: string): boolean {
  return typeof s === 'string' && UUID_REGEX.test(s);
}

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

    const projectsWithUuid = projects.map(p => {
      const newId = isValidUuid(p.id) ? p.id : uuidv4();
      if (!isValidUuid(p.id)) projectIdMap.set(p.id, newId);
      return { ...p, id: newId, ownerId: p.ownerId ?? ownerId };
    });

    tasks.forEach(t => {
      if (!isValidUuid(t.id)) taskIdMap.set(t.id, uuidv4());
    });
    const tasksWithUuid = tasks.map(t => {
      const newId = taskIdMap.get(t.id) ?? t.id;
      const newProjectId = projectIdMap.get(t.projectId) ?? (isValidUuid(t.projectId) ? t.projectId : projectsWithUuid[0]?.id);
      const newParentId = t.parentId ? (taskIdMap.get(t.parentId) ?? (isValidUuid(t.parentId) ? t.parentId : null)) : null;
      const newDeps = (t.dependencies ?? []).map(d => taskIdMap.get(d) ?? (isValidUuid(d) ? d : null)).filter(Boolean) as string[];
      return { ...t, id: newId, projectId: newProjectId ?? t.projectId, parentId: newParentId, dependencies: newDeps };
    });

    if (projectsWithUuid.length > 0) {
      const rows = projectsWithUuid.map(p => {
        const row = toProjectRow(p);
        if (ownerId) row.owner_id = ownerId;
        return row;
      });
      let { error } = await supabase!.from('projects').upsert(rows);
      if (error && isAssignmentsSchemaError(error)) {
        const minimalRows = projectsWithUuid.map(p => {
          const r = toProjectRowMinimal(p) as Record<string, unknown>;
          if (ownerId) r.owner_id = ownerId;
          return r;
        });
        const res = await supabase!.from('projects').upsert(minimalRows);
        error = res.error;
      }
      if (error) throw error;
    }

    if (tasksWithUuid.length > 0) {
      for (let i = 0; i < tasksWithUuid.length; i += TASKS_UPSERT_BATCH_SIZE) {
        const chunk = tasksWithUuid.slice(i, i + TASKS_UPSERT_BATCH_SIZE);
        const rows = chunk.map((t, j) => toTaskRow(t, i + j));
        const { error } = await supabase!.from('tasks').upsert(rows);
        if (error) throw error;
      }
    }

    if (settings) {
      await upsertSettings(settings);
    }

    // 마이그레이션 완료 후 localStorage 정리
    localStorage.removeItem('wbs-projects');
    localStorage.removeItem('wbs-tasks');
    localStorage.removeItem('wbs-settings');
    localStorage.removeItem('wbs-current-project');

    console.log('[DB] localStorage 데이터를 Supabase로 마이그레이션 완료');
    return true;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[DB] 마이그레이션 실패:', err);
    return false;
  }
}
