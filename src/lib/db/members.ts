import { supabase } from '../supabase';
import type { ProjectMemberRow, ProjectAccessRequestRow, AdminAccessRequestRow, PendingProjectInvitationRow } from '../supabase';
import { requireSupabase } from './client';

export async function fetchProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
  requireSupabase();
  const { data, error } = await supabase!.from('project_members').select('*').eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as ProjectMemberRow[];
}

/** 특정 사용자(userId)가 멤버로 속한 프로젝트 목록 (project_members). 관리자용 권한 관리 UI에서 사용. */
export async function fetchProjectMembershipsByUser(userId: string): Promise<ProjectMemberRow[]> {
  requireSupabase();
  const uid = String(userId ?? '').trim();
  if (!uid) return [];
  const { data, error } = await supabase!.from('project_members').select('*').eq('user_id', uid);
  if (error) throw error;
  return (data ?? []) as ProjectMemberRow[];
}

export async function createProjectInvite(
  projectId: string,
  role: 'editor' | 'viewer' = 'editor',
): Promise<{ token: string; url: string } | null> {
  requireSupabase();
  const { data, error } = await supabase!.from('project_invites').insert({ project_id: projectId, role }).select('token').single();
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
  const { error } = await supabase!.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId);
  if (error) throw error;
}

/** 프로젝트 멤버 권한 설정(추가 또는 변경). 관리자 또는 프로젝트 소유자만 가능. role은 DB상 viewer/editor(승인 후 편집 권한은 동일). */
export async function upsertProjectMember(
  projectId: string,
  userId: string,
  role: 'editor' | 'viewer',
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!
      .from('project_members')
      .upsert({ project_id: projectId, user_id: userId, role }, { onConflict: 'project_id,user_id' });
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
  role: 'editor' | 'viewer',
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!.from('project_members').update({ role }).eq('project_id', projectId).eq('user_id', userId);
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
  requestedRole: 'viewer' | 'editor',
): Promise<{ success: boolean; error?: string; requestId?: string }> {
  requireSupabase();
  try {
    const {
      data: { user },
    } = await supabase!.auth.getUser();
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

/** 거절된 요청을 다시 pending으로 재요청. `requestedRole`이 있으면 함께 갱신(예: 편집으로 재요청). */
export async function rerequestProjectAccess(
  requestId: string,
  requestedRole?: 'viewer' | 'editor',
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const patch: Record<string, unknown> = {
      status: 'pending',
      reviewed_at: null,
      reviewed_by: null,
    };
    if (requestedRole) patch.requested_role = requestedRole;
    const { error } = await supabase!.from('project_access_requests').update(patch).eq('id', requestId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '재요청에 실패했습니다.' };
  }
}

/**
 * 현재 프로젝트에 대한 편집(editor) 권한 요청을 보냅니다.
 * - 요청 이력 없음 → INSERT
 * - pending + editor → 이미 대기 중
 * - pending + viewer → editor로 상향
 * - rejected → 재요청 + editor
 * - approved + viewer → pending + editor(재승인 필요)
 */
export async function requestProjectEditorAccess(
  projectId: string,
): Promise<{ success: boolean; error?: string; state?: 'sent' | 'already_pending' | 'upgraded' }> {
  requireSupabase();
  try {
    const {
      data: { user },
    } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };

    const row = await getMyProjectAccessRequest(projectId);
    if (!row) {
      const r = await createProjectAccessRequest(projectId, 'editor');
      return r.success ? { success: true, state: 'sent' } : { success: false, error: r.error };
    }
    if (row.status === 'pending' && row.requested_role === 'editor') {
      return { success: true, state: 'already_pending' };
    }
    if (row.status === 'pending' && row.requested_role === 'viewer') {
      const { error } = await supabase!
        .from('project_access_requests')
        .update({ requested_role: 'editor' })
        .eq('id', row.id)
        .eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      return { success: true, state: 'upgraded' };
    }
    if (row.status === 'rejected') {
      const r = await rerequestProjectAccess(row.id, 'editor');
      return r.success ? { success: true, state: 'sent' } : { success: false, error: r.error };
    }
    if (row.status === 'approved' && row.requested_role === 'viewer') {
      const { error } = await supabase!
        .from('project_access_requests')
        .update({
          status: 'pending',
          requested_role: 'editor',
          reviewed_at: null,
          reviewed_by: null,
        })
        .eq('id', row.id)
        .eq('user_id', user.id);
      if (error) return { success: false, error: error.message };
      return { success: true, state: 'sent' };
    }
    if (row.status === 'approved' && row.requested_role === 'editor') {
      return {
        success: false,
        error: '이미 편집 권한이 승인된 요청입니다. 동기화 또는 새로고침 후에도 편집이 안 되면 관리자에게 문의하세요.',
      };
    }
    return { success: false, error: '처리할 수 없는 권한 요청 상태입니다.' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '요청에 실패했습니다.' };
  }
}

/** 내 권한 요청 목록 (본인 요청만 RLS로 조회 가능). */
export async function listMyProjectAccessRequests(): Promise<ProjectAccessRequestRow[]> {
  requireSupabase();
  const { data, error } = await supabase!.from('project_access_requests').select('*').order('created_at', { ascending: false });
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
    const {
      data: { user },
    } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };

    const upsertResult = await upsertProjectMember(
      (row as { project_id: string; user_id: string; requested_role: 'viewer' | 'editor' }).project_id,
      (row as { user_id: string }).user_id,
      (row as { requested_role: 'viewer' | 'editor' }).requested_role,
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
    const {
      data: { user },
    } = await supabase!.auth.getUser();
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
  const { data, error } = await supabase!.from('project_access_requests').select('*').eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  return data as ProjectAccessRequestRow | null;
}

