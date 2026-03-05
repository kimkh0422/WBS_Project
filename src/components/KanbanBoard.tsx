import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  defaultDropAnimationSideEffects,
  DropAnimation
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWBS } from '../context/WBSContext';
import { Task, TaskStatus } from '../types';
import { cn } from '../lib/utils';
import { GripVertical, Calendar, User, AlertCircle, CheckCircle2, Circle, Clock, Plus, X } from 'lucide-react';
import { TaskModal } from './TaskModal';

// Column configuration
const COLUMNS: { id: TaskStatus; title: string; color: string; icon: React.ReactNode }[] = [
  {
    id: 'todo',
    title: '할 일',
    color: 'bg-stone-100 border-stone-200',
    icon: <Circle className="w-4 h-4 text-stone-500" />
  },
  {
    id: 'in-progress',
    title: '진행 중',
    color: 'bg-blue-50 border-blue-100',
    icon: <Clock className="w-4 h-4 text-blue-500" />
  },
  {
    id: 'blocked',
    title: '지연됨',
    color: 'bg-red-50 border-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-500" />
  },
  {
    id: 'done',
    title: '완료',
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
}

function KanbanCard({ task, wbsId, isOverlay, onClick }: KanbanCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  if (isDragging) {
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
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick?.(task)}
      className={cn(
        "bg-white p-3 rounded-lg shadow-sm border border-stone-200 hover:shadow-md transition-shadow cursor-pointer group relative",
        isOverlay && "shadow-xl rotate-2 cursor-grabbing border-blue-500 ring-2 ring-blue-500 ring-opacity-50 z-50"
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-medium text-sm text-stone-800 line-clamp-2 leading-tight">
          {wbsId ? `${wbsId} ` : ''}{task.name}
        </h3>
        <button className="text-stone-300 hover:text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 mt-3">
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <User size={12} />
          <span className="truncate max-w-[100px]">{task.assignee || '미배정'}</span>
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
  column: typeof COLUMNS[0];
  tasks: Task[];
  wbsMap: Map<string, string>;
  onTaskClick: (task: Task) => void;
  onAddTask: (status: TaskStatus, name: string) => void;
}

function KanbanColumn({ column, tasks, wbsMap, onTaskClick, onAddTask }: KanbanColumnProps) {
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
          <h2 className="font-semibold text-stone-700 text-sm">{column.title}</h2>
          <span className="bg-stone-200 text-stone-600 text-xs px-2 py-0.5 rounded-full font-medium">
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
            <KanbanCard key={task.id} task={task} wbsId={wbsMap.get(task.id)} onClick={onTaskClick} />
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
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 hover:bg-black/5 p-2 rounded-lg text-sm font-medium transition-colors text-left"
          >
            <Plus size={16} />
            카드 추가
          </button>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  const { tasks, updateTask, addTask, deleteTask, wbsMap } = useWBS();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter tasks to only show leaf tasks (tasks with no children)
  const leafTasks = useMemo(() => {
    return tasks.filter(task => !tasks.some(t => t.parentId === task.id));
  }, [tasks]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      todo: [],
      'in-progress': [],
      blocked: [],
      done: [],
    };

    leafTasks.forEach(task => {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    });

    return grouped;
  }, [leafTasks]);

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

    if (COLUMNS.some(c => c.id === overId)) {
      newStatus = overId as TaskStatus;
    } else {
      const overTask = tasks.find(t => t.id === overId);
      if (overTask) {
        newStatus = overTask.status;
      }
    }

    if (newStatus && newStatus !== task.status) {
      const updates: Partial<Task> = { status: newStatus };

      if (newStatus === 'done') {
        updates.progress = 100;
      } else if (newStatus === 'todo' && task.progress === 100) {
        updates.progress = 0;
      } else if (newStatus === 'in-progress' && task.progress === 0) {
        updates.progress = 10;
      } else if (newStatus === 'in-progress' && task.progress === 100) {
        updates.progress = 90;
      }

      updateTask(activeId, updates);
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

  const handleDeleteTask = () => {
    if (editingTask) {
      deleteTask(editingTask.id);
    }
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
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 h-full min-w-max">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id]}
              wbsMap={wbsMap}
              onTaskClick={handleTaskClick}
              onAddTask={handleAddTask}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask ? (
            <KanbanCard task={activeTask} wbsId={wbsMap.get(activeTask.id)} isOverlay />
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
        onDelete={handleDeleteTask}
        initialData={editingTask || undefined}
        parentOptions={tasks}
      />
    </div>
  );
}
