import { supabase, supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from '../supabase';
import type { ProfileRow } from '../supabase';
import { requireSupabase, isRpcDisabled, isRpcNotFoundError, disableRpc } from './client';

function isApprovedColumnError(err: { message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes("'approved'") || (msg.includes('approved') && (msg.includes('schema') || msg.includes('cache')));
}

function isOrgProfileColumnsError(err: { message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('department') || msg.includes('managed_org');
}

/** 회원 목록. approved / 조직 컬럼이 없으면 단계별로 폴백 조회한다. 에러 시 예외 발생. */
export async function fetchProfiles(): Promise<ProfileRow[]> {
  requireSupabase();
  const mapApproved = <T extends Omit<ProfileRow, 'approved'>>(rows: T[]): ProfileRow[] => rows.map((row) => ({ ...row, approved: true }));

  try {
    const { data, error } = await supabase!
      .from('profiles')
      .select('id, email, full_name, created_at, is_admin, approved, department, managed_org_node_id')
      .order('created_at', { ascending: false });
    if (!error) return (data ?? []) as ProfileRow[];
    if (isApprovedColumnError(error)) {
      const { data: r2, error: e2 } = await supabase!
        .from('profiles')
        .select('id, email, full_name, created_at, is_admin, department, managed_org_node_id')
        .order('created_at', { ascending: false });
      if (!e2) return mapApproved((r2 ?? []) as Omit<ProfileRow, 'approved'>[]);
      const { data: r3, error: e3 } = await supabase!
        .from('profiles')
        .select('id, email, full_name, created_at, is_admin')
        .order('created_at', { ascending: false });
      if (!e3) return mapApproved((r3 ?? []) as Omit<ProfileRow, 'approved'>[]);
      throw new Error(e3.message);
    }
    if (isOrgProfileColumnsError(error)) {
      const { data: r2, error: e2 } = await supabase!
        .from('profiles')
        .select('id, email, full_name, created_at, is_admin, approved')
        .order('created_at', { ascending: false });
      if (!e2) return (r2 ?? []) as ProfileRow[];
      throw new Error(e2.message);
    }
    throw new Error(error.message);
  } catch (e) {
    if (e instanceof Error && isApprovedColumnError(e)) {
      const { data: r3, error: e3 } = await supabase!
        .from('profiles')
        .select('id, email, full_name, created_at, is_admin')
        .order('created_at', { ascending: false });
      if (!e3) return mapApproved((r3 ?? []) as Omit<ProfileRow, 'approved'>[]);
      throw new Error(e3.message, { cause: e });
    }
    throw e instanceof Error ? e : new Error('회원 목록을 불러올 수 없습니다.');
  }
}

/** 프로필에서 레벨별 색상 조회. 로그인 사용자용. profiles 없으면 null 반환. */
export async function fetchProfileLevelColors(userId: string): Promise<Array<{ r: number; g: number; b: number }> | null> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.from('profiles').select('level_colors').eq('id', userId).maybeSingle();
    if (error) return null;
    const colors = (data as { level_colors?: unknown } | null)?.level_colors;
    if (!Array.isArray(colors)) return null;
    const valid = colors.filter(
      (c): c is { r: number; g: number; b: number } =>
        c &&
        typeof c === 'object' &&
        typeof (c as Record<string, unknown>).r === 'number' &&
        typeof (c as Record<string, unknown>).g === 'number' &&
        typeof (c as Record<string, unknown>).b === 'number',
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
    const { error } = await supabase!.from('profiles').update({ level_colors: colors }).eq('id', userId);
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
          '접속 통계를 불러올 수 없습니다. Supabase DB에 방문 통계 마이그레이션( visits, record_visit, get_member_visit_stats )을 적용하고, 함수 실행 권한(GRANT)을 확인하세요.',
        );
      }
      return {};
    }
    const rows = (data ?? []) as { user_id: string; login_count: number; last_visited_at: string | null }[];
    const out: Record<string, { login_count: number; last_visited_at: string | null }> = {};
    rows.forEach((r) => {
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
    rows.forEach((r) => {
      out[r.user_id] = r.display_name || '(이메일 없음)';
    });
    return out;
  } catch {
    return {};
  }
}

/** 등록 회원(profiles) 수. RPC `get_registered_member_count` 미배포 시 RLS 범위 내 count 폴백. */
export async function getRegisteredMemberCount(): Promise<number> {
  if (!isSupabaseConfigured || !supabase) return 0;
  if (!isRpcDisabled('get_registered_member_count')) {
    try {
      const { data, error } = await supabase.rpc('get_registered_member_count');
      if (!error) return typeof data === 'number' ? data : Number(data) || 0;
      if (isRpcNotFoundError(error)) disableRpc('get_registered_member_count');
    } catch {
      /* fall through */
    }
  }
  try {
    const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
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

/** 금일 접속한 사용자 목록(대시보드). RPC `get_daily_visitors` 미배포 시 빈 배열. */
export type DailyVisitorRow = {
  userId: string;
  displayName: string;
  visitedAt: string;
};

export async function getDailyVisitors(): Promise<DailyVisitorRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  if (isRpcDisabled('get_daily_visitors')) return [];
  try {
    const { data, error } = await supabase.rpc('get_daily_visitors');
    if (error) {
      if (isRpcNotFoundError(error)) disableRpc('get_daily_visitors');
      return [];
    }
    const raw = data as unknown;
    let arr: unknown[] = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p)) arr = p;
      } catch {
        /* ignore */
      }
    }
    return arr.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        userId: String(r.user_id ?? ''),
        displayName: String(r.display_name ?? ''),
        visitedAt: String(r.visited_at ?? ''),
      };
    });
  } catch {
    return [];
  }
}

