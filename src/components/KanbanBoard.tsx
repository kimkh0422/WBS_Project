import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  defaultDropAnimationSideEffects,
  DropAnimation,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWBS } from '../context/WBSContext';
import { Task, TaskStatus, FilterState } from '../types';
import { cn } from '../lib/utils';
import { GripVertical, Calendar, User, AlertCircle, CheckCircle2, Circle, Clock, Plus, X, Trash2, Edit2 } from 'lucide-react';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';

// Column configuration
const COLUMNS: { id: TaskStatus; icon: React.ReactNode; color: string }[] = [
  {
    id: 'todo',
    color: 'bg-stone-100 border-stone-200',
    icon: <Circle className="w-4 h-4 text-stone-500" />
  },
  {
    id: 'in-progress',
    color: 'bg-blue-50 border-blue-100',
    icon: <Clock className="w-4 h-4 text-blue-500" />
  },
  {
    id: 'blocked',
    color: 'bg-red-50 border-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-500" />
  },
  {
    id: 'done',
    color: 'bg-green-50 border-green-100',
    icon: <CheckCircle2 className="w-4 h-4 text-green-500" />
  },
];

interface KanbanCardProps {
  key?: React.Key;
  task: Task;
  wbsId?: string;
  isOverlay?: boolean;
  onClick?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onUpdate?: (taskId: string, updates: Partial<Task>) => void;
  level?: number;
}

