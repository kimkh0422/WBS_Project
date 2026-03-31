import { supabase, supabaseUrl, supabaseAnonKey, ProjectRow, ProjectAssignmentRow, TaskRow, SettingsRow, ProjectMemberRow, ProjectInviteRow, ProjectAccessRequestRow, ProfileRow, isSupabaseConfigured } from './supabase';
import type { Task, Project, ProjectAssignment } from '../types';
import type { WBSSettings } from '../context/WBSContext';
import type { BackupData } from './export';

const SUPABASE_REQUIRED = 'Supabase 설정이 필요합니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.';

function requireSupabase(): asserts supabase is NonNullable<typeof supabase> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(SUPABASE_REQUIRED);
  }
}

function rpcDisabledKey(fnName: string) {
  return `wbs.rpc.disabled.${fnName}`;
}

function isRpcDisabled(fnName: string): boolean {
  try {
    return sessionStorage.getItem(rpcDisabledKey(fnName)) === '1';
  } catch {
    return false;
  }
}

function disableRpc(fnName: string) {
  try {
    sessionStorage.setItem(rpcDisabledKey(fnName), '1');
  } catch {
    // ignore
  }
}

function isRpcNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string; message?: string; details?: string };
  const status = e.status;
  const code = (e.code || '').toString();
  const msg = ((e.message || '') + ' ' + (e.details || '')).toLowerCase();
  return (
    status === 404 ||
    code === 'PGRST202' ||
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('could not find the function')
  );
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
    user_locked_fields: (task.userLockedFields ?? []) as any,
    sort_order: sortOrder,
    is_milestone: task.isMilestone ?? false,
    is_issue: task.isIssue ?? false,
    baseline_start_date: task.baselineStartDate ?? null,
    baseline_end_date: task.baselineEndDate ?? null,
    baseline_work_effort: task.baselineWorkEffort ?? null,
    weight: task.weight ?? null,
  };
}

/** TaskRow → Task (동기화 시 DB 전체 내려받기·로컬 저장용) */
export function fromTaskRow(row: TaskRow): Task {
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
    isIssue: row.is_issue ?? false,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineEndDate: row.baseline_end_date ?? undefined,
    baselineWorkEffort: row.baseline_work_effort ?? undefined,
    weight: row.weight ?? undefined,
    userLockedFields: Array.isArray(row.user_locked_fields)
      ? (row.user_locked_fields.filter(Boolean) as Task['userLockedFields'])
      : undefined,
  };
}

function toProjectRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    start_date: project.startDate ?? null,
    end_date: project.endDate ?? null,
    assignments: (project.assignments ?? []).map(a => ({
      assignee: a.assignee,
      allocation_percent: a.allocationPercent,
      ...(a.monthlyAllocations && Object.keys(a.monthlyAllocations).length > 0 ? { monthly_allocations: a.monthlyAllocations } : {}),
    })),
    owner_id: project.ownerId ?? null,
    min_work_effort_days: project.minWorkEffortDays ?? null,
    report_category: project.reportCategory ?? null,
    report_agency: project.reportAgency ?? null,
    report_budget_this_year: project.reportBudgetThisYear ?? null,
    report_total_period: project.reportTotalPeriod ?? null,
    report_name_short: project.reportNameShort ?? null,
    report_name_full: project.reportNameFull ?? null,
  };
}

/** assignments 컬럼이 없는 구 스키마용 (PGRST204 fallback) */
function toProjectRowMinimal(project: Project): Omit<ProjectRow, 'assignments'> & { assignments?: never } {
  const { assignments: _a, ...rest } = toProjectRow(project);
  return rest;
}

