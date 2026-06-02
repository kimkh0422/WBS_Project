import React, { useMemo } from 'react';
import { X, Briefcase, ListTodo, UserCircle } from 'lucide-react';
import type { Project, Task, WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatNum2, formatPercent1 } from '../lib/utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { isAssigneeProjectPm, isAssigneeProjectPo, resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { formatProjectDisplayName } from '../lib/projectKind';
import { getStatusColorProps } from '../lib/statusColor';
import { formatEffortFromManDays } from '../lib/workEffortUnits';
import {
  allocationAssigneeStorageKey,
  formatPersonWorkEffortRowDisplay,
  isUnassignedDivisionSplitPersonKey,
} from '../lib/allocationDivisionInfer';
import {
  computePersonWorkEffortWeightedProgressPct,
  mergeMonthlyAllocationsForAssignee,
  type PersonAllocationItem,
} from '../lib/personAllocations';
import {
  allocationEffortMismatchDetailTooltip,
  allocationEffortMismatchMessage,
  evaluateAllocationEffortIntegrity,
} from '../lib/allocationEffortIntegrity';
import { PersonAllocationEffortCell } from './PersonAllocationEffortCell';

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
  /** `(미지정)::사업부` 가짜 행: 상세에 포함할 프로젝트만(담당 미지정 작업 필터) */
  allocationProjectIdFilter?: Set<string>;
  /** 사업부 추정 행 제목용(최상위 사업부 id → 이름) */
  divisionNameById?: Map<string, string>;
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
  allocationProjectIdFilter,
  divisionNameById,
}: PersonAllocationDetailPanelProps) {
  const assigneeStorageKey = allocationAssigneeStorageKey(person);
  const restrictUnassignedProjects =
    isUnassignedDivisionSplitPersonKey(person) && allocationProjectIdFilter && allocationProjectIdFilter.size > 0
      ? allocationProjectIdFilter
      : null;

  const personDisplay = useMemo(
    () =>
      divisionNameById
        ? formatPersonWorkEffortRowDisplay(person, displayMetaByName, divisionNameById)
        : formatAssigneeDisplay(person, displayMetaByName),
    [person, displayMetaByName, divisionNameById],
  );
  const orgLabel = orgMemberLabelByName.get(assigneeStorageKey.trim()) ?? null;
  const totalPercent = allocationItems.reduce((s, i) => s + i.allocationPercent, 0);
  const projEffortRaw = personProjectWorkEffort.get(assigneeStorageKey);
  const projEffort = useMemo(() => {
    if (!restrictUnassignedProjects || !projEffortRaw) return projEffortRaw;
    const m = new Map<string, number>();
    for (const [pid, v] of projEffortRaw) {
      if (restrictUnassignedProjects.has(pid)) m.set(pid, v);
    }
    return m.size > 0 ? m : undefined;
  }, [projEffortRaw, restrictUnassignedProjects]);
  const totalMd = projEffort ? [...projEffort.values()].reduce((s, v) => s + v, 0) : 0;
  const effortIntegrity = evaluateAllocationEffortIntegrity(totalPercent, totalMd);
  const effortIntegrityMessage = allocationEffortMismatchMessage(effortIntegrity);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const tasksForPerson = useMemo(() => {
    const target = (assigneeStorageKey || '').trim() || '(미지정)';
    return allTasks
      .filter((t) => {
        if (((t.assignee || '').trim() || '(미지정)') !== target) return false;
        if (restrictUnassignedProjects) return restrictUnassignedProjects.has(t.projectId);
        return true;
      })
      .slice()
      .sort((a, b) => {
        const c = a.projectId.localeCompare(b.projectId, 'ko');
        if (c !== 0) return c;
        return (a.endDate || '').localeCompare(b.endDate || '', 'ko') || a.name.localeCompare(b.name, 'ko');
      });
  }, [allTasks, assigneeStorageKey, restrictUnassignedProjects]);

  /** 담당 WBS 작업 기준: 프로젝트별 총 공수·가중 진척용 earned 합 */
  const workEffortEarnedByProjectForPerson = useMemo(() => {
    const m = new Map<string, { totalMd: number; totalEarnedMd: number }>();
    for (const t of tasksForPerson) {
      const e = Number(t.workEffort) || 0;
      if (e <= 0) continue;
      const pr = typeof t.progress === 'number' && Number.isFinite(t.progress) ? Math.min(100, Math.max(0, t.progress)) : 0;
      const cur = m.get(t.projectId) ?? { totalMd: 0, totalEarnedMd: 0 };
      cur.totalMd += e;
      cur.totalEarnedMd += e * (pr / 100);
      m.set(t.projectId, cur);
    }
    return m;
  }, [tasksForPerson]);

  const pmProjects = useMemo(() => {
    if (assigneeStorageKey === '(미지정)') return [];
    return projects.filter((p) => isAssigneeProjectPm(person, p, profileMap));
  }, [person, assigneeStorageKey, projects, profileMap]);

  const poProjects = useMemo(() => {
    if (assigneeStorageKey === '(미지정)') return [];
    return projects.filter((p) => isAssigneeProjectPo(person, p));
  }, [person, assigneeStorageKey, projects]);

  const statusNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of statusConfigs) m.set(c.id, c.name);
    return m;
  }, [statusConfigs]);

  return (
    <div
      className="border-t border-teal-100/80 bg-gradient-to-b from-slate-50/80 to-white px-4 py-4 sm:px-5 sm:py-5"
      role="region"
      aria-label={`${personDisplay} 상세`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold shrink-0 text-sm bg-teal-100 text-teal-800">
            {personDisplay.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <UserCircle className="text-slate-400 shrink-0" size={18} aria-hidden />
              <h3 className="text-base font-bold text-slate-900 break-words min-w-0">{personDisplay}</h3>
            </div>
            {orgLabel && <p className="text-xs text-slate-500 mt-1">{orgLabel}</p>}
            <p className="text-[11px] text-slate-400 mt-1">행을 다시 클릭하거나 Esc로 접을 수 있습니다.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-end sm:self-start inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <X size={14} aria-hidden />
          닫기
        </button>
      </div>

      {effortIntegrity.hasMismatch && effortIntegrityMessage && (
        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-950 cursor-help"
          title={allocationEffortMismatchDetailTooltip(effortIntegrity) ?? effortIntegrityMessage}
        >
          <span className="font-semibold">투입·공수 불일치</span> — {effortIntegrityMessage}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:col-span-2">
          <PersonAllocationEffortCell
            totalPercent={totalPercent}
            totalWorkEffortMd={totalMd}
            effortDisplayUnit={effortDisplayUnit}
            align="left"
          />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">투입 프로젝트</div>
          <div className="text-lg font-bold tabular-nums text-slate-800 mt-0.5">{allocationItems.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">담당 작업</div>
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

      {poProjects.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5">
          <div className="text-xs font-semibold text-amber-950 flex items-center gap-1.5 mb-1.5">
            <Briefcase size={14} className="shrink-0" aria-hidden />
            PO로 등록된 프로젝트
          </div>
          <ul className="text-sm text-amber-950 space-y-1">
            {poProjects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{formatProjectDisplayName(p.name, p.projectKind)}</span>
                {onNavigateToWork && (
                  <button
                    type="button"
                    onClick={() => onNavigateToWork(p.id)}
                    className="text-[11px] font-semibold text-amber-800 hover:underline"
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
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Briefcase size={14} />
          프로젝트별 투입 · 기간
        </h4>
        {allocationItems.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-lg px-3 py-2">
            프로젝트 설정에 등록된 투입 비율이 없습니다. WBS 작업만 배정된 경우 아래「담당 WBS 작업」만 표시됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[640px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">프로젝트</th>
                  <th
                    className="text-right font-medium px-2 py-2 w-20 cursor-help"
                    title="이 프로젝트에 등록한 해당 인원의 투입율(%)입니다. WBS 작업에 적힌 공수 합과는 별도 데이터이며, 투입율을 M/M·M/D로 환산한 값은 상단 요약과 동일한 규칙입니다."
                  >
                    투입%
                  </th>
                  <th
                    className="text-right font-medium px-2 py-2 w-32 cursor-help"
                    title="이 프로젝트에서 해당 인원이 담당자로 지정된 WBS 작업 공수를 합산한 값입니다. 작업별 단위는 프로젝트 설정을 따르며, 여기서는 M/D 및 M/M로 함께 표시합니다. 진척률은 해당 프로젝트 작업만으로 공수 가중 평균을 계산합니다."
                  >
                    공수·진척
                  </th>
                  <th className="text-left font-medium px-2 py-2 w-40">기간</th>
                  <th className="text-left font-medium px-2 py-2">월별 투입</th>
                  <th className="text-center font-medium px-2 py-2 w-24">작업</th>
                </tr>
              </thead>
              <tbody>
                {allocationItems.map(({ project, allocationPercent }) => {
                  const md = projEffort?.get(project.id) ?? 0;
                  const agg = workEffortEarnedByProjectForPerson.get(project.id);
                  const projectProgressPct =
                    agg && agg.totalMd > 0
                      ? computePersonWorkEffortWeightedProgressPct(agg)
                      : md > 0
                        ? computePersonWorkEffortWeightedProgressPct({ totalMd: md, totalEarnedMd: 0 })
                        : 0;
                  const rowIntegrity = evaluateAllocationEffortIntegrity(allocationPercent, md);
                  const monthly = mergeMonthlyAllocationsForAssignee(project, assigneeStorageKey);
                  const period =
                    project.startDate || project.endDate ? `${project.startDate || '미정'} ~ ${project.endDate || '미정'}` : '미정';
                  return (
                    <tr
                      key={project.id}
                      className={cn('border-t border-slate-100 align-top', rowIntegrity.hasMismatch && 'bg-amber-50/40')}
                      title={rowIntegrity.hasMismatch ? (allocationEffortMismatchDetailTooltip(rowIntegrity) ?? undefined) : undefined}
                    >
                      <td className="px-3 py-2 font-medium text-slate-800 break-words max-w-[14rem]">
                        {formatProjectDisplayName(project.name, project.projectKind)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-teal-700">
                        {formatPercent1(allocationPercent)}%
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 text-right tabular-nums align-top',
                          rowIntegrity.hasMismatch ? 'text-amber-800 font-semibold' : 'text-slate-600',
                        )}
                      >
                        {md > 0 ? (
                          <div>
                            <div className="font-medium">{formatEffortFromManDays(md, effortDisplayUnit)}</div>
                            <div className="text-[10px] font-semibold text-indigo-700 mt-0.5">
                              진척 {formatPercent1(projectProgressPct)}%
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{period}</td>
                      <td className="px-2 py-2 text-slate-500">
                        {monthly ? (
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[18rem]">
                            {Object.entries(monthly)
                              .sort(([a], [b]) => a.localeCompare(b))
                              .map(([ym, pct]) => (
                                <span key={ym} className="tabular-nums">
                                  {ym} {formatPercent1(Number(pct))}%
                                </span>
                              ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">동일 비율</span>
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
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <ListTodo size={14} />
          담당 WBS 작업 ({tasksForPerson.length}건)
        </h4>
        {tasksForPerson.length === 0 ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-lg px-3 py-2">할당된 작업이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs sm:text-sm min-w-[720px]">
              <thead className="sticky top-0 z-[1] bg-slate-50 border-b border-slate-200 text-slate-500">
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
                    <tr key={task.id} className="border-t border-slate-100 hover:bg-slate-50/60 align-top">
                      <td className="px-3 py-2 text-slate-700 break-words max-w-[10rem]">
                        {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : task.projectId}
                      </td>
                      <td className="px-2 py-2 font-medium text-slate-900 break-words max-w-[16rem]">{task.name}</td>
                      <td className="px-1 py-2 text-center text-[10px] text-slate-500">
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
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700">{formatPercent1(task.progress)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {we != null && Number(we) > 0 ? `${formatNum2(Number(we))} ${unit}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{task.startDate || '—'}</td>
                      <td className="px-2 py-2 text-slate-600 whitespace-nowrap">{task.endDate || '—'}</td>
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
