import React, { useMemo } from 'react';
import { X, Briefcase, Users, ListTodo, Flag, Bug, ListChecks, ExternalLink, Table2, CalendarClock, LayoutGrid, Ban } from 'lucide-react';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import type { Project, Task, WorkEffortUnit } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import { cn, formatNum2, formatPercent1 } from '../lib/utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { formatProjectDisplayName } from '../lib/projectKind';
import { getStatusColorProps } from '../lib/statusColor';
import { DEFAULT_MAN_DAYS_PER_MAN_MONTH, manDaysToManMonths } from '../lib/workEffortUnits';
import {
  computeProjectAssigneeWorkEffort,
  mergeMonthlyAllocationsForAssignee,
  normalizeProjectAssignments,
} from '../lib/personAllocations';

export type DashboardProjectCardStats = {
  total: number;
  statusCounts: Record<string, number>;
  progress: number;
  assigneeCount: number;
};

function workEffortUnitLabel(u: WorkEffortUnit | undefined): string {
  switch (u) {
    case 'minute':
      return '분';
    case 'hour':
      return '시간';
    case 'week':
      return '주';
    default:
      return '일';
  }
}

function formatMdMm(md: number, unit: 'mm' | 'md'): string {
  if (unit === 'md') return `${formatNum2(md)} M/D`;
  return `${formatNum2(manDaysToManMonths(md))} M/M`;
}

function isTaskDone(t: Task, doneStatusIds: Set<string>): boolean {
  return doneStatusIds.has(t.status) || (typeof t.progress === 'number' && Number.isFinite(t.progress) && t.progress >= 100);
}

function isOverdue(t: Task, doneStatusIds: Set<string>): boolean {
  if (isTaskDone(t, doneStatusIds)) return false;
  const end = t.endDate?.trim();
  if (!end) return false;
  try {
    const d = parseISO(end);
    if (Number.isNaN(d.getTime())) return false;
    return isBefore(d, startOfDay(new Date()));
  } catch {
    return false;
  }
}

export interface DashboardProjectCardDetailPanelProps {
  project: Project & { stats: DashboardProjectCardStats };
  tasks: Task[];
  wbsSettings: WBSSettings;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
  /** PM 미지정 시 프로젝트 소유자 표시명 조회용 */
  profileMap?: Record<string, string>;
  orgMemberLabelByName: Map<string, string>;
  doneStatusIds: Set<string>;
  /** 프로젝트 그룹(폴더) 표시명 */
  projectGroupName?: string;
  effortDisplayUnit?: 'mm' | 'md';
  onClose: () => void;
  /** URL 기반 대시보드 프로젝트 상세 (?detail=project) */
  onOpenDashboardProjectDetail?: () => void;
  onNavigateToTable?: (projectId: string) => void;
  onOpenTaskInTable?: (taskId: string, projectId: string) => void;
  /** 이 브라우저에서만 대시보드 집계·카드에서 제외 중인지(상단「집계 제외」와 동일) */
  localDashboardAggregationExcluded?: boolean;
  onToggleLocalDashboardAggregationExclude?: () => void;
  /** 조직/DB에 저장되는 대시보드 반영 여부(프로젝트 편집의「대시보드에 반영」과 동일) */
  onIncludeInDashboardChange?: (include: boolean) => void;
}

