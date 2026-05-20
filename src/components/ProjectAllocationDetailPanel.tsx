import React, { useMemo } from 'react';
import { X, Briefcase, ListTodo, Users } from 'lucide-react';
import type { Project, Task, WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatNum2 } from '../lib/utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { formatProjectDisplayName } from '../lib/projectKind';
import { getStatusColorProps } from '../lib/statusColor';
import { formatAllocationPercentSumForDisplay, manDaysToManMonths } from '../lib/workEffortUnits';
import type { ProjectAllocationRow } from '../lib/personAllocations';
import { computeProjectAssigneeWorkEffort, mergeMonthlyAllocationsForAssignee } from '../lib/personAllocations';

function formatEffortFromManDays(md: number, unit: 'mm' | 'md'): string {
  if (unit === 'md') return `${formatNum2(md)} M/D`;
  return `${formatNum2(manDaysToManMonths(md))} M/M`;
}

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

function workEffortUnitShort(u: WorkEffortUnit | undefined): string {
  switch (u) {
    case 'minute':
      return '분';
    case 'hour':
      return 'h';
    case 'week':
      return '주';
    default:
      return '일';
  }
}

export interface ProjectAllocationDetailPanelProps {
  project: Project;
  assignments: ProjectAllocationRow['assignments'];
  totalPercent: number;
  allTasks: Task[];
  effortDisplayUnit: 'mm' | 'md';
  orgMemberLabelByName: Map<string, string>;
  displayMetaByName: Map<string, PersonDisplayMeta>;
  profileMap?: Record<string, string>;
  statusConfigs: StatusConfig[];
  onClose: () => void;
  onNavigateToWork?: (projectId: string) => void;
}

