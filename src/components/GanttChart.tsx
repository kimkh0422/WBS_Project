import React, { useState, useMemo } from 'react';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { addDays, differenceInDays, format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, min, max, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { TaskModal } from './TaskModal';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../lib/utils';

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
}

export function GanttChart({ filters, sortConfig, hideSidebar = false }: GanttChartProps) {
  const { tasks, updateTask, deleteTask, wbsMap } = useWBS();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);

  // Custom Scale State
  const [dayWidth, setDayWidth] = useState(40);

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
        if (filters.assignee && !task.assignee.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
        if (filters.startDate && task.startDate < filters.startDate) return false;
        if (filters.endDate && task.endDate > filters.endDate) return false;
        return true;
      }).sort(compare);
    } else {
      const buildTree = (parentId: string | null): Task[] => {
        let children = tasks.filter(t => t.parentId === parentId);

        if (sortConfig) {
          children.sort(compare);
        }

        let result: Task[] = [];
        for (const child of children) {
          result.push(child);
          if (child.expanded) {
            result = result.concat(buildTree(child.id));
          }
        }
        return result;
      };

      return buildTree(null);
    }
  }, [tasks, filters, sortConfig]);

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
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const months = eachMonthOfInterval({ start: minDate, end: maxDate });

  const totalWidth = totalDays * dayWidth;
  const sidebarWidth = 240;

  // Constants for Row Height to match WBSTable.tsx Min-Height which is 28px + 4px py = ~28px
  // In WBSTable: py-0.5, border-b -> line-height is 28px
  // Gantt Chart original had h-8 (32px) + py-4. We should compress Gantt Rows to exactly 28px to align.
  const ROW_HEIGHT = 28;
  const ROW_GAP = 0; // Removing gap to match table
  const VIEW_PADDING_TOP = 16;

  const handleSave = (updates: any) => {
    if (editingTask) {
      if (editingTask.id === '') {
        // Should not happen here for Gantt edit
      } else {
        updateTask(editingTask.id, updates);
      }
      setEditingTask(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  const today = new Date();
  const todayIndex = days.findIndex(day => isSameDay(day, today));
  const todayLeft = todayIndex !== -1 ? todayIndex * dayWidth + (dayWidth / 2) : 0;

  return (
    <>
      <div className="w-full h-full overflow-auto bg-white">
        <div className="min-w-max flex flex-col">
          {/* Header Row */}
          <div className="flex sticky top-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
            {/* Sidebar Header */}
            {!hideSidebar && (
              <div
                className="flex-shrink-0 border-r border-[var(--color-line)] bg-stone-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-stone-500"
                style={{ width: sidebarWidth, height: 60 }}
              >
                작업명
              </div>
            )}

            {/* Timeline Header */}
            <div className="relative" style={{ width: Math.max(totalWidth, window.innerWidth) /* Ensure header covers screen */, height: 60 }}>
              <div className="absolute right-4 top-2 z-50 flex gap-1 bg-white/90 backdrop-blur shadow-sm border border-stone-200 rounded-lg p-1">
                <button
                  onClick={() => setDayWidth(Math.max(20, dayWidth - 10))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="축소"
                >
                  <ZoomOut size={14} />
                </button>
                <div className="px-2 text-[10px] font-mono text-stone-500 flex items-center justify-center min-w-[3rem]">
                  {Math.round((dayWidth / 40) * 100)}%
                </div>
                <button
                  onClick={() => setDayWidth(Math.min(120, dayWidth + 10))}
                  className="p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 rounded transition-colors"
                  title="확대"
                >
                  <ZoomIn size={14} />
                </button>
              </div>

              <div className="flex h-7 border-b border-stone-200" style={{ width: totalWidth }}>
                {months.map((month) => {
                  const monthStart = max([startOfMonth(month), minDate]);
                  const monthEnd = min([endOfMonth(month), maxDate]);
                  const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
                  const width = daysInMonth * dayWidth;

                  return (
                    <div
                      key={month.toISOString()}
                      className="flex items-center px-3 text-[10px] font-bold uppercase tracking-wider text-stone-500 border-r border-stone-200"
                      style={{ width }}
                    >
                      {format(month, 'MMMM yyyy')}
                    </div>
                  );
                })}
              </div>

              <div className="flex h-8" style={{ width: totalWidth }}>
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "flex-shrink-0 border-r border-stone-200 flex items-center justify-center text-[10px] font-mono",
                      ['Sat', 'Sun'].includes(format(day, 'EEE')) ? 'bg-stone-50 text-stone-400' : 'text-stone-600',
                      isSameDay(day, today) && 'bg-red-50 text-red-600 font-bold'
                    )}
                    style={{ width: dayWidth }}
                  >
                    {format(day, 'd')}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Body Row */}
          <div className="flex relative">
            {/* Left Column (Task Names) */}
            {!hideSidebar && (
              <div
                className="flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 py-4 lg:block md:hidden hidden"
                style={{ width: sidebarWidth }}
              >
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
                {days.map((day) => (
                  <div
                    key={`grid-${day.toISOString()}`}
                    className={cn(
                      "flex-shrink-0 border-r border-stone-100 h-full",
                      ['Sat', 'Sun'].includes(format(day, 'EEE')) && 'bg-stone-50/30'
                    )}
                    style={{ width: dayWidth }}
                  />
                ))}
              </div>

              {/* Today Line */}
              {todayIndex !== -1 && (
                <div
                  className="absolute top-0 bottom-0 z-10 border-l border-red-500 border-dashed pointer-events-none opacity-50"
                  style={{ left: todayLeft }}
                >
                  <div className="absolute -top-2 -translate-x-1/2 bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow-sm whitespace-nowrap z-20">
                    오늘
                  </div>
                </div>
              )}

              {/* Dependency Lines SVG Layer */}
              <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
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

                    // Path logic
                    const path = `M ${depRight} ${depTop} 
                                 L ${depRight + 10} ${depTop} 
                                 L ${depRight + 10} ${taskTop} 
                                 L ${taskLeft} ${taskTop}`;

                    return (
                      <path
                        key={`${depId}-${task.id}`}
                        d={path}
                        fill="none"
                        stroke="#a8a29e"
                        strokeWidth="1.5"
                        markerEnd="url(#arrowhead)"
                        opacity="0.6"
                      />
                    );
                  });
                })}
              </svg>

              {/* Task Bars */}
              {visibleTasks.map((task, index) => {
                const start = parseISO(task.startDate);
                const end = parseISO(task.endDate);
                const offsetDays = differenceInDays(start, minDate);
                const durationDays = differenceInDays(end, start) + 1;

                const left = offsetDays * dayWidth;
                const width = durationDays * dayWidth;

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
                    <div
                      onDoubleClick={() => setEditingTask(task)}
                      className={cn(
                        "absolute top-0 h-8 rounded shadow-sm overflow-hidden cursor-pointer hover:brightness-110 transition-all border",
                        barColor
                      )}
                      style={{ left, width: Math.max(width - 4, 4) }}
                      title={`${wbsMap.get(task.id) ? wbsMap.get(task.id) + ' ' : ''}${task.name}: ${task.startDate} - ${task.endDate}`}
                    >
                      <div
                        className="h-full bg-black/10"
                        style={{ width: `${task.progress}%` }}
                      />
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white font-medium truncate w-full pr-2 drop-shadow-md pointer-events-none">
                        {wbsMap.get(task.id) ? `${wbsMap.get(task.id)} ` : ''}{task.name}
                      </span>
                    </div>

                    {width < 100 && (
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs text-stone-500 whitespace-nowrap pointer-events-none"
                        style={{ left: left + width + 8 }}
                      >
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