export function fromProjectRow(row: ProjectRow): Project {
  const assignments: ProjectAssignment[] = Array.isArray(row.assignments)
    ? row.assignments.map((a: ProjectAssignmentRow) => ({
        assignee: a.assignee,
        allocationPercent: a.allocation_percent,
        ...(a.monthly_allocations && Object.keys(a.monthly_allocations).length > 0 ? { monthlyAllocations: a.monthly_allocations } : {}),
      }))
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
    reportCategory: row.report_category ?? undefined,
    reportAgency: row.report_agency ?? undefined,
    reportBudgetThisYear: row.report_budget_this_year ?? undefined,
    reportTotalPeriod: row.report_total_period ?? undefined,
    reportNameShort: row.report_name_short ?? undefined,
    reportNameFull: row.report_name_full ?? undefined,
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

export function fromSettingsRow(row: SettingsRow): Partial<WBSSettings> {
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
  const rows = await fetchTaskRows();
  return rows.map(fromTaskRow);
}

/** Supabase/PostgREST 기본 행 제한(1000). 이 이상은 페이지네이션으로 가져옴. */
const TASKS_PAGE_SIZE = 1000;

export async function fetchTaskRows(): Promise<TaskRow[]> {
  requireSupabase();
  const all: TaskRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase!
      .from('tasks')
      .select('*')
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

export async function fetchSettingsRow(): Promise<SettingsRow | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('wbs_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return (data as SettingsRow) ?? null;
}

// ─── 동기화: 로컬↔DB 차이만 업/다운로드용 비교 ─────────────────────────────

function normAssignmentsForSync(a: ProjectAssignmentRow[] | null | undefined): unknown {
  return [...(a ?? [])]
    .map(x => ({
      assignee: x.assignee,
      allocation_percent: x.allocation_percent,
      monthly_allocations: x.monthly_allocations && Object.keys(x.monthly_allocations).length ? x.monthly_allocations : {},
    }))
    .sort((x, y) => x.assignee.localeCompare(y.assignee));
}

/** DB 행 기준 프로젝트 본문 지문 (동일이면 업로드 생략) */
export function fingerprintProjectRowForSync(row: ProjectRow): string {
  return JSON.stringify({
    name: row.name,
    description: row.description ?? null,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    assignments: normAssignmentsForSync(row.assignments),
    min_work_effort_days: row.min_work_effort_days ?? null,
    report_category: row.report_category ?? null,
    report_agency: row.report_agency ?? null,
    report_budget_this_year: row.report_budget_this_year ?? null,
    report_total_period: row.report_total_period ?? null,
    report_name_short: row.report_name_short ?? null,
    report_name_full: row.report_name_full ?? null,
  });
}

export function projectNeedsDbUpload(project: Project, serverById: Map<string, Project>): boolean {
  const sp = serverById.get(project.id);
  if (!sp) return true;
  return projectFingerprintFromProject(project) !== projectFingerprintFromProject(sp);
}

function taskContentFingerprint(row: TaskRow): string {
  const deps = [...(row.dependencies ?? [])].sort();
  const checklist = [...(row.checklist ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    project_id: row.project_id,
    parent_id: row.parent_id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    progress: row.progress,
    assignee: row.assignee,
    status: row.status,
    dependencies: deps,
    work_effort: row.work_effort,
    description: row.description,
    checklist,
    deliverables: row.deliverables,
    is_milestone: row.is_milestone ?? false,
    is_issue: row.is_issue ?? false,
    baseline_start_date: row.baseline_start_date ?? null,
    baseline_end_date: row.baseline_end_date ?? null,
    baseline_work_effort: row.baseline_work_effort ?? null,
    weight: row.weight ?? null,
  });
}

/**
 * Realtime으로 받은 DB 행이 로컬 작업과 "내용상" 동일한지.
 * updated_at·sort_order는 지문에 포함되지 않음 → 본인 저장 직후 에코에서 오탐 충돌 방지용.
 */
export function serverTaskRowMatchesLocalTask(localTask: Task, serverRow: TaskRow): boolean {
  const so =
    typeof serverRow.sort_order === 'number' && Number.isFinite(serverRow.sort_order)
      ? serverRow.sort_order
      : 0;
  const lr = toTaskRow(localTask, so);
  return taskContentFingerprint(lr) === taskContentFingerprint(serverRow);
}

/** 프로젝트 내 작업 id 나열이 서버와 다르면 순서·트리 반영을 위해 해당 프로젝트 작업 전부 업로드 */
export function projectIdsWithTaskOrderDrift(
  localTasks: Task[],
  serverRows: TaskRow[],
  projectIds: Set<string>
): Set<string> {
  const drift = new Set<string>();
  const byPid = (pid: string) => localTasks.filter(t => t.projectId === pid).map(t => t.id);
  const serverByPid = (pid: string) =>
    serverRows
      .filter(r => r.project_id === pid)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(r => r.id);
  for (const pid of projectIds) {
    if (JSON.stringify(byPid(pid)) !== JSON.stringify(serverByPid(pid))) drift.add(pid);
  }
  return drift;
}

export function collectTasksNeedingUpload(
  localTasks: Task[],
  serverById: Map<string, TaskRow>,
  projectIdSet: Set<string>,
  sortOrders?: Map<string, number>
): Task[] {
  const serverRows = [...serverById.values()];
  const driftPids = projectIdsWithTaskOrderDrift(localTasks, serverRows, projectIdSet);
  const out: Task[] = [];
  const seen = new Set<string>();
  for (const t of localTasks) {
    if (!t.projectId || !projectIdSet.has(t.projectId)) continue;
    const sr = serverById.get(t.id);
    if (!sr) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
      continue;
    }
    if (driftPids.has(t.projectId)) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
      continue;
    }
    const localRow = toTaskRow(t, sr.sort_order);
    const contentChanged = taskContentFingerprint(localRow) !== taskContentFingerprint(sr);
    // sort_order가 핑거프린트에 포함되지 않으므로 별도 비교: 로컬 순서와 서버 sort_order가 다르면 업로드
    const localSortOrder = sortOrders?.get(t.id);
    const sortOrderChanged = localSortOrder !== undefined && sr.sort_order !== localSortOrder;
    if (contentChanged || sortOrderChanged) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
    }
  }
  return out;
}

