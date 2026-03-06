import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn('[Supabase] 환경변수가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요.');
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ─── DB Row 타입 (snake_case) ───────────────────────────────────────────────

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
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
