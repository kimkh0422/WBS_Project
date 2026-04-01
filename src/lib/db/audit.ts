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

export async function getCurrentUserForAudit(): Promise<{ userId: string | null; userDisplay: string }> {
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

export function diffTaskFields(
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

export function diffProjectFields(
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
