import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] 환경변수가 설정되지 않았습니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.'
  );
}

/**
 * In-process auth lock (replaces Web Locks API). Avoids "orphaned lock" noise and
 * occasional 5s waits when React Strict Mode mounts/unmounts quickly while
 * getSession / Realtime compete for navigator.locks on the auth token.
 * Cross-tab session coordination is reduced; same-tab behavior stays correct.
 */
function createInProcessAuthLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return async (
    _name: string,
    _acquireTimeout: number,
    fn: () => Promise<unknown>
  ) => {
    const run = chain.then(() => fn());
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Typed via GoTrueClientOptions.lock (serializes auth in-tab; avoids Web Locks + Strict Mode noise)
        lock: createInProcessAuthLock() as NonNullable<
          NonNullable<Parameters<typeof createClient>[2]>['auth']
        >['lock'],
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
  created_at?: string;
  report_category?: string | null;
  report_agency?: string | null;
  report_budget_this_year?: string | null;
  report_total_period?: string | null;
  report_name_short?: string | null;
  report_name_full?: string | null;
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
  baseline_start_date?: string | null;
  baseline_end_date?: string | null;
  baseline_work_effort?: number | null;
  /** 진척 가중치 (상위 입력 시 하위 비율 재분배, DB 반영용) */
  weight?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface SettingsRow {
  id: string;
  level1_prefix: string;
  level2_prefix: string;
  level3_prefix: string;
  max_level: number;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at?: string;
  is_admin: boolean;
  /** 관리자 승인 여부. false면 로컬 전용, true면 DB 동기화 사용 가능 */
  approved?: boolean;
  /** 사용자 맞춤 레벨별 색상 [{r,g,b}, ...]. null이면 기본값 사용 */
  level_colors?: Array<{ r: number; g: number; b: number }> | null;
  /** 접속 횟수 (visits 집계, 관리자 회원 목록에서만) */
  login_count?: number;
  /** 마지막 접속 시각 (ISO 문자열, 관리자 회원 목록에서만) */
  last_visited_at?: string | null;
}