function getLevelStyle(level: number) {
  switch (level) {
    case 1: return { badge: '1레벨', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', border: 'border-l-purple-400' };
    case 2: return { badge: '2레벨', dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-l-blue-400' };
    case 3: return { badge: '3레벨', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-l-emerald-400' };
    default: return { badge: `${level}레벨`, dot: 'bg-stone-400', text: 'text-stone-600', bg: 'bg-stone-50', border: 'border-l-stone-300' };
  }
}

function KanbanCard({ task, wbsId, isOverlay, onClick, onDelete, onUpdate, level = 1 }: KanbanCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const lvStyle = getLevelStyle(level);
  const [newName, setNewName] = useState(task.name);

  // Skip hooks if we are in an overlay to avoid conflicting state
  const sortable = useSortable({
    id: task.id,
    disabled: isOverlay || isRenaming,
    data: {
      type: 'Task',
      task,
    },
  });

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = sortable;

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  const handleRename = () => {
    if (newName.trim() && newName.trim() !== task.name) {
      onUpdate?.(task.id, { name: newName.trim() });
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setNewName(task.name);
      setIsRenaming(false);
    }
    e.stopPropagation();
  };

  if (isDragging && !isOverlay) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="bg-stone-50 border-2 border-stone-200 rounded-lg h-[100px] opacity-50"
      />
    );
  }

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      className={cn(
        "bg-white p-3 rounded-lg shadow-sm border border-stone-200 border-l-4 hover:shadow-md transition-shadow group relative",
        isOverlay ? "shadow-xl rotate-2 cursor-grabbing border-l-blue-500 z-50 w-[264px]" : "cursor-grab active:cursor-grabbing",
        !isOverlay && lvStyle.border,
        isRenaming && "ring-2 ring-blue-400"
      )}
      {...(!isOverlay && !isRenaming ? { ...attributes, ...listeners } : {})}
      style={{ ...style, touchAction: isOverlay ? undefined : 'none' }}
      onClick={(e) => {
        if (isOverlay) return;
        if ((e.target as HTMLElement).closest('button')) return;
        if ((e.target as HTMLElement).closest('.drag-handle')) return;
        if (!isRenaming) onClick?.(task);
      }}
    >
      <div className="flex justify-between items-start mb-2 gap-2">
        <div className="flex-1 min-w-0" onDoubleClick={(e) => { e.stopPropagation(); !isOverlay && setIsRenaming(true); }}>
          {isRenaming ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-sm font-bold bg-white text-blue-600 outline-none ring-1 ring-blue-500 rounded px-1"
            />
          ) : (
            <h3 className="font-medium text-sm text-stone-800 line-clamp-2 leading-tight">
              {wbsId ? `${wbsId} ` : ''}{task.name}
            </h3>
          )}
        </div>

        {!isOverlay && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onClick?.(task); }}
              className="p-1 hover:bg-blue-50 text-blue-600 rounded"
              title="수정"
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(task.id); }}
              className="p-1 hover:bg-red-50 text-red-600 rounded"
              title="삭제"
            >
              <Trash2 size={12} />
            </button>
            <div
              className="p-1 text-stone-300 hover:text-stone-500 cursor-grab drag-handle"
              title="드래그하여 이동"
            >
              <GripVertical size={14} />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 mt-3">
        {/* Level badge */}
        {!isOverlay && (
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider", lvStyle.bg, lvStyle.text)}>
              {lvStyle.badge}
            </span>
            {wbsId && (
              <span className="text-[9px] font-mono text-stone-400">{wbsId}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <User size={12} />
          <span className="truncate max-w-[100px]" title={task.assignments?.length ? task.assignments.map(a => `${a.assignee} ${a.allocationPercent}%`).join(', ') : undefined}>
            {task.assignments?.length ? task.assignments.map(a => `${a.assignee} (${a.allocationPercent}%)`).join(', ') : (task.assignee || '미배정')}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Calendar size={12} />
            <span>{task.endDate ? new Date(task.endDate).toLocaleDateString() : '-'}</span>
          </div>

          {task.progress > 0 && (
            <div className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              task.progress === 100 ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
            )}>
              {task.progress}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  key?: React.Key;
  column: { id: string; name: string; icon: React.ReactNode; color: string; progress: number };
  tasks: Task[];
  displayWbsMap: Map<string, string>;
  onTaskClick: (task: Task) => void;
  onAddTask: (status: TaskStatus, name: string) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  taskLevels: Map<string, number>;
}

function KanbanColumn({ column, tasks, displayWbsMap, onTaskClick, onAddTask, onDeleteTask, onUpdateTask, taskLevels }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: {
      type: 'Column',
      column,
    },
  });

  const [isAdding, setIsAdding] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  const handleSubmit = () => {
    if (newCardTitle.trim()) {
      onAddTask(column.id, newCardTitle.trim());
      setNewCardTitle('');
      setIsAdding(true); // Keep adding mode open like Trello
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-w-[280px] w-[280px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {column.icon}
          <span className="font-bold text-stone-700">{column.name}</span>
          <span className="bg-white/50 px-2 py-0.5 rounded-full text-[10px] font-bold text-stone-500 border border-black/5">
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-xl p-2 flex flex-col gap-2 overflow-y-auto scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent border border-transparent transition-colors",
          column.color
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              wbsId={displayWbsMap.get(task.id)}
              onClick={onTaskClick}
              onDelete={onDeleteTask}
              onUpdate={onUpdateTask}
              level={taskLevels.get(task.id) ?? 1}
            />
          ))}
        </SortableContext>

        {isAdding ? (
          <div className="bg-white p-2 rounded-lg shadow-sm border border-blue-500 animate-in fade-in zoom-in-95 duration-100">
            <textarea
              ref={inputRef}
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="카드 제목을 입력하세요..."
              className="w-full text-sm resize-none outline-none text-stone-800 placeholder:text-stone-400 min-h-[60px]"
              rows={3}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleSubmit}
                className="bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
              >
                카드 추가
              </button>
              <button
                onClick={() => setIsAdding(false)}
                className="text-stone-500 hover:text-stone-700 p-1 rounded hover:bg-stone-100"
                title="취소"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 hover:bg-black/5 p-2 rounded-lg text-sm font-medium transition-colors text-left"
            title="이 컬럼에 새 카드 추가"
          >
            <Plus size={16} />
            카드 추가
          </button>
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  filters: FilterState;
}

export function KanbanBoard({ filters }: KanbanBoardProps) {
  const { tasks, updateTask, addTask, deleteTask, wbsMap, displayWbsMap, wbsSettings } = useWBS();

  const columns = useMemo(() => {
    return wbsSettings.statusConfigs.map(config => {
      const template = COLUMNS.find(c => c.id === config.id);
      return {
        ...config,
        icon: template?.icon || <Circle className="w-4 h-4 text-stone-400" />,
        color: config.color || template?.color || 'bg-stone-50 border-stone-100'
      };
    });
  }, [wbsSettings.statusConfigs]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string | null }>({
    isOpen: false,
    taskId: null
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
    useSensor(MouseSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Compute level (depth) for each task from parentId chain
  const taskLevels = useMemo(() => {
    const levels = new Map<string, number>();
    const getLevel = (taskId: string, visited = new Set<string>()): number => {
      if (levels.has(taskId)) return levels.get(taskId)!;
      if (visited.has(taskId)) return 1;
      visited.add(taskId);
      const task = tasks.find(t => t.id === taskId);
      if (!task || !task.parentId) {
        levels.set(taskId, 1);
        return 1;
      }
      const parentLevel = getLevel(task.parentId, visited);
      const level = parentLevel + 1;
      levels.set(taskId, level);
      return level;
    };
    tasks.forEach(t => getLevel(t.id));
    return levels;
  }, [tasks]);

  // Filter tasks and apply filters (show all tasks, all levels)
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filters.projectId !== 'all') {
      result = result.filter(t => t.projectId === filters.projectId);
    }
    return result.filter(task => {
      if (filters.status !== 'all' && task.status !== filters.status) return false;
      if (filters.assignee && !task.assignee.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
      const taskStart = (task.startDate || '').slice(0, 10);
      const taskEnd = (task.endDate || '').slice(0, 10);
      if (filters.startDate && filters.endDate) {
        if (taskStart > filters.endDate || taskEnd < filters.startDate) return false;
      } else {
        if (filters.startDate && taskEnd < filters.startDate) return false;
        if (filters.endDate && taskStart > filters.endDate) return false;
      }
      if (filters.milestoneOnly && !task.isMilestone) return false;
      return true;
    });
  }, [tasks, filters]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    wbsSettings.statusConfigs.forEach(config => {
      grouped[config.id] = [];
    });
    filteredTasks.forEach(task => {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      } else {
        const firstStatusId = wbsSettings.statusConfigs[0]?.id;
        if (firstStatusId && grouped[firstStatusId]) {
          // skip unknown statuses
        }
      }
    });
    // Sort each group by level, then by name
    Object.values(grouped).forEach(arr =>
      arr.sort((a, b) => (taskLevels.get(a.id) ?? 1) - (taskLevels.get(b.id) ?? 1))
    );
    return grouped;
  }, [filteredTasks, wbsSettings.statusConfigs, taskLevels]);

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const task = tasks.find(t => t.id === activeId);
    if (!task) return;

    let newStatus: TaskStatus | undefined;

    if (wbsSettings.statusConfigs.some(c => c.id === overId)) {
      newStatus = overId as TaskStatus;
    } else {
      const overTask = tasks.find(t => t.id === overId);
      if (overTask) {
        newStatus = overTask.status;
      }
    }

    if (newStatus && newStatus !== task.status) {
      const destinationStatus = newStatus;
      const statusConfig = wbsSettings.statusConfigs.find(c => c.id === destinationStatus);
      const progress = statusConfig ? statusConfig.progress : undefined;

      updateTask(activeId, {
        status: destinationStatus,
        ...(progress !== undefined ? { progress } : {})
      });
    }
  };

  const handleTaskClick = (task: Task) => {
    setEditingTask(task);
    setIsModalOpen(true);
  };

  const handleAddTask = (status: TaskStatus, name: string) => {
    addTask({
      name,
      status,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      progress: 0,
      workEffort: 0.5,
      assignee: '',
      parentId: null,
    });
  };

  const handleSaveTask = (taskData: any) => {
    if (editingTask) {
      updateTask(editingTask.id, taskData);
    } else {
      addTask(taskData);
    }
  };

  const handleDeleteClick = (taskId: string) => {
    setDeleteConfirm({ isOpen: true, taskId });
  };

  const executeDelete = () => {
    if (deleteConfirm.taskId) {
      deleteTask(deleteConfirm.taskId);
    }
    setDeleteConfirm({ isOpen: false, taskId: null });
  };

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  return (
    <div className="h-full w-full overflow-x-auto p-6 bg-[var(--color-bg)]">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 h-full min-w-max">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id] ?? []}
              displayWbsMap={displayWbsMap}
              onTaskClick={handleTaskClick}
              onAddTask={handleAddTask}
              onDeleteTask={handleDeleteClick}
              onUpdateTask={updateTask}
              taskLevels={taskLevels}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask ? (
            <KanbanCard task={activeTask} wbsId={displayWbsMap.get(activeTask.id)} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSaveTask}
        onDelete={() => editingTask && handleDeleteClick(editingTask.id)}
        initialData={editingTask || undefined}
        parentOptions={tasks}
      />

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ ...deleteConfirm, isOpen: false })}
        onConfirm={executeDelete}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다."
        confirmLabel="삭제"
        isDanger={true}
      />
    </div>
  );
}
