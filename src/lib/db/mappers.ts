import type { ProjectRow, ProjectAssignmentRow, TaskRow, SettingsRow } from '../supabase';
import type { Task, Project, ProjectAssignment } from '../../types';
import { normalizeWorkEffortUnit } from '../workEffortUnits';
import type { WBSSettings } from '../wbsSettings';

export function toTaskRow(task: Task, sortOrder: number): TaskRow {
  return {
    id: task.id,
    project_id: task.projectId,
    parent_id: task.parentId ?? null,
    name: task.name,
    start_date: task.startDate ?? '',
    end_date: task.endDate ?? '',
    progress: task.progress ?? 0,
    assignee: task.assignee ?? '',
    status: task.status ?? 'todo',
    expanded: task.expanded ?? false,
    dependencies: task.dependencies ?? [],
    work_effort: task.workEffort ?? null,
    description: task.description ?? null,
    checklist: (task.checklist ?? []) as { id: string; text: string; completed: boolean }[],
    deliverables: task.deliverables ?? null,
    user_locked_fields: (task.userLockedFields ?? []) as TaskRow['user_locked_fields'],
    sort_order: sortOrder,
    is_milestone: task.isMilestone ?? false,
    is_issue: task.isIssue ?? false,
    baseline_start_date: task.baselineStartDate ?? null,
    baseline_end_date: task.baselineEndDate ?? null,
    baseline_work_effort: task.baselineWorkEffort ?? null,
    weight: task.weight ?? null,
    custom_fields: task.customFields ?? {},
  };
}

/** TaskRow → Task (동기화 시 DB 전체 내려받기·로컬 저장용) */
export function fromTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    assignee: row.assignee,
    status: row.status as Task['status'],
    expanded: row.expanded,
    dependencies: row.dependencies ?? [],
    workEffort: row.work_effort ?? undefined,
    description: row.description ?? undefined,
    checklist: row.checklist ?? [],
    deliverables: row.deliverables ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    isMilestone: row.is_milestone ?? false,
    isIssue: row.is_issue ?? false,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineEndDate: row.baseline_end_date ?? undefined,
    baselineWorkEffort: row.baseline_work_effort ?? undefined,
    weight: row.weight ?? undefined,
    customFields: row.custom_fields ?? undefined,
    userLockedFields: Array.isArray(row.user_locked_fields)
      ? (row.user_locked_fields.filter(Boolean) as Task['userLockedFields'])
      : undefined,
  };
}

export function toProjectRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    start_date: project.startDate ?? null,
    end_date: project.endDate ?? null,
    assignments: (project.assignments ?? []).map((a) => ({
      assignee: a.assignee,
      allocation_percent: a.allocationPercent,
      ...(a.monthlyAllocations && Object.keys(a.monthlyAllocations).length > 0 ? { monthly_allocations: a.monthlyAllocations } : {}),
    })),
    owner_id: project.ownerId ?? null,
    min_work_effort_days: project.minWorkEffortDays ?? null,
    work_effort_unit: normalizeWorkEffortUnit(project.workEffortUnit),
    report_category: project.reportCategory ?? null,
    report_agency: project.reportAgency ?? null,
    report_budget_this_year: project.reportBudgetThisYear ?? null,
    report_total_period: project.reportTotalPeriod ?? null,
    report_name_short: project.reportNameShort ?? null,
    report_name_full: project.reportNameFull ?? null,
    group_id: project.groupId ?? null,
  };
}

/** assignments 컬럼이 없는 구 스키마용 (PGRST204 fallback) */
export function toProjectRowMinimal(project: Project): Omit<ProjectRow, 'assignments'> & { assignments?: never } {
  const { assignments: _a, ...rest } = toProjectRow(project);
  return rest;
}

export function fromProjectRow(row: ProjectRow): Project {
  const assignments: ProjectAssignment[] = Array.isArray(row.assignments)
    ? row.assignments.map((a: ProjectAssignmentRow) => ({
        assignee: a.assignee,
        allocationPercent: a.allocation_percent,
        ...(a.monthly_allocations && Object.keys(a.monthly_allocations).length > 0 ? { monthlyAllocations: a.monthly_allocations } : {}),
      }))
    : [];
  const minDays = row.min_work_effort_days != null ? Number(row.min_work_effort_days) : undefined;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    assignments: assignments.length > 0 ? assignments : undefined,
    ownerId: row.owner_id ?? undefined,
    minWorkEffortDays: minDays != null && Number.isFinite(minDays) ? minDays : undefined,
    workEffortUnit: normalizeWorkEffortUnit(row.work_effort_unit),
    reportCategory: row.report_category ?? undefined,
    reportAgency: row.report_agency ?? undefined,
    reportBudgetThisYear: row.report_budget_this_year ?? undefined,
    reportTotalPeriod: row.report_total_period ?? undefined,
    reportNameShort: row.report_name_short ?? undefined,
    reportNameFull: row.report_name_full ?? undefined,
    groupId: row.group_id ?? undefined,
  };
}

export function toSettingsRow(settings: WBSSettings): SettingsRow {
  // 기존 4개 컬럼 외 나머지를 config_json에 저장
  // themeMode는 사용자별 로컬 설정으로 분리되어 DB에 저장하지 않는다.
  const { level1Prefix, level2Prefix, level3Prefix, maxLevel, ...rest } = settings;
  const { themeMode: _themeMode, ...configJson } = rest as Record<string, unknown>;
  void _themeMode;
  return {
    id: 'default',
    level1_prefix: level1Prefix,
    level2_prefix: level2Prefix,
    level3_prefix: level3Prefix,
    max_level: maxLevel,
    config_json: configJson,
  };
}

export function fromSettingsRow(row: SettingsRow): Partial<WBSSettings> {
  const base: Partial<WBSSettings> = {
    level1Prefix: row.level1_prefix,
    level2Prefix: row.level2_prefix,
    level3Prefix: row.level3_prefix,
    maxLevel: row.max_level,
  };
  // config_json에서 나머지 설정 복원 (themeMode는 사용자별 로컬 설정이므로 무시)
  if (row.config_json && typeof row.config_json === 'object') {
    const { themeMode: _themeMode, ...rest } = row.config_json as Record<string, unknown>;
    void _themeMode;
    Object.assign(base, rest);
  }
  // 옛 기본 appTitle('지엠티 프로젝트 매니저')은 자동으로 떼어내어 새 default가 적용되도록 한다.
  if (base.appTitle === '지엠티 프로젝트 매니저') {
    delete base.appTitle;
  }
  return base;
}
