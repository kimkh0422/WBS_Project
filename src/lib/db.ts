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

/** 프로젝트별 변경 이력 조회 (최신순). 테이블 없으면 빈 배열 반환. */
export async function fetchAuditLog(projectId: string, limit = 100): Promise<AuditLogEntry[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('wbs_audit_log')
      .select('id, project_id, entity_type, entity_id, entity_name, action, user_id, user_display, created_at, changes')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as AuditLogEntry[];
  } catch {
    return [];
  }
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

// ─── 변경 이력(감사 로그) ─────────────────────────────────────────────────────

export type AuditAction = 'create' | 'update' | 'delete' | 'bulk_update';

export interface AuditLogEntry {
  id: string;
  project_id: string | null;
  entity_type: 'task' | 'project';
  entity_id: string | null;
  entity_name: string | null;
  action: AuditAction;
  user_id: string | null;
  user_display: string | null;
  created_at: string;
  changes: unknown;
}

async function getCurrentUserForAudit(): Promise<{ userId: string | null; userDisplay: string }> {
  if (!supabase) return { userId: null, userDisplay: '로컬' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return { userId: null, userDisplay: '로컬' };
    const email = user.email ?? user.id;
    const name = (user.user_metadata?.full_name as string)?.trim?.();
    return {
      userId: user.id,
      userDisplay: name || email || user.id,
    };
  } catch {
    return { userId: null, userDisplay: '로컬' };
  }
}

/** 이력 테이블이 없거나 실패해도 앱 동작에는 영향 없도록 에러 무시 */
async function insertAuditLog(payload: {
  project_id: string | null;
  entity_type: 'task' | 'project';
  entity_id?: string | null;
  entity_name?: string | null;
  action: AuditAction;
  changes?: unknown;
}): Promise<void> {
  if (!supabase) return;
  try {
    const { userId, userDisplay } = await getCurrentUserForAudit();
    await supabase.from('wbs_audit_log').insert({
      project_id: payload.project_id,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id ?? null,
      entity_name: payload.entity_name ?? null,
      action: payload.action,
      user_id: userId,
      user_display: userDisplay,
      changes: payload.changes ?? null,
    });
  } catch {
    // wbs_audit_log 미적용 환경 등
  }
}

function diffTaskFields(
  oldRow: TaskRow | null,
  newTask: Task,
  newRow: TaskRow
): Array<{ field: string; old_value: unknown; new_value: unknown }> | undefined {
  if (!oldRow) return undefined;
  const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  const fields: (keyof TaskRow)[] = ['name', 'start_date', 'end_date', 'progress', 'assignee', 'status', 'work_effort', 'description', 'is_milestone'];
  for (const key of fields) {
    const o = oldRow[key];
    const n = newRow[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: key, old_value: o, new_value: n });
    }
  }
  return changes.length > 0 ? changes : undefined;
}

function diffProjectFields(
  oldRow: ProjectRow | null,
  newRow: ProjectRow
): Array<{ field: string; old_value: unknown; new_value: unknown }> | undefined {
  if (!oldRow) return undefined;
  const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  const fields: (keyof ProjectRow)[] = ['name', 'description', 'start_date', 'end_date'];
  for (const key of fields) {
    const o = oldRow[key];
    const n = newRow[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: key, old_value: o, new_value: n });
    }
  }
  return changes.length > 0 ? changes : undefined;
}

// ─── 삽입/업데이트 ────────────────────────────────────────────────────────────

function isAssignmentsSchemaError(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return err.code === 'PGRST204' || msg.includes("'assignments'") || msg.includes('assignments');
}

export async function upsertProject(project: Project): Promise<void> {
  requireSupabase();
  const existing = await supabase!
    .from('projects')
    .select('id, name, description, start_date, end_date')
    .eq('id', project.id)
    .maybeSingle();
  const existingRow = (existing.data ?? null) as ProjectRow | null;
  const row = toProjectRow(project);
  const { error } = await supabase!.from('projects').upsert(row);
  if (error && isAssignmentsSchemaError(error)) {
    const { error: err2 } = await supabase!.from('projects').upsert(toProjectRowMinimal(project));
    if (err2) throw err2;
  } else if (error) {
    throw error;
  }
  const action: AuditAction = existingRow ? 'update' : 'create';
  const changes = existingRow ? diffProjectFields(existingRow, row) : undefined;
  await insertAuditLog({
    project_id: project.id,
    entity_type: 'project',
    entity_id: project.id,
    entity_name: project.name,
    action,
    changes,
  });
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
    const { data, error } = await supabase!
      .from('tasks')
      .update(row)
      .eq('id', task.id)
      .eq('updated_at', task.updatedAt)
      .select('id')
      .maybeSingle();
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
  const { error } = await supabase!.from('tasks').upsert(row);
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
  const { data: project } = await supabase!
    .from('projects')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase!.from('projects').delete().eq('id', id);
  if (error) throw error;
  const row = project as { id: string; name: string } | null;
  await insertAuditLog({
    project_id: id,
    entity_type: 'project',
    entity_id: id,
    entity_name: row?.name ?? null,
    action: 'delete',
  });
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

/** 프로젝트 멤버 권한 설정(추가 또는 변경). 관리자 또는 프로젝트 소유자만 가능. role은 'editor'(편집) 또는 'viewer'(보기). */
export async function upsertProjectMember(
  projectId: string,
  userId: string,
  role: 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('project_members')
      .upsert(
        { project_id: projectId, user_id: userId, role },
        { onConflict: 'project_id,user_id' }
      );
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '권한 설정에 실패했습니다.' };
  }
}

