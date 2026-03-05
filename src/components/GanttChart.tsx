import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { addDays, differenceInDays, format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, min, max, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, eachWeekOfInterval, getWeek } from 'date-fns';
import { TaskModal } from './TaskModal';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
}

type ViewMode = 'day' | 'week' | 'month';
type DragType = 'move' | 'resize-left' | 'resize-right';

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

export function GanttChart({ filters, sortConfig, hideSidebar = false }: GanttChartProps) {
  const { tasks, updateTask, deleteTask, wbsMap } = useWBS();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);

  // Zoom level index, -1 means auto-fit
  const [zoomIndex, setZoomIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ taskId: string; startDate: string; endDate: string } | null>(null);

  const visibleTasks = useMemo(() => {
    const hasFilters = filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;

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

    if (hasFilters) {
      return tasks.filter(task => {
        if (filters.status !== 'all' && task.status !== filters.status) return false;
        if (filters.assignee && task.assignee !== filters.assignee) return false;
        if (filters.startDate && task.startDate < filters.startDate) return false;
        if (filters.endDate && task.endDate > filters.endDate) return false;
        return true;
      }).sort(compare);
    } else {
      const buildTree = (parentId: string | null): Task[] => {
        let children = tasks.filter(t => t.parentId === parentId);
        if (sortConfig) children.sort(compare);
        let result: Task[] = [];
        for (const child of children) {
          result.push(child);
          if (child.expanded) result = result.concat(buildTree(child.id));
        }
        return result;
      };
      return buildTree(null);
    }
  }, [tasks, filters, sortConfig]);

  // Keyboard hotkeys - only when mounted
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') {
        setZoomIndex(prev => prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1));
      } else if (e.key === '-' || e.key === '_') {
        setZoomIndex(prev => prev === -1 ? 0 : Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const ROW_HEIGHT = 28;
  const VIEW_PADDING_TOP = 16;

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
          <div key={month.toISOString()} className="flex items-center px-3 text-[10px] font-bold uppercase tracking-wider text-stone-500 border-r border-stone-200 overflow-hidden" style={{ width }}>
            {format(month, width > 40 ? 'MMMM yyyy' : 'MMM yy')}
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
          <div key={year} className="flex items-center px-3 text-[10px] font-bold uppercase tracking-wider text-stone-500 border-r border-stone-200 overflow-hidden" style={{ width }}>
            {year}
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
            ['Sat', 'Sun'].includes(format(day, 'EEE')) ? 'bg-stone-50 text-stone-400' : 'text-stone-600',
            isSameDay(day, today) && 'bg-red-50 text-red-600 font-bold'
          )}
          style={{ width: dayWidth }}
        >
          {dayWidth >= 20 ? format(day, 'd') : dayWidth >= 10 ? (new Date(day).getDate() % 5 === 0 ? format(day, 'd') : '') : ''}
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
            {width >= 20 ? `W${getWeek(week)}` : ''}
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
            {width >= 16 ? format(month, 'MMM') : ''}
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
          className={cn("flex-shrink-0 border-r border-stone-100 h-full", ['Sat', 'Sun'].includes(format(day, 'EEE')) && 'bg-stone-50/30')}
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

  return (
    <>
      <div ref={containerRef} className="w-full h-full overflow-auto bg-white">
        <div className="min-w-max flex flex-col">
          {/* Header Row */}
          <div className="flex sticky top-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
            {/* Sidebar Header */}
            {!hideSidebar && (
              <div className="flex-shrink-0 border-r border-[var(--color-line)] bg-stone-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-stone-500" style={{ width: sidebarWidth, height: 60 }}>
                작업명
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
              <div className="flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 py-4 lg:block md:hidden hidden" style={{ width: sidebarWidth }}>
                {visibleTasks.map(t => {
                  const prefix = wbsMap.get(t.id) ? `${wbsMap.get(t.id)} ` : '';
                  return (
                    <div
                      key={t.id}
                      className="flex items-center px-4 text-xs font-medium text-[var(--color-ink)] truncate hover:bg-stone-50 cursor-pointer transition-colors border-b border-transparent hover:border-stone-100"
                      style={{ height: `${ROW_HEIGHT}px` }}
                      title={`${prefix}${t.name}`}
                      onDoubleClick={() => setEditingTask(t)}
                    >
                      {prefix}{t.name}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Chart Body */}
            <div className="relative py-4" style={{ width: totalWidth, height: visibleTasks.length * ROW_HEIGHT + VIEW_PADDING_TOP * 2 }}>
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

                const colors = {
                  todo: 'bg-stone-300 border-stone-400',
                  'in-progress': 'bg-blue-500 border-blue-600',
                  done: 'bg-emerald-500 border-emerald-600',
                  blocked: 'bg-red-500 border-red-600',
                };

                const barColor = colors[task.status] || colors.todo;

                return (
                  <div
                    key={task.id}
                    className="relative h-8 group hover:bg-stone-50 transition-colors"
                    style={{ width: totalWidth }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                  >
                    {/* Main bar */}
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      onMouseDown={(e) => handleBarMouseDown(e, task)}
                      className={cn(
                        "absolute top-0 h-8 rounded shadow-sm overflow-hidden transition-all border",
                        barColor,
                        isBeingDragged ? 'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50' : 'cursor-grab hover:brightness-110'
                      )}
                      style={{ left, width: Math.max(width - 4, 4) }}
                      title={`${wbsMap.get(task.id) ? wbsMap.get(task.id) + ' ' : ''}${task.name}: ${effectiveStartDate} → ${effectiveEndDate}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium truncate pr-8 drop-shadow-md pointer-events-none" style={{ width: 'calc(100% - 12px)' }}>
                          {wbsMap.get(task.id) ? `${wbsMap.get(task.id)} ` : ''}{task.name}
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
                        {wbsMap.get(task.id) ? `${wbsMap.get(task.id)} ` : ''}{task.name}
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