/** 누적 접속 순위(대시보드). RPC `get_visitor_ranking` 미배포 시 빈 배열. */
export type VisitorRankingRow = {
  userId: string;
  displayName: string;
  visitCount: number;
  lastVisitedAt: string;
};

export async function getVisitorRanking(): Promise<VisitorRankingRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  if (isRpcDisabled('get_visitor_ranking')) return [];
  try {
    const { data, error } = await supabase.rpc('get_visitor_ranking');
    if (error) {
      if (isRpcNotFoundError(error)) disableRpc('get_visitor_ranking');
      return [];
    }
    const raw = data as unknown;
    let arr: unknown[] = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p)) arr = p;
      } catch {
        /* ignore */
      }
    }
    return arr.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        userId: String(r.user_id ?? ''),
        displayName: String(r.display_name ?? ''),
        visitCount: Number(r.visit_count) || 0,
        lastVisitedAt: String(r.last_visited_at ?? ''),
      };
    });
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

/** 관리자: 회원의 부서·조직 책임 범위 수정 (시스템 관리자 RLS 필요). 조직 책임자는 호출 불가. */
export async function updateMemberOrgFields(
  userId: string,
  fields: { department?: string | null; managed_org_node_id?: string | null },
): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const patch: Record<string, string | null> = {};
    if (fields.department !== undefined) patch.department = fields.department?.trim() || null;
    if (fields.managed_org_node_id !== undefined) {
      patch.managed_org_node_id = fields.managed_org_node_id?.trim() || null;
    }
    if (Object.keys(patch).length === 0) return { success: true };
    const { error } = await supabase!.from('profiles').update(patch).eq('id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch {
    return { success: false, error: 'profiles 테이블을 사용할 수 없습니다.' };
  }
}

/** 관리자·조직 책임자: 회원 역할(is_admin) 변경 — DB RPC에서 권한 분기, 미배포 DB는 관리자 직접 UPDATE 폴백 */
export async function updateMemberRole(userId: string, isAdmin: boolean): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { data, error } = await supabase!.rpc('update_member_is_admin', {
      p_target_user_id: userId,
      p_is_admin: isAdmin,
    });
    if (!error && data !== null && data !== undefined) {
      const row = data as { success?: boolean; error?: string };
      if (row.success === true) return { success: true };
      if (row.success === false && row.error) return { success: false, error: row.error };
      if (typeof row === 'object' && row.success === false) return { success: false, error: row.error ?? '역할 변경에 실패했습니다.' };
      return { success: true };
    }

    const rpcUnavailable = error && isRpcNotFoundError(error);
    const rpcReturnedError = error && !rpcUnavailable;
    if (rpcReturnedError) return { success: false, error: error.message };

    /* RPC 없음 또는 네트워크 등: 폴백 (조직 책임자는 RLS로 실패 → 마이그레이션 필요 안내 가능) */
    const { error: updErr } = await supabase!.from('profiles').update({ is_admin: isAdmin }).eq('id', userId);
    if (updErr) return { success: false, error: updErr.message };
    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg || '역할 변경에 실패했습니다.' };
  }
}

/** 관리자 여부. ensure_profile RPC 없으면 false 반환. */
export async function checkIsAdmin(): Promise<boolean> {
  const status = await getProfileStatus();
  return status?.isAdmin === true;
}

export type LoginProfileStatus = {
  isAdmin: boolean;
  approved: boolean;
  /** 회원 계정 소속 부서 문자열 */
  department: string | null;
  /** 설정 시 해당 org 노드 subtree 소속 회원만 역할 수정 가능 */
  managedOrgNodeId: string | null;
  /** managed_org_node_id 가 비어있지 않을 때 true */
  isOrgScopeManager: boolean;
};