// ─── 시스템 관리자(is_admin) 권한 요청 ─────────────────────────────────────────

const ADMIN_REQ_MSG_MAX = 500;

/** 비관리자: 시스템 관리자 권한 요청 등록. 동시에 대기 중인 요청이 있으면 DB 유니크 제약으로 실패할 수 있음. */
export async function createAdminAccessRequest(message?: string | null): Promise<{ success: boolean; error?: string; requestId?: string }> {
  requireSupabase();
  try {
    const {
      data: { user },
    } = await supabase!.auth.getUser();
    if (!user?.id) return { success: false, error: '로그인이 필요합니다.' };
    const trimmed = (message ?? '').trim();
    const msg = trimmed.length > ADMIN_REQ_MSG_MAX ? trimmed.slice(0, ADMIN_REQ_MSG_MAX) : trimmed || null;
    const { data, error } = await supabase!
      .from('admin_access_requests')
      .insert({ user_id: user.id, message: msg, status: 'pending' })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return { success: false, error: '이미 대기 중인 관리자 권한 요청이 있습니다.' };
      return { success: false, error: error.message };
    }
    return { success: true, requestId: (data as { id: string })?.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '요청에 실패했습니다.' };
  }
}

/** 내 대기 중인 시스템 관리자 권한 요청 1건 */
export async function getMyPendingAdminAccessRequest(): Promise<AdminAccessRequestRow | null> {
  requireSupabase();
  const {
    data: { user },
  } = await supabase!.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase!
    .from('admin_access_requests')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data as AdminAccessRequestRow | null;
}

/** 시스템 관리자: 대기 중인 관리자 권한 요청 목록 */
export async function listPendingAdminAccessRequests(): Promise<AdminAccessRequestRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('admin_access_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminAccessRequestRow[];
}

export async function approveAdminAccessRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.rpc('approve_admin_access_request', { p_request_id: requestId });
    if (error) return { success: false, error: error.message };
    const row = data as { success?: boolean; error?: string } | null;
    if (row?.success === false) return { success: false, error: row.error ?? '승인에 실패했습니다.' };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '승인에 실패했습니다.' };
  }
}

export async function rejectAdminAccessRequest(requestId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.rpc('reject_admin_access_request', { p_request_id: requestId });
    if (error) return { success: false, error: error.message };
    const row = data as { success?: boolean; error?: string } | null;
    if (row?.success === false) return { success: false, error: row.error ?? '거절에 실패했습니다.' };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '거절에 실패했습니다.' };
  }
}

/** 내가 멤버(또는 소유자)인 프로젝트 ID 목록. 권한 요청 UI에서 "접근 권한 없음" 판단용. */
export async function getMyProjectMemberProjectIds(): Promise<string[]> {
  requireSupabase();
  const { data, error } = await supabase!.from('project_members').select('project_id');
  if (error) return [];
  return ((data ?? []) as { project_id: string }[]).map((r) => r.project_id);
}

/** 편집 가능한 프로젝트 ID 목록 (소유자 또는 승인된 멤버: viewer/editor 포함). DB RPC와 동일. */
export async function getMyEditableProjectIds(): Promise<string[]> {
  requireSupabase();
  const { data, error } = await supabase!.rpc('get_user_editable_project_ids');
  if (error) return [];
  return Array.isArray(data) ? (data as string[]) : [];
}

// ─── 사전 초대 (미가입자) ────────────────────────────────────────────────────
// 흐름: ShareModal에서 미가입자(이름/이메일)를 등록 → pending_project_invitations에 저장
// → 그 사람이 회원가입하면 ensure_profile RPC가 자동으로 project_members에 옮김.

/** 특정 프로젝트의 사전 초대 목록 조회. 관리자/소유자만 표시 가능 (RLS). */
export async function fetchPendingProjectInvitations(projectId: string): Promise<PendingProjectInvitationRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('pending_project_invitations')
    .select('*')
    .eq('project_id', projectId)
    .order('invited_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PendingProjectInvitationRow[];
}

/** 사전 초대 추가. email 또는 full_name 중 적어도 하나는 필수.
 * 성공 시 INSERT 직후 .select()로 추가된 행을 함께 반환한다.
 * SELECT RLS가 미적용/오류 상태에서도 클라이언트가 즉시 UI에 반영하기 위함. */
export async function addPendingProjectInvitation(
  projectId: string,
  identifier: { email?: string | null; full_name?: string | null },
  role: 'editor' | 'viewer',
): Promise<{ success: boolean; error?: string; row?: PendingProjectInvitationRow }> {
  requireSupabase();
  const email = identifier.email?.trim() || null;
  const fullName = identifier.full_name?.trim() || null;
  if (!email && !fullName) {
    return { success: false, error: '이름 또는 이메일이 필요합니다.' };
  }
  try {
    const { data, error } = await supabase!
      .from('pending_project_invitations')
      .insert({ project_id: projectId, email, full_name: fullName, role })
      .select()
      .single();
    if (error) {
      // 23505 = unique_violation (같은 프로젝트에 같은 이메일/이름 중복)
      if (error.code === '23505') return { success: false, error: '이미 사전 등록된 사용자입니다.' };
      return { success: false, error: error.message };
    }
    return { success: true, row: data as PendingProjectInvitationRow };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '사전 등록에 실패했습니다.' };
  }
}

/** 사전 초대 제거 (관리자/소유자만 가능 — RLS). */
export async function removePendingProjectInvitation(invitationId: string): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!.from('pending_project_invitations').delete().eq('id', invitationId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '사전 등록 제거에 실패했습니다.' };
  }
}
