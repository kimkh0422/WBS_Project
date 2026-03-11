import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] 환경변수가 설정되지 않았습니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.'
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ─── DB Row 타입 (snake_case) ───────────────────────────────────────────────

export interface ProjectAssignmentRow {
  assignee: string;
  allocation_percent: number;
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
  sort_order: number;
  is_milestone?: boolean;
  baseline_start_date?: string | null;
  baseline_end_date?: string | null;
  baseline_work_effort?: number | null;
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
  /** 사용자 맞춤 레벨별 색상 [{r,g,b}, ...]. null이면 기본값 사용 */
  level_colors?: Array<{ r: number; g: number; b: number }> | null;
}
