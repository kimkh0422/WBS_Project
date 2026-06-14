import React, { useMemo, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { buildVisibleTasks } from '../lib/taskView';
import { isProjectTitleRootTask } from '../lib/ensureProjectTopLevelName';
import { FilterState, SortConfig } from '../types';
import { differenceInDays, parseISO, format, min, max, addDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Target, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';
import { ConfirmDialog } from './ConfirmDialog';

const emptyFilters: FilterState = {
  projectIds: 'all',
  status: 'all',
  assignee: '',
  assigneeUnassignedOnly: false,
  startDate: '',
  endDate: '',
};

function fmt(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? dateStr : format(d, 'yyyy.MM.dd', { locale: ko });
  } catch {
    return dateStr;
  }
}

function varianceDays(baselineStr: string | undefined, currentStr: string | undefined): number | null {
  if (!baselineStr || !currentStr) return null;
  try {
    const b = parseISO(baselineStr);
    const c = parseISO(currentStr);
    if (isNaN(b.getTime()) || isNaN(c.getTime())) return null;
    return differenceInDays(c, b);
  } catch {
    return null;
  }
}

export function BaselineView() {
  const {
    tasks,
    projects,
    currentProjectId,
    wbsMap,
    displayWbsMap,
    setBaselineForTasks,
    setBaselineForAllTasks,
    selectedTaskIds,
    setSelectedTaskIds,
  } = useWBS();

  const [showOnlyWithBaseline, setShowOnlyWithBaseline] = useState(true);
  const [baselineSelectedIds, setBaselineSelectedIds] = useState<Set<string>>(new Set());
  const [confirmSetAll, setConfirmSetAll] = useState(false);

  const showEffortColumns = showOnlyWithBaseline;
  const effortColCount = showEffortColumns ? 3 : 0;

  const filters: FilterState = useMemo(
    () => ({
      ...emptyFilters,
      projectIds: !currentProjectId || currentProjectId === 'all' ? 'all' : [currentProjectId],
    }),
    [currentProjectId],
  );

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);

  const visibleTasks = useMemo(
    () =>
      buildVisibleTasks(tasks, filters, null as SortConfig, {
        preserveDepthOnFiltered: false,
        projectTitleSkip: (t) => isProjectTitleRootTask(t, projectsById.get(t.projectId)),
      }),
    [tasks, filters, projectsById],
  );

  const listToShow = useMemo(() => {
    if (!showOnlyWithBaseline) return visibleTasks;
    return visibleTasks.filter(
      (t) => (t.baselineStartDate && t.baselineStartDate.length > 0) || (t.baselineEndDate && t.baselineEndDate.length > 0),
    );
  }, [visibleTasks, showOnlyWithBaseline]);

  const toggleSelect = (taskId: string, multi: boolean) => {
    const next = new Set(baselineSelectedIds);
    if (multi && next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    setBaselineSelectedIds(next);
    setSelectedTaskIds(Array.from(next));
  };

  const selectAll = () => {
    if (baselineSelectedIds.size === listToShow.length) {
      setBaselineSelectedIds(new Set());
      setSelectedTaskIds([]);
    } else {
      const ids = listToShow.map((t) => t.id);
      setBaselineSelectedIds(new Set(ids));
      setSelectedTaskIds(ids);
    }
  };

  const effectiveSelectedIds = baselineSelectedIds.size > 0 ? baselineSelectedIds : new Set(selectedTaskIds || []);
  const effectiveSelectedCount = effectiveSelectedIds.size;

  const handleSetBaselineForSelection = () => {
    const ids = effectiveSelectedCount > 0 ? Array.from(effectiveSelectedIds) : selectedTaskIds || [];
    if (ids.length > 0) {
      setBaselineForTasks(ids);
      setBaselineSelectedIds(new Set());
      setSelectedTaskIds([]);
    }
  };

  // 베이스라인만 있는 작업들의 날짜 범위 (간트용)
  const baselineTasksForChart = useMemo(() => {
    return listToShow.filter((t) => t.baselineStartDate && t.baselineEndDate);
  }, [listToShow]);

  const chartDates = useMemo(() => {
    if (baselineTasksForChart.length === 0) return { minDate: new Date(), maxDate: new Date(), days: 0 };
    const dates = baselineTasksForChart.flatMap((t) => [parseISO(t.baselineStartDate!), parseISO(t.baselineEndDate!)]);
    const minD = startOfWeek(min(dates));
    const maxD = endOfWeek(max(dates));
    const days = differenceInDays(maxD, minD) + 1;
    return { minDate: minD, maxDate: maxD, days: Math.max(days, 1) };
  }, [baselineTasksForChart]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* 상단 액션 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Target className="text-amber-500" size={22} />
              베이스라인
            </h2>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showOnlyWithBaseline}
                onChange={() => setShowOnlyWithBaseline((v) => !v)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              베이스라인 있는 작업만
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSetBaselineForSelection}
              disabled={effectiveSelectedCount === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              선택 작업 베이스라인 설정
              {effectiveSelectedCount > 0 && ` (${effectiveSelectedCount})`}
            </button>
            <button
              onClick={() => setConfirmSetAll(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              전체 베이스라인 설정
            </button>
          </div>
        </div>

        {/* 테이블 */}
        <div className="card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="w-8 p-2">
                    <input
                      type="checkbox"
                      checked={listToShow.length > 0 && effectiveSelectedCount >= listToShow.length}
                      onChange={selectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-14">ID</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider min-w-[200px]">작업명</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">베이스라인 시작</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">베이스라인 종료</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">현재 시작</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">현재 종료</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20 text-center">시작 차이(일)</th>
                  <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20 text-center">종료 차이(일)</th>
                  {showEffortColumns && (
                    <>
                      <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20 text-right">계획 공수</th>
                      <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20 text-right">현재 공수</th>
                      <th className="p-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-20 text-center">공수 차이</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {listToShow.length === 0 ? (
                  <tr>
                    <td colSpan={9 + effortColCount} className="p-8 text-center text-slate-400 text-sm">
                      {showOnlyWithBaseline
                        ? '베이스라인이 설정된 작업이 없습니다. 표/간트에서 작업을 선택한 뒤 "선택 작업 베이스라인 설정" 또는 "전체 베이스라인 설정"을 사용하세요.'
                        : '표시할 작업이 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  listToShow.map((task) => {
                    const startVar = varianceDays(task.baselineStartDate, task.startDate);
                    const endVar = varianceDays(task.baselineEndDate, task.endDate);
                    const isSelected = effectiveSelectedIds.has(task.id);
                    const wbsId = displayWbsMap.get(task.id) ?? wbsMap.get(task.id) ?? '';
                    const hasBaselineEffort = typeof task.baselineWorkEffort === 'number' && Number.isFinite(task.baselineWorkEffort);
                    const effortDiff = hasBaselineEffort ? (task.workEffort ?? 0) - (task.baselineWorkEffort ?? 0) : null;
                    const fmtEffort = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
                    return (
                      <tr
                        key={task.id}
                        onClick={() => toggleSelect(task.id, true)}
                        className={cn(
                          'border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer transition-colors',
                          isSelected && 'bg-indigo-50',
                        )}
                        style={{ paddingLeft: `${(task.depth || 0) * 20}px` }}
                      >
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(task.id, true)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-2 font-mono text-[10px] text-slate-500">{wbsId || '-'}</td>
                        <td
                          className="p-2 font-medium text-sm text-[var(--color-ink)]"
                          style={{ paddingLeft: `${12 + (task.depth || 0) * 20}px` }}
                        >
                          {task.name}
                        </td>
                        <td className="p-2 text-xs font-mono text-slate-600">{fmt(task.baselineStartDate)}</td>
                        <td className="p-2 text-xs font-mono text-slate-600">{fmt(task.baselineEndDate)}</td>
                        <td className="p-2 text-xs font-mono text-slate-700">{fmt(task.startDate)}</td>
                        <td className="p-2 text-xs font-mono text-slate-700">{fmt(task.endDate)}</td>
                        <td className="p-2 text-xs font-mono text-center">
                          {startVar !== null ? (
                            <span className={cn(startVar > 0 ? 'text-red-600' : startVar < 0 ? 'text-emerald-600' : 'text-slate-500')}>
                              {startVar > 0 ? '+' : ''}
                              {startVar}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="p-2 text-xs font-mono text-center">
                          {endVar !== null ? (
                            <span className={cn(endVar > 0 ? 'text-red-600' : endVar < 0 ? 'text-emerald-600' : 'text-slate-500')}>
                              {endVar > 0 ? '+' : ''}
                              {endVar}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        {showEffortColumns && (
                          <>
                            <td className="p-2 text-xs font-mono text-right text-slate-600">
                              {task.baselineWorkEffort != null && Number.isFinite(task.baselineWorkEffort)
                                ? fmtEffort(task.baselineWorkEffort)
                                : '-'}
                            </td>
                            <td className="p-2 text-xs font-mono text-right text-slate-700">
                              {task.workEffort != null && Number.isFinite(task.workEffort) ? fmtEffort(task.workEffort) : '-'}
                            </td>
                            <td className="p-2 text-xs font-mono text-center">
                              {effortDiff !== null ? (
                                <span
                                  className={cn(effortDiff > 0 ? 'text-red-600' : effortDiff < 0 ? 'text-emerald-600' : 'text-slate-500')}
                                >
                                  {effortDiff > 0 ? '+' : ''}
                                  {fmtEffort(effortDiff)}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 베이스라인 간트 (읽기 전용) */}
        {baselineTasksForChart.length > 0 && chartDates.days > 0 && (
          <div className="card-elevated overflow-hidden">
            <h3 className="px-4 py-3 text-sm font-bold text-slate-600 border-b border-slate-100 flex items-center gap-2">
              <Calendar size={16} className="text-amber-500" />
              베이스라인 간트
            </h3>
            <div className="p-4 overflow-x-auto">
              <div className="min-w-[600px]">
                {/* 시간축 */}
                <div className="flex text-[10px] font-mono text-slate-500 border-b border-slate-200 mb-2">
                  {eachDayOfInterval({ start: chartDates.minDate, end: addDays(chartDates.minDate, Math.min(chartDates.days, 90)) })
                    .filter((_, i) => i % 7 === 0 || i === 0)
                    .map((day) => (
                      <div key={day.toISOString()} className="flex-shrink-0 px-1" style={{ width: 28 }}>
                        {format(day, 'M/d', { locale: ko })}
                      </div>
                    ))}
                </div>
                {/* 막대 */}
                <div className="space-y-1.5">
                  {baselineTasksForChart.slice(0, 30).map((task) => {
                    const start = parseISO(task.baselineStartDate!);
                    const end = parseISO(task.baselineEndDate!);
                    const left = (differenceInDays(start, chartDates.minDate) / chartDates.days) * 100;
                    const width = Math.max(2, ((differenceInDays(end, start) + 1) / chartDates.days) * 100);
                    return (
                      <div key={task.id} className="flex items-center gap-2 h-7">
                        <div className="w-32 truncate text-xs text-slate-600 font-medium shrink-0" title={task.name}>
                          {task.name}
                        </div>
                        <div className="flex-1 h-4 bg-slate-100 rounded relative overflow-hidden min-w-[200px]">
                          <div
                            className="absolute top-0 left-0 h-full bg-amber-500/80 rounded"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${fmt(task.baselineStartDate)} ~ ${fmt(task.baselineEndDate)}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmSetAll}
        onClose={() => setConfirmSetAll(false)}
        onConfirm={() => {
          setBaselineForAllTasks();
          setConfirmSetAll(false);
        }}
        title="전체 베이스라인 설정"
        message="모든 작업의 현재 일정·공수를 베이스라인으로 저장합니다. 기존 베이스라인이 덮어씌워집니다. 계속하시겠습니까?"
        confirmLabel="설정"
      />
    </div>
  );
}
