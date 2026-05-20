import React, { useMemo } from 'react';
import { X, Briefcase, ListTodo, UserCircle } from 'lucide-react';
import type { Project, Task, WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatNum2 } from '../lib/utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { formatProjectDisplayName } from '../lib/projectKind';
import { getStatusColorProps } from '../lib/statusColor';
import { formatAllocationPercentSumForDisplay, manDaysToManMonths } from '../lib/workEffortUnits';
import { mergeMonthlyAllocationsForAssignee, type PersonAllocationItem } from '../lib/personAllocations';

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

export interface PersonAllocationDetailPanelProps {
  person: string;
  projects: Project[];
  /** 해당 인원의 프로젝트별 투입 행(없으면 빈 배열). */
  allocationItems: PersonAllocationItem[];
  /** 담당자 → 프로젝트 → WBS 공수 합(M/D). */
  personProjectWorkEffort: Map<string, Map<string, number>>;
  allTasks: Task[];
  effortDisplayUnit: 'mm' | 'md';
  orgMemberLabelByName: Map<string, string>;
  displayMetaByName: Map<string, PersonDisplayMeta>;
  statusConfigs: StatusConfig[];
  onClose: () => void;
  onNavigateToWork?: (projectId: string) => void;
  /** PM 미지정 시 소유자 표시명 */
  profileMap?: Record<string, string>;
}

