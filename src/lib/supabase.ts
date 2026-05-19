import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn('[Supabase] 환경변수가 설정되지 않았습니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.');
}

/**
 * In-process auth lock (replaces Web Locks API). Avoids "orphaned lock" noise and
 * occasional 5s waits when React Strict Mode mounts/unmounts quickly while
 * getSession / Realtime compete for navigator.locks on the auth token.
 * Cross-tab session coordination is reduced; same-tab behavior stays correct.
 */
function createInProcessAuthLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => {
    const run = chain.then(() => fn());
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/**
 * 모든 REST 요청에 apikey 헤더를 보장하는 커스텀 fetch.
 * 클라이언트가 apikey를 정상적으로 포함하지 못하는 엣지케이스(세션 갱신 타이밍,
 * 브라우저 확장 등)를 방어적으로 처리한다.
 */
function makeApikeyGuardedFetch(anonKey: string) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) {
      headers.set('apikey', anonKey);
    }
    return fetch(input, { ...init, headers });
  };
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Typed via GoTrueClientOptions.lock (serializes auth in-tab; avoids Web Locks + Strict Mode noise)
        lock: createInProcessAuthLock() as NonNullable<NonNullable<Parameters<typeof createClient>[2]>['auth']>['lock'],
      },
      global: {
        fetch: makeApikeyGuardedFetch(supabaseAnonKey),
      },
    })
  : null;

// ─── DB Row 타입 (snake_case) ───────────────────────────────────────────────

export interface ProjectAssignmentRow {
  assignee: string;
  allocation_percent: number;
  /** 기간별 월별 투입비율. 키: "YYYY-MM", 값: 해당 월 비율 */
  monthly_allocations?: Record<string, number> | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  assignments: ProjectAssignmentRow[] | null;
  owner_id?: string | null;
  min_work_effort_days?: number | null;
  work_effort_unit?: string | null;
  created_at?: string;
  project_kind?: string | null;
  report_category?: string | null;
  report_agency?: string | null;
  report_budget_this_year?: string | null;
  report_total_period?: string | null;
  report_name_short?: string | null;
  report_name_full?: string | null;
  /** 사용자 정의 그룹 ID. wbs_settings.config_json.projectGroups의 항목과 매핑 */
  group_id?: string | null;
}

export type ProjectMemberRole = 'owner' | 'editor' | 'viewer';

export interface ProjectMemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  invited_at?: string;
}

export interface ProjectInviteRow {
  id: string;
  project_id: string;
  token: string;
  role: 'editor' | 'viewer';
  expires_at: string;
  created_at?: string;
}

/** 프로젝트 사전 초대 — 아직 가입하지 않은 사람을 미리 멤버로 등록.
 * 가입 후 ensure_profile RPC가 자동으로 project_members에 옮긴다. */
export interface PendingProjectInvitationRow {
  id: string;
  project_id: string;
  email: string | null;
  full_name: string | null;
  role: 'editor' | 'viewer';
  invited_at?: string;
  invited_by?: string | null;
}

/** 프로젝트 권한 요청 (승인 사용자가 보기/편집 권한 요청) */
export interface ProjectAccessRequestRow {
  id: string;
  project_id: string;
  user_id: string;
  requested_role: 'viewer' | 'editor';
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

/** 시스템 관리자(DB is_admin) 권한 요청 */
export interface AdminAccessRequestRow {
  id: string;
  user_id: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

export interface TaskRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  start_date: string;
  end_date: string;
  progress: number;
  assignee: string;
  status: string;
  expanded: boolean;
  dependencies: string[];
  work_effort: number | null;
  description: string | null;
  checklist: { id: string; text: string; completed: boolean }[];
  deliverables: string | null;
  /** 사용자가 직접 편집해 롤업/자동계산에서 보호할 필드 목록 */
  user_locked_fields?: Array<'dependencies' | 'startDate' | 'endDate' | 'workEffort' | 'progress'> | null;
  sort_order: number;
  is_milestone?: boolean;
  is_issue?: boolean;
  is_action_item?: boolean;
  baseline_start_date?: string | null;
  baseline_end_date?: string | null;
  baseline_work_effort?: number | null;
  /** 진척 가중치(상대 중요도, 형제 합 제약 없음). 상위 진척률 롤업 시 가중평균에 사용 */
  weight?: number | null;
  /** 사용자 정의 컬럼 값 (key: custom column id, value: text) */
  custom_fields?: Record<string, string> | null;
  created_at?: string;
  updated_at?: string;
}

export interface SettingsRow {
  id: string;
  level1_prefix: string;
  level2_prefix: string;
  level3_prefix: string;
  max_level: number;
  /** 나머지 모든 설정 (statusConfigs, appTitle 등) */
  config_json?: Record<string, unknown> | null;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at?: string;
  is_admin: boolean;
  /** 조직도 부서명과 동일 문자열 (org 책임자가 같은 범위 내 역할 수정 시 필요) */
  department?: string | null;
  /** 지정 시 팀장·사업부장 등: 해당 org 노드 subtree 소속 회원의 is_admin만 변경 가능 */
  managed_org_node_id?: string | null;
  /** 관리자 승인 여부. false면 로컬 전용, true면 DB 동기화 사용 가능 */
  approved?: boolean;
  /** 사용자 맞춤 레벨별 색상 [{r,g,b}, ...]. null이면 기본값 사용 */
  level_colors?: Array<{ r: number; g: number; b: number }> | null;
  /** 접속 횟수 (visits 집계, 관리자 회원 목록에서만) */
  login_count?: number;
  /** 마지막 접속 시각 (ISO 문자열, 관리자 회원 목록에서만) */
  last_visited_at?: string | null;
}
