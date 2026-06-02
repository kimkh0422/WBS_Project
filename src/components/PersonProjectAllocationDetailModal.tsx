import React, { useMemo } from 'react';
import { Briefcase, ListTodo, UserCircle } from 'lucide-react';
import type { Project, Task, WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { BaseModal } from './Base/Modal';
import { cn, formatNum2, formatPercent1 } from '../lib/utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { formatProjectDisplayName } from '../lib/projectKind';
import { getStatusColorProps } from '../lib/statusColor';
import { manDaysToManMonths } from '../lib/workEffortUnits';
import { mergeMonthlyAllocationsForAssignee } from '../lib/personAllocations';

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

export interface PersonProjectAllocationDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  person: string;
  project: Project;
  allocationPercent: number;
  workEffortMd: number;
  allTasks: Task[];
  effortDisplayUnit: 'mm' | 'md';
  orgMemberLabelByName: Map<string, string>;
  displayMetaByName: Map<string, PersonDisplayMeta>;
  statusConfigs: StatusConfig[];
  onNavigateToWork?: (projectId: string) => void;
  profileMap?: Record<string, string>;
}

export function PersonProjectAllocationDetailModal({
  isOpen,
  onClose,
  person,
  project,
  allocationPercent,
  workEffortMd,
  allTasks,
  effortDisplayUnit,
  orgMemberLabelByName,
  displayMetaByName,
  statusConfigs,
  onNavigateToWork,
  profileMap,
}: PersonProjectAllocationDetailModalProps) {
  const personDisplay = formatAssigneeDisplay(person, displayMetaByName);
  const orgLabel = orgMemberLabelByName.get(person.trim()) ?? null;
  const projectTitle = formatProjectDisplayName(project.name, project.projectKind);
  const period = project.startDate || project.endDate ? `${project.startDate || '미정'} ~ ${project.endDate || '미정'}` : '기간 미정';

  const monthly = useMemo(() => mergeMonthlyAllocationsForAssignee(project, person), [project, person]);

  const tasksHere = useMemo(() => {
    const target = (person || '').trim() || '(미지정)';
    return allTasks
      .filter((t) => t.projectId === project.id && ((t.assignee || '').trim() || '(미지정)') === target)
      .slice()
      .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
  }, [allTasks, project.id, person]);

  const statusNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of statusConfigs) m.set(c.id, c.name);
    return m;
  }, [statusConfigs]);

  const isPmOnProject = useMemo(() => {
    if (person === '(미지정)') return false;
    const t = person.trim();
    return resolveProjectPmRawDisplayName(project, profileMap).trim() === t;
  }, [person, project, profileMap]);

  const title = (
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="text-base font-bold text-[var(--color-ink)] break-words leading-snug">{personDisplay}</span>
      <span className="text-sm font-semibold text-slate-500 break-words leading-snug">{projectTitle}</span>
    </span>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="lg"
      headerStart={<UserCircle className="text-teal-600 shrink-0" size={22} aria-hidden />}
      bodyClassName="pt-4"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          {onNavigateToWork && (
            <button
              type="button"
              onClick={() => {
                onNavigateToWork(project.id);
                onClose();
              }}
              className="inline-flex items-center justify-center rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
            >
              이 프로젝트 작업 표로 이동
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            닫기
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">이 프로젝트 투입</div>
            <div className={cn('text-lg font-bold tabular-nums mt-0.5', allocationPercent > 100 ? 'text-amber-600' : 'text-teal-700')}>
              {formatPercent1(allocationPercent)}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">WBS 공수 합</div>
            <div className="text-lg font-bold tabular-nums text-slate-800 mt-0.5">
              {workEffortMd > 0 ? formatEffortFromManDays(workEffortMd, effortDisplayUnit) : '—'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 col-span-2 sm:col-span-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">담당 작업</div>
            <div className="text-lg font-bold tabular-nums text-violet-700 mt-0.5">{tasksHere.length}건</div>
          </div>
        </div>

        {(orgLabel || isPmOnProject) && (
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-sm text-slate-700 space-y-1">
            {orgLabel && <p className="break-words">{orgLabel}</p>}
            {isPmOnProject && (
              <p className="text-indigo-900 font-medium flex items-center gap-1.5">
                <Briefcase size={14} className="shrink-0 text-indigo-600" aria-hidden />이 프로젝트의 PM(과제 책임)으로 표시되어 있습니다.
              </p>
            )}
          </div>
        )}

        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <Briefcase size={14} aria-hidden />
            프로젝트 기간
          </h4>
          <p className="text-sm text-slate-700 tabular-nums">{period}</p>
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">월별 투입</h4>
          {monthly ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700">
              {Object.entries(monthly)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([ym, pct]) => (
                  <span key={ym} className="tabular-nums">
                    {ym} <strong>{formatPercent1(Number(pct))}%</strong>
                  </span>
                ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">월별 값이 없으면 프로젝트 전체 기간에 동일 비율로 적용됩니다.</p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ListTodo size={14} aria-hidden />이 프로젝트에서 담당한 WBS 작업 ({tasksHere.length}건)
          </h4>
          {tasksHere.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">할당된 작업이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto max-h-[min(380px,45vh)] overflow-y-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-xs sm:text-sm min-w-[560px]">
                <thead className="sticky top-0 z-[1] bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">작업명</th>
                    <th className="text-center font-medium px-1 py-2 w-14">유형</th>
                    <th className="text-left font-medium px-2 py-2 w-24">상태</th>
                    <th className="text-right font-medium px-2 py-2 w-14">진척</th>
                    <th className="text-right font-medium px-2 py-2 w-20">공수</th>
                    <th className="text-left font-medium px-2 py-2 whitespace-nowrap">시작</th>
                    <th className="text-left font-medium px-2 py-2 whitespace-nowrap">종료</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksHere.map((task) => {
                    const sc = statusConfigs.find((c) => c.id === task.status);
                    const colorProps = getStatusColorProps(sc?.color ?? '');
                    const statusLabel = statusNameById.get(task.status) ?? task.status;
                    const unit = workEffortUnitLabel(project.workEffortUnit);
                    const we = task.workEffort;
                    return (
                      <tr key={task.id} className="border-t border-slate-100 hover:bg-slate-50/60 align-top">
                        <td className="px-3 py-2 font-medium text-slate-900 break-words max-w-[18rem]">{task.name}</td>
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

        <p className="text-[11px] text-slate-400 leading-relaxed">
          이름이나 투입율 숫자를 누르면 작업 표 이동·투입율 수정이 됩니다. 카드의 빈 영역을 누르면 이 창이 열립니다.
        </p>
      </div>
    </BaseModal>
  );
}