export function settingsNeedDbUpload(settings: WBSSettings, serverRow: SettingsRow | null): boolean {
  if (!serverRow) return true;
  const local = toSettingsRow(settings);
  return (
    local.level1_prefix !== serverRow.level1_prefix ||
    local.level2_prefix !== serverRow.level2_prefix ||
    local.level3_prefix !== serverRow.level3_prefix ||
    local.max_level !== serverRow.max_level
  );
}

export function projectFingerprintFromProject(p: Project): string {
  return fingerprintProjectRowForSync(toProjectRow(p) as ProjectRow);
}

/** 서버와 내용이 다른 프로젝트만 로컬 객체 교체 (같으면 참조 유지) */
export function mergeProjectsDelta(local: Project[], serverProjects: Project[]): {
  merged: Project[];
  replacedFromServer: number;
  /** 서버에서 반영된(로컬과 달라 교체된) 프로젝트 id 목록 */
  replacedProjectIds: string[];
} {
  const sm = new Map(serverProjects.map(p => [p.id, p]));
  const replacedIds: string[] = [];
  const out: Project[] = [];
  for (const sp of serverProjects) {
    const lp = local.find(p => p.id === sp.id);
    if (lp && projectFingerprintFromProject(lp) === projectFingerprintFromProject(sp)) out.push(lp);
    else {
      out.push(sp);
      replacedIds.push(sp.id);
    }
  }
  for (const lp of local) {
    if (!sm.has(lp.id)) out.push(lp);
  }
  return { merged: out, replacedFromServer: replacedIds.length, replacedProjectIds: replacedIds };
}

/**
 * 서버와 내용이 다른 작업만 서버 행으로 교체.
 * authoritativeProjectIds: 이번 동기에서 업로드 범위에 들어간 프로젝트 — 서버에 없는 작업 id는 삭제된 것으로 보고 제거.
 * 범위 밖 프로젝트는 로컬 전용 작업을 유지(현재 프로젝트만 동기 시 다른 프로젝트 손실 방지).
 */
