import { supabase } from '../supabase';
import type { ProjectRow } from '../supabase';
import type { Project } from '../../types';
import { requireSupabase, getAuthedUserId } from './client';
import { toProjectRow, toProjectRowMinimal, fromProjectRow } from './mappers';
import { insertAuditLog, diffProjectFields } from './audit';
import type { AuditAction } from './audit';

export function isAssignmentsSchemaError(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return err.code === 'PGRST204' || msg.includes("'assignments'") || msg.includes('assignments');
}

export async function fetchProjects(): Promise<Project[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('projects')
    // egress 절감: 필요한 컬럼만 조회
    .select(
      'id,name,description,start_date,end_date,assignments,owner_id,min_work_effort_days,report_category,report_agency,report_budget_this_year,report_total_period,report_name_short,report_name_full,group_id,created_at',
    )
    .order('created_at', { ascending: true });
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

export async function upsertProject(project: Project): Promise<void> {
  requireSupabase();
  const existing = await supabase!
    .from('projects')
    .select('id, name, description, start_date, end_date')
    .eq('id', project.id)
    .maybeSingle();
  const existingRow = (existing.data ?? null) as ProjectRow | null;
  const row = toProjectRow(project);
  // RLS 환경에서 upsert(INSERT .. ON CONFLICT DO UPDATE)는 INSERT 정책의 WITH CHECK가
  // "충돌로 UPDATE 되는 케이스"에도 적용되어, 소유자(owner)가 아닌 editor 사용자가
  // 프로젝트를 저장할 때 실패할 수 있음.
  // 따라서 "존재하면 update, 없으면 insert"로 분기한다.
  if (existingRow) {
    const { error } = await supabase!.from('projects').update(row).eq('id', project.id);
    if (error && isAssignmentsSchemaError(error)) {
      const { error: err2 } = await supabase!
        .from('projects')
        .update(toProjectRowMinimal(project) as Record<string, unknown>)
        .eq('id', project.id);
      if (err2) throw err2;
    } else if (error) {
      throw error;
    }
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
    const { error } = await supabase!.from('projects').insert(insertRow);
    if (error && isAssignmentsSchemaError(error)) {
      const minimal = toProjectRowMinimal(project) as Record<string, unknown>;
      const minimalWithOwner = authedUserId ? { ...minimal, owner_id: authedUserId } : minimal;
      const { error: err2 } = await supabase!.from('projects').insert(minimalWithOwner);
      if (err2) throw err2;
    } else if (error) {
      throw error;
    }
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
  await insertAuditLog({
    project_id: id,
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
