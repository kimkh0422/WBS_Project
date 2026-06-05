import { supabase } from '../supabase';

/** 주간보고 — 프로젝트 진척 한 행 */
export type WeeklyReportProjectRow = {
  name: string;
  period: string;
  owner: string;
  planPct: string;
  actualPct: string;
  content: string;
  issue: string;
  note: string;
};

/** 주간보고 — 이슈 한 행 */
export type WeeklyReportIssueRow = {
  title: string;
  content: string;
  plan: string;
  result: string;
  note: string;
};

/** 주간보고 본문(jsonb) */
export type WeeklyReportContent = {
  projects: WeeklyReportProjectRow[];
  issues: WeeklyReportIssueRow[];
  nextWeek: string[];
  etc: string;
};

/** 등록된 주간보고 1건 */
export type WeeklyReportRecord = {
  id: string;
  authorId: string | null;
  organization: string;
  reporter: string;
  weekStart: string | null;
  weekEnd: string | null;
  title: string;
  content: WeeklyReportContent;
  createdAt: string;
  updatedAt: string;
};

/** 작성/수정 입력 */
export type WeeklyReportInput = {
  organization: string;
  reporter: string;
  weekStart: string | null;
  weekEnd: string | null;
  title: string;
  content: WeeklyReportContent;
};

type WeeklyReportRow = {
  id: string;
  author_id: string | null;
  organization: string | null;
  reporter: string | null;
  week_start: string | null;
  week_end: string | null;
  title: string | null;
  content: unknown;
  created_at: string;
  updated_at: string;
};

export function emptyWeeklyReportContent(): WeeklyReportContent {
  return { projects: [], issues: [], nextWeek: [], etc: '' };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function normalizeProject(p: unknown): WeeklyReportProjectRow {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  return {
    name: str(o.name),
    period: str(o.period),
    owner: str(o.owner),
    planPct: str(o.planPct),
    actualPct: str(o.actualPct),
    content: str(o.content),
    issue: str(o.issue),
    note: str(o.note),
  };
}

function normalizeIssue(i: unknown): WeeklyReportIssueRow {
  const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
  return {
    title: str(o.title),
    content: str(o.content),
    plan: str(o.plan),
    result: str(o.result),
    note: str(o.note),
  };
}

/** jsonb 본문을 안전하게 정규화(누락/형식오류 방어) */
export function normalizeWeeklyReportContent(raw: unknown): WeeklyReportContent {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    projects: Array.isArray(c.projects) ? c.projects.map(normalizeProject) : [],
    issues: Array.isArray(c.issues) ? c.issues.map(normalizeIssue) : [],
    nextWeek: Array.isArray(c.nextWeek) ? c.nextWeek.map(str).filter((s) => s.trim() !== '') : [],
    etc: str(c.etc),
  };
}

function mapRow(r: WeeklyReportRow): WeeklyReportRecord {
  return {
    id: r.id,
    authorId: r.author_id,
    organization: str(r.organization),
    reporter: str(r.reporter),
    weekStart: r.week_start,
    weekEnd: r.week_end,
    title: str(r.title),
    content: normalizeWeeklyReportContent(r.content),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLUMNS = 'id, author_id, organization, reporter, week_start, week_end, title, content, created_at, updated_at';

/** 등록된 주간보고 전체 조회(최근 주차·최근 수정 우선) */
export async function fetchWeeklyReports(): Promise<WeeklyReportRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('weekly_reports')
    .select(COLUMNS)
    .order('week_start', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as WeeklyReportRow[]).map(mapRow);
}

/** 주간보고 등록(신규). author_id는 RLS(본인만 작성)에 맞춰 현재 사용자로 설정. */
export async function insertWeeklyReport(input: WeeklyReportInput, authorId: string): Promise<WeeklyReportRecord> {
  if (!supabase) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await supabase
    .from('weekly_reports')
    .insert({
      author_id: authorId,
      organization: input.organization,
      reporter: input.reporter,
      week_start: input.weekStart,
      week_end: input.weekEnd,
      title: input.title,
      content: input.content,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data as WeeklyReportRow);
}

/** 주간보고 수정(본인 보고만 — RLS). */
export async function updateWeeklyReport(id: string, input: WeeklyReportInput): Promise<WeeklyReportRecord> {
  if (!supabase) throw new Error('Supabase 설정이 필요합니다.');
  const { data, error } = await supabase
    .from('weekly_reports')
    .update({
      organization: input.organization,
      reporter: input.reporter,
      week_start: input.weekStart,
      week_end: input.weekEnd,
      title: input.title,
      content: input.content,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data as WeeklyReportRow);
}

/** 주간보고 삭제(본인 보고만 — RLS). */
export async function deleteWeeklyReport(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase 설정이 필요합니다.');
  const { error } = await supabase.from('weekly_reports').delete().eq('id', id);
  if (error) throw error;
}