/** 프로젝트 멤버 역할만 변경. 기존 멤버에 대해 editor/viewer 전환 시 사용. */
export async function setProjectMemberRole(
  projectId: string,
  userId: string,
  role: 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('project_members')
      .update({ role })
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '역할 변경에 실패했습니다.' };
  }
}

// ─── 회원 관리 (관리자) ────────────────────────────────────────────────────────

function isApprovedColumnError(err: { message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes("'approved'") || msg.includes('approved') && (msg.includes('schema') || msg.includes('cache'));
}

/** 회원 목록. approved 컬럼이 없으면 기존 컬럼만 조회 후 approved=true로 반환. 에러 시 예외 발생. */
export async function fetchProfiles(): Promise<ProfileRow[]> {
  requireSupabase();
  try {
    const { data, error } = await supabase!
      .from('profiles')
      .select('id, email, full_name, created_at, is_admin, approved')
      .order('created_at', { ascending: false });
    if (error) {
      if (isApprovedColumnError(error)) {
        const { data: dataWithoutApproved, error: err2 } = await supabase!
          .from('profiles')
          .select('id, email, full_name, created_at, is_admin')
          .order('created_at', { ascending: false });
        if (err2) throw new Error(err2.message);
        return ((dataWithoutApproved ?? []) as Omit<ProfileRow, 'approved'>[]).map(row => ({ ...row, approved: true }));
      }
      throw new Error(error.message);
    }
    return (data ?? []) as ProfileRow[];
  } catch (e) {
    if (e instanceof Error) throw e;
    if (e && typeof e === 'object' && isApprovedColumnError(e as { message?: string })) {
      const { data, error } = await supabase!
        .from('profiles')
        .select('id, email, full_name, created_at, is_admin')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Omit<ProfileRow, 'approved'>[]).map(row => ({ ...row, approved: true }));
    }
    throw e instanceof Error ? e : new Error('회원 목록을 불러올 수 없습니다.');
  }
}

/** 접근 가능한 프로젝트 소유자 표시명 조회 (RPC). profileMap 보강용. */
export async function getProjectOwnerDisplayNames(ownerIds: string[]): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || !supabase || ownerIds.length === 0) return {};
  const unique = [...new Set(ownerIds.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc('get_project_owner_display_names', { owner_ids: unique });
    if (error) return {};
    const rows = (data ?? []) as { user_id: string; display_name: string }[];
    const out: Record<string, string> = {};
    rows.forEach(r => { out[r.user_id] = r.display_name || '(이메일 없음)'; });
    return out;
  } catch {
    return {};
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
  const status = await getProfileStatus();
  return status?.isAdmin === true;
}

/** 로그인 사용자의 프로필 상태(관리자 여부, 승인 여부). 미승인 시 로컬 전용 사용. */
export async function getProfileStatus(): Promise<{ isAdmin: boolean; approved: boolean } | null> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.rpc('ensure_profile');
    if (error) return null;
    const result = data as { is_admin?: boolean; approved?: boolean };
    return {
      isAdmin: result?.is_admin === true,
      approved: result?.approved === true,
    };
  } catch {
    return null;
  }
}

/** 관리자: 회원 승인(approved). 승인 후 해당 회원은 DB와 동기화 가능. */
export async function updateMemberApproved(userId: string, approved: boolean): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('profiles')
      .update({ approved })
      .eq('id', userId);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes("'approved'") || (msg.includes('approved') && (msg.includes('schema') || msg.includes('cache')))) {
        return { success: false, error: '승인 기능을 사용하려면 DB 마이그레이션(approved 컬럼)을 적용해 주세요. Supabase 대시보드에서 supabase/migrations/20250312010000_add_profiles_approved.sql 을 실행하세요.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("'approved'") || (msg.includes('approved') && (msg.includes('schema') || msg.includes('cache')))) {
      return { success: false, error: '승인 기능을 사용하려면 DB 마이그레이션(approved 컬럼)을 적용해 주세요.' };
    }
    return { success: false, error: 'profiles 테이블을 사용할 수 없습니다.' };
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