export function mergeTasksDelta(
  local: Task[],
  serverRows: TaskRow[],
  authoritativeProjectIds: Set<string>
): { merged: Task[]; replacedFromServer: number; replacedByProject: Record<string, number> } {
  const serverIds = new Set(serverRows.map(r => r.id));
  const lm = new Map(local.map(t => [t.id, t]));
  const replacedByProject: Record<string, number> = {};
  const out: Task[] = [];
  for (const row of serverRows) {
    const st = fromTaskRow(row);
    const lt = lm.get(st.id);
    const contentMatch =
      lt &&
      taskContentFingerprint(toTaskRow(lt, row.sort_order)) === taskContentFingerprint(row);
    if (contentMatch) {
      out.push(
        lt.updatedAt === row.updated_at ? lt : { ...lt, updatedAt: row.updated_at ?? undefined }
      );
    } else {
      out.push(lt ? { ...st, expanded: lt.expanded } : st);
      const pid = row.project_id ?? '';
      replacedByProject[pid] = (replacedByProject[pid] ?? 0) + 1;
    }
  }
  for (const lt of local) {
    if (serverIds.has(lt.id)) continue;
    if (authoritativeProjectIds.has(lt.projectId)) continue;
    out.push(lt);
  }
  return { merged: out, replacedFromServer: Object.values(replacedByProject).reduce((a, b) => a + b, 0), replacedByProject };
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
  const fields: (keyof TaskRow)[] = ['name', 'start_date', 'end_date', 'progress', 'assignee', 'status', 'work_effort', 'description', 'is_milestone', 'is_issue'];
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

function isTaskOptionalColumnSchemaError(
  err: { code?: string; message?: string },
  columnName: string
): boolean {
  const msg = (err.message ?? '').toLowerCase();
  const col = String(columnName ?? '').toLowerCase();
  return err.code === 'PGRST204' && (msg.includes(`'${col}'`) || msg.includes(col));
}

function getMissingColumnNameFromPgrst204(err: { code?: string; message?: string }): string | null {
  if (err.code !== 'PGRST204') return null;
  const msg = err.message ?? '';
  // Example: "Could not find the 'is_issue' column of 'tasks' in the schema cache"
  const m = msg.match(/could not find the '([^']+)' column/i);
  return m?.[1] ? String(m[1]) : null;
}

function stripTaskOptionalColumns(row: TaskRow, columns: string[]): TaskRow {
  const out = { ...(row as any) } as any;
  for (const c of columns) delete out[c];
  return out as TaskRow;
}

const TASK_OPTIONAL_DB_COLUMNS = new Set<string>([
  // Feature flags
  'is_issue',
  'is_milestone',
  // Baseline fields (older schemas may not have these)
  'baseline_start_date',
  'baseline_end_date',
  'baseline_work_effort',
  // 진척 가중치 (마이그레이션 20260317120000)
  'weight',
]);

function stripIfKnownOptionalTaskColumn(row: TaskRow, columnName: string | null): TaskRow | null {
  if (!columnName) return null;
  const col = columnName.toLowerCase();
  if (!TASK_OPTIONAL_DB_COLUMNS.has(col)) return null;
  return stripTaskOptionalColumns(row, [col]);
}

async function retryTaskRowsWithOptionalColumnFallback<T>(
  rows: TaskRow[],
  op: (payload: TaskRow[]) => Promise<{ error: any; data?: T }>
): Promise<{ error: any; data?: T }> {
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

function orderTaskRowsParentsFirst(rows: TaskRow[]): TaskRow[] {
  // tasks.parent_id has FK to tasks.id, so inserts must ensure parent exists.
  // This orders rows so that any parent row comes before its children (stable by original order).
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
    if (!byId.has(pid)) continue; // parent outside this payload -> ignore ordering constraint
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
        // Insert while keeping overall stability
        const insertAt = queue.findIndex(x => (originalIndex.get(x) ?? 0) > (originalIndex.get(childId) ?? 0));
        if (insertAt === -1) queue.push(childId);
        else queue.splice(insertAt, 0, childId);
      }
    }
  }

  // If cycles or anything unexpected, fall back to original order to avoid dropping data.
  if (outIds.length !== rows.length) return rows;
  return outIds.map(id => byId.get(id)!).filter(Boolean);
}

