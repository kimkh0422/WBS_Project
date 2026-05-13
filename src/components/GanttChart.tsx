import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { differenceInDays, eachDayOfInterval, isSameDay, parseISO, eachMonthOfInterval, eachWeekOfInterval } from 'date-fns';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildVisibleTasks, type TaskWithDepth } from '../lib/taskView';
import { useLevelColors } from '../context/LevelColorsContext';
import { getCriticalPathTaskIds } from '../lib/schedule';
import { buildProjectEffortUnitMap } from '../lib/workEffortUnits';
import { useToast } from './Toast';
import { formatRange, formatEffort } from '../lib/ganttFormat';
import { isComposingKeyEvent } from '../lib/ime';
import { ZOOM_LEVELS, type ViewMode } from './Gantt/ZOOM_LEVELS';
import { useGanttViewport } from './hooks/useGanttViewport';
import { useGanttDrag } from './hooks/useGanttDrag';
import { GanttTopHeader, GanttBottomHeader } from './Gantt/GanttHeader';
import { GanttGrid } from './Gantt/GanttGrid';

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
  rowHeight?: number;
  /** 표에서 측정한 행별 높이 (줄바꿈 켜짐 시 표·간트 동기화) */
  rowHeights?: number[];
  onRowHeightChange?: (height: number) => void;
  syncScrollRef?: React.Ref<HTMLDivElement>;
  hotkeysEnabled?: boolean;
  /** split 뷰에서 표의 sticky [+ 새 작업 추가] 행 높이만큼 간트 상단을 띄워 행 정렬 맞춤. 0이면 띄우지 않음. */
  topSpacerHeight?: number;
}

