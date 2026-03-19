import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { addDays, differenceInDays, format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, min, max, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, eachWeekOfInterval, getWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { TaskModal } from './TaskModal';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildVisibleTasks, TaskWithDepth } from '../lib/taskView';
import { useLevelColors } from '../context/LevelColorsContext';
import { getCriticalPathTaskIds } from '../lib/schedule';

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
  rowHeight?: number;
  /** 표에서 측정한 행별 높이 (줄바꿈 켜짐 시 표·간트 동기화) */
  rowHeights?: number[];
  onRowHeightChange?: (height: number) => void;
  syncScrollRef?: React.RefObject<HTMLDivElement>;
  hotkeysEnabled?: boolean;
}

type ViewMode = 'day' | 'week' | 'month';
type DragType = 'move' | 'resize-left' | 'resize-right';

interface TaskDragInfo {
  taskId: string;
  originalStartDate: string;
  originalEndDate: string;
  previewStartDate: string;
  previewEndDate: string;
}

interface DragState {
  /** 단일 작업 리사이즈 시 taskId; 다중 이동 시 tasks[0].taskId가 기준 */
  taskId: string;
  type: DragType;
  startX: number;
  startY: number;
  /** 클릭(드래그 없음) 시 선택용 */
  clickTaskId: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** 다중 이동 시 모든 작업 정보; 단일 시 tasks.length === 1 */
  tasks: TaskDragInfo[];
}

// Zoom levels with corresponding view mode and per-day width
const ZOOM_LEVELS: { mode: ViewMode; dayWidth: number; label: string }[] = [
  { mode: 'month', dayWidth: 2, label: '년간' },
  { mode: 'month', dayWidth: 4, label: '반기' },
  { mode: 'month', dayWidth: 8, label: '분기' },
  { mode: 'week', dayWidth: 14, label: '월간' },
  { mode: 'week', dayWidth: 20, label: '주간' },
  { mode: 'day', dayWidth: 30, label: '2주' },
  { mode: 'day', dayWidth: 40, label: '일간' },
  { mode: 'day', dayWidth: 60, label: '확대' },
  { mode: 'day', dayWidth: 90, label: '상세' },
];