async function getAuthedUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
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
  // NOTE:
  // RLS 환경에서 upsert(INSERT .. ON CONFLICT DO UPDATE)는 INSERT 정책의 WITH CHECK가
  // "충돌로 UPDATE 되는 케이스"에도 적용되어, 소유자(owner)가 아닌 editor 사용자가
  // 프로젝트를 저장할 때 실패할 수 있음. (UPDATE 정책은 통과해도 INSERT 체크에서 실패)
  // 따라서 "존재하면 update, 없으면 insert"로 분기한다.
  if (existingRow) {
    const { error } = await supabase!.from('projects').update(row).eq('id', project.id);
    if (error && isAssignmentsSchemaError(error)) {
      const { error: err2 } = await supabase!.from('projects').update(toProjectRowMinimal(project) as any).eq('id', project.id);
      if (err2) throw err2;
    } else if (error) {
      throw error;
    }
  } else {
    // 백업/가져오기 데이터에는 ownerId가 타 사용자로 들어있을 수 있음.
    // RLS projects_insert는 owner_id = auth.uid()를 요구하므로,
    // 신규 INSERT 시에는 현재 로그인 사용자를 owner로 강제한다.
    const authedUserId = await getAuthedUserId();
    const insertRow = { ...row, owner_id: authedUserId ?? row.owner_id };
    const { error } = await supabase!.from('projects').insert(insertRow);
    if (error && isAssignmentsSchemaError(error)) {
      const minimal = toProjectRowMinimal(project) as any;
      const minimalWithOwner = authedUserId ? { ...minimal, owner_id: authedUserId } : minimal;
      const { error: err2 } = await supabase!.from('projects').insert(minimalWithOwner);
      if (err2) throw err2;
    } else if (error) {
      throw error;
    }
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

const TASKS_UPSERT_BATCH_SIZE = 50;

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

/** 특정 사용자(userId)가 멤버로 속한 프로젝트 목록 (project_members). 관리자용 권한 관리 UI에서 사용. */
export async function fetchProjectMembershipsByUser(userId: string): Promise<ProjectMemberRow[]> {
  requireSupabase();
  const uid = String(userId ?? '').trim();
  if (!uid) return [];
  const { data, error } = await supabase!
    .from('project_members')
    .select('*')
    .eq('user_id', uid);
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

// ─── 프로젝트 권한 요청 (승인 사용자 → 보기/편집 권한 요청, 관리자·소유자 승인) ─────

/** 프로젝트에 대한 보기/편집 권한 요청 생성. 승인된 사용자만 가능. */
export async function createProjectAccessRequest(
  projectId: string,
  requestedRole: 'viewer' | 'editor'
): Promise<{ success: boolean; error?: string; requestId?: string }> {
  requireSupabase();
  try {
    const { data: { user } } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };
    const { data, error } = await supabase!
      .from('project_access_requests')
      .insert({
        project_id: projectId,
        user_id: user.id,
        requested_role: requestedRole,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return { success: false, error: '이미 해당 프로젝트에 권한을 요청했습니다.' };
      return { success: false, error: error.message };
    }
    return { success: true, requestId: (data as { id: string })?.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '권한 요청에 실패했습니다.' };
  }
}

/** 거절된 요청을 다시 pending으로 재요청. */
export async function rerequestProjectAccess(requestId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('project_access_requests')
      .update({ status: 'pending', reviewed_at: null, reviewed_by: null })
      .eq('id', requestId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '재요청에 실패했습니다.' };
  }
}

/** 내 권한 요청 목록 (본인 요청만 RLS로 조회 가능). */
export async function listMyProjectAccessRequests(): Promise<ProjectAccessRequestRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_access_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectAccessRequestRow[];
}

/** 관리자·프로젝트 소유자: pending 권한 요청 목록 (승인/거절 처리용). */
export async function listPendingProjectAccessRequests(): Promise<ProjectAccessRequestRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_access_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectAccessRequestRow[];
}

/** 권한 요청 승인: project_members에 추가 후 요청 상태를 approved로 변경. 관리자 또는 해당 프로젝트 소유자만. */
export async function approveProjectAccessRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { data: row, error: fetchError } = await supabase!
      .from('project_access_requests')
      .select('project_id, user_id, requested_role')
      .eq('id', requestId)
      .eq('status', 'pending')
      .single();
    if (fetchError || !row) return { success: false, error: fetchError?.message ?? '요청을 찾을 수 없거나 이미 처리되었습니다.' };
    const { data: { user } } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };

    const upsertResult = await upsertProjectMember(
      (row as { project_id: string; user_id: string; requested_role: 'viewer' | 'editor' }).project_id,
      (row as { user_id: string }).user_id,
      (row as { requested_role: 'viewer' | 'editor' }).requested_role
    );
    if (!upsertResult.success) return { success: false, error: upsertResult.error };

    const { error: updateError } = await supabase!
      .from('project_access_requests')
      .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', requestId);
    if (updateError) return { success: false, error: updateError.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '승인 처리에 실패했습니다.' };
  }
}

