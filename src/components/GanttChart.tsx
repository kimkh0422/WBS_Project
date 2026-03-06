import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { addDays, differenceInDays, format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, min, max, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, eachWeekOfInterval, getWeek } from 'date-fns';
import { ko } from 'date-fns/locale';
import { TaskModal } from './TaskModal';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
  rowHeight?: number;
  syncScrollRef?: React.RefObject<HTMLDivElement>;
  hotkeysEnabled?: boolean;
}

type ViewMode = 'day' | 'week' | 'month';
type DragType = 'move' | 'resize-left' | 'resize-right';

type TaskWithDepth = Task & { depth: number };

function getLevelStyle(level: number) {
  switch (level) {
    case 1: return { border: 'border-l-purple-500', bar: 'bg-purple-500/90 border-purple-600' };
    case 2: return { border: 'border-l-blue-500', bar: 'bg-blue-500/90 border-blue-600' };
    case 3: return { border: 'border-l-emerald-500', bar: 'bg-emerald-500/90 border-emerald-600' };
    default: return { border: 'border-l-stone-400', bar: 'bg-stone-500/90 border-stone-600' };
  }
}

interface DragState {
  taskId: string;
  type: DragType;
  startX: number;
  originalStartDate: string;
  originalEndDate: string;
  previewStartDate: string;
  previewEndDate: string;
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

export function GanttChart({ filters, sortConfig, hideSidebar = false, rowHeight: propRowHeight, syncScrollRef, hotkeysEnabled = true }: GanttChartProps) {
  const { tasks, updateTask, deleteTask, wbsMap, displayWbsMap } = useWBS();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);

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
  const dragStateRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ taskId: string; startDate: string; endDate: string } | null>(null);

  // visibleTasks 로직을 WBSTable과 동일하게 맞춰 표·간트 행 정렬이 일치하도록 함
  const visibleTasks = useMemo((): TaskWithDepth[] => {
    const hasFilters = filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const getDepth = (taskId: string): number => {
      const task = taskMap.get(taskId);
      if (!task || !task.parentId) return 0;
      return getDepth(task.parentId) + 1;
    };

    const compare = (a: Task, b: Task) => {
      if (!sortConfig) return 0;
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const comparison = valA < valB ? -1 : 1;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    };

    let baseTasks = tasks;
    if (filters.projectId !== 'all') {
      baseTasks = baseTasks.filter(t => t.projectId === filters.projectId);
    }

    if (hasFilters) {
      return baseTasks.filter(task => {
        if (filters.status !== 'all' && task.status !== filters.status) return false;
        if (filters.assignee && !task.assignee.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
        if (filters.startDate && task.startDate < filters.startDate) return false;
        if (filters.endDate && task.endDate > filters.endDate) return false;
        return true;
      }).sort(compare).map(t => ({ ...t, depth: getDepth(t.id) }));
    } else {
      const buildTree = (parentId: string | null, depth: number): TaskWithDepth[] => {
        let children = baseTasks.filter(t => t.parentId === parentId);
        if (sortConfig) children.sort(compare);
        let result: TaskWithDepth[] = [];
        for (const child of children) {
          result.push({ ...child, depth });
          if (child.expanded) result = result.concat(buildTree(child.id, depth + 1));
        }
        return result;
      };
      return buildTree(null, 0);
    }
  }, [tasks, filters, sortConfig]);

  // Keyboard hotkeys - only when mounted
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') {
        setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1));
      } else if (e.key === '-' || e.key === '_') {
        setZoomIndex(prev => prev === -1 ? 0 : Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled]);

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
    dragStateRef.current = {
      taskId: task.id,
      type: 'move',
      startX: e.clientX,
      originalStartDate: task.startDate,
      originalEndDate: task.endDate,
      previewStartDate: task.startDate,
      previewEndDate: task.endDate,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, task: Task, type: 'resize-left' | 'resize-right') => {
    e.preventDefault();
    e.stopPropagation();
    dragStateRef.current = {
      taskId: task.id,
      type,
      startX: e.clientX,
      originalStartDate: task.startDate,
      originalEndDate: task.endDate,
      previewStartDate: task.startDate,
      previewEndDate: task.endDate,
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;

      const dw = dayWidthRef.current;
      const deltaX = e.clientX - drag.startX;
      const deltaDays = Math.round(deltaX / dw);

      const origStart = parseISO(drag.originalStartDate);
      const origEnd = parseISO(drag.originalEndDate);

      let newStart = drag.previewStartDate;
      let newEnd = drag.previewEndDate;

      if (drag.type === 'move') {
        newStart = format(addDays(origStart, deltaDays), 'yyyy-MM-dd');
        newEnd = format(addDays(origEnd, deltaDays), 'yyyy-MM-dd');
      } else if (drag.type === 'resize-left') {
        const candidate = addDays(origStart, deltaDays);
        if (candidate < origEnd) {
          newStart = format(candidate, 'yyyy-MM-dd');
          newEnd = drag.originalEndDate;
        }
      } else if (drag.type === 'resize-right') {
        const candidate = addDays(origEnd, deltaDays);
        if (candidate > origStart) {
          newStart = drag.originalStartDate;
          newEnd = format(candidate, 'yyyy-MM-dd');
        }
      }

      drag.previewStartDate = newStart;
      drag.previewEndDate = newEnd;
      setDragPreview({ taskId: drag.taskId, startDate: newStart, endDate: newEnd });
    };

    const handleMouseUp = () => {
      const drag = dragStateRef.current;
      if (drag) {
        updateTask(drag.taskId, { startDate: drag.previewStartDate, endDate: drag.previewEndDate });
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
  }, [updateTask]);

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  // Early returns must come after all hooks
  if (visibleTasks.length === 0) return (
    <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
      {tasks.length === 0 ? '등록된 작업이 없습니다. 새 작업을 추가해 보세요.' : '필터와 일치하는 작업이 없습니다.'}
    </div>
  );

  const dates = visibleTasks.flatMap(t => [parseISO(t.startDate), parseISO(t.endDate)]).filter(d => !isNaN(d.getTime()));

  if (dates.length === 0) return (
    <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
      유효하지 않은 날짜가 포함되어 있습니다. 데이터를 확인해 주세요.
    </div>
  );

  const minDate = startOfWeek(addDays(min(dates), -7));
  const maxDate = endOfWeek(addDays(max(dates), 7));
  const totalDays = differenceInDays(maxDate, minDate) + 1;

  const sidebarWidth = hideSidebar ? 0 : 240;

  const ROW_HEIGHT = propRowHeight ?? 34;
  const VIEW_PADDING_TOP = 0;

  const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
  const availableWidth = containerWidth - sidebarWidth - 20;
  const autoDayWidth = Math.max(2, Math.floor(availableWidth / totalDays));

  const autoZoomLevel = ZOOM_LEVELS.reduce((prev, curr) =>
    Math.abs(curr.dayWidth - autoDayWidth) < Math.abs(prev.dayWidth - autoDayWidth) ? curr : prev
  );

  const currentZoomEntry = zoomIndex === -1 ? { ...autoZoomLevel, dayWidth: autoDayWidth } : ZOOM_LEVELS[zoomIndex];
  const dayWidth = currentZoomEntry.dayWidth;
  const viewMode: ViewMode = currentZoomEntry.mode;

  const totalWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const months = eachMonthOfInterval({ start: minDate, end: maxDate });
  const weeks = eachWeekOfInterval({ start: minDate, end: maxDate });

  // Keep dayWidthRef in sync for drag calculations
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
      return days.map((day) => (
        <div
          key={day.toISOString()}
          className={cn(
            "flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono",
            ['토', '일'].includes(format(day, 'EEE', { locale: ko })) ? 'bg-stone-50 text-stone-400' : 'text-stone-600',
            isSameDay(day, today) && 'bg-red-50 text-red-600 font-bold'
          )}
          style={{ width: dayWidth }}
        >
          {dayWidth >= 20 ? format(day, 'd', { locale: ko }) : dayWidth >= 10 ? (new Date(day).getDate() % 5 === 0 ? format(day, 'd', { locale: ko }) : '') : ''}
        </div>
      ));
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
            className={cn("flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono overflow-hidden", isCurrentWeek && 'bg-red-50 text-red-600 font-bold')}
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
            className={cn("flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono overflow-hidden", isCurrentMonth && 'bg-red-50 text-red-600 font-bold')}
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

  // Split view: 헤더는 스크롤 밖, 스크롤 영역은 행만 → 표와 scrollTop 1:1 맞춤
  if (isSplitView) {
    return (
      <>
        <div className="w-full h-full flex flex-col bg-white">
          {/* 헤더 고정 (스크롤 밖) */}
          <div className="flex flex-shrink-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
            <div className="relative" style={{ width: Math.max(totalWidth, containerWidth), height: 60 }}>
              <div className="absolute right-2 top-2 z-50 flex gap-1 bg-white/95 backdrop-blur shadow-sm border border-stone-200 rounded-lg p-1">
                <button
                  onClick={() => setZoomIndex(prev => prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="축소"
                >
                  <ZoomOut size={14} />
                </button>
                <div className="px-2 text-[10px] font-mono text-stone-500 flex items-center justify-center min-w-[3rem]">
                  {zoomIndex === -1 ? '맞춤' : ZOOM_LEVELS[zoomIndex].label}
                </div>
                <button
                  onClick={() => setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="확대"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  onClick={() => setZoomIndex(-1)}
                  className={cn("p-1 rounded transition-colors", zoomIndex === -1 ? 'text-blue-500 bg-blue-50' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-800')}
                  title="전체 맞춤"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
              <div className="flex h-7 border-b border-stone-200" style={{ width: totalWidth }}>
                {renderTopHeader()}
              </div>
              <div className="flex h-8" style={{ width: totalWidth }}>
                {renderBottomHeader()}
              </div>
            </div>
          </div>
          {/* 스크롤 영역 = 행만 (표와 동기화) */}
          <div ref={syncScrollRef} className="flex-1 min-h-0 overflow-auto bg-white">
            <div className="relative" style={{ width: totalWidth, height: visibleTasks.length * ROW_HEIGHT }}>
              <div className="absolute inset-0 z-0 flex pointer-events-none">
                {renderGridColumns()}
              </div>
              {todayIndex !== -1 && (
                <div className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50" style={{ left: todayLeft }}>
                  <div className="absolute -top-2 -translate-x-1/2 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap z-20">오늘</div>
                </div>
              )}
              <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                <defs>
                  <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                  </marker>
                </defs>
                {visibleTasks.map((task, index) => {
                  if (!task.dependencies || task.dependencies.length === 0) return null;
                  const taskStart = parseISO(task.startDate);
                  const taskOffsetDays = differenceInDays(taskStart, minDate);
                  const taskLeft = taskOffsetDays * dayWidth;
                  const taskTop = VIEW_PADDING_TOP + index * ROW_HEIGHT + (ROW_HEIGHT / 2);
                  return task.dependencies.map(depId => {
                    const depTask = visibleTasks.find(t => t.id === depId);
                    const depIndex = visibleTasks.findIndex(t => t.id === depId);
                    if (!depTask || depIndex === -1) return null;
                    const depEnd = parseISO(depTask.endDate);
                    const depOffsetDays = differenceInDays(depEnd, minDate) + 1;
                    const depRight = depOffsetDays * dayWidth;
                    const depTop = VIEW_PADDING_TOP + depIndex * ROW_HEIGHT + (ROW_HEIGHT / 2);
                    const path = `M ${depRight} ${depTop} L ${depRight + 10} ${depTop} L ${depRight + 10} ${taskTop} L ${taskLeft} ${taskTop}`;
                    return (
                      <path key={`${depId}-${task.id}`} d={path} fill="none" stroke="#a8a29e" strokeWidth="1.5" markerEnd="url(#arrowhead)" opacity="0.6" />
                    );
                  });
                })}
              </svg>
              {visibleTasks.map((task, index) => {
                const isBeingDragged = dragPreview?.taskId === task.id;
                const effectiveStartDate = isBeingDragged ? dragPreview!.startDate : task.startDate;
                const effectiveEndDate = isBeingDragged ? dragPreview!.endDate : task.endDate;
                const start = parseISO(effectiveStartDate);
                const end = parseISO(effectiveEndDate);
                const offsetDays = differenceInDays(start, minDate);
                const durationDays = differenceInDays(end, start) + 1;
                const left = offsetDays * dayWidth;
                const width = Math.max(durationDays * dayWidth, dayWidth);
                const depth = task.depth ?? 0;
                const lvStyle = getLevelStyle(depth + 1);
                const statusColors = { todo: 'bg-stone-300 border-stone-400', 'in-progress': 'bg-blue-500 border-blue-600', done: 'bg-emerald-500 border-emerald-600', blocked: 'bg-red-500 border-red-600' };
                const barColor = statusColors[task.status] || statusColors.todo;
                const effortText = formatEffort(task.workEffort);
                return (
                  <div key={task.id} className="relative group hover:bg-stone-50 transition-colors" style={{ width: totalWidth, height: ROW_HEIGHT }} onContextMenu={(e) => handleContextMenu(e, task.id)}>
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn("absolute top-0 rounded shadow-sm overflow-hidden transition-all border", lvStyle.bar, isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : 'cursor-grab hover:brightness-110')}
                      style={{ left, width: Math.max(width - 4, 4), height: ROW_HEIGHT }}
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}: ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium truncate pr-8 drop-shadow-md pointer-events-none" style={{ width: 'calc(100% - 12px)' }}>
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}{width >= 140 && effortText ? ` · ${effortText}` : ''}
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
                      <span className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 whitespace-nowrap pointer-events-none" style={{ left: left + width + 8 }}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <TaskModal isOpen={!!editingTask} onClose={() => setEditingTask(null)} onSave={handleSave} initialData={editingTask || undefined} parentOptions={tasks} />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              { label: '편집', onClick: () => { setEditingTask(tasks.find(t => t.id === contextMenu.taskId) || null); setContextMenu(null); } },
              { label: '삭제', onClick: () => { deleteTask(contextMenu.taskId); setContextMenu(null); }, danger: true },
            ]}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div ref={containerRef} className="w-full h-full overflow-auto bg-white">
        <div className="min-w-max flex flex-col">
          {/* Header Row */}
          <div className="flex sticky top-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
            {/* Sidebar Header */}
            {!hideSidebar && (
              <div className="flex-shrink-0 border-r border-[var(--color-line)] bg-stone-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-stone-500" style={{ width: sidebarWidth, height: 60 }}>
                <div className="flex items-end justify-between w-full gap-2">
                  <span>작업</span>
                  <span className="text-[10px] font-mono text-stone-400 normal-case">기간 · 공수</span>
                </div>
              </div>
            )}

            {/* Timeline Header */}
            <div className="relative" style={{ width: Math.max(totalWidth, containerWidth - sidebarWidth), height: 60 }}>
              {/* Zoom Controls */}
              <div className="absolute right-2 top-2 z-50 flex gap-1 bg-white/95 backdrop-blur shadow-sm border border-stone-200 rounded-lg p-1">
                <button
                  onClick={() => setZoomIndex(prev => prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="축소"
                >
                  <ZoomOut size={14} />
                </button>
                <div className="px-2 text-[10px] font-mono text-stone-500 flex items-center justify-center min-w-[3rem]">
                  {zoomIndex === -1 ? '맞춤' : ZOOM_LEVELS[zoomIndex].label}
                </div>
                <button
                  onClick={() => setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="확대"
                >
                  <ZoomIn size={14} />
                </button>
                <button
                  onClick={() => setZoomIndex(-1)}
                  className={cn("p-1 rounded transition-colors", zoomIndex === -1 ? 'text-blue-500 bg-blue-50' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-800')}
                  title="전체 맞춤"
                >
                  <Maximize2 size={14} />
                </button>
              </div>

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
              <div className="flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 lg:block md:hidden hidden" style={{ width: sidebarWidth }}>
                {visibleTasks.map(t => {
                  const prefix = displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ` : '';
                  const depth = t.depth ?? 0;
                  const lvStyle = getLevelStyle(depth + 1);
                  const effortText = formatEffort(t.workEffort);
                  return (
                    <div
                      key={t.id}
                      className={cn("flex items-center text-xs font-medium text-[var(--color-ink)] hover:bg-stone-50 cursor-pointer transition-colors border-b border-l-4 border-transparent hover:border-stone-100", lvStyle.border)}
                      style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${depth * 16 + 16}px`, paddingRight: 16 }}
                      title={`${prefix}${t.name} (${depth + 1}레벨) · ${t.startDate}~${t.endDate}${effortText ? ` · ${effortText}` : ''}`}
                      onDoubleClick={() => setEditingTask(t)}
                    >
                      <div className="flex items-center justify-between gap-2 w-full min-w-0">
                        <div className="truncate min-w-0">{prefix}{t.name}</div>
                        <div className="text-[10px] font-mono text-stone-400 whitespace-nowrap shrink-0">
                          {formatRange(t.startDate, t.endDate)}{effortText ? ` · ${effortText}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Chart Body */}
            <div className="relative" style={{ width: totalWidth, height: visibleTasks.length * ROW_HEIGHT }}>
              {/* Grid Background */}
              <div className="absolute inset-0 z-0 flex pointer-events-none">
                {renderGridColumns()}
              </div>

              {/* Today Line */}
              {todayIndex !== -1 && (
                <div className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50" style={{ left: todayLeft }}>
                  <div className="absolute -top-2 -translate-x-1/2 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap z-20">
                    오늘
                  </div>
                </div>
              )}

              {/* Dependency Lines SVG Layer */}
              <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                <defs>
                  <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                  </marker>
                </defs>
                {visibleTasks.map((task, index) => {
                  if (!task.dependencies || task.dependencies.length === 0) return null;
                  const taskStart = parseISO(task.startDate);
                  const taskOffsetDays = differenceInDays(taskStart, minDate);
                  const taskLeft = taskOffsetDays * dayWidth;
                  const taskTop = VIEW_PADDING_TOP + index * ROW_HEIGHT + (ROW_HEIGHT / 2);

                  return task.dependencies.map(depId => {
                    const depTask = visibleTasks.find(t => t.id === depId);
                    const depIndex = visibleTasks.findIndex(t => t.id === depId);
                    if (!depTask || depIndex === -1) return null;
                    const depEnd = parseISO(depTask.endDate);
                    const depOffsetDays = differenceInDays(depEnd, minDate) + 1;
                    const depRight = depOffsetDays * dayWidth;
                    const depTop = VIEW_PADDING_TOP + depIndex * ROW_HEIGHT + (ROW_HEIGHT / 2);
                    const path = `M ${depRight} ${depTop} L ${depRight + 10} ${depTop} L ${depRight + 10} ${taskTop} L ${taskLeft} ${taskTop}`;
                    return (
                      <path key={`${depId}-${task.id}`} d={path} fill="none" stroke="#a8a29e" strokeWidth="1.5" markerEnd="url(#arrowhead)" opacity="0.6" />
                    );
                  });
                })}
              </svg>

              {/* Task Bars */}
              {visibleTasks.map((task, index) => {
                // Use preview dates during drag
                const isBeingDragged = dragPreview?.taskId === task.id;
                const effectiveStartDate = isBeingDragged ? dragPreview!.startDate : task.startDate;
                const effectiveEndDate = isBeingDragged ? dragPreview!.endDate : task.endDate;

                const start = parseISO(effectiveStartDate);
                const end = parseISO(effectiveEndDate);
                const offsetDays = differenceInDays(start, minDate);
                const durationDays = differenceInDays(end, start) + 1;

                const left = offsetDays * dayWidth;
                const width = Math.max(durationDays * dayWidth, dayWidth);

                const depth = task.depth ?? 0;
                const lvStyle = getLevelStyle(depth + 1);
                const effortText = formatEffort(task.workEffort);

                return (
                  <div
                    key={task.id}
                    className="relative group hover:bg-stone-50 transition-colors"
                    style={{ width: totalWidth, height: ROW_HEIGHT }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                  >
                    {/* Main bar - 레벨별 색상으로 구분 */}
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn(
                        "absolute top-0 rounded shadow-sm overflow-hidden transition-all border",
                        lvStyle.bar,
                        isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : 'cursor-grab hover:brightness-110'
                      )}
                      style={{ left, width: Math.max(width - 4, 4), height: ROW_HEIGHT }}
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}: ${effectiveStartDate} → ${effectiveEndDate}${effortText ? ` · ${effortText}` : ''}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium truncate pr-8 drop-shadow-md pointer-events-none" style={{ width: 'calc(100% - 12px)' }}>
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}{width >= 140 && effortText ? ` · ${effortText}` : ''}
                        </span>
                      )}

                      {/* Left resize handle */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')}
                      />
                      {/* Right resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')}
                      />
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

                    {width < 80 && !isBeingDragged && (
                      <span className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 whitespace-nowrap pointer-events-none" style={{ left: left + width + 8 }}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </span>
                    )}
                  </div>
                );
              })}
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