export function GanttChart({ filters, sortConfig, hideSidebar = false, rowHeight: propRowHeight, rowHeights: propRowHeights, onRowHeightChange, syncScrollRef, hotkeysEnabled = true }: GanttChartProps) {
  const { tasks, updateTask, deleteTask, wbsMap, displayWbsMap, selectedTaskIds, setSelectedTaskIds, wbsSettings } = useWBS();
  const { levelBarBg, levelBorderColor } = useLevelColors();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const selectedSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);

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

  const handleSidebarResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // 완료 처리 규칙:
  // - leaf(최하위) 작업: status === 'done' 이면 완료
  // - 상위 작업: 하위 leaf 작업들이 모두 완료면 완료로 간주(흑백 처리)
  const allLeafDoneById = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t] as const));
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
        result = children.every(childId => dfs(childId));
      }

      visiting.delete(id);
      memo.set(id, result);
      return result;
    };

    for (const t of tasks) dfs(t.id);
    return memo;
  }, [tasks]);

  const formatMd = (iso: string) => {
    try {
      return format(parseISO(iso), 'M/d', { locale: ko });
    } catch {
      return iso;
    }
  };

  const formatRange = (startIso: string, endIso: string) => `${formatMd(startIso)}~${formatMd(endIso)}`;

  const formatEffort = (effort: unknown) => {
    const n = typeof effort === 'number' && Number.isFinite(effort) ? effort : undefined;
    if (n === undefined) return '';
    return `${n}D`;
  };

  // Zoom level index, -1 means auto-fit
  const [zoomIndex, setZoomIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const anchorTaskIdRef = useRef<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Map<string, { startDate: string; endDate: string }> | null>(null);

  // visibleTasks 로직을 WBSTable과 동일하게 맞춰 표·간트 행 정렬이 일치하도록 함
  const visibleTasks = useMemo(
    () => buildVisibleTasks(tasks, filters, sortConfig, { preserveDepthOnFiltered: true }),
    [tasks, filters, sortConfig]
  );

  const selectionRef = useRef({ selectedTaskIds, visibleTasks, setSelectedTaskIds, updateTask });
  selectionRef.current = { selectedTaskIds, visibleTasks, setSelectedTaskIds, updateTask };

  const visibleTaskById = useMemo(
    () => new Map(visibleTasks.map(task => [task.id, task] as const)),
    [visibleTasks]
  );

  const visibleTaskIndexById = useMemo(
    () => new Map(visibleTasks.map((task, index) => [task.id, index] as const)),
    [visibleTasks]
  );

  const criticalPathSet = useMemo(() => getCriticalPathTaskIds(tasks), [tasks]);
  const showCriticalPath = wbsSettings?.showCriticalPath === true;
  const effectiveCriticalPathSet = showCriticalPath ? criticalPathSet : EMPTY_CRITICAL_PATH_SET;

  // Keyboard hotkeys - only when mounted
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return;
      const currentRowHeight = propRowHeight ?? 20;
      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통)
      if (onRowHeightChange && (e.ctrlKey || e.metaKey)) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          onRowHeightChange(Math.min(64, currentRowHeight + 2));
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          onRowHeightChange(Math.max(15, currentRowHeight - 2));
          return;
        }
      }
      // Zoom: + / - (수정키 없을 때만; Ctrl+/-는 줄높이용)
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1));
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setZoomIndex(prev => prev === -1 ? 0 : Math.max(0, prev - 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, propRowHeight, onRowHeightChange]);

  const handleSave = (updates: any) => {
    if (editingTask) {
      if (editingTask.id !== '') updateTask(editingTask.id, updates);
      setEditingTask(null);
    }
  };

  // Drag to move and resize
  const dayWidthRef = useRef(40);
  const minDateRef = useRef<Date>(new Date());

  const handleBarMouseDown = useCallback((e: React.MouseEvent, task: Task) => {
    e.preventDefault();
    e.stopPropagation();
    // 다중 선택된 작업 중 하나를 드래그하면 전체 선택 항목 이동
    const baseIds =
      selectedSet.has(task.id) && selectedSet.size > 1
        ? Array.from(selectedSet).filter(id => visibleTaskById.has(id))
        : [task.id];
    // 부모 작업 드래그 시 모든 자손도 함께 이동 (자손 포함 안 하면 DB 동기화 시 롤업으로 날짜 복원됨)
    const expandWithDescendants = (rootIds: string[]): string[] => {
      const result = new Set(rootIds);
      const stack = [...rootIds];
      while (stack.length > 0) {
        const pid = stack.pop()!;
        for (const t of tasks) {
          if (t.parentId === pid && !result.has(t.id)) {
            result.add(t.id);
            stack.push(t.id);
          }
        }
      }
      return Array.from(result);
    };
    const idsToMove = expandWithDescendants(baseIds);
    const taskInfos: TaskDragInfo[] = idsToMove.map(id => {
      const t = visibleTaskById.get(id) ?? tasks.find(x => x.id === id);
      if (!t) return null;
      return {
        taskId: t.id,
        originalStartDate: t.startDate,
        originalEndDate: t.endDate,
        previewStartDate: t.startDate,
        previewEndDate: t.endDate,
      };
    }).filter((x): x is TaskDragInfo => x !== null);
    if (taskInfos.length === 0) return;
    dragStateRef.current = {
      taskId: task.id,
      type: 'move',
      startX: e.clientX,
      startY: e.clientY,
      clickTaskId: task.id,
      ctrlKey: e.ctrlKey || e.metaKey,
      shiftKey: e.shiftKey,
      tasks: taskInfos,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [selectedSet, visibleTaskById, tasks]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, task: Task, type: 'resize-left' | 'resize-right') => {
    e.preventDefault();
    e.stopPropagation();
    // 부모 리사이즈 시 자손도 함께 클램프하기 위해 자손 포함
    const getDescendants = (parentId: string): Task[] => {
      const result: Task[] = [];
      const stack = [parentId];
      while (stack.length > 0) {
        const pid = stack.pop()!;
        for (const t of tasks) {
          if (t.parentId === pid) { result.push(t); stack.push(t.id); }
        }
      }
      return result;
    };
    const descendants = getDescendants(task.id);
    dragStateRef.current = {
      taskId: task.id,
      type,
      startX: e.clientX,
      startY: e.clientY,
      clickTaskId: task.id,
      ctrlKey: false,
      shiftKey: false,
      tasks: [
        { taskId: task.id, originalStartDate: task.startDate, originalEndDate: task.endDate, previewStartDate: task.startDate, previewEndDate: task.endDate },
        ...descendants.map(d => ({ taskId: d.id, originalStartDate: d.startDate, originalEndDate: d.endDate, previewStartDate: d.startDate, previewEndDate: d.endDate })),
      ],
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, [tasks]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const resize = sidebarResizeRef.current;
      if (resize) {
        const next = resize.startWidth + (e.clientX - resize.startX);
        setSidebarWidth(Math.min(520, Math.max(180, Math.round(next))));
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) return;

      const dw = dayWidthRef.current;
      const deltaX = e.clientX - drag.startX;
      const deltaDays = Math.round(deltaX / dw);

      const nextPreview = new Map<string, { startDate: string; endDate: string }>();

      if (drag.type === 'move') {
        for (const t of drag.tasks) {
          const origStart = parseISO(t.originalStartDate);
          const origEnd = parseISO(t.originalEndDate);
          const newStart = format(addDays(origStart, deltaDays), 'yyyy-MM-dd');
          const newEnd = format(addDays(origEnd, deltaDays), 'yyyy-MM-dd');
          t.previewStartDate = newStart;
          t.previewEndDate = newEnd;
          nextPreview.set(t.taskId, { startDate: newStart, endDate: newEnd });
        }
      } else {
        // resize-left / resize-right: 첫 번째 항목이 리사이즈 대상(부모), 나머지는 자손
        const primary = drag.tasks[0];
        if (primary) {
          const origStart = parseISO(primary.originalStartDate);
          const origEnd = parseISO(primary.originalEndDate);
          let newStart = primary.originalStartDate;
          let newEnd = primary.originalEndDate;

          if (drag.type === 'resize-left') {
            const candidate = addDays(origStart, deltaDays);
            if (candidate < origEnd) newStart = format(candidate, 'yyyy-MM-dd');
          } else {
            const candidate = addDays(origEnd, deltaDays);
            if (candidate > origStart) newEnd = format(candidate, 'yyyy-MM-dd');
          }

          primary.previewStartDate = newStart;
          primary.previewEndDate = newEnd;
          nextPreview.set(primary.taskId, { startDate: newStart, endDate: newEnd });

          // 자손: 부모의 새 날짜 범위 밖으로 벗어난 부분만 클램프
          for (let i = 1; i < drag.tasks.length; i++) {
            const t = drag.tasks[i]!;
            let dStart = t.originalStartDate;
            let dEnd = t.originalEndDate;
            if (drag.type === 'resize-right') {
              if (dEnd > newEnd) dEnd = newEnd;
              if (dStart > newEnd) dStart = newEnd;
            } else {
              if (dStart < newStart) dStart = newStart;
              if (dEnd < newStart) dEnd = newStart;
            }
            t.previewStartDate = dStart;
            t.previewEndDate = dEnd;
            nextPreview.set(t.taskId, { startDate: dStart, endDate: dEnd });
          }
        }
      }

      setDragPreview(nextPreview);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (sidebarResizeRef.current) {
        sidebarResizeRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      const drag = dragStateRef.current;
      if (drag) {
        const moved = Math.abs(e.clientX - drag.startX) > 10 || Math.abs(e.clientY - drag.startY) > 10;
        if (moved) {
          const { updateTask: upd } = selectionRef.current;
          for (const t of drag.tasks) {
            const startChanged = t.previewStartDate !== t.originalStartDate || t.previewEndDate !== t.originalEndDate;
            if (startChanged) {
              upd(t.taskId, { startDate: t.previewStartDate, endDate: t.previewEndDate }, { skipCascade: true });
            }
          }
        } else if (drag.type === 'move') {
          // 클릭(드래그 없음): 선택 처리
          const { selectedTaskIds: sel, visibleTasks: vis, setSelectedTaskIds: setSel } = selectionRef.current;
          const taskId = drag.clickTaskId;
          const multi = drag.ctrlKey;
          const range = drag.shiftKey;
          const current = new Set(sel);
          let next: string[];
          if (range && anchorTaskIdRef.current) {
            const idx = vis.findIndex(t => t.id === taskId);
            const anchorIdx = vis.findIndex(t => t.id === anchorTaskIdRef.current);
            if (idx !== -1 && anchorIdx !== -1) {
              const start = Math.min(idx, anchorIdx);
              const end = Math.max(idx, anchorIdx);
              next = vis.slice(start, end + 1).map(t => t.id);
            } else {
              next = [...current, taskId];
            }
          } else if (multi) {
            const nextSet = new Set(current);
            if (nextSet.has(taskId)) nextSet.delete(taskId);
            else nextSet.add(taskId);
            next = Array.from(nextSet);
          } else {
            next = [taskId];
            anchorTaskIdRef.current = taskId;
          }
          setSel(next);
        }
        dragStateRef.current = null;
        setDragPreview(null);
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  const ROW_HEIGHT = propRowHeight ?? 20;
  const VIEW_PADDING_TOP = 0;

  // 표·간트 동기화: 표의 .data-row는 border-box이므로 height가 테두리 포함 총 높이. 간트도 동일한 줄간격으로 일직선 정렬.
  const effectiveRowHeights = useMemo(() => {
    if (propRowHeights && propRowHeights.length === visibleTasks.length) return propRowHeights;
    return visibleTasks.map(() => ROW_HEIGHT);
  }, [propRowHeights, visibleTasks.length, ROW_HEIGHT]);

  const totalHeight = useMemo(() => effectiveRowHeights.reduce((a, b) => a + b, 0), [effectiveRowHeights]);

  const dates = useMemo(
    () => visibleTasks.flatMap(t => [parseISO(t.startDate), parseISO(t.endDate)]).filter(d => !isNaN(d.getTime())),
    [visibleTasks]
  );
  const minDate = useMemo(
    () => (dates.length > 0 ? startOfWeek(addDays(min(dates), -7)) : startOfWeek(new Date())),
    [dates]
  );
  const maxDate = useMemo(
    () => (dates.length > 0 ? endOfWeek(addDays(max(dates), 7)) : endOfWeek(addDays(new Date(), 14))),
    [dates]
  );
  const totalDays = differenceInDays(maxDate, minDate) + 1;
  const effectiveSidebarWidth = hideSidebar ? 0 : sidebarWidth;
  const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
  const availableWidth = containerWidth - effectiveSidebarWidth - 20;
  const autoDayWidth = Math.max(2, totalDays > 0 ? Math.floor(availableWidth / totalDays) : 40);
  const autoZoomLevel = ZOOM_LEVELS.reduce((prev, curr) =>
    Math.abs(curr.dayWidth - autoDayWidth) < Math.abs(prev.dayWidth - autoDayWidth) ? curr : prev
  );
  const currentZoomEntry = zoomIndex === -1 ? { ...autoZoomLevel, dayWidth: autoDayWidth } : ZOOM_LEVELS[zoomIndex];
  const dayWidth = currentZoomEntry.dayWidth;

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

      return task.dependencies.flatMap(depId => {
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
  }, [effectiveRowHeights, VIEW_PADDING_TOP, dayWidth, minDate, visibleTaskById, visibleTaskIndexById, visibleTasks, dates.length, effectiveCriticalPathSet]);

  if (visibleTasks.length === 0) return (
    <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
      {tasks.length === 0 ? '등록된 작업이 없습니다. 새 작업을 추가해 보세요.' : '필터와 일치하는 작업이 없습니다.'}
    </div>
  );

  if (dates.length === 0) return (
    <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
      유효하지 않은 날짜가 포함되어 있습니다. 데이터를 확인해 주세요.
    </div>
  );

  const viewMode: ViewMode = currentZoomEntry.mode;
  const totalWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const months = eachMonthOfInterval({ start: minDate, end: maxDate });
  const weeks = eachWeekOfInterval({ start: minDate, end: maxDate });

  dayWidthRef.current = dayWidth;
  minDateRef.current = minDate;

  const today = new Date();
  const todayIndex = days.findIndex(day => isSameDay(day, today));
  const todayLeft = todayIndex !== -1 ? todayIndex * dayWidth + (dayWidth / 2) : 0;

  // Render top header row (Year/Month container)
  const renderTopHeader = () => {
    if (viewMode === 'day' || viewMode === 'week') {
      return months.map((month) => {
        const monthStart = max([startOfMonth(month), minDate]);
        const monthEnd = min([endOfMonth(month), maxDate]);
        const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
        const width = daysInMonth * dayWidth;
        return (
          <div key={month.toISOString()} className="flex items-center px-3 text-[10px] font-bold tracking-wider text-stone-500 border-r border-stone-200 overflow-hidden" style={{ width }}>
            {format(month, width > 40 ? 'yyyy년 M월' : 'yy년 M월', { locale: ko })}
          </div>
        );
      });
    } else {
      // Month view: show years
      const years = Array.from(new Set(months.map(m => m.getFullYear())));
      return years.map(year => {
        const yearMonths = months.filter(m => m.getFullYear() === year);
        const firstMonth = yearMonths[0];
        const lastMonth = yearMonths[yearMonths.length - 1];
        const yearStart = max([new Date(year, 0, 1), minDate]);
        const yearEnd = min([new Date(year, 11, 31), maxDate]);
        const daysInYear = differenceInDays(yearEnd, yearStart) + 1;
        const width = daysInYear * dayWidth;
        return (
          <div key={year} className="flex items-center px-3 text-[10px] font-bold tracking-wider text-stone-500 border-r border-stone-200 overflow-hidden" style={{ width }}>
            {year}년
          </div>
        );
      });
    }
  };

  // Render bottom header row (Days/Weeks/Months)
  const renderBottomHeader = () => {
    if (viewMode === 'day') {
      return days.map((day) => {
        const isToday = isSameDay(day, today);
        return (
          <div
            key={day.toISOString()}
            className={cn(
              "flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono",
              ['토', '일'].includes(format(day, 'EEE', { locale: ko })) ? 'bg-stone-50 text-stone-400' : 'text-stone-600',
              isToday && 'bg-red-500 text-white font-bold'
            )}
            style={{ width: dayWidth }}
          >
            {dayWidth >= 20 ? format(day, 'd', { locale: ko }) : dayWidth >= 10 ? (new Date(day).getDate() % 5 === 0 ? format(day, 'd', { locale: ko }) : '') : ''}
          </div>
        );
      });
    } else if (viewMode === 'week') {
      return weeks.map((week) => {
        const weekStart = max([week, minDate]);
        const weekEnd = min([endOfWeek(week), maxDate]);
        const daysInWeek = differenceInDays(weekEnd, weekStart) + 1;
        const width = daysInWeek * dayWidth;
        const isCurrentWeek = isSameDay(startOfWeek(today), week);
        return (
          <div
            key={week.toISOString()}
            className={cn("flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono overflow-hidden", isCurrentWeek ? 'bg-red-500 text-white font-bold' : '')}
            style={{ width }}
          >
            {width >= 20 ? `${getWeek(week)}주` : ''}
          </div>
        );
      });
    } else {
      // Month mode: show months
      return months.map((month) => {
        const monthStart = max([startOfMonth(month), minDate]);
        const monthEnd = min([endOfMonth(month), maxDate]);
        const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
        const width = daysInMonth * dayWidth;
        const isCurrentMonth = format(today, 'yyyy-MM') === format(month, 'yyyy-MM');
        return (
          <div
            key={month.toISOString()}
            className={cn("flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono overflow-hidden", isCurrentMonth ? 'bg-red-500 text-white font-bold' : '')}
            style={{ width }}
          >
            {width >= 16 ? format(month, 'M월', { locale: ko }) : ''}
          </div>
        );
      });
    }
  };

  // Render grid columns
  const renderGridColumns = () => {
    if (viewMode === 'day') {
      return days.map((day) => (
        <div
          key={`grid-${day.toISOString()}`}
          className={cn("flex-shrink-0 border-r border-stone-100 h-full", ['토', '일'].includes(format(day, 'EEE', { locale: ko })) && 'bg-stone-50/30')}
          style={{ width: dayWidth }}
        />
      ));
    } else if (viewMode === 'week') {
      return weeks.map((week) => {
        const weekStart = max([week, minDate]);
        const weekEnd = min([endOfWeek(week), maxDate]);
        const daysInWeek = differenceInDays(weekEnd, weekStart) + 1;
        const width = daysInWeek * dayWidth;
        return (
          <div key={`grid-week-${week.toISOString()}`} className="flex-shrink-0 border-r border-stone-100 h-full" style={{ width }} />
        );
      });
    } else {
      return months.map((month) => {
        const monthStart = max([startOfMonth(month), minDate]);
        const monthEnd = min([endOfMonth(month), maxDate]);
        const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
        const width = daysInMonth * dayWidth;
        return (
          <div key={`grid-month-${month.toISOString()}`} className="flex-shrink-0 border-r border-stone-100 h-full" style={{ width }} />
        );
      });
    }
  };

  const isSplitView = !!syncScrollRef;

  // Split view: 날짜 헤더 ↔ 본문 ↔ 하단 스크롤바 수평 동기화
  useEffect(() => {
    if (!isSplitView) return;
    const mainEl = syncScrollRef?.current;
    if (!mainEl) return;
    let fromMain = false;
    let fromBottom = false;
    const onMainScroll = () => {
      if (fromBottom) return;
      fromMain = true;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = mainEl.scrollLeft;
      if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = mainEl.scrollLeft;
      fromMain = false;
    };
    mainEl.addEventListener('scroll', onMainScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', onMainScroll);
  }, [isSplitView, syncScrollRef]);

  useEffect(() => {
    if (!isSplitView) return;
    const bottomEl = bottomScrollRef.current;
    const mainEl = syncScrollRef?.current;
    if (!bottomEl || !mainEl) return;
    const onBottomScroll = () => {
      mainEl.scrollLeft = bottomEl.scrollLeft;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = bottomEl.scrollLeft;
    };
    bottomEl.addEventListener('scroll', onBottomScroll, { passive: true });
    return () => bottomEl.removeEventListener('scroll', onBottomScroll);
  }, [isSplitView, syncScrollRef]);

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
                onClick={() => setZoomIndex(prev => prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1))}
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
                value={zoomIndex === -1 ? Math.max(0, ZOOM_LEVELS.findIndex(z => z.dayWidth === autoZoomLevel.dayWidth)) : zoomIndex}
                onChange={(e) => setZoomIndex(Number(e.target.value))}
                className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[100px] shrink"
                title="간트 확대/축소"
              />
              <button
                onClick={() => setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1))}
                className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
                title="확대"
              >
                <ZoomIn size={12} />
              </button>
              <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
              <button
                onClick={() => setZoomIndex(-1)}
                className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0", zoomIndex === -1 ? 'text-blue-600 bg-blue-50 font-medium' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700')}
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
                  <span className="text-[10px] font-bold text-slate-600 w-7 text-right shrink-0">
                    {propRowHeight ?? 20}
                  </span>
                </div>
              </>
            )}
          </div>
          {/* 헤더 고정 (스크롤 밖) - 수평 스크롤은 본문과 동기화 */}
          <div ref={headerScrollRef} className="flex-shrink-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)] overflow-x-hidden">
            <div className="relative flex-shrink-0" style={{ width: totalWidth, height: 60 }}>
              <div className="flex h-7 border-b border-stone-200" style={{ width: totalWidth }}>
                {renderTopHeader()}
              </div>
              <div className="flex h-8" style={{ width: totalWidth }}>
                {renderBottomHeader()}
              </div>
            </div>
          </div>
          {/* 스크롤 영역 = 행만 (표와 동기화). 수평 스크롤바는 하단 별도 스크롤바로 대체 */}
          <div ref={syncScrollRef} className="flex-1 min-h-0 overflow-auto bg-white gantt-body-no-hscroll" style={{ scrollbarWidth: 'none' }}>
            <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
              <div className="absolute inset-0 z-0 flex pointer-events-none">
                {renderGridColumns()}
              </div>
              {todayIndex !== -1 && (
                <div className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50" style={{ left: todayLeft }} />
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
              {visibleTasks.map((task, index) => {
                const isSelected = selectedSet.has(task.id);
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
                const effortText = formatEffort(task.workEffort);
                const rowH = effectiveRowHeights[index];
                return (
                  <div
                    key={task.id}
                    className={cn("relative group transition-colors", isSelected ? "bg-blue-50/50" : "hover:bg-stone-50")}
                    style={{ width: totalWidth, height: rowH }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                  >
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn(
                        "absolute top-0 rounded shadow-sm overflow-hidden transition-all border",
                        isDone && "gantt-completed",
                        isCritical && "ring-2 ring-red-500 border-red-600",
                        isSelected && !isBeingDragged && !isCritical ? "ring-2 ring-blue-300/80" : "",
                        isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : 'cursor-grab hover:brightness-110'
                      )}
                      style={{ left, width: Math.max(width - 4, 4), height: rowH, backgroundColor: levelBarBg(level), borderColor: isCritical ? '#dc2626' : levelBorderColor(level) }}
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''} · ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}${task.assignments?.length ? ` · 투입: ${task.assignments.map(a => `${a.assignee} ${a.allocationPercent}%`).join(', ')}` : task.assignee ? ` · ${task.assignee}` : ''}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium break-words pr-8 drop-shadow-md pointer-events-none line-clamp-2" style={{ width: 'calc(100% - 12px)' }}>
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                        </span>
                      )}
                      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20" onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')} />
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20" onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')} />
                    </div>
                    {isBeingDragged && (
                      <div className="absolute -top-7 bg-stone-800 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none" style={{ left: Math.max(0, left) }}>
                        {effectiveStartDate} ~ {effectiveEndDate}
                      </div>
                    )}
                    {width < 80 && !isBeingDragged && (
                      <span className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 break-words max-w-[200px] pointer-events-none" style={{ left: left + width + 8 }}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </span>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 pointer-events-none ring-1 ring-blue-300/70" />
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

        <TaskModal isOpen={!!editingTask} onClose={() => setEditingTask(null)} onSave={handleSave} initialData={editingTask || undefined} parentOptions={tasks} onOpenTask={(task) => setEditingTask(task)} />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            actions={[
              { label: '편집', onClick: () => { setEditingTask(tasks.find(t => t.id === contextMenu.taskId) || null); } },
              { label: '삭제', onClick: () => { deleteTask(contextMenu.taskId); }, danger: true },
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
              onClick={() => setZoomIndex(prev => prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1))}
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
              value={zoomIndex === -1 ? Math.max(0, ZOOM_LEVELS.findIndex(z => z.dayWidth === autoZoomLevel.dayWidth)) : zoomIndex}
              onChange={(e) => setZoomIndex(Number(e.target.value))}
              className="w-24 h-1.5 accent-stone-800 cursor-pointer flex-1 min-w-0 max-w-[100px] shrink"
              title="간트 확대/축소"
            />
            <button
              onClick={() => setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1))}
              className="p-0.5 rounded text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors shrink-0"
              title="확대"
            >
              <ZoomIn size={12} />
            </button>
            <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
            <button
              onClick={() => setZoomIndex(-1)}
              className={cn("text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0", zoomIndex === -1 ? 'text-blue-600 bg-blue-50 font-medium' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700')}
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
                <span className="text-[10px] font-bold text-slate-600 w-7 text-right shrink-0">
                  {propRowHeight ?? 20}
                </span>
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
              <div className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-stone-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-stone-500" style={{ width: sidebarWidth, height: 60 }}>
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
                {renderTopHeader()}
              </div>

              {/* Bottom header (days, weeks, or months) */}
              <div className="flex h-8" style={{ width: totalWidth }}>
                {renderBottomHeader()}
              </div>
            </div>
          </div>

          {/* Body Row */}
          <div className="flex relative">
            {/* Left Column (Task Names) */}
            {!hideSidebar && (
              <div className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 lg:block md:hidden hidden" style={{ width: sidebarWidth }}>
                {visibleTasks.map((t, index) => {
                  const depth = t.depth ?? 0;
                  const level = depth + 1;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center text-xs font-medium text-[var(--color-ink)] hover:bg-stone-50 cursor-pointer transition-colors border-b border-l-4 border-transparent hover:border-stone-100"
                      style={{ height: `${effectiveRowHeights[index] ?? ROW_HEIGHT}px`, paddingLeft: `${depth * 16 + 16}px`, paddingRight: 16, borderLeftColor: levelBarBg(level) }}
                      title={displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ${t.name}` : t.name}
                      onDoubleClick={() => setEditingTask(t)}
                    >
                      <div className="break-words min-w-0">{displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ` : ''}{t.name}</div>
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
                {renderGridColumns()}
              </div>

              {/* Today Line */}
              {todayIndex !== -1 && (
                <div className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50" style={{ left: todayLeft }} />
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
                const isSelected = selectedSet.has(task.id);
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
                const effortText = formatEffort(task.workEffort);
                const rowH = effectiveRowHeights[index] ?? ROW_HEIGHT;

                return (
                  <div
                    key={task.id}
                    className={cn("relative group transition-colors", isSelected ? "bg-blue-50/50" : "hover:bg-stone-50")}
                    style={{ width: totalWidth, height: rowH }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                  >
                    {/* 마일스톤: 다이아몬드 / 일반 작업: 바 */}
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn(
                        "absolute top-0 overflow-hidden transition-all",
                        isDone && "gantt-completed",
                        isMilestone
                          ? "rounded-sm border-2 border-amber-600 bg-amber-500 rotate-45 cursor-grab hover:brightness-110 shadow-sm"
                          : "rounded shadow-sm border",
                        !isMilestone && isCritical && "ring-2 ring-red-500 border-red-600",
                        isSelected && !isBeingDragged && !isCritical ? "ring-2 ring-blue-300/80" : "",
                        isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : !isMilestone && 'cursor-grab hover:brightness-110'
                      )}
                      style={
                        isMilestone
                          ? { left: left + (dayWidth / 2) - 8, top: rowH / 2 - 8, width: 16, height: 16 }
                          : { left, width: Math.max(width - 4, 4), height: rowH, backgroundColor: levelBarBg(level), borderColor: isCritical ? '#dc2626' : levelBorderColor(level) }
                      }
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''}${isMilestone ? ` (마일스톤) · ${effectiveStartDate}` : ` · ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}`}`}
                    >
                      {!isMilestone && (
                        <>
                          <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                          {width >= 40 && (
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium truncate pr-8 drop-shadow-md pointer-events-none" style={{ width: 'calc(100% - 12px)' }}>
                              {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
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
                      <span className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 break-words max-w-[200px] pointer-events-none" style={{ left: (isMilestone ? left + (dayWidth / 2) - 8 + 16 : left + width) + 8 }}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </span>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 pointer-events-none ring-1 ring-blue-300/70" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      </div>

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
                const task = tasks.find(t => t.id === contextMenu.taskId);
                if (task) setEditingTask(task);
              }
            },
            {
              label: '삭제',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => {
                if (confirm('이 작업을 삭제하시겠습니까?')) deleteTask(contextMenu.taskId);
              }
            }
          ]}
        />
      )}

    </>
  );
}