/** 로그인 사용자의 프로필 상태(관리자·승인·조직 책임자 범위). 미승인 시 로컬 전용 사용. */
export async function getProfileStatus(): Promise<LoginProfileStatus | null> {
  requireSupabase();
  const fallbackStatus = (): LoginProfileStatus => ({
    isAdmin: false,
    approved: true,
    department: null,
    managedOrgNodeId: null,
    isOrgScopeManager: false,
  });
  try {
    const { data, error } = await supabase!.rpc('ensure_profile');
    if (!error) {
      const result = data as {
        is_admin?: boolean;
        approved?: boolean;
        managed_org_node_id?: string | null;
        department?: string | null;
        is_org_scope_manager?: boolean;
      };
      const rawManaged = result.managed_org_node_id;
      const managedStr = rawManaged !== undefined && rawManaged !== null ? String(rawManaged).trim() : '';
      const deptStr = result.department !== undefined && result.department !== null ? String(result.department).trim() : '';
      return {
        isAdmin: result?.is_admin === true,
        approved: result?.approved !== false,
        department: deptStr.length > 0 ? deptStr : null,
        managedOrgNodeId: managedStr.length > 0 ? managedStr : null,
        isOrgScopeManager: result?.is_org_scope_manager === true || managedStr.length > 0,
      };
    }
    try {
      const { data: authData } = await supabase!.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) return fallbackStatus();
      let row: Record<string, unknown> | null = null;
      const trySelectOrg = async () => {
        const { data: r, error: selErr } = await supabase!
          .from('profiles')
          .select('is_admin, approved, department, managed_org_node_id')
          .eq('id', uid)
          .maybeSingle();
        if (!selErr) row = r as Record<string, unknown>;
        else {
          const { data: r2, error: e2 } = await supabase!.from('profiles').select('is_admin, approved').eq('id', uid).maybeSingle();
          if (!e2) row = r2 as Record<string, unknown>;
        }
      };
      await trySelectOrg();
      if (!row) return fallbackStatus();
      const r = row;
      const isAdminVal = r.is_admin === true;
      const approvedVal = r.approved !== false;
      const managedRaw = r.managed_org_node_id != null ? String(r.managed_org_node_id).trim() : '';
      const deptRaw = r.department != null ? String(r.department).trim() : '';
      return {
        isAdmin: isAdminVal,
        approved: approvedVal,
        department: deptRaw.length > 0 ? deptRaw : null,
        managedOrgNodeId: managedRaw.length > 0 ? managedRaw : null,
        isOrgScopeManager: managedRaw.length > 0,
      };
    } catch {
      return fallbackStatus();
    }
  } catch {
    try {
      const { data: authData } = await supabase!.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) return fallbackStatus();
      const { data: row, error: selErr } = await supabase!
        .from('profiles')
        .select('is_admin, approved, department, managed_org_node_id')
        .eq('id', uid)
        .maybeSingle();
      if (selErr || !row) return fallbackStatus();
      const r = row as Record<string, unknown>;
      const managedRaw = r.managed_org_node_id != null ? String(r.managed_org_node_id).trim() : '';
      const deptRaw = r.department != null ? String(r.department).trim() : '';
      return {
        isAdmin: r.is_admin === true,
        approved: r.approved !== false,
        department: deptRaw.length > 0 ? deptRaw : null,
        managedOrgNodeId: managedRaw.length > 0 ? managedRaw : null,
        isOrgScopeManager: managedRaw.length > 0,
      };
    } catch {
      return fallbackStatus();
    }
  }
}

/** 관리자: 회원 승인(approved). 승인 후 해당 회원은 DB와 동기화 가능. */
export async function updateMemberApproved(userId: string, approved: boolean): Promise<{ success: boolean; error?: string }> {
  requireSupabase();
  try {
    const { error } = await supabase!.from('profiles').update({ approved }).eq('id', userId);
    if (error) {
      const msg = error.message ?? '';
      if (msg.includes("'approved'") || (msg.includes('approved') && (msg.includes('schema') || msg.includes('cache')))) {
        return {
          success: false,
          error:
            '승인 기능을 사용하려면 DB 마이그레이션(approved 컬럼)을 적용해 주세요. Supabase 대시보드에서 supabase/migrations/20250312010000_add_profiles_approved.sql 을 실행하세요.',
        };
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
  options?: { wbsAdminPassword?: string },
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
        Authorization: `Bearer ${authToken}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as { success?: boolean; error?: string };
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
