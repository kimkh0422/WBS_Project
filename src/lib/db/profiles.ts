import { supabase, supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from '../supabase';
import type { ProfileRow } from '../supabase';
import { requireSupabase, isRpcDisabled, isRpcNotFoundError, disableRpc } from './client';

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
      if (error) throw new Error(error.message, { cause: e });
      return ((data ?? []) as Omit<ProfileRow, 'approved'>[]).map(row => ({ ...row, approved: true }));
    }
    throw e instanceof Error ? e : new Error('회원 목록을 불러올 수 없습니다.');
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
        c && typeof c === 'object' && typeof (c as Record<string, unknown>).r === 'number' && typeof (c as Record<string, unknown>).g === 'number' && typeof (c as Record<string, unknown>).b === 'number'
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
        approved: result?.approved !== false,
      };
    }
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
        return { isAdmin: false, approved: true };
      }
      const r = (row ?? {}) as { is_admin?: boolean | null; approved?: boolean | null };
      return {
        isAdmin: r.is_admin === true,
        approved: r.approved !== false,
      };
    } catch {
      return { isAdmin: false, approved: true };
    }
  } catch {
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