export function GanttChart({
  filters,
  sortConfig,
  hideSidebar = false,
  rowHeight: propRowHeight,
  rowHeights: propRowHeights,
  onRowHeightChange,
  syncScrollRef,
  hotkeysEnabled = true,
  topSpacerHeight = 0,
}: GanttChartProps) {
  const {
    tasks,
    updateTask,
    deleteTask,
    wbsMap,
    displayWbsMap,
    selectedTaskIds,
    setSelectedTaskIds,
    activeTaskId,
    setActiveTaskId,
    wbsSettings,
    canEditCurrentProject,
    projects,
  } = useWBS();
  const { levelBarBg, levelBorderColor, levelRowBg, levelGanttBarFill } = useLevelColors();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskId: string } | null>(null);
  const [tappedBar, setTappedBar] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const barPopoverRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set<string>(selectedTaskIds), [selectedTaskIds]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 240;
    const raw = window.localStorage.getItem('wbs:gantt:sidebarWidth');
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 240;
    return Math.min(520, Math.max(180, Math.round(n)));
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('wbs:gantt:sidebarWidth', String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleSidebarResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [sidebarWidth],
  );

  // 완료 처리 규칙:
  // - leaf(최하위) 작업: status === 'done' 이면 완료
  // - 상위 작업: 하위 leaf 작업들이 모두 완료면 완료로 간주(흑백 처리)
  const allLeafDoneById = useMemo(() => {
    const byId = new Map<string, Task>(tasks.map((t) => [t.id, t]));
    const childrenByParent = new Map<string, string[]>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t.id);
      childrenByParent.set(t.parentId, arr);
    }

    const memo = new Map<string, boolean>();
    const visiting = new Set<string>();

    const dfs = (id: string): boolean => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) return false; // cycle guard
      visiting.add(id);

      const task = byId.get(id);
      if (!task) {
        visiting.delete(id);
        memo.set(id, false);
        return false;
      }

      const children = childrenByParent.get(id) ?? [];
      let result: boolean;
      if (children.length === 0) {
        result = task.status === 'done';
      } else {
        result = children.every((childId) => dfs(childId));
      }

      visiting.delete(id);
      memo.set(id, result);
      return result;
    };

    for (const t of tasks) dfs(t.id);
    return memo;
  }, [tasks]);

  // Zoom level index, -1 means auto-fit
  const [zoomIndex, setZoomIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  /** 본문(세로 스크롤) element — 표↔간트 동기화의 한쪽 끝. 외부 syncScrollRef와 함께 set한다(callback ref 호환). */
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const setMainScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      mainScrollRef.current = el;
      const outer = syncScrollRef;
      if (typeof outer === 'function') outer(el);
      else if (outer) (outer as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [syncScrollRef],
  );

  // visibleTasks 로직을 WBSTable과 동일하게 맞춰 표·간트 행 정렬이 일치하도록 함
  const visibleTasks = useMemo(
    () => buildVisibleTasks(tasks, filters, sortConfig, { preserveDepthOnFiltered: true }),
    [tasks, filters, sortConfig],
  );

  const { push: pushToast } = useToast();

  // visibleTaskById + visibleTaskIndexById를 단일 패스로 생성
  const { visibleTaskById, visibleTaskIndexById } = useMemo(() => {
    const byId = new Map<string, TaskWithDepth>();
    const indexById = new Map<string, number>();
    visibleTasks.forEach((task, index) => {
      byId.set(task.id, task);
      indexById.set(task.id, index);
    });
    return { visibleTaskById: byId, visibleTaskIndexById: indexById };
  }, [visibleTasks]);

  const [showBaseline, setShowBaseline] = useState(false);
  const showCriticalPath = wbsSettings?.showCriticalPath === true;

  const projectAssignmentsByProjectId = useMemo(() => new Map(projects.map((p) => [p.id, p.assignments ?? []])), [projects]);
  const projectEffortUnitByProjectId = useMemo(() => buildProjectEffortUnitMap(projects), [projects]);
  // 크리티컬 패스 표시가 꺼져 있으면 계산 자체를 스킵 (O(V²+E) 연산)
  const criticalPathSet = useMemo(
    () =>
      showCriticalPath
        ? getCriticalPathTaskIds(tasks, projectAssignmentsByProjectId, projectEffortUnitByProjectId)
        : EMPTY_CRITICAL_PATH_SET,
    [showCriticalPath, tasks, projectAssignmentsByProjectId, projectEffortUnitByProjectId],
  );
  const effectiveCriticalPathSet = criticalPathSet;

  // Keyboard hotkeys - only when mounted
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      if (isComposingKeyEvent(e)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return;
      const currentRowHeight = propRowHeight ?? 20;
      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통)
      if (onRowHeightChange && (e.ctrlKey || e.metaKey)) {
        const isInc = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
        const isDec = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
        if (isInc) {
          e.preventDefault();
          onRowHeightChange(Math.min(64, currentRowHeight + 2));
          return;
        }
        if (isDec) {
          e.preventDefault();
          onRowHeightChange(Math.max(15, currentRowHeight - 2));
          return;
        }
      }
      // Zoom: + / - (수정키 없을 때만; Ctrl+/-는 줄높이용)
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoomIndex((prev) => (prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1)));
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setZoomIndex((prev) => (prev === -1 ? 0 : Math.max(0, prev - 1)));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, propRowHeight, onRowHeightChange]);

  const handleSave = (updates: Partial<Task>) => {
    if (editingTask) {
      if (editingTask.id !== '') updateTask(editingTask.id, updates);
      setEditingTask(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  const handleBarClickForPopover = useCallback((e: React.MouseEvent, task: Task) => {
    if (suppressBarPopoverClickRef.current) {
      suppressBarPopoverClickRef.current = false;
      return;
    }
    setTappedBar({ taskId: task.id, x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!tappedBar) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (barPopoverRef.current?.contains(ev.target as Node)) return;
      setTappedBar(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [tappedBar]);

  useEffect(() => {
    if (editingTask) setTappedBar(null);
  }, [editingTask]);

  const ROW_HEIGHT = propRowHeight ?? 20;
  const VIEW_PADDING_TOP = 0;

  // 표·간트 동기화: 표의 .data-row는 border-box이므로 height가 테두리 포함 총 높이. 간트도 동일한 줄간격으로 일직선 정렬.
  const effectiveRowHeights = useMemo(() => {
    if (propRowHeights && propRowHeights.length === visibleTasks.length) return propRowHeights;
    return visibleTasks.map(() => ROW_HEIGHT);
  }, [propRowHeights, visibleTasks.length, ROW_HEIGHT]);

  const totalHeight = useMemo(() => effectiveRowHeights.reduce((a, b) => a + b, 0), [effectiveRowHeights]);

  const ganttVirtualizer = useVirtualizer({
    count: visibleTasks.length,
    getScrollElement: () => mainScrollRef.current ?? null,
    estimateSize: (i) => effectiveRowHeights[i] ?? ROW_HEIGHT,
    overscan: 10,
  });

  const effectiveSidebarWidth = hideSidebar ? 0 : sidebarWidth;
  const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
  const { dates, minDate, maxDate, totalDays, autoZoomLevel, currentZoomEntry, dayWidth } = useGanttViewport({
    visibleTasks,
    zoomIndex,
    containerWidth,
    effectiveSidebarWidth,
  });

  const { dragPreview, suppressBarPopoverClickRef, handleBarMouseDown, handleResizeMouseDown } = useGanttDrag({
    selectedSet,
    visibleTaskById,
    visibleTasks,
    tasks,
    selectedTaskIds,
    setSelectedTaskIds,
    setActiveTaskId,
    updateTask,
    pushToast,
    dayWidth,
    minDate,
    sidebarResizeRef,
    setSidebarWidth,
  });

  const dependencyPaths = useMemo(() => {
    if (visibleTasks.length === 0 || dates.length === 0) return [];
    const rowTops = effectiveRowHeights.reduce<number[]>((acc, _, i) => {
      acc.push(i === 0 ? VIEW_PADDING_TOP : acc[i - 1] + effectiveRowHeights[i - 1]);
      return acc;
    }, []);
    return visibleTasks.flatMap((task, index) => {
      if (!task.dependencies || task.dependencies.length === 0) return [];

      const taskStart = parseISO(task.startDate);
      const taskOffsetDays = differenceInDays(taskStart, minDate);
      const taskLeft = taskOffsetDays * dayWidth;
      const taskTop = rowTops[index] + effectiveRowHeights[index] / 2;

      return task.dependencies.flatMap((depId) => {
        const depTask = visibleTaskById.get(depId);
        const depIndex = visibleTaskIndexById.get(depId);
        if (!depTask || depIndex === undefined) return [];

        const depEnd = parseISO(depTask.endDate);
        const depOffsetDays = differenceInDays(depEnd, minDate) + 1;
        const depRight = depOffsetDays * dayWidth;
        const depTop = rowTops[depIndex] + effectiveRowHeights[depIndex] / 2;
        const path = `M ${depRight} ${depTop} L ${depRight + 10} ${depTop} L ${depRight + 10} ${taskTop} L ${taskLeft} ${taskTop}`;
        const isCritical = effectiveCriticalPathSet.has(depId) && effectiveCriticalPathSet.has(task.id);

        return [{ key: `${depId}-${task.id}`, path, isCritical }];
      });
    });
  }, [
    effectiveRowHeights,
    VIEW_PADDING_TOP,
    dayWidth,
    minDate,
    visibleTaskById,
    visibleTaskIndexById,
    visibleTasks,
    dates.length,
    effectiveCriticalPathSet,
  ]);

  const isSplitView = !!syncScrollRef;

  // Split view: 날짜 헤더(상단 가로 스크롤) ↔ 본문 ↔ 하단 스크롤바 수평 동기화.
  // 상단·하단 어디서 스크롤해도 셋이 같이 움직이도록 유지.
  // NOTE: Rules of Hooks - early return 이전에 위치해야 함
  useEffect(() => {
    if (!isSplitView) return;
    const mainEl = mainScrollRef.current;
    if (!mainEl) return;
    const onMainScroll = () => {
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = mainEl.scrollLeft;
      if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = mainEl.scrollLeft;
    };
    mainEl.addEventListener('scroll', onMainScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', onMainScroll);
  }, [isSplitView, syncScrollRef]);

  useEffect(() => {
    if (!isSplitView) return;
    const bottomEl = bottomScrollRef.current;
    const mainEl = mainScrollRef.current;
    if (!bottomEl || !mainEl) return;
    const onBottomScroll = () => {
      mainEl.scrollLeft = bottomEl.scrollLeft;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = bottomEl.scrollLeft;
    };
    bottomEl.addEventListener('scroll', onBottomScroll, { passive: true });
    return () => bottomEl.removeEventListener('scroll', onBottomScroll);
  }, [isSplitView, syncScrollRef]);

  useEffect(() => {
    if (!isSplitView) return;
    const headerEl = headerScrollRef.current;
    const mainEl = mainScrollRef.current;
    if (!headerEl || !mainEl) return;
    const onHeaderScroll = () => {
      mainEl.scrollLeft = headerEl.scrollLeft;
      if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = headerEl.scrollLeft;
    };
    headerEl.addEventListener('scroll', onHeaderScroll, { passive: true });
    return () => headerEl.removeEventListener('scroll', onHeaderScroll);
  }, [isSplitView, syncScrollRef]);

  const tappedBarPopoverEl =
    tappedBar &&
    (() => {
      const t = visibleTaskById.get(tappedBar.taskId) ?? tasks.find((x) => x.id === tappedBar.taskId);
      if (!t) return null;
      const wbs = displayWbsMap.get(t.id);
      const displayName = wbs ? `${wbs} ${t.name}` : t.name;
      return (
        <div
          ref={barPopoverRef}
          className="fixed z-50 bg-white border border-stone-200 rounded-lg shadow-lg p-3 text-sm max-w-[240px]"
          style={{ left: tappedBar.x, top: tappedBar.y, transform: 'translate(-50%, 8px)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="font-semibold text-stone-800 break-words">{displayName}</div>
          <div className="text-stone-600 mt-1 tabular-nums">{formatRange(t.startDate, t.endDate)}</div>
          {t.assignee ? <div className="text-stone-500 mt-1 break-words">{t.assignee}</div> : null}
        </div>
      );
    })();

  if (visibleTasks.length === 0)
    return (
      <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
        {tasks.length === 0 ? '등록된 작업이 없습니다. 새 작업을 추가해 보세요.' : '필터와 일치하는 작업이 없습니다.'}
      </div>
    );

  if (dates.length === 0)
    return (
      <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
        유효하지 않은 날짜가 포함되어 있습니다. 데이터를 확인해 주세요.
      </div>
    );

  const viewMode: ViewMode = currentZoomEntry.mode;
  const totalWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const months = eachMonthOfInterval({ start: minDate, end: maxDate });
  const weeks = eachWeekOfInterval({ start: minDate, end: maxDate });

  const today = new Date();
  const todayIndex = days.findIndex((day) => isSameDay(day, today));
  const todayLeft = todayIndex !== -1 ? todayIndex * dayWidth + dayWidth / 2 : 0;

  const headerProps = { viewMode, dayWidth, minDate, maxDate, days, months, weeks, today };

  // Split view: 헤더는 스크롤 밖, 스크롤 영역은 행만 → 표와 scrollTop 1:1 맞춤
  // 표의 Summary Bar와 동일 min-h로 줌 바를 통합해 표·간트 헤더가 일직선에 오도록 함
  if (isSplitView) {
    return (
      <>
        <div className="w-full h-full flex flex-col bg-white">
          {/* 표의 Summary Bar와 동일 높이 - 줌/줄간격 컨트롤을 이 안에 배치해 헤더 정렬 (min-h로 여유 두어 화면 잘림 방지) */}
          <div className="min-h-12 flex-shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-[var(--color-line)] bg-stone-50 overflow-x-auto overflow-y-visible whitespace-nowrap">
            {/* 확대/축소 (너비 간격) */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 shrink-0">축소</span>
              <button
                onClick={() => setZoomIndex((prev) => (prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1)))}
                className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
                title="축소"
              >
                <ZoomOut size={12} />
              </button>
              <input
                type="range"
                min={0}
                max={ZOOM_LEVELS.length - 1}
                step={1}
                value={
                  zoomIndex === -1
                    ? Math.max(
                        0,
                        ZOOM_LEVELS.findIndex((z) => z.dayWidth === autoZoomLevel.dayWidth),
                      )
                    : zoomIndex
                }
                onChange={(e) => setZoomIndex(Number(e.target.value))}
                className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[100px] shrink"
                title="간트 확대/축소"
              />
              <button
                onClick={() => setZoomIndex((prev) => (prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1)))}
                className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
                title="확대"
              >
                <ZoomIn size={12} />
              </button>
              <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
              <button
                onClick={() => setZoomIndex(-1)}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0',
                  zoomIndex === -1 ? 'text-blue-600 bg-blue-50 font-medium' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700',
                )}
                title="전체 맞춤"
              >
                맞춤
              </button>
              <span className="text-[10px] font-mono text-stone-500 w-8 shrink-0">
                {zoomIndex === -1 ? '맞춤' : ZOOM_LEVELS[zoomIndex].label}
              </span>
            </div>

            {/* 줄간격 조절 - 너비 간격(줌)과 동일한 형태로 우측에 배치 */}
            {onRowHeightChange && (
              <>
                <div className="w-px h-5 bg-stone-200 flex-shrink-0" />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
                  <input
                    type="range"
                    min={15}
                    max={64}
                    step={2}
                    value={propRowHeight ?? 20}
                    onChange={(e) => onRowHeightChange(Number(e.target.value))}
                    className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[96px]"
                    title={`줄간격: ${propRowHeight ?? 20}px`}
                  />
                  <span className="text-[10px] font-bold text-slate-600 w-7 text-right shrink-0">{propRowHeight ?? 20}</span>
                </div>
              </>
            )}
            <div className="w-px h-5 bg-stone-200 flex-shrink-0" />
            <button
              onClick={() => setShowBaseline((prev) => !prev)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded transition-colors shrink-0 whitespace-nowrap',
                showBaseline ? 'text-orange-600 bg-orange-50 font-medium' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700',
              )}
              title="베이스라인 일정 표시 토글"
            >
              베이스라인
            </button>
          </div>
          {/* 헤더 고정 (스크롤 밖) - 표의 split 헤더처럼 상단 수평 스크롤바 노출하여 본문·하단과 동기화.
              표는 헤더에 위쪽 스크롤바, 본문에 아래 스크롤바를 두는 구조 — 간트도 같은 패턴으로 정렬. */}
          <div
            ref={headerScrollRef}
            className="flex-shrink-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)] overflow-x-auto overflow-y-hidden"
          >
            <div className="relative flex-shrink-0" style={{ width: totalWidth, height: 60 }}>
              <div className="flex h-7 border-b border-stone-200" style={{ width: totalWidth }}>
                <GanttTopHeader {...headerProps} />
              </div>
              <div className="flex h-8" style={{ width: totalWidth }}>
                <GanttBottomHeader {...headerProps} />
              </div>
            </div>
          </div>
          {/* 스크롤 영역 = 행만 (표와 세로 스크롤 동기화). 수평 스크롤은 상단 헤더·하단 별도 바에서 처리(여기는 숨김). */}
          <div ref={setMainScrollEl} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-white">
            {/* 상단 spacer — 표의 sticky [+ 새 작업 추가] 행에 대응.
                sticky로 두어 스크롤해도 항상 viewport 상단에 머무르며 표의 sticky 행과 시각 정렬.
                실제 데이터 행은 spacer 아래에서 시작되어 표의 첫 행과 같은 y에 위치한다. */}
            {topSpacerHeight > 0 && (
              <div
                className="sticky top-0 z-20 border-y border-blue-200/70 bg-blue-50/70 backdrop-blur-sm shadow-sm"
                style={{ height: topSpacerHeight, width: totalWidth, boxSizing: 'border-box' }}
                aria-hidden
              />
            )}
            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              <div className="absolute inset-0 z-0 flex pointer-events-none">
                <GanttGrid
                  viewMode={viewMode}
                  dayWidth={dayWidth}
                  minDate={minDate}
                  maxDate={maxDate}
                  days={days}
                  months={months}
                  weeks={weeks}
                />
              </div>
              {todayIndex !== -1 && (
                <div
                  className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50"
                  style={{ left: todayLeft }}
                />
              )}
              <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                <defs>
                  <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                  </marker>
                </defs>
                {dependencyPaths.map(({ key, path, isCritical }) => (
                  <path
                    key={key}
                    d={path}
                    fill="none"
                    stroke={isCritical ? '#dc2626' : '#a8a29e'}
                    strokeWidth={isCritical ? 2.5 : 1.5}
                    markerEnd="url(#arrowhead)"
                    opacity={isCritical ? 0.9 : 0.6}
                  />
                ))}
              </svg>
              {(visibleTasks.length > 50
                ? ganttVirtualizer.getVirtualItems()
                : visibleTasks.map((_, i) => ({
                    index: i,
                    start: effectiveRowHeights.slice(0, i).reduce((a, b) => a + b, 0),
                    size: effectiveRowHeights[i],
                  }))
              ).map((virtualRow) => {
                const index = virtualRow.index;
                const task = visibleTasks[index];
                if (!task) return null;
                // 보라색 강조: 체크박스 체크된 행만. 노란색(amber) 강조: 단일 활성 행(activeTaskId).
                // 둘 다 해당하면 보라색 우선(체크박스가 더 명시적 의도).
                const isSelected = selectedSet.has(task.id);
                const isActive = !isSelected && activeTaskId === task.id;
                const preview = dragPreview?.get(task.id);
                const isBeingDragged = !!preview;
                const isDone = allLeafDoneById.get(task.id) === true;
                const effectiveStartDate = preview?.startDate ?? task.startDate;
                const effectiveEndDate = preview?.endDate ?? task.endDate;
                const start = parseISO(effectiveStartDate);
                const end = parseISO(effectiveEndDate);
                const offsetDays = differenceInDays(start, minDate);
                const durationDays = differenceInDays(end, start) + 1;
                const left = offsetDays * dayWidth;
                const width = Math.max(durationDays * dayWidth, dayWidth);
                const depth = task.depth ?? 0;
                const level = depth + 1;
                const isCritical = effectiveCriticalPathSet.has(task.id);
                const effortText = formatEffort(task.workEffort, projectEffortUnitByProjectId.get(task.projectId) ?? 'day');
                const rowH = effectiveRowHeights[index];
                return (
                  <div
                    key={task.id}
                    className={cn(
                      'absolute left-0 right-0 group box-border border-b border-slate-100/80 transition-colors z-[1]',
                      isSelected &&
                        'z-[2] bg-purple-50/90 font-semibold text-purple-900 ring-2 ring-inset ring-purple-500/80 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.12)]',
                      isActive && 'z-[2] bg-amber-50/80 font-medium text-amber-900 ring-2 ring-inset ring-amber-500/70',
                      !isSelected && !isActive && 'hover:bg-[var(--color-line-soft)]',
                    )}
                    style={{ width: totalWidth, height: rowH, top: virtualRow.start }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      handleBarMouseDown(e, task);
                    }}
                  >
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onClick={(e) => handleBarClickForPopover(e, task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn(
                        'absolute top-0 rounded shadow-sm overflow-hidden transition-all border',
                        isDone && 'gantt-completed',
                        isCritical && 'ring-2 ring-red-500 border-red-600',
                        isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : 'cursor-grab hover:brightness-110',
                      )}
                      style={{
                        left,
                        width: Math.max(width - 4, 4),
                        height: rowH,
                        backgroundColor: levelGanttBarFill(level),
                        borderColor: isCritical ? '#dc2626' : levelBarBg(level),
                      }}
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''} · ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}${task.assignee ? ` · ${task.assignee}` : ''}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium break-words pr-8 pointer-events-none line-clamp-2 text-slate-800"
                          style={{ width: 'calc(100% - 12px)' }}
                        >
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                          {task.name}
                        </span>
                      )}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')}
                      />
                    </div>
                    {showBaseline &&
                      task.baselineStartDate &&
                      task.baselineEndDate &&
                      (() => {
                        const blStart = parseISO(task.baselineStartDate);
                        const blEnd = parseISO(task.baselineEndDate);
                        const blOffsetDays = differenceInDays(blStart, minDate);
                        const blDuration = differenceInDays(blEnd, blStart) + 1;
                        const blLeft = blOffsetDays * dayWidth;
                        const blWidth = Math.max(blDuration * dayWidth, dayWidth);
                        return (
                          <div
                            className="absolute rounded-sm pointer-events-none border border-dashed border-orange-400"
                            style={{
                              left: blLeft,
                              width: Math.max(blWidth - 4, 4),
                              height: 4,
                              bottom: 1,
                              backgroundColor: 'rgba(251,146,60,0.35)',
                            }}
                            title={`베이스라인: ${task.baselineStartDate} → ${task.baselineEndDate}`}
                          />
                        );
                      })()}
                    {isBeingDragged && (
                      <div
                        className="absolute -top-7 bg-stone-800 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none"
                        style={{ left: Math.max(0, left) }}
                      >
                        {effectiveStartDate} ~ {effectiveEndDate}
                      </div>
                    )}
                    {width < 80 && !isBeingDragged && (
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 break-words max-w-[200px] pointer-events-none"
                        style={{ left: left + width + 8 }}
                      >
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                        {task.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 하단 수평 스크롤바 */}
          <div
            ref={bottomScrollRef}
            className="flex-shrink-0 overflow-x-scroll overflow-y-hidden border-t border-stone-200"
            style={{ height: 12 }}
          >
            <div style={{ width: totalWidth, height: 1 }} />
          </div>
        </div>

        {tappedBarPopoverEl}

        <TaskModal
          isOpen={!!editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleSave}
          initialData={editingTask || undefined}
          parentOptions={tasks}
          onOpenTask={(task) => setEditingTask(task)}
        />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            actions={[
              {
                label: '편집',
                onClick: () => {
                  setEditingTask(tasks.find((t) => t.id === contextMenu.taskId) || null);
                },
              },
              ...(canEditCurrentProject
                ? [
                    {
                      label: '삭제',
                      onClick: () => {
                        deleteTask(contextMenu.taskId);
                      },
                      danger: true,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="w-full h-full flex flex-col bg-white">
        {/* 컨트롤 바 - 스크롤 영역 밖 (split view와 동일한 구조) */}
        <div className="min-h-12 flex-shrink-0 flex items-center justify-end gap-3 px-4 py-1.5 border-b border-[var(--color-line)] bg-stone-50 overflow-x-auto overflow-y-visible whitespace-nowrap">
          {/* 확대/축소 (날짜 간격) */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 shrink-0">축소</span>
            <button
              onClick={() => setZoomIndex((prev) => (prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1)))}
              className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
              title="축소"
            >
              <ZoomOut size={12} />
            </button>
            <input
              type="range"
              min={0}
              max={ZOOM_LEVELS.length - 1}
              step={1}
              value={
                zoomIndex === -1
                  ? Math.max(
                      0,
                      ZOOM_LEVELS.findIndex((z) => z.dayWidth === autoZoomLevel.dayWidth),
                    )
                  : zoomIndex
              }
              onChange={(e) => setZoomIndex(Number(e.target.value))}
              className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[100px] shrink"
              title="간트 확대/축소"
            />
            <button
              onClick={() => setZoomIndex((prev) => (prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1)))}
              className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
              title="확대"
            >
              <ZoomIn size={12} />
            </button>
            <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
            <button
              onClick={() => setZoomIndex(-1)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0',
                zoomIndex === -1 ? 'text-blue-600 bg-blue-50 font-medium' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700',
              )}
              title="전체 맞춤"
            >
              맞춤
            </button>
            <span className="text-[10px] font-mono text-stone-500 w-8 shrink-0">
              {zoomIndex === -1 ? '맞춤' : ZOOM_LEVELS[zoomIndex].label}
            </span>
          </div>

          {/* 줄간격 조절 */}
          {onRowHeightChange && (
            <>
              <div className="w-px h-5 bg-stone-200 flex-shrink-0" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
                <input
                  type="range"
                  min={15}
                  max={64}
                  step={2}
                  value={propRowHeight ?? 20}
                  onChange={(e) => onRowHeightChange(Number(e.target.value))}
                  className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[96px]"
                  title={`줄간격: ${propRowHeight ?? 20}px`}
                />
                <span className="text-[10px] font-bold text-slate-600 w-7 text-right shrink-0">{propRowHeight ?? 20}</span>
              </div>
            </>
          )}
        </div>

        {/* 스크롤 영역 */}
        <div ref={containerRef} className="flex-1 min-h-0 overflow-auto bg-white">
          <div className="min-w-max flex flex-col">
            {/* Header Row */}
            <div className="flex sticky top-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
              {/* Sidebar Header */}
              {!hideSidebar && (
                <div
                  className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-stone-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-stone-500"
                  style={{ width: sidebarWidth, height: 60 }}
                >
                  <div className="flex items-end w-full min-w-0">
                    <span>작업</span>
                  </div>
                  <div
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 border-l border-stone-200 hover:border-indigo-400 z-[60] shrink-0"
                    onMouseDown={handleSidebarResizeMouseDown}
                    title="왼쪽 너비 조절"
                  />
                </div>
              )}

              {/* Timeline Header */}
              <div className="relative" style={{ width: Math.max(totalWidth, containerWidth - effectiveSidebarWidth), height: 60 }}>
                {/* Top header (months or years) */}
                <div className="flex h-7 border-b border-stone-200" style={{ width: totalWidth }}>
                  <GanttTopHeader {...headerProps} />
                </div>

                {/* Bottom header (days, weeks, or months) */}
                <div className="flex h-8" style={{ width: totalWidth }}>
                  <GanttBottomHeader {...headerProps} />
                </div>
              </div>
            </div>

            {/* Body Row */}
            <div className="flex relative">
              {/* Left Column (Task Names) */}
              {!hideSidebar && (
                <div
                  className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 lg:block md:hidden hidden"
                  style={{ width: sidebarWidth }}
                >
                  {visibleTasks.map((t, index) => {
                    const depth = t.depth ?? 0;
                    const level = depth + 1;
                    return (
                      <div
                        key={t.id}
                        className="flex items-center text-xs font-medium text-[var(--color-ink)] hover:bg-stone-50 cursor-pointer transition-colors border-b border-l-4 border-transparent hover:border-stone-100"
                        style={{
                          height: `${effectiveRowHeights[index] ?? ROW_HEIGHT}px`,
                          paddingLeft: `${depth * 16 + 16}px`,
                          paddingRight: 16,
                          borderLeftColor: levelBarBg(level),
                        }}
                        title={displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ${t.name}` : t.name}
                        onDoubleClick={() => setEditingTask(t)}
                      >
                        <div className="break-words min-w-0">
                          {displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ` : ''}
                          {t.name}
                        </div>
                      </div>
                    );
                  })}
                  <div
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 border-l border-stone-200 hover:border-indigo-400 z-[60] shrink-0"
                    onMouseDown={handleSidebarResizeMouseDown}
                    title="왼쪽 너비 조절"
                  />
                </div>
              )}

              {/* Chart Body */}
              <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
                {/* Grid Background */}
                <div className="absolute inset-0 z-0 flex pointer-events-none">
                  <GanttGrid
                    viewMode={viewMode}
                    dayWidth={dayWidth}
                    minDate={minDate}
                    maxDate={maxDate}
                    days={days}
                    months={months}
                    weeks={weeks}
                  />
                </div>

                {/* Today Line */}
                {todayIndex !== -1 && (
                  <div
                    className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50"
                    style={{ left: todayLeft }}
                  />
                )}

                {/* Dependency Lines SVG Layer */}
                <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                  <defs>
                    <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                    </marker>
                  </defs>
                  {dependencyPaths.map(({ key, path, isCritical }) => (
                    <path
                      key={key}
                      d={path}
                      fill="none"
                      stroke={isCritical ? '#dc2626' : '#a8a29e'}
                      strokeWidth={isCritical ? 2.5 : 1.5}
                      markerEnd="url(#arrowhead)"
                      opacity={isCritical ? 0.9 : 0.6}
                    />
                  ))}
                </svg>

                {/* Task Bars */}
                {visibleTasks.map((task, index) => {
                  // 보라색=체크박스, 노란색=단일 활성 (체크박스 우선)
                  const isSelected = selectedSet.has(task.id);
                  const isActive = !isSelected && activeTaskId === task.id;
                  const preview = dragPreview?.get(task.id);
                  const isBeingDragged = !!preview;
                  const effectiveStartDate = preview?.startDate ?? task.startDate;
                  const effectiveEndDate = preview?.endDate ?? task.endDate;

                  const start = parseISO(effectiveStartDate);
                  const end = parseISO(effectiveEndDate);
                  const offsetDays = differenceInDays(start, minDate);
                  const durationDays = differenceInDays(end, start) + 1;

                  const left = offsetDays * dayWidth;
                  const width = Math.max(durationDays * dayWidth, dayWidth);
                  const isMilestone = !!task.isMilestone;

                  const depth = task.depth ?? 0;
                  const level = depth + 1;
                  const isCritical = effectiveCriticalPathSet.has(task.id);
                  const isDone = allLeafDoneById.get(task.id) === true;
                  const effortText = formatEffort(task.workEffort, projectEffortUnitByProjectId.get(task.projectId) ?? 'day');
                  const rowH = effectiveRowHeights[index] ?? ROW_HEIGHT;

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        'relative group box-border border-b border-slate-100/80 transition-colors',
                        isSelected &&
                          'bg-purple-50/90 font-semibold text-purple-900 ring-2 ring-inset ring-purple-500/80 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.12)]',
                        isActive && 'bg-amber-50/80 font-medium text-amber-900 ring-2 ring-inset ring-amber-500/70',
                        !isSelected && !isActive && 'hover:bg-[var(--color-line-soft)]',
                      )}
                      style={{ width: totalWidth, height: rowH }}
                      onContextMenu={(e) => handleContextMenu(e, task.id)}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        handleBarMouseDown(e, task);
                      }}
                    >
                      {/* 마일스톤: 다이아몬드 / 일반 작업: 바 */}
                      <div
                        onDoubleClick={() => setEditingTask(task)}
                        onClick={(e) => handleBarClickForPopover(e, task)}
                        onMouseDown={(e) => handleBarMouseDown(e, task)}
                        className={cn(
                          'absolute top-0 overflow-hidden transition-all',
                          isDone && 'gantt-completed',
                          isMilestone
                            ? 'rounded-sm border-2 border-amber-600 bg-amber-500 rotate-45 cursor-grab hover:brightness-110 shadow-sm'
                            : 'rounded shadow-sm border',
                          !isMilestone && isCritical && 'ring-2 ring-red-500 border-red-600',
                          isBeingDragged
                            ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50'
                            : !isMilestone && 'cursor-grab hover:brightness-110',
                        )}
                        style={
                          isMilestone
                            ? { left: left + dayWidth / 2 - 8, top: rowH / 2 - 8, width: 16, height: 16 }
                            : {
                                left,
                                width: Math.max(width - 4, 4),
                                height: rowH,
                                backgroundColor: levelGanttBarFill(level),
                                borderColor: isCritical ? '#dc2626' : levelBarBg(level),
                              }
                        }
                        title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''}${isMilestone ? ` (마일스톤) · ${effectiveStartDate}` : ` · ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}`}`}
                      >
                        {!isMilestone && (
                          <>
                            <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                            {width >= 40 && (
                              <span
                                className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium truncate pr-8 pointer-events-none text-slate-800"
                                style={{ width: 'calc(100% - 12px)' }}
                              >
                                {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                                {task.name}
                              </span>
                            )}
                            <div
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                              onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                              onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')}
                            />
                          </>
                        )}
                      </div>

                      {/* Floating date tooltip during drag */}
                      {isBeingDragged && (
                        <div
                          className="absolute -top-7 bg-stone-800 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none"
                          style={{ left: Math.max(0, left) }}
                        >
                          {effectiveStartDate} ~ {effectiveEndDate}
                        </div>
                      )}

                      {(width < 80 || isMilestone) && !isBeingDragged && (
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 break-words max-w-[200px] pointer-events-none"
                          style={{ left: (isMilestone ? left + dayWidth / 2 - 8 + 16 : left + width) + 8 }}
                        >
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                          {task.name}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {tappedBarPopoverEl}

      <TaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSave}
        initialData={editingTask || undefined}
        parentOptions={tasks}
        onOpenTask={(task) => setEditingTask(task)}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={[
            {
              label: '수정',
              icon: <Edit2 size={14} />,
              onClick: () => {
                const task = tasks.find((t) => t.id === contextMenu.taskId);
                if (task) setEditingTask(task);
              },
            },
            ...(canEditCurrentProject
              ? [
                  {
                    label: '삭제',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: () => {
                      setDeleteConfirm({ taskId: contextMenu.taskId });
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) deleteTask(deleteConfirm.taskId);
        }}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        isDanger
      />
    </>
  );
}
