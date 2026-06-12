import { supabase } from '../supabase';
import type { ProjectRow } from '../supabase';
import type { Project } from '../../types';
import { requireSupabase, getAuthedUserId, getMissingColumnNameFromPgrst204, stripSelectListColumn } from './client';
import { toProjectRow, fromProjectRow } from './mappers';
import { insertAuditLog, diffProjectFields } from './audit';
import type { AuditAction } from './audit';

export function isAssignmentsSchemaError(err: { code?: string | number; message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return err.code === 'PGRST204' || msg.includes("'assignments'") || msg.includes('assignments');
}

export function isMissingColumnError(
  err: { code?: string | number; message?: string; details?: string; hint?: string },
  columnName: string,
): boolean {
  const col = columnName.toLowerCase();
  const msg = [err.message, err.details, err.hint].filter(Boolean).join(' ').toLowerCase();
  const codeStr = String(err.code ?? '').trim();
  // 클라이언트·PostgREST 버전에 따라 code가 문자열 또는 숫자로 올 수 있음
  const is42703 = codeStr === '42703' || err.code === 42703;
  const isPgrst204 = codeStr === 'PGRST204' || err.code === 'PGRST204';

  // PostgREST 스키마 캐시 기준 알 수 없는 컬럼
  if (isPgrst204) {
    return msg.includes(`'${col}'`) || msg.includes(col);
  }

  // PostgreSQL undefined_column — 원격 DB에 컬럼이 아직 없을 때 흔히 42703으로 올라옴
  if (is42703 && msg.includes('does not exist') && msg.includes(col)) {
    return true;
  }

  // code가 비어 있거나 래핑된 경우에도 메시지로 보조 판별 (undefined_column 문구)
  if (msg.includes('column') && msg.includes('does not exist') && msg.includes(col)) {
    return true;
  }

  // 일부 클라이언트는 code 필드 없이 `[42703] column ...` 형태만 message에 실음
  const bracketCode = msg.match(/^\s*\[(\d+)\]\s/)?.[1];
  if (bracketCode === '42703' && msg.includes('does not exist') && msg.includes(col)) {
    return true;
  }

  return false;
}

/** 스키마가 앱보다 뒤처진 원격 DB용: 알려진 선택 컬럼 누락·assignments 미지원 시 필드를 제거하며 반복 저장 */
const OPTIONAL_PROJECT_WRITE_COLUMNS = [
  'project_kind',
  'pm_name',
  'po_name',
  'include_in_dashboard',
  'formal_name',
  'source_task_id',
  'source_project_id',
] as const;

function stripProjectWritePayloadForError(
  err: { code?: string | number; message?: string; details?: string; hint?: string },
  current: Record<string, unknown>,
): Record<string, unknown> | null {
  if (isAssignmentsSchemaError(err)) {
    const { assignments: _a, ...rest } = current;
    return rest;
  }
  for (const col of OPTIONAL_PROJECT_WRITE_COLUMNS) {
    if (isMissingColumnError(err, col) && Object.prototype.hasOwnProperty.call(current, col)) {
      const { [col]: _removed, ...rest } = current;
      return rest;
    }
  }
  return null;
}

/**
 * RLS가 UPDATE를 USING 불충족으로 막으면 오류 없이 0행이 갱신된다(존재가 확인된 행이라도).
 * 단건 편집(updateProject)에서는 이를 권한 오류로 올려, 서버 풀이 로컬 수정을 조용히
 * 되돌리기 전에 사용자에게 알리고 dirty 플래그로 되돌림을 막는다. handleDbError가 42501을
 * "편집 권한 없음" 안내로 매핑한다.
 */
class ProjectUpdatePermissionError extends Error {
  code = '42501';
  constructor() {
    super('이 프로젝트를 편집할 권한이 없습니다. 소유자 또는 관리자만 수정할 수 있습니다.');
    this.name = 'ProjectUpdatePermissionError';
  }
}

async function updateProjectRowWithSchemaFallback(
  projectId: string,
  row: Record<string, unknown>,
  detectPermissionDenied = false,
): Promise<void> {
  let current: Record<string, unknown> = { ...row };
  for (let attempt = 0; attempt < 24; attempt++) {
    const { data, error } = await supabase!.from('projects').update(current).eq('id', projectId).select('id');
    if (!error) {
      if (detectPermissionDenied && Array.isArray(data) && data.length === 0) {
        throw new ProjectUpdatePermissionError();
      }
      return;
    }
    const next = stripProjectWritePayloadForError(error, current);
    if (next) {
      current = next;
      continue;
    }
    throw error;
  }
  throw new Error('projects.update: 스키마 폴백 시도 횟수 초과');
}

async function insertProjectRowWithSchemaFallback(insertRow: Record<string, unknown>): Promise<void> {
  let current: Record<string, unknown> = { ...insertRow };
  for (let attempt = 0; attempt < 24; attempt++) {
    const { error } = await supabase!.from('projects').insert(current);
    if (!error) return;
    const next = stripProjectWritePayloadForError(error, current);
    if (next) {
      current = next;
      continue;
    }
    throw error;
  }
  throw new Error('projects.insert: 스키마 폴백 시도 횟수 초과');
}

const PROJECT_SELECT_COLUMNS =
  'id,name,formal_name,description,start_date,end_date,assignments,owner_id,min_work_effort_days,project_kind,report_category,report_agency,report_budget_this_year,report_total_period,report_name_short,report_name_full,group_id,pm_name,po_name,include_in_dashboard,source_task_id,source_project_id,created_at';

/** 원격 DB/PostgREST 스키마가 앱보다 낮을 때 select 목록에서 제거해 재시도할 컬럼 (PGRST204 메시지 기준) */
const PROJECT_OPTIONAL_SELECT_COLUMNS = new Set(
  [
    'assignments',
    'end_date',
    'owner_id',
    'min_work_effort_days',
    'project_kind',
    'report_category',
    'report_agency',
    'report_budget_this_year',
    'report_total_period',
    'report_name_short',
    'report_name_full',
    'group_id',
    'pm_name',
    'po_name',
    'include_in_dashboard',
    'formal_name',
    'source_task_id',
    'source_project_id',
  ].map((c) => c.toLowerCase()),
);

export async function fetchProjects(): Promise<Project[]> {
  requireSupabase();
  let selectCols = PROJECT_SELECT_COLUMNS;
  let data: ProjectRow[] | null = null;
  let error: { message?: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 48; attempt++) {
    const res = await supabase!.from('projects').select(selectCols).order('created_at', { ascending: true });
    data = (res.data ?? null) as unknown as ProjectRow[] | null;
    error = res.error;
    if (!error) break;
    const missing = getMissingColumnNameFromPgrst204(error);
    if (!missing || !PROJECT_OPTIONAL_SELECT_COLUMNS.has(missing.toLowerCase())) break;
    const next = stripSelectListColumn(selectCols, missing);
    if (next === selectCols) break;
    selectCols = next;
  }
  if (error) throw error;
  const rows = (data ?? []) as ProjectRow[];
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map(fromProjectRow);
}

export async function upsertProject(project: Project, opts?: { detectPermissionDenied?: boolean }): Promise<void> {
  requireSupabase();
  const UPSERT_EXISTING_OPTIONAL = new Set(['end_date', 'pm_name', 'po_name', 'include_in_dashboard', 'formal_name']);
  let existingSelect = 'id, name, formal_name, description, start_date, end_date, pm_name, po_name, include_in_dashboard';
  let existing = await supabase!.from('projects').select(existingSelect).eq('id', project.id).maybeSingle();
  for (let attempt = 0; attempt < 16 && existing.error; attempt++) {
    const missing = getMissingColumnNameFromPgrst204(existing.error);
    if (!missing || !UPSERT_EXISTING_OPTIONAL.has(missing.toLowerCase())) break;
    const next = stripSelectListColumn(existingSelect, missing);
    if (next === existingSelect) break;
    existingSelect = next;
    existing = await supabase!.from('projects').select(existingSelect).eq('id', project.id).maybeSingle();
  }
  if (existing.error) throw existing.error;
  const existingRow = (existing.data ?? null) as unknown as ProjectRow | null;
  const row = toProjectRow(project);
  // RLS 환경에서 upsert(INSERT .. ON CONFLICT DO UPDATE)는 INSERT 정책의 WITH CHECK가
  // "충돌로 UPDATE 되는 케이스"에도 적용되어, 소유자(owner)가 아닌 editor 사용자가
  // 프로젝트를 저장할 때 실패할 수 있음.
  // 따라서 "존재하면 update, 없으면 insert"로 분기한다.
  if (existingRow) {
    await updateProjectRowWithSchemaFallback(project.id, row as unknown as Record<string, unknown>, opts?.detectPermissionDenied === true);
  } else {
    // 백업/가져오기 데이터에는 ownerId가 타 사용자로 들어있을 수 있음.
    // RLS projects_insert는 owner_id = auth.uid()를 요구하므로,
    // 신규 INSERT 시에는 현재 로그인 사용자를 owner로 강제한다.
    const authedUserId = await getAuthedUserId();
    if (!authedUserId) {
      // 인증 세션이 아직 잡히지 않은 상태에서는 INSERT를 거부.
      // owner_id NULL로 저장되면 이후 RLS가 모든 변경을 거부해 데이터가 보이지 않게 됨.
      throw new Error('로그인 세션이 준비되지 않아 프로젝트를 저장할 수 없습니다.');
    }
    const insertRow = { ...row, owner_id: authedUserId };
    await insertProjectRowWithSchemaFallback(insertRow as unknown as Record<string, unknown>);
  }
  const action: AuditAction = existingRow ? 'update' : 'create';
  const changes = existingRow ? diffProjectFields(existingRow, row) : undefined;
  await insertAuditLog({
    project_id: project.id,
    entity_type: 'project',
    entity_id: project.id,
    entity_name: project.name,
    action,
    changes,
  });
}

export async function deleteProjectFromDB(id: string): Promise<void> {
  requireSupabase();
  const { data: project } = await supabase!.from('projects').select('id, name').eq('id', id).maybeSingle();
  const { error } = await supabase!.from('projects').delete().eq('id', id);
  if (error) throw error;
  const row = project as { id: string; name: string } | null;
  // project_id는 null로 기록한다. wbs_audit_log.project_id는 projects(id) ON DELETE CASCADE FK라,
  // 방금 삭제된 프로젝트 id를 넣으면 외래키 위반(409)이 나고(설령 통과해도 CASCADE로 즉시 삭제됨).
  // 삭제된 프로젝트 식별 정보는 FK가 없는 entity_id·entity_name에 보존한다.
  await insertAuditLog({
    project_id: null,
    entity_type: 'project',
    entity_id: id,
    entity_name: row?.name ?? null,
    action: 'delete',
  });
}

export async function deleteAllProjectsFromDB(): Promise<void> {
  requireSupabase();
  const { error } = await supabase!.from('projects').delete().not('id', 'is', null);
  if (error) throw error;
}
