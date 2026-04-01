import { supabase } from '../supabase';
import type { ProjectMemberRow, ProjectAccessRequestRow } from '../supabase';
import { requireSupabase } from './client';

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

// ─── 프로젝트 권한 요청 ─────────────────────────────────────────────────────────

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