/** 권한 요청 거절. 관리자 또는 해당 프로젝트 소유자만. */
export async function rejectProjectAccessRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { data: { user } } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };
    const { error } = await supabase!
      .from('project_access_requests')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', requestId)
      .eq('status', 'pending');
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '거절 처리에 실패했습니다.' };
  }
}

/** 특정 프로젝트에 대한 내 권한 요청 1건 조회 (있으면 1건). */
export async function getMyProjectAccessRequest(projectId: string): Promise<ProjectAccessRequestRow | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_access_requests')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data as ProjectAccessRequestRow | null;
}

/** 내가 멤버(또는 소유자)인 프로젝트 ID 목록. 권한 요청 UI에서 "접근 권한 없음" 판단용. */
export async function getMyProjectMemberProjectIds(): Promise<string[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('project_members')
    .select('project_id');
  if (error) return [];
  return ((data ?? []) as { project_id: string }[]).map(r => r.project_id);
}

/** 편집 가능한 프로젝트 ID 목록 (소유자 또는 editor 권한이 부여된 프로젝트). 승인 사용자는 모든 프로젝트를 보지만 편집은 이 목록만. */
export async function getMyEditableProjectIds(): Promise<string[]> {
  requireSupabase();
  const { data, error } = await supabase!.rpc('get_user_editable_project_ids');
  if (error) return [];
  return Array.isArray(data) ? (data as string[]) : [];
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

/** 회원별 접속 횟수·마지막 접속 시각 (관리자 전용 RPC). 실패 시 빈 객체. */
export async function getMemberVisitStats(): Promise<Record<string, { login_count: number; last_visited_at: string | null }>> {
  if (!isSupabaseConfigured || !supabase) return {};
  if (isRpcDisabled('get_member_visit_stats')) return {};
  try {
    const { data, error } = await supabase.rpc('get_member_visit_stats');
    if (error) {
      if (isRpcNotFoundError(error)) {
        disableRpc('get_member_visit_stats');
        return {};
      }
      const msg = error.message ?? '';
      // 마이그레이션 미적용/권한 문제는 UI에서 안내할 수 있도록 예외로 올림
      if (
        msg.toLowerCase().includes('does not exist') ||
        msg.toLowerCase().includes('permission denied') ||
        msg.toLowerCase().includes('not found')
      ) {
        throw new Error(
          '접속 통계를 불러올 수 없습니다. Supabase DB에 방문 통계 마이그레이션( visits, record_visit, get_member_visit_stats )을 적용하고, 함수 실행 권한(GRANT)을 확인하세요.'
        );
      }
      return {};
    }
    const rows = (data ?? []) as { user_id: string; login_count: number; last_visited_at: string | null }[];
    const out: Record<string, { login_count: number; last_visited_at: string | null }> = {};
    rows.forEach(r => {
      out[r.user_id] = { login_count: Number(r.login_count) || 0, last_visited_at: r.last_visited_at ?? null };
    });
    return out;
  } catch {
    return {};
  }
}

/** 접근 가능한 프로젝트 소유자 표시명 조회 (RPC). profileMap 보강용. */
export async function getProjectOwnerDisplayNames(ownerIds: string[]): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || !supabase || ownerIds.length === 0) return {};
  if (isRpcDisabled('get_project_owner_display_names')) return {};
  const unique = [...new Set(ownerIds.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc('get_project_owner_display_names', { owner_ids: unique });
    if (error) {
      if (isRpcNotFoundError(error)) disableRpc('get_project_owner_display_names');
      return {};
    }
    const rows = (data ?? []) as { user_id: string; display_name: string }[];
    const out: Record<string, string> = {};
    rows.forEach(r => { out[r.user_id] = r.display_name || '(이메일 없음)'; });
    return out;
  } catch {
    return {};
  }
}

