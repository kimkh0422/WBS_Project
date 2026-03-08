import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] 환경변수가 설정되지 않았습니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하거나 .env.example을 참고하세요. (미설정 시 로컬 저장 모드로 동작)'
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
  assignments: ProjectAssignmentRow[] | null;
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
