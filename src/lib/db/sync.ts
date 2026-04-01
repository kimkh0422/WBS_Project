import type { ProjectRow, ProjectAssignmentRow, TaskRow, SettingsRow } from '../supabase';
import type { Task, Project } from '../../types';
import type { WBSSettings } from '../wbsSettings';
import { toTaskRow, toProjectRow, fromTaskRow, toSettingsRow } from './mappers';

function normAssignmentsForSync(a: ProjectAssignmentRow[] | null | undefined): unknown {
  return [...(a ?? [])]
    .map(x => ({
      assignee: x.assignee,
      allocation_percent: x.allocation_percent,
      monthly_allocations: x.monthly_allocations && Object.keys(x.monthly_allocations).length ? x.monthly_allocations : {},
    }))
    .sort((x, y) => x.assignee.localeCompare(y.assignee));
}

function taskContentFingerprint(row: TaskRow): string {
  const deps = [...(row.dependencies ?? [])].sort();
  const checklist = [...(row.checklist ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    project_id: row.project_id,
    parent_id: row.parent_id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    progress: row.progress,
    assignee: row.assignee,
    status: row.status,
    dependencies: deps,
    work_effort: row.work_effort,
    description: row.description,
    checklist,
    deliverables: row.deliverables,
    is_milestone: row.is_milestone ?? false,
    is_issue: row.is_issue ?? false,
    baseline_start_date: row.baseline_start_date ?? null,
    baseline_end_date: row.baseline_end_date ?? null,
    baseline_work_effort: row.baseline_work_effort ?? null,
    weight: row.weight ?? null,
  });
}

/** DB 행 기준 프로젝트 본문 지문 (동일이면 업로드 생략) */
export function fingerprintProjectRowForSync(row: ProjectRow): string {
  return JSON.stringify({
    name: row.name,
    description: row.description ?? null,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    assignments: normAssignmentsForSync(row.assignments),
    min_work_effort_days: row.min_work_effort_days ?? null,
    report_category: row.report_category ?? null,
    report_agency: row.report_agency ?? null,
    report_budget_this_year: row.report_budget_this_year ?? null,
    report_total_period: row.report_total_period ?? null,
    report_name_short: row.report_name_short ?? null,
    report_name_full: row.report_name_full ?? null,
  });
}

export function projectNeedsDbUpload(project: Project, serverById: Map<string, Project>): boolean {
  const sp = serverById.get(project.id);
  if (!sp) return true;
  return projectFingerprintFromProject(project) !== projectFingerprintFromProject(sp);
}

/**
 * Realtime으로 받은 DB 행이 로컬 작업과 "내용상" 동일한지.
 * updated_at·sort_order는 지문에 포함되지 않음 → 본인 저장 직후 에코에서 오탐 충돌 방지용.
 */
export function serverTaskRowMatchesLocalTask(localTask: Task, serverRow: TaskRow): boolean {
  const so =
    typeof serverRow.sort_order === 'number' && Number.isFinite(serverRow.sort_order)
      ? serverRow.sort_order
      : 0;
  const lr = toTaskRow(localTask, so);
  return taskContentFingerprint(lr) === taskContentFingerprint(serverRow);
}

/** 프로젝트 내 작업 id 나열이 서버와 다르면 순서·트리 반영을 위해 해당 프로젝트 작업 전부 업로드 */
export function projectIdsWithTaskOrderDrift(
  localTasks: Task[],
  serverRows: TaskRow[],
  projectIds: Set<string>
): Set<string> {
  const drift = new Set<string>();
  const byPid = (pid: string) => localTasks.filter(t => t.projectId === pid).map(t => t.id);
  const serverByPid = (pid: string) =>
    serverRows
      .filter(r => r.project_id === pid)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(r => r.id);
  for (const pid of projectIds) {
    if (JSON.stringify(byPid(pid)) !== JSON.stringify(serverByPid(pid))) drift.add(pid);
  }
  return drift;
}