export function ProjectAllocationDetailPanel({
  project,
  assignments,
  totalPercent,
  allTasks,
  effortDisplayUnit,
  orgMemberLabelByName,
  displayMetaByName,
  profileMap,
  statusConfigs,
  onClose,
  onNavigateToWork,
}: ProjectAllocationDetailPanelProps) {
  const title = formatProjectDisplayName(project.name, project.projectKind);
  const period = project.startDate || project.endDate ? `${project.startDate || '미정'} ~ ${project.endDate || '미정'}` : '기간 미정';

  const assigneeWorkMd = useMemo(() => computeProjectAssigneeWorkEffort(allTasks, project.id), [allTasks, project.id]);

  const tasksForProject = useMemo(() => {
    return allTasks
      .filter((t) => t.projectId === project.id)
      .slice()
      .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
  }, [allTasks, project.id]);

  const totalMd = useMemo(() => [...assigneeWorkMd.values()].reduce((s, v) => s + v, 0), [assigneeWorkMd]);

  const statusNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of statusConfigs) m.set(c.id, c.name);
    return m;
  }, [statusConfigs]);

  const assigneesOnlyOnWbs = useMemo(() => {
    const alloc = new Set(assignments.map((a) => a.assignee));
    const extra = new Set<string>();
    for (const t of tasksForProject) {
      const name = (t.assignee || '').trim() || '(미지정)';
      if (!alloc.has(name)) extra.add(name);
    }
    return [...extra].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [assignments, tasksForProject]);

  const reportBits = [
    project.reportCategory && `분류: ${project.reportCategory}`,
    project.reportAgency && `주관: ${project.reportAgency}`,
    project.reportBudgetThisYear && `예산: ${project.reportBudgetThisYear}`,
    project.reportTotalPeriod && `기간(보고): ${project.reportTotalPeriod}`,
    project.reportNameShort && `약칭: ${project.reportNameShort}`,
  ].filter(Boolean) as string[];

  const pmRaw = resolveProjectPmRawDisplayName(project, profileMap);
  const pmDisplay = pmRaw ? formatAssigneeDisplay(pmRaw, displayMetaByName) : null;

  const initial = (project.name || '?').trim().substring(0, 1);

  return (
    <div
      className="border-t border-orange-100/90 bg-gradient-to-b from-stone-50/80 to-white px-4 py-4 sm:px-5 sm:py-5"
      role="region"
      aria-label={`${title} 상세`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center font-bold shrink-0 text-sm bg-orange-100 text-orange-900">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Briefcase className="text-stone-400 shrink-0" size={18} aria-hidden />
              <h3 className="text-base font-bold text-stone-900 break-words">{title}</h3>
            </div>
            <p className="text-xs text-stone-500 mt-1">{period}</p>
            <p className="text-xs text-indigo-800 mt-1">
              PM: <span className={cn('font-semibold', !pmDisplay && 'text-stone-400 font-normal')}>{pmDisplay ?? '미지정'}</span>
            </p>
            {project.description?.trim() && (
              <p className="text-xs text-stone-600 mt-2 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {project.description.trim()}
              </p>
            )}
            <p className="text-[11px] text-stone-400 mt-2">행을 다시 클릭하거나 Esc로 접을 수 있습니다.</p>
          </div>
        </div>
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          {onNavigateToWork && (
            <button
              type="button"
              onClick={() => onNavigateToWork(project.id)}
              className="inline-flex items-center justify-center rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50"
            >
              작업 표로 이동
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">총 투입</div>
          <div className={cn('text-lg font-bold tabular-nums mt-0.5', totalPercent > 100 ? 'text-amber-600' : 'text-orange-600')}>
            {formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit)}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">투입 인원</div>
          <div className="text-lg font-bold tabular-nums text-stone-800 mt-0.5">{assignments.length}명</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">WBS 작업</div>
          <div className="text-lg font-bold tabular-nums text-violet-700 mt-0.5">{tasksForProject.length}건</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">WBS 공수 합</div>
          <div className="text-lg font-bold tabular-nums text-stone-800 mt-0.5">
            {totalMd > 0 ? formatEffortFromManDays(totalMd, effortDisplayUnit) : '—'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-600 mb-4">
        <span>
          공수 단위: <strong className="text-stone-900">{workEffortUnitShort(project.workEffortUnit)}</strong>
        </span>
        {project.minWorkEffortDays != null && project.minWorkEffortDays > 0 && (
          <span>
            최소 공수: <strong className="text-stone-900 tabular-nums">{project.minWorkEffortDays}일</strong>
          </span>
        )}
      </div>

      {reportBits.length > 0 && (
        <div className="mb-4 rounded-lg border border-stone-100 bg-stone-50/80 px-3 py-2 text-xs text-stone-700 space-y-0.5">
          {reportBits.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {assigneesOnlyOnWbs.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs text-amber-950">
          <strong className="font-semibold">프로젝트 투입 설정에는 없고 WBS에만 담당으로 올라간 인원:</strong>{' '}
          {assigneesOnlyOnWbs.map((n) => formatAssigneeDisplay(n, displayMetaByName)).join(', ')}
        </div>
      )}

      <div className="mb-5">
        <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Users size={14} />
          인원별 투입 · WBS 공수
        </h4>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-xs sm:text-sm min-w-[640px]">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">담당자</th>
                <th className="text-left font-medium px-2 py-2 max-w-[10rem]">조직</th>
                <th className="text-right font-medium px-2 py-2 w-20">투입%</th>
                <th className="text-right font-medium px-2 py-2 w-28">WBS 공수</th>
                <th className="text-left font-medium px-2 py-2">월별 투입</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const md = assigneeWorkMd.get(a.assignee) ?? 0;
                const monthly = mergeMonthlyAllocationsForAssignee(project, a.assignee);
                const org = orgMemberLabelByName.get(a.assignee.trim()) ?? '—';
                return (
                  <tr key={a.assignee} className="border-t border-stone-100 align-top">
                    <td className="px-3 py-2 font-medium text-stone-900">{formatAssigneeDisplay(a.assignee, displayMetaByName)}</td>
                    <td className="px-2 py-2 text-stone-600 text-[11px] break-words">{org}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-orange-700">{formatNum2(a.allocationPercent)}%</td>
                    <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                      {md > 0 ? formatEffortFromManDays(md, effortDisplayUnit) : '—'}
                    </td>
                    <td className="px-2 py-2 text-stone-500">
                      {monthly ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[20rem]">
                          {Object.entries(monthly)
                            .sort(([k1], [k2]) => k1.localeCompare(k2))
                            .map(([ym, pct]) => (
                              <span key={ym} className="tabular-nums">
                                {ym} {pct}%
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
      </div>

      <div>
        <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <ListTodo size={14} />이 프로젝트 WBS 작업 ({tasksForProject.length}건)
        </h4>
        {tasksForProject.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">등록된 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[680px]">
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
                </tr>
              </thead>
              <tbody>
                {tasksForProject.map((task) => {
                  const sc = statusConfigs.find((c) => c.id === task.status);
                  const colorProps = getStatusColorProps(sc?.color ?? '');
                  const statusLabel = statusNameById.get(task.status) ?? task.status;
                  const unit = workEffortUnitLabel(project.workEffortUnit);
                  const we = task.workEffort;
                  const assigneeLabel = formatAssigneeDisplay((task.assignee || '').trim() || '(미지정)', displayMetaByName);
                  return (
                    <tr key={task.id} className="border-t border-stone-100 hover:bg-stone-50/60 align-top">
                      <td className="px-3 py-2 font-medium text-stone-900 break-words max-w-[18rem]">{task.name}</td>
                      <td className="px-2 py-2 text-stone-700 text-[11px] truncate max-w-[7rem]" title={assigneeLabel}>
                        {assigneeLabel}
                      </td>
                      <td className="px-1 py-2 text-center text-[10px] text-stone-500">
                        {task.isMilestone && <span className="block text-amber-700 font-semibold">M</span>}
                        {task.isIssue && <span className="block text-red-700 font-semibold">이슈</span>}
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
                      <td className="px-2 py-2 text-right tabular-nums text-stone-700">{formatNum2(task.progress)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {we != null && Number(we) > 0 ? `${formatNum2(Number(we))} ${unit}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-stone-600 whitespace-nowrap">{task.startDate || '—'}</td>
                      <td className="px-2 py-2 text-stone-600 whitespace-nowrap">{task.endDate || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
