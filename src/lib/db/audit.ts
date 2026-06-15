import { supabase, isSupabaseConfigured } from '../supabase';
import type { ProjectRow, TaskRow } from '../supabase';
import type { Task } from '../../types';

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

/**
 * 변경 이력 조회 (최신순). 테이블 없거나 RLS로 차단되면 빈 배열 반환.
 * @param projectId null이면 전체 프로젝트(권한 있는 범위) — 관리자는 모든 이력, 일반 사용자는 본인 소유·멤버 프로젝트만.
 */
export async function fetchAuditLog(projectId: string | null, limit = 100): Promise<AuditLogEntry[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    let query = supabase
      .from('wbs_audit_log')
      .select('id, project_id, entity_type, entity_id, entity_name, action, user_id, user_display, created_at, changes')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []) as AuditLogEntry[];
  } catch {
    return [];
  }
}

let auditUserCache: { userId: string | null; userDisplay: string; cachedAtMs: number } | null = null;
const AUDIT_USER_CACHE_MS = 60_000;

export async function getCurrentUserForAudit(): Promise<{ userId: string | null; userDisplay: string }> {
  if (!supabase) return { userId: null, userDisplay: '로컬' };
  const now = Date.now();
  if (auditUserCache && now - auditUserCache.cachedAtMs < AUDIT_USER_CACHE_MS) {
    return { userId: auditUserCache.userId, userDisplay: auditUserCache.userDisplay };
  }
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      auditUserCache = { userId: null, userDisplay: '로컬', cachedAtMs: now };
      return { userId: null, userDisplay: '로컬' };
    }
    const email = user.email ?? user.id;
    const name = (user.user_metadata?.full_name as string)?.trim?.();
    const resolved = {
      userId: user.id,
      userDisplay: name || email || user.id,
    };
    auditUserCache = { ...resolved, cachedAtMs: now };
    return resolved;
  } catch {
    return { userId: null, userDisplay: '로컬' };
  }
}

/** 이력 테이블이 없거나 실패해도 앱 동작에는 영향 없도록 에러 무시 */
export async function insertAuditLog(payload: {
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

const AUDIT_LOG_INSERT_CHUNK = 120;

/** 대량 삭제 등: 감사 행을 한 번의 세션 조회 + 소수의 insert로 기록한다. */
export async function insertAuditLogsBatch(
  entries: ReadonlyArray<{
    project_id: string | null;
    entity_type: 'task' | 'project';
    entity_id?: string | null;
    entity_name?: string | null;
    action: AuditAction;
    changes?: unknown;
  }>,
): Promise<void> {
  if (!supabase || entries.length === 0) return;
  try {
    const { userId, userDisplay } = await getCurrentUserForAudit();
    for (let i = 0; i < entries.length; i += AUDIT_LOG_INSERT_CHUNK) {
      const slice = entries.slice(i, i + AUDIT_LOG_INSERT_CHUNK);
      const rows = slice.map((payload) => ({
        project_id: payload.project_id,
        entity_type: payload.entity_type,
        entity_id: payload.entity_id ?? null,
        entity_name: payload.entity_name ?? null,
        action: payload.action,
        user_id: userId,
        user_display: userDisplay,
        changes: payload.changes ?? null,
      }));
      await supabase.from('wbs_audit_log').insert(rows);
    }
  } catch {
    /* wbs_audit_log 미적용 환경 등 */
  }
}

export function diffTaskFields(
  oldRow: TaskRow | null,
  newTask: Task,
  newRow: TaskRow,
): Array<{ field: string; old_value: unknown; new_value: unknown }> | undefined {
  if (!oldRow) return undefined;
  const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  const fields: (keyof TaskRow)[] = [
    'name',
    'start_date',
    'end_date',
    'progress',
    'assignee',
    'status',
    'work_effort',
    'description',
    'is_milestone',
    'is_issue',
    'is_action_item',
    'planned_progress_override',
  ];
  for (const key of fields) {
    const o = oldRow[key];
    const n = newRow[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: key, old_value: o, new_value: n });
    }
  }
  return changes.length > 0 ? changes : undefined;
}

export function diffProjectFields(
  oldRow: ProjectRow | null,
  newRow: ProjectRow,
): Array<{ field: string; old_value: unknown; new_value: unknown }> | undefined {
  if (!oldRow) return undefined;
  const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  const fields: (keyof ProjectRow)[] = [
    'name',
    'formal_name',
    'description',
    'start_date',
    'end_date',
    'pm_name',
    'po_name',
    'include_in_dashboard',
  ];
  for (const key of fields) {
    const o = oldRow[key];
    const n = newRow[key];
    if (JSON.stringify(o) !== JSON.stringify(n)) {
      changes.push({ field: key, old_value: o, new_value: n });
    }
  }
  return changes.length > 0 ? changes : undefined;
}