export async function getVisitorStats(): Promise<{ daily: number; total: number }> {
  if (!isSupabaseConfigured || !supabase) return { daily: 0, total: 0 };
  if (isRpcDisabled('get_visitor_stats')) return { daily: 0, total: 0 };
  try {
    const { data, error } = await supabase.rpc('get_visitor_stats');
    if (error) {
      if (isRpcNotFoundError(error)) disableRpc('get_visitor_stats');
      return { daily: 0, total: 0 };
    }
    const d = data as { daily?: number; total?: number } | null;
    return {
      daily: typeof d?.daily === 'number' ? d.daily : 0,
      total: typeof d?.total === 'number' ? d.total : 0,
    };
  } catch {
    return { daily: 0, total: 0 };
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
    if (!error) {
      const result = data as { is_admin?: boolean; approved?: boolean };
      return {
        isAdmin: result?.is_admin === true,
        // approved가 명시적으로 false가 아닌 한(= true/undefined) 승인으로 간주
        approved: result?.approved !== false,
      };
    }
    // Fallback: ensure_profile RPC 미적용/권한 문제 시 profiles 직접 조회
    try {
      const { data: authData } = await supabase!.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) return { isAdmin: false, approved: true };
      const { data: row, error: selErr } = await supabase!
        .from('profiles')
        .select('is_admin, approved')
        .eq('id', uid)
        .maybeSingle();
      if (selErr) {
        // profiles 조회도 막히는 환경이면 UI에서만 막지 않게 기본값(approved=true) 사용
        return { isAdmin: false, approved: true };
      }
      const r = (row ?? {}) as { is_admin?: boolean | null; approved?: boolean | null };
      return {
        isAdmin: r.is_admin === true,
        // 기존 계정에서 approved가 null인 경우가 있어, false만 "미승인"으로 취급
        approved: r.approved !== false,
      };
    } catch {
      return { isAdmin: false, approved: true };
    }
  } catch {
    // RPC 호출 자체가 실패하는 경우도 동일 폴백
    try {
      const { data: authData } = await supabase!.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) return { isAdmin: false, approved: true };
      const { data: row, error: selErr } = await supabase!
        .from('profiles')
        .select('is_admin, approved')
        .eq('id', uid)
        .maybeSingle();
      if (selErr) return { isAdmin: false, approved: true };
      const r = (row ?? {}) as { is_admin?: boolean | null; approved?: boolean | null };
      return {
        isAdmin: r.is_admin === true,
        approved: r.approved !== false,
      };
    } catch {
      return { isAdmin: false, approved: true };
    }
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

/** 관리자: 회원 삭제 (Edge Function 호출, auth.users에서 삭제). 비밀번호 관리자 모드일 때 wbsAdminPassword 전달. */
export async function deleteMemberAsAdmin(
  userId: string,
  options?: { wbsAdminPassword?: string }
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const body: { userId: string; wbsAdminPassword?: string } = { userId };
    if (options?.wbsAdminPassword) body.wbsAdminPassword = options.wbsAdminPassword;

    const { data: sessionData } = await supabase!.auth.getSession();
    const authToken = sessionData.session?.access_token ?? supabaseAnonKey;

    const response = await fetch(`${supabaseUrl}/functions/v1/admin-delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });

    const json = await response.json() as { success?: boolean; error?: string };
    if (!response.ok) {
      return { success: false, error: json?.error || `회원 삭제에 실패했습니다. (${response.status})` };
    }
    if (json?.error) return { success: false, error: json.error };
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg || '회원 삭제에 실패했습니다.' };
  }
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
    // Preserve backup order for sort_order, but insert parents first for FK.
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
        let { error } = await supabase!.from('tasks').upsert(rows);
        if (error) {
          const missing = getMissingColumnNameFromPgrst204(error);
          if (missing && TASK_OPTIONAL_DB_COLUMNS.has(missing.toLowerCase())) {
            const minimalRows = rows.map(r => stripTaskOptionalColumns(r, [missing.toLowerCase()]));
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