export function DashboardProjectCardDetailPanel({
  project,
  tasks,
  wbsSettings,
  assigneeDisplayMetaByName,
  profileMap,
  orgMemberLabelByName,
  doneStatusIds,
  projectGroupName,
  effortDisplayUnit = 'mm',
  onClose,
  onOpenDashboardProjectDetail,
  onNavigateToTable,
  onOpenTaskInTable,
  localDashboardAggregationExcluded = false,
  onToggleLocalDashboardAggregationExclude,
  onIncludeInDashboardChange,
}: DashboardProjectCardDetailPanelProps) {
  const s = project.stats;
  const title = formatProjectDisplayName(project.name, project.projectKind);
  const pmRaw = resolveProjectPmRawDisplayName(project, profileMap);
  const pmDisplay = pmRaw ? formatAssigneeDisplay(pmRaw, assigneeDisplayMetaByName) : '';
  const poRaw = (project.poName ?? '').trim();
  const poDisplay = poRaw ? formatAssigneeDisplay(poRaw, assigneeDisplayMetaByName) : '';

  const normalizedAssignments = useMemo(() => normalizeProjectAssignments(project.assignments ?? []), [project.assignments]);

  const assigneeWorkMd = useMemo(() => computeProjectAssigneeWorkEffort(tasks, project.id), [tasks, project.id]);

  const totalMd = useMemo(() => [...assigneeWorkMd.values()].reduce((a, b) => a + b, 0), [assigneeWorkMd]);

  const assigneeRows = useMemo(() => {
    const m = new Map<string, { count: number }>();
    for (const t of tasks) {
      const name = (t.assignee || '').trim() || '(미지정)';
      m.set(name, { count: (m.get(name)?.count ?? 0) + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'ko'));
  }, [tasks]);

  const milestoneCount = useMemo(() => tasks.filter((t) => t.isMilestone).length, [tasks]);
  const issueCount = useMemo(() => tasks.filter((t) => t.isIssue).length, [tasks]);
  const actionCount = useMemo(() => tasks.filter((t) => t.isActionItem).length, [tasks]);
  const overdueCount = useMemo(() => tasks.filter((t) => isOverdue(t, doneStatusIds)).length, [tasks, doneStatusIds]);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => (a.endDate || '').localeCompare(b.endDate || '', 'ko') || a.name.localeCompare(b.name, 'ko')),
    [tasks],
  );

  const statusNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of wbsSettings.statusConfigs) m.set(c.id, c.name);
    return m;
  }, [wbsSettings.statusConfigs]);

  const reportBits = [
    project.reportCategory && `분류: ${project.reportCategory}`,
    project.reportAgency && `주관: ${project.reportAgency}`,
    project.reportBudgetThisYear && `예산: ${project.reportBudgetThisYear}`,
    project.reportTotalPeriod && `기간(보고): ${project.reportTotalPeriod}`,
    project.reportNameShort && `약칭: ${project.reportNameShort}`,
    project.reportNameFull && `전체 과제명: ${project.reportNameFull}`,
  ].filter(Boolean) as string[];

  const period = project.startDate || project.endDate ? `${project.startDate || '미정'} ~ ${project.endDate || '미정'}` : '기간 미정';

  const includeInDashboard = project.includeInDashboard !== false;
  const showDashboardFlags = onIncludeInDashboardChange != null || onToggleLocalDashboardAggregationExclude != null;

  return (
    <div
      className="w-full rounded-xl border border-indigo-100/90 bg-gradient-to-b from-indigo-50/40 via-white to-white shadow-sm overflow-hidden"
      role="region"
      aria-label={`${title} 상세`}
    >
      <div className="border-b border-indigo-100/80 bg-white/90 px-4 py-3 sm:px-5 sm:py-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-900 flex items-center justify-center font-bold text-lg shrink-0">
            {(project.name || '?').trim().substring(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Briefcase className="text-indigo-500 shrink-0" size={20} aria-hidden />
              <h3 className="text-lg font-bold text-[var(--color-ink)] break-words">{title}</h3>
            </div>
            {projectGroupName && <p className="text-xs text-stone-500 mt-1">그룹: {projectGroupName}</p>}
            <p className="text-xs text-stone-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={12} className="text-stone-400 shrink-0" aria-hidden />
                {period}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-violet-700 font-bold uppercase tracking-wide">PM</span>
                <span className={cn(!pmDisplay && 'text-stone-400')}>{pmDisplay || '미지정'}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-amber-800 font-bold uppercase tracking-wide">PO</span>
                <span className={cn(!poDisplay && 'text-stone-400')}>{poDisplay || '—'}</span>
              </span>
            </div>
            <p className="text-[11px] text-stone-400 mt-2">같은 카드·행을 다시 클릭하거나 Esc, 팝업 바깥 배경 클릭으로 닫을 수 있습니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onNavigateToTable && (
            <button
              type="button"
              onClick={() => onNavigateToTable(project.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50"
            >
              <Table2 size={14} aria-hidden />
              WBS 작업 표
            </button>
          )}
          {onOpenDashboardProjectDetail && (
            <button
              type="button"
              onClick={onOpenDashboardProjectDetail}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
            >
              <ExternalLink size={14} aria-hidden />
              대시보드 상세
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50"
          >
            <X size={14} aria-hidden />
            닫기
          </button>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-5 max-h-[min(85vh,1200px)] overflow-y-auto">
        {project.description?.trim() && (
          <div className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5">
            <div className="text-[10px] font-bold text-stone-500 uppercase tracking-wide mb-1">설명</div>
            <p className="text-sm text-stone-800 whitespace-pre-wrap break-words">{project.description.trim()}</p>
          </div>
        )}

        {showDashboardFlags && (
          <div className="rounded-lg border border-indigo-100/90 bg-gradient-to-br from-indigo-50/70 to-white px-3 py-3 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wide flex items-center gap-1.5">
              <LayoutGrid size={14} className="text-indigo-600 shrink-0" aria-hidden />
              대시보드 반영
            </h4>
            <div className="space-y-2.5">
              {onIncludeInDashboardChange && (
                <label className="flex gap-2.5 cursor-pointer items-start">
                  <input
                    type="checkbox"
                    checked={includeInDashboard}
                    onChange={(e) => onIncludeInDashboardChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-semibold text-stone-900">대시보드에 반영</span>
                    <p className="text-[11px] text-stone-600 mt-0.5 leading-relaxed">
                      끄면 조직 전체 기준으로 요약·프로젝트 카드·목록에서 제외됩니다. WBS·간트 등 작업 화면에는 그대로 표시됩니다.
                    </p>
                  </span>
                </label>
              )}
              {onToggleLocalDashboardAggregationExclude && (
                <label className="flex gap-2.5 cursor-pointer items-start rounded-md border border-amber-100/90 bg-amber-50/50 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={localDashboardAggregationExcluded}
                    onChange={() => onToggleLocalDashboardAggregationExclude()}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 text-amber-700 focus:ring-amber-500"
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-semibold text-stone-900 inline-flex items-center gap-1">
                      <Ban size={12} className="text-amber-700 shrink-0" aria-hidden />이 기기에서만 집계 제외
                    </span>
                    <p className="text-[11px] text-stone-600 mt-0.5 leading-relaxed">
                      이 브라우저에만 저장됩니다. 상단 도구 모음의「집계 제외」와 같은 목록이며, 체크 시 요약·부서 집계·투입 현황 등에서
                      빠집니다.
                    </p>
                  </span>
                </label>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-semibold text-stone-400 uppercase">진척</div>
            <div className="text-xl font-bold text-indigo-600 tabular-nums mt-0.5">{formatPercent1(s.progress)}%</div>
            <div className="mt-1.5 h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${Math.min(100, s.progress)}%` }} />
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-semibold text-stone-400 uppercase">작업</div>
            <div className="text-xl font-bold text-stone-800 tabular-nums mt-0.5">{s.total}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-semibold text-stone-400 uppercase">팀원</div>
            <div className="text-xl font-bold text-stone-800 tabular-nums mt-0.5">{s.assigneeCount}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-semibold text-stone-400 uppercase">WBS 공수</div>
            <div className="text-sm font-bold text-stone-800 mt-1 leading-tight">
              {totalMd > 0 ? formatMdMm(totalMd, effortDisplayUnit) : '—'}
            </div>
            <div className="text-[10px] text-stone-400 mt-0.5">1M/M={DEFAULT_MAN_DAYS_PER_MAN_MONTH}M/D</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
            <div className="text-[10px] font-semibold text-amber-800/90 uppercase">기한 초과</div>
            <div className={cn('text-xl font-bold tabular-nums mt-0.5', overdueCount > 0 ? 'text-amber-700' : 'text-stone-400')}>
              {overdueCount}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm col-span-2 sm:col-span-2 lg:col-span-1">
            <div className="text-[10px] font-semibold text-stone-400 uppercase">유형</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-stone-700">
              <span className="inline-flex items-center gap-0.5">
                <Flag size={12} className="text-amber-600" aria-hidden /> {milestoneCount}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Bug size={12} className="text-rose-600" aria-hidden /> {issueCount}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <ListChecks size={12} className="text-violet-600" aria-hidden /> {actionCount}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-600">
          <span>
            공수 단위: <strong className="text-stone-900">{workEffortUnitLabel(project.workEffortUnit)}</strong>
          </span>
          {project.minWorkEffortDays != null && project.minWorkEffortDays > 0 && (
            <span>
              최소 공수: <strong className="text-stone-900 tabular-nums">{project.minWorkEffortDays}일</strong>
            </span>
          )}
        </div>

        {reportBits.length > 0 && (
          <div className="rounded-lg border border-stone-100 bg-stone-50/80 px-3 py-2 text-xs text-stone-700 space-y-0.5">
            {reportBits.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

        <div>
          <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ListTodo size={14} />
            상태별 작업 수
          </h4>
          <div className="flex flex-wrap gap-2">
            {wbsSettings.statusConfigs.map((config) => {
              const n = s.statusCounts[config.id] ?? 0;
              const colorProps = getStatusColorProps(config.color ?? '');
              return (
                <span
                  key={config.id}
                  className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium', colorProps.className)}
                  style={colorProps.style}
                >
                  {config.name}
                  <span className="tabular-nums font-bold">{n}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Users size={14} />
            담당자별 (작업 건수 · WBS 공수)
          </h4>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[480px]">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">담당자</th>
                  <th className="text-left font-medium px-2 py-2 max-w-[12rem]">조직</th>
                  <th className="text-right font-medium px-2 py-2 w-20">작업</th>
                  <th className="text-right font-medium px-2 py-2 w-28">공수</th>
                </tr>
              </thead>
              <tbody>
                {assigneeRows.map(([name, { count }]) => {
                  const md = assigneeWorkMd.get(name) ?? 0;
                  const org = orgMemberLabelByName.get(name.trim()) ?? '—';
                  return (
                    <tr key={name} className="border-t border-stone-100">
                      <td className="px-3 py-2 font-medium text-stone-900">{formatAssigneeDisplay(name, assigneeDisplayMetaByName)}</td>
                      <td className="px-2 py-2 text-stone-600 text-[11px] break-words">{org}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-800">{count}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {md > 0 ? formatMdMm(md, effortDisplayUnit) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Briefcase size={14} />
            프로젝트 투입 설정
          </h4>
          {normalizedAssignments.length === 0 ? (
            <p className="text-sm text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">등록된 투입 비율이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
              <table className="w-full text-xs sm:text-sm min-w-[560px]">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">담당자</th>
                    <th className="text-right font-medium px-2 py-2 w-20">투입%</th>
                    <th className="text-right font-medium px-2 py-2 w-28">WBS 공수</th>
                    <th className="text-left font-medium px-2 py-2">월별 투입</th>
                  </tr>
                </thead>
                <tbody>
                  {normalizedAssignments.map((a) => {
                    const md = assigneeWorkMd.get(a.assignee) ?? 0;
                    const monthly = mergeMonthlyAllocationsForAssignee(project, a.assignee);
                    return (
                      <tr key={a.assignee} className="border-t border-stone-100 align-top">
                        <td className="px-3 py-2 font-medium text-stone-900">
                          {formatAssigneeDisplay(a.assignee, assigneeDisplayMetaByName)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold text-teal-700">
                          {formatPercent1(a.allocationPercent)}%
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                          {md > 0 ? formatMdMm(md, effortDisplayUnit) : '—'}
                        </td>
                        <td className="px-2 py-2 text-stone-500 text-[11px]">
                          {monthly ? (
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[24rem]">
                              {Object.entries(monthly)
                                .sort(([k1], [k2]) => k1.localeCompare(k2))
                                .map(([ym, pct]) => (
                                  <span key={ym} className="tabular-nums">
                                    {ym} {formatPercent1(Number(pct))}%
                                  </span>
                                ))}
                            </div>
                          ) : (
                            <span className="text-stone-400">동일 비율</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2">전체 작업 ({sortedTasks.length}건)</h4>
          {sortedTasks.length === 0 ? (
            <p className="text-sm text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">작업이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto max-h-[min(380px,45vh)] overflow-y-auto rounded-lg border border-stone-200 bg-white">
              <table className="w-full text-xs sm:text-sm min-w-[760px]">
                <thead className="sticky top-0 z-[1] bg-stone-50 border-b border-stone-200 text-stone-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">작업명</th>
                    <th className="text-left font-medium px-2 py-2 w-28">담당</th>
                    <th className="text-center font-medium px-1 py-2 w-14">유형</th>
                    <th className="text-left font-medium px-2 py-2 w-24">상태</th>
                    <th className="text-right font-medium px-2 py-2 w-14">진척</th>
                    <th className="text-right font-medium px-2 py-2 w-20">공수</th>
                    <th className="text-left font-medium px-2 py-2 whitespace-nowrap">시작</th>
                    <th className="text-left font-medium px-2 py-2 whitespace-nowrap">종료</th>
                    <th className="text-center font-medium px-2 py-2 w-20">표에서 열기</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTasks.map((task) => {
                    const sc = wbsSettings.statusConfigs.find((c) => c.id === task.status);
                    const colorProps = getStatusColorProps(sc?.color ?? '');
                    const statusLabel = statusNameById.get(task.status) ?? task.status;
                    const unit = workEffortUnitLabel(project.workEffortUnit);
                    const we = task.workEffort;
                    const overdue = isOverdue(task, doneStatusIds);
                    const assigneeLabel = formatAssigneeDisplay((task.assignee || '').trim() || '(미지정)', assigneeDisplayMetaByName);
                    return (
                      <tr key={task.id} className={cn('border-t border-stone-100 align-top', overdue && 'bg-amber-50/50')}>
                        <td className="px-3 py-2 font-medium text-stone-900 break-words max-w-[14rem]">
                          {task.name}
                          {overdue && <span className="ml-1 text-[10px] font-semibold text-amber-700 whitespace-nowrap">기한초과</span>}
                        </td>
                        <td className="px-2 py-2 text-stone-700 text-[11px] truncate max-w-[7rem]" title={assigneeLabel}>
                          {assigneeLabel}
                        </td>
                        <td className="px-1 py-2 text-center text-[10px] text-stone-500">
                          {task.isMilestone && <span className="block text-amber-700 font-semibold">M</span>}
                          {task.isIssue && <span className="block text-rose-700 font-semibold">이슈</span>}
                          {task.isActionItem && <span className="block text-violet-700 font-semibold">액션</span>}
                          {!task.isMilestone && !task.isIssue && !task.isActionItem && '—'}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={cn('inline-flex px-1.5 py-0.5 rounded border text-[11px] font-medium', colorProps.className)}
                            style={colorProps.style}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-700">{formatPercent1(task.progress)}%</td>
                        <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                          {we != null && Number(we) > 0 ? `${formatNum2(Number(we))} ${unit}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-stone-600 whitespace-nowrap">{task.startDate || '—'}</td>
                        <td className="px-2 py-2 text-stone-600 whitespace-nowrap">{task.endDate || '—'}</td>
                        <td className="px-2 py-2 text-center">
                          {onOpenTaskInTable ? (
                            <button
                              type="button"
                              onClick={() => onOpenTaskInTable(task.id, project.id)}
                              className="text-[11px] font-semibold text-indigo-600 hover:underline"
                            >
                              열기
                            </button>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