export function PersonAllocationDetailPanel({
  person,
  projects,
  allocationItems,
  personProjectWorkEffort,
  allTasks,
  effortDisplayUnit,
  orgMemberLabelByName,
  displayMetaByName,
  statusConfigs,
  onClose,
  onNavigateToWork,
  profileMap,
}: PersonAllocationDetailPanelProps) {
  const personDisplay = formatAssigneeDisplay(person, displayMetaByName);
  const orgLabel = orgMemberLabelByName.get(person.trim()) ?? null;
  const totalPercent = allocationItems.reduce((s, i) => s + i.allocationPercent, 0);
  const projEffort = personProjectWorkEffort.get(person);
  const totalMd = projEffort ? [...projEffort.values()].reduce((s, v) => s + v, 0) : 0;

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const tasksForPerson = useMemo(() => {
    const target = (person || '').trim() || '(미지정)';
    return allTasks
      .filter((t) => ((t.assignee || '').trim() || '(미지정)') === target)
      .slice()
      .sort((a, b) => {
        const c = a.projectId.localeCompare(b.projectId, 'ko');
        if (c !== 0) return c;
        return (a.endDate || '').localeCompare(b.endDate || '', 'ko') || a.name.localeCompare(b.name, 'ko');
      });
  }, [allTasks, person]);

  const pmProjects = useMemo(() => {
    if (person === '(미지정)') return [];
    const t = person.trim();
    return projects.filter((p) => resolveProjectPmRawDisplayName(p, profileMap).trim() === t);
  }, [person, projects, profileMap]);

  const statusNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of statusConfigs) m.set(c.id, c.name);
    return m;
  }, [statusConfigs]);

  return (
    <div
      className="border-t border-teal-100/80 bg-gradient-to-b from-stone-50/80 to-white px-4 py-4 sm:px-5 sm:py-5"
      role="region"
      aria-label={`${personDisplay} 상세`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold shrink-0 text-sm bg-teal-100 text-teal-800">
            {person.substring(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <UserCircle className="text-stone-400 shrink-0" size={18} aria-hidden />
              <h3 className="text-base font-bold text-stone-900 truncate">{personDisplay}</h3>
            </div>
            {orgLabel && <p className="text-xs text-stone-500 mt-1">{orgLabel}</p>}
            <p className="text-[11px] text-stone-400 mt-1">행을 다시 클릭하거나 Esc로 접을 수 있습니다.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-end sm:self-start inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50"
        >
          <X size={14} aria-hidden />
          닫기
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">총 투입</div>
          <div className={cn('text-lg font-bold tabular-nums mt-0.5', totalPercent > 100 ? 'text-amber-600' : 'text-teal-700')}>
            {formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit)}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">WBS 공수 합</div>
          <div className="text-lg font-bold tabular-nums text-stone-800 mt-0.5">
            {totalMd > 0 ? formatEffortFromManDays(totalMd, effortDisplayUnit) : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">투입 프로젝트</div>
          <div className="text-lg font-bold tabular-nums text-stone-800 mt-0.5">{allocationItems.length}</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">담당 작업</div>
          <div className="text-lg font-bold tabular-nums text-violet-700 mt-0.5">{tasksForPerson.length}건</div>
        </div>
      </div>

      {pmProjects.length > 0 && (
        <div className="mb-5 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2.5">
          <div className="text-xs font-semibold text-indigo-900 flex items-center gap-1.5 mb-1.5">
            <Briefcase size={14} className="shrink-0" aria-hidden />
            PM(과제 책임)으로 표시된 프로젝트
          </div>
          <ul className="text-sm text-indigo-950 space-y-1">
            {pmProjects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{formatProjectDisplayName(p.name, p.projectKind)}</span>
                {onNavigateToWork && (
                  <button
                    type="button"
                    onClick={() => onNavigateToWork(p.id)}
                    className="text-[11px] font-semibold text-indigo-700 hover:underline"
                  >
                    작업 표
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5">
        <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Briefcase size={14} />
          프로젝트별 투입 · 기간
        </h4>
        {allocationItems.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">
            프로젝트 설정에 등록된 투입 비율이 없습니다. WBS 작업만 배정된 경우 아래「담당 WBS 작업」만 표시됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[640px]">
              <thead className="bg-stone-50 border-b border-stone-200 text-stone-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">프로젝트</th>
                  <th className="text-right font-medium px-2 py-2 w-20">투입%</th>
                  <th className="text-right font-medium px-2 py-2 w-28">공수(M/D·M/M)</th>
                  <th className="text-left font-medium px-2 py-2 w-40">기간</th>
                  <th className="text-left font-medium px-2 py-2">월별 투입</th>
                  <th className="text-center font-medium px-2 py-2 w-24">작업</th>
                </tr>
              </thead>
              <tbody>
                {allocationItems.map(({ project, allocationPercent }) => {
                  const md = projEffort?.get(project.id) ?? 0;
                  const monthly = mergeMonthlyAllocationsForAssignee(project, person);
                  const period =
                    project.startDate || project.endDate ? `${project.startDate || '미정'} ~ ${project.endDate || '미정'}` : '미정';
                  return (
                    <tr key={project.id} className="border-t border-stone-100 align-top">
                      <td className="px-3 py-2 font-medium text-stone-800 break-words max-w-[14rem]">
                        {formatProjectDisplayName(project.name, project.projectKind)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-teal-700">{formatNum2(allocationPercent)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                        {md > 0 ? formatEffortFromManDays(md, effortDisplayUnit) : '—'}
                      </td>
                      <td className="px-2 py-2 text-stone-600 whitespace-nowrap">{period}</td>
                      <td className="px-2 py-2 text-stone-500">
                        {monthly ? (
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[18rem]">
                            {Object.entries(monthly)
                              .sort(([a], [b]) => a.localeCompare(b))
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
                      <td className="px-2 py-2 text-center">
                        {onNavigateToWork ? (
                          <button
                            type="button"
                            onClick={() => onNavigateToWork(project.id)}
                            className="text-teal-700 font-semibold hover:underline"
                          >
                            표로 이동
                          </button>
                        ) : (
                          '—'
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
        <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <ListTodo size={14} />
          담당 WBS 작업 ({tasksForPerson.length}건)
        </h4>
        {tasksForPerson.length === 0 ? (
          <p className="text-sm text-stone-500 bg-white border border-stone-100 rounded-lg px-3 py-2">할당된 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[720px]">
              <thead className="sticky top-0 z-[1] bg-stone-50 border-b border-stone-200 text-stone-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">프로젝트</th>
                  <th className="text-left font-medium px-2 py-2">작업명</th>
                  <th className="text-center font-medium px-1 py-2 w-14">유형</th>
                  <th className="text-left font-medium px-2 py-2 w-24">상태</th>
                  <th className="text-right font-medium px-2 py-2 w-14">진척</th>
                  <th className="text-right font-medium px-2 py-2 w-20">공수</th>
                  <th className="text-left font-medium px-2 py-2 whitespace-nowrap">시작</th>
                  <th className="text-left font-medium px-2 py-2 whitespace-nowrap">종료</th>
                </tr>
              </thead>
              <tbody>
                {tasksForPerson.map((task) => {
                  const proj = projectById.get(task.projectId);
                  const sc = statusConfigs.find((c) => c.id === task.status);
                  const colorProps = getStatusColorProps(sc?.color ?? '');
                  const statusLabel = statusNameById.get(task.status) ?? task.status;
                  const unit = workEffortUnitLabel(proj?.workEffortUnit);
                  const we = task.workEffort;
                  return (
                    <tr key={task.id} className="border-t border-stone-100 hover:bg-stone-50/60 align-top">
                      <td className="px-3 py-2 text-stone-700 break-words max-w-[10rem]">
                        {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : task.projectId}
                      </td>
                      <td className="px-2 py-2 font-medium text-stone-900 break-words max-w-[16rem]">{task.name}</td>
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