export function collectTasksNeedingUpload(
  localTasks: Task[],
  serverById: Map<string, TaskRow>,
  projectIdSet: Set<string>,
  sortOrders?: Map<string, number>
): Task[] {
  const serverRows = [...serverById.values()];
  const driftPids = projectIdsWithTaskOrderDrift(localTasks, serverRows, projectIdSet);
  const out: Task[] = [];
  const seen = new Set<string>();
  for (const t of localTasks) {
    if (!t.projectId || !projectIdSet.has(t.projectId)) continue;
    const sr = serverById.get(t.id);
    if (!sr) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
      continue;
    }
    if (driftPids.has(t.projectId)) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
      continue;
    }
    const localRow = toTaskRow(t, sr.sort_order);
    const contentChanged = taskContentFingerprint(localRow) !== taskContentFingerprint(sr);
    // sort_order가 핑거프린트에 포함되지 않으므로 별도 비교: 로컬 순서와 서버 sort_order가 다르면 업로드
    const localSortOrder = sortOrders?.get(t.id);
    const sortOrderChanged = localSortOrder !== undefined && sr.sort_order !== localSortOrder;
    if (contentChanged || sortOrderChanged) {
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
    }
  }
  return out;
}

export function settingsNeedDbUpload(settings: WBSSettings, serverRow: SettingsRow | null): boolean {
  if (!serverRow) return true;
  const local = toSettingsRow(settings);
  return (
    local.level1_prefix !== serverRow.level1_prefix ||
    local.level2_prefix !== serverRow.level2_prefix ||
    local.level3_prefix !== serverRow.level3_prefix ||
    local.max_level !== serverRow.max_level
  );
}

export function projectFingerprintFromProject(p: Project): string {
  return fingerprintProjectRowForSync(toProjectRow(p) as ProjectRow);
}

/** 서버와 내용이 다른 프로젝트만 로컬 객체 교체 (같으면 참조 유지) */
export function mergeProjectsDelta(local: Project[], serverProjects: Project[]): {
  merged: Project[];
  replacedFromServer: number;
  /** 서버에서 반영된(로컬과 달라 교체된) 프로젝트 id 목록 */
  replacedProjectIds: string[];
} {
  const sm = new Map(serverProjects.map(p => [p.id, p]));
  const replacedIds: string[] = [];
  const out: Project[] = [];
  for (const sp of serverProjects) {
    const lp = local.find(p => p.id === sp.id);
    if (lp && projectFingerprintFromProject(lp) === projectFingerprintFromProject(sp)) out.push(lp);
    else {
      out.push(sp);
      replacedIds.push(sp.id);
    }
  }
  for (const lp of local) {
    if (!sm.has(lp.id)) out.push(lp);
  }
  return { merged: out, replacedFromServer: replacedIds.length, replacedProjectIds: replacedIds };
}

/**
 * 서버와 내용이 다른 작업만 서버 행으로 교체.
 * authoritativeProjectIds: 이번 동기에서 업로드 범위에 들어간 프로젝트 — 서버에 없는 작업 id는 삭제된 것으로 보고 제거.
 * 범위 밖 프로젝트는 로컬 전용 작업을 유지(현재 프로젝트만 동기 시 다른 프로젝트 손실 방지).
 */
export function mergeTasksDelta(
  local: Task[],
  serverRows: TaskRow[],
  authoritativeProjectIds: Set<string>
): { merged: Task[]; replacedFromServer: number; replacedByProject: Record<string, number> } {
  const serverIds = new Set(serverRows.map(r => r.id));
  const lm = new Map(local.map(t => [t.id, t]));
  const replacedByProject: Record<string, number> = {};
  const out: Task[] = [];
  for (const row of serverRows) {
    const st = fromTaskRow(row);
    const lt = lm.get(st.id);
    const contentMatch =
      lt &&
      taskContentFingerprint(toTaskRow(lt, row.sort_order)) === taskContentFingerprint(row);
    if (contentMatch) {
      out.push(
        lt.updatedAt === row.updated_at ? lt : { ...lt, updatedAt: row.updated_at ?? undefined }
      );
    } else {
      out.push(lt ? { ...st, expanded: lt.expanded } : st);
      const pid = row.project_id ?? '';
      replacedByProject[pid] = (replacedByProject[pid] ?? 0) + 1;
    }
  }
  for (const lt of local) {
    if (serverIds.has(lt.id)) continue;
    if (authoritativeProjectIds.has(lt.projectId)) continue;
    out.push(lt);
  }
  return { merged: out, replacedFromServer: Object.values(replacedByProject).reduce((a, b) => a + b, 0), replacedByProject };
}
