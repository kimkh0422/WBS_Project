import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
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
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useWBS } from '../context/WBSContext';
import { Task, TaskStatus, FilterState } from '../types';
import { cn } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import { GripVertical, Calendar, User, AlertCircle, CheckCircle2, Circle, Clock, Plus, X, Trash2, Edit2 } from 'lucide-react';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';
import { saveJsonWithIdbFallback, loadJsonWithIdbFallback, type PersistKey } from '../lib/persist';

/** 설명에 포함된 마크다운 이미지 `![](url)` 중 첫 URL (칸반 썸네일용) */
function extractFirstMarkdownImageUrl(description: string | undefined): string | null {
  if (!description) return null;
  const m = description.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  const url = m?.[1];
  if (!url || (!url.startsWith('data:') && !url.startsWith('http://') && !url.startsWith('https://'))) return null;
  return url;
}

/** 클립보드 이미지가 너무 크면 폭을 줄여 data URL 용량을 낮춘다. */
function downscaleDataUrlIfNeeded(dataUrl: string, maxWidth = 1280): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth <= maxWidth) {
        resolve(dataUrl);
        return;
      }
      const w = maxWidth;
      const h = Math.round((img.naturalHeight * maxWidth) / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function defaultScreenshotCardTitle(): string {
  const d = new Date();
  return `스크린샷 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Column configuration
const COLUMNS: { id: TaskStatus; icon: React.ReactNode; color: string }[] = [
  {
    id: 'todo',
    color: 'bg-stone-100 border-stone-200',
    icon: <Circle className="w-4 h-4 text-stone-500" />,
  },
  {
    id: 'in-progress',
    color: 'bg-blue-50 border-blue-100',
    icon: <Clock className="w-4 h-4 text-blue-500" />,
  },
  {
    id: 'blocked',
    color: 'bg-red-50 border-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-500" />,
  },
  {
    id: 'done',
    color: 'bg-green-50 border-green-100',
    icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  },
];

interface KanbanCardProps {
  key?: React.Key;
  task: Task;
  wbsId?: string;
  /** 상위 WBS 표시명 (예: "T2.4 시뮬레이터 데") */
  parentWbsLabel?: string;
  isOverlay?: boolean;
  canEdit?: boolean;
  onClick?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onUpdate?: (taskId: string, updates: Partial<Task>) => void;
  level?: number;
}

function getLevelStyle(level: number) {
  switch (level) {
    case 1:
      return { badge: '1레벨', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', border: 'border-l-purple-400' };
    case 2:
      return { badge: '2레벨', dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-l-blue-400' };
    case 3:
      return { badge: '3레벨', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-l-emerald-400' };
    default:
      return { badge: `${level}레벨`, dot: 'bg-stone-400', text: 'text-stone-600', bg: 'bg-stone-50', border: 'border-l-stone-300' };
  }
}

function KanbanCard({ task, wbsId, parentWbsLabel, isOverlay, canEdit = true, onClick, onDelete, onUpdate, level = 1 }: KanbanCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const lvStyle = getLevelStyle(level);
  const [newName, setNewName] = useState(task.name);
  const coverUrl = !isOverlay ? extractFirstMarkdownImageUrl(task.description) : null;

  // Skip hooks if we are in an overlay to avoid conflicting state
  const sortable = useSortable({
    id: task.id,
    disabled: isOverlay || isRenaming,
    data: {
      type: 'Task',
      task,
    },
  });

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = sortable;

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
    return <div ref={setNodeRef} style={style} className="bg-stone-50 border-2 border-stone-200 rounded-lg h-[100px] opacity-50" />;
  }

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      className={cn(
        'bg-white p-3 rounded-lg shadow-sm border border-stone-200 border-l-4 hover:shadow-md transition-shadow group relative',
        isOverlay ? 'shadow-xl rotate-2 cursor-grabbing border-l-blue-500 z-50 w-[264px]' : 'cursor-grab active:cursor-grabbing',
        !isOverlay && lvStyle.border,
        isRenaming && 'ring-2 ring-blue-400',
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
      {coverUrl && (
        <div className="mb-2 -mt-0.5 rounded-md overflow-hidden border border-stone-100 bg-stone-50">
          <img
            src={coverUrl}
            alt=""
            className="w-full max-h-[7.5rem] object-cover object-center block pointer-events-none"
            loading="lazy"
          />
        </div>
      )}
      <div className="flex justify-between items-start mb-2 gap-2">
        <div
          className="flex-1 min-w-0"
          onDoubleClick={(e) => {
            e.stopPropagation();
            !isOverlay && setIsRenaming(true);
          }}
        >
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
            <>
              <h3 className="font-medium text-sm text-stone-800 line-clamp-2 leading-tight">{task.name}</h3>
              {parentWbsLabel && (
                <p className="text-[10px] text-stone-500 mt-0.5 truncate" title={parentWbsLabel}>
                  상위: {parentWbsLabel}
                </p>
              )}
            </>
          )}
        </div>

        {!isOverlay && (
          <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick?.(task);
              }}
              className="p-1 hover:bg-blue-50 text-blue-600 rounded"
              title="수정"
              aria-label="수정"
            >
              <Edit2 size={12} />
            </button>
            {canEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(task.id);
                }}
                className="p-1 hover:bg-red-50 text-red-600 rounded"
                title="삭제"
                aria-label="삭제"
              >
                <Trash2 size={12} />
              </button>
            )}
            <div className="p-1 text-stone-300 hover:text-stone-500 cursor-grab drag-handle" title="드래그하여 이동">
              <GripVertical size={14} />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 mt-3">
        {/* Level badge */}
        {!isOverlay && (
          <div className="flex items-center gap-1.5">
            <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider', lvStyle.bg, lvStyle.text)}>
              {lvStyle.badge}
            </span>
            {task.isIssue && (
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200"
                title="이슈"
              >
                ISSUE
              </span>
            )}
            {task.isActionItem && (
              <span
                className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-200"
                title="액션 항목"
              >
                ACTION
              </span>
            )}
            {wbsId && <span className="text-[9px] font-mono text-stone-400">{wbsId}</span>}
          </div>
        )}
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
            <div
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                task.progress === 100 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700',
              )}
            >
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
  column: { id: string; name: string; icon: React.ReactNode; color: string; progress?: number };
  tasks: Task[];
  displayWbsMap: Map<string, string>;
  parentWbsLabelMap: Map<string, string>;
  canEdit?: boolean;
  onTaskClick: (task: Task) => void;
  onAddTask: (status: TaskStatus, name: string) => void;
  /** 클립보드 이미지 붙여넣기 시 카드 생성 (트렐로 스타일) */
  onPasteCardImage?: (status: TaskStatus, dataUrl: string, titleOrEmpty: string) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  taskLevels: Map<string, number>;
  onRenameColumn: (columnId: string, newName: string) => void;
}

function KanbanColumn({
  column,
  tasks,
  displayWbsMap,
  parentWbsLabelMap,
  canEdit = true,
  onTaskClick,
  onAddTask,
  onPasteCardImage,
  onDeleteTask,
  onUpdateTask,
  taskLevels,
  onRenameColumn,
}: KanbanColumnProps) {
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [columnName, setColumnName] = useState(column.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setColumnName(column.name);
  }, [column.name]);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    const trimmed = columnName.trim();
    if (trimmed && trimmed !== column.name) {
      onRenameColumn(column.id, trimmed);
    } else {
      setColumnName(column.name);
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setColumnName(column.name);
      setIsRenaming(false);
    }
  };

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

  /** 캡처 단계에서 이미지 붙여넣기를 가로채 카드로 추가 (자식 textarea 포함). */
  const handlePasteCapture = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!canEdit || !onPasteCardImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    let file: File | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item?.type?.startsWith('image/')) {
        file = item.getAsFile();
        break;
      }
    }
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      const title = newCardTitle.trim();
      onPasteCardImage(column.id as TaskStatus, dataUrl, title);
      setNewCardTitle('');
      setIsAdding(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    reader.readAsDataURL(file);
  };

  const colorProps = getStatusColorProps(column.color);

  return (
    <div className="flex flex-col h-full min-w-[280px] w-[280px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {column.icon}
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              className="text-sm font-bold text-stone-800 bg-white border border-blue-400 rounded px-1 py-0.5 outline-none shadow-sm"
            />
          ) : (
            <span
              className="font-bold text-stone-700 cursor-text"
              title="더블 클릭하여 그룹명 수정"
              onDoubleClick={() => setIsRenaming(true)}
            >
              {column.name}
            </span>
          )}
          <span className="bg-white/50 px-2 py-0.5 rounded-full text-[10px] font-bold text-stone-500 border border-black/5">
            {tasks.length}
          </span>
          {typeof column.progress === 'number' && (
            <span
              className="bg-blue-50 px-2 py-0.5 rounded-full text-[10px] font-bold text-blue-700 border border-blue-100 tabular-nums"
              title={`${column.name} 단계 기본 진척률`}
            >
              {column.progress}%
            </span>
          )}
        </div>
      </div>

      <div
        ref={setNodeRef}
        tabIndex={-1}
        title="빈 영역을 클릭한 뒤 스크린샷(Ctrl+V)을 붙여넣으면 이 단계 맨 아래에 카드가 추가됩니다."
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) (e.currentTarget as HTMLDivElement).focus();
        }}
        onPasteCapture={handlePasteCapture}
        className={cn(
          'flex-1 rounded-xl p-2 flex flex-col gap-2 overflow-y-auto scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent transition-colors outline-none',
          !colorProps.style && 'border border-transparent',
          colorProps.className,
        )}
        style={colorProps.style}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              wbsId={displayWbsMap.get(task.id)}
              parentWbsLabel={parentWbsLabelMap.get(task.id)}
              canEdit={canEdit}
              onClick={onTaskClick}
              onDelete={onDeleteTask}
              onUpdate={onUpdateTask}
              level={taskLevels.get(task.id) ?? 1}
            />
          ))}
        </SortableContext>

        {canEdit && isAdding ? (
          <div className="bg-white p-2 rounded-lg shadow-sm border border-blue-500 animate-in fade-in zoom-in-95 duration-100">
            <textarea
              ref={inputRef}
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="제목 입력 또는 이미지 붙여넣기 (Ctrl+V)…"
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
                aria-label="취소"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : canEdit ? (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-700 hover:bg-black/5 p-2 rounded-lg text-sm font-medium transition-colors text-left"
            title="이 컬럼에 새 카드 추가"
          >
            <Plus size={16} />
            카드 추가
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  filters: FilterState;
}

export function KanbanBoard({ filters }: KanbanBoardProps) {
  const {
    tasks,
    updateTask,
    addTask,
    deleteTask,
    wbsMap,
    displayWbsMap,
    wbsSettings,
    currentProjectId,
    updateWbsSettings,
    canEditCurrentProject,
  } = useWBS();

  const getKanbanStorageKey = (projectId: string | 'all') => `wbs-kanban-order-v1-${projectId || 'all'}` as PersistKey;

  const loadKanbanOrder = (projectId: string | 'all'): Record<string, string[]> => {
    try {
      const raw = localStorage.getItem(getKanbanStorageKey(projectId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const result: Record<string, string[]> = {};
      Object.entries(parsed).forEach(([status, ids]) => {
        if (Array.isArray(ids)) {
          result[status] = ids.filter((id) => typeof id === 'string') as string[];
        }
      });
      return result;
    } catch {
      return {};
    }
  };

  const saveKanbanOrder = (projectId: string | 'all', order: Record<string, string[]>) => {
    void saveJsonWithIdbFallback(getKanbanStorageKey(projectId), order);
  };

  const effectiveProjectId = useMemo(() => {
    if (filters.projectIds === 'all') return currentProjectId || 'all';
    if (filters.projectIds.length === 1) return filters.projectIds[0];
    return `multi:${[...filters.projectIds].sort().join(',')}`;
  }, [filters.projectIds, currentProjectId]);

  const [kanbanOrder, setKanbanOrder] = useState<Record<string, string[]>>(() => loadKanbanOrder(effectiveProjectId || 'all'));

  useEffect(() => {
    const key = getKanbanStorageKey(effectiveProjectId || 'all');
    let cancelled = false;
    void loadJsonWithIdbFallback(key).then((data) => {
      if (cancelled) return;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const result: Record<string, string[]> = {};
        Object.entries(data as Record<string, unknown>).forEach(([status, ids]) => {
          if (Array.isArray(ids)) result[status] = ids.filter((id) => typeof id === 'string');
        });
        setKanbanOrder(result);
      } else {
        setKanbanOrder(loadKanbanOrder(effectiveProjectId || 'all'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectId]);

  const columns = useMemo(() => {
    return wbsSettings.statusConfigs.map((config) => {
      const template = COLUMNS.find((c) => c.id === config.id);
      return {
        ...config,
        icon: template?.icon || <Circle className="w-4 h-4 text-stone-400" />,
        color: config.color || template?.color || 'bg-stone-50 border-stone-100',
      };
    });
  }, [wbsSettings.statusConfigs]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string | null }>({
    isOpen: false,
    taskId: null,
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
    }),
  );

  // 상위 작업 표시명 (WBS 번호 + 이름) — 카드에서 한눈에 보기 위함
  const parentWbsLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
    tasks.forEach((task) => {
      if (!task.parentId) return;
      const parent = taskById.get(task.parentId);
      if (!parent) return;
      const wbs = displayWbsMap.get(parent.id);
      map.set(task.id, wbs ? `${wbs} ${parent.name}` : parent.name);
    });
    return map;
  }, [tasks, displayWbsMap]);

  // Compute level (depth) for each task from parentId chain
  const taskLevels = useMemo(() => {
    const levels = new Map<string, number>();
    const getLevel = (taskId: string, visited = new Set<string>()): number => {
      if (levels.has(taskId)) return levels.get(taskId)!;
      if (visited.has(taskId)) return 1;
      visited.add(taskId);
      const task = tasks.find((t) => t.id === taskId);
      if (!task || !task.parentId) {
        levels.set(taskId, 1);
        return 1;
      }
      const parentLevel = getLevel(task.parentId, visited);
      const level = parentLevel + 1;
      levels.set(taskId, level);
      return level;
    };
    tasks.forEach((t) => getLevel(t.id));
    return levels;
  }, [tasks]);

  // Task IDs that have at least one child (parent tasks)
  const parentTaskIds = useMemo(() => {
    return new Set(tasks.filter((t) => t.parentId).map((t) => t.parentId) as string[]);
  }, [tasks]);

  // Filter tasks: only leaf tasks (no children), then apply filters
  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filters.projectIds !== 'all') {
      const set = new Set(filters.projectIds);
      result = result.filter((t) => t.projectId && set.has(t.projectId));
    }
    // Kanban: show only leaf tasks (lowest-level, no children)
    result = result.filter((task) => !parentTaskIds.has(task.id));
    return result.filter((task) => {
      if (filters.status !== 'all' && task.status !== filters.status) return false;
      const assigneeName = (task.assignee || '').toLowerCase();
      if (filters.assigneeUnassignedOnly) {
        if (assigneeName.trim().length > 0) return false;
      } else if (filters.assignee && !assigneeName.includes(filters.assignee.toLowerCase())) {
        return false;
      }
      const taskStart = (task.startDate || '').slice(0, 10);
      const taskEnd = (task.endDate || '').slice(0, 10);
      if (filters.startDate && filters.endDate) {
        if (taskStart > filters.endDate || taskEnd < filters.startDate) return false;
      } else {
        if (filters.startDate && taskEnd < filters.startDate) return false;
        if (filters.endDate && taskStart > filters.endDate) return false;
      }
      // 마일스톤/이슈 동시 선택 시: (마일스톤 OR 이슈)만 표시
      if (filters.milestoneOnly && filters.issueOnly) {
        if (!task.isMilestone && !task.isIssue) return false;
      } else {
        if (filters.milestoneOnly && !task.isMilestone) return false;
        if (filters.issueOnly && !task.isIssue) return false;
      }
      if (typeof filters.level === 'number' && (taskLevels.get(task.id) ?? 1) !== filters.level) return false;
      if (filters.pastDueOnly) {
        const today = new Date().toISOString().slice(0, 10);
        if (!taskEnd || taskEnd >= today || (task.progress ?? 0) >= 100) return false;
      }
      return true;
    });
  }, [tasks, filters, taskLevels, parentTaskIds]);

  const handleRenameColumn = (columnId: string, newName: string) => {
    const nextConfigs = wbsSettings.statusConfigs.map((config) => (config.id === columnId ? { ...config, name: newName } : config));
    updateWbsSettings({ statusConfigs: nextConfigs });
  };

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    wbsSettings.statusConfigs.forEach((config) => {
      grouped[config.id] = [];
    });
    filteredTasks.forEach((task) => {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      } else {
        const firstStatusId = wbsSettings.statusConfigs[0]?.id;
        if (firstStatusId && grouped[firstStatusId]) {
          // skip unknown statuses
        }
      }
    });
    // Sort each group by persisted kanban order (상하 드래그 순서) 먼저,
    // 없으면 레벨(계층 깊이) 기준으로 정렬
    Object.entries(grouped).forEach(([statusId, arr]) => {
      const order = kanbanOrder[statusId] ?? [];
      arr.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if (ia !== -1 || ib !== -1) {
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        }
        return (taskLevels.get(a.id) ?? 1) - (taskLevels.get(b.id) ?? 1);
      });
    });
    return grouped;
  }, [filteredTasks, wbsSettings.statusConfigs, taskLevels, kanbanOrder]);

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

    const task = tasks.find((t) => t.id === activeId);
    if (!task) return;

    let newStatus: TaskStatus | undefined;
    let overTask: Task | undefined;

    if (wbsSettings.statusConfigs.some((c) => c.id === overId)) {
      newStatus = overId as TaskStatus;
    } else {
      overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        newStatus = overTask.status;
      }
    }

    if (!newStatus) return;

    const sourceStatus = task.status;
    const destinationStatus = newStatus;

    // 현재 상태 컬럼에서의 카드 순서 배열을 가져오고, 누락된 카드가 있으면 채워 넣음
    const getStatusOrder = (statusId: string): string[] => {
      const existing = (kanbanOrder[statusId] ?? []).filter((id) => filteredTasks.some((t) => t.id === id && t.status === statusId));
      const missing = (tasksByStatus[statusId] ?? []).map((t) => t.id).filter((id) => !existing.includes(id));
      return [...existing, ...missing];
    };

    // 같은 컬럼 내 상하 드래그: 순서만 변경, WBS 번호나 상태는 그대로
    if (destinationStatus === sourceStatus) {
      const currentOrder = getStatusOrder(sourceStatus);
      const activeIndex = currentOrder.indexOf(activeId);
      if (activeIndex === -1) return;

      let overIndex = currentOrder.length - 1;
      if (overTask && overTask.id !== activeId) {
        const idx = currentOrder.indexOf(overTask.id);
        if (idx !== -1) overIndex = idx;
      }

      if (activeIndex === overIndex) return;

      const nextOrder = [...currentOrder];
      nextOrder.splice(activeIndex, 1);
      nextOrder.splice(overIndex, 0, activeId);

      const updatedOrder = { ...kanbanOrder, [sourceStatus]: nextOrder };
      setKanbanOrder(updatedOrder);
      saveKanbanOrder(effectiveProjectId || 'all', updatedOrder);
      return;
    }

    // 컬럼 간 이동: 상태 변경 + Kanban 정렬 순서 갱신 (WBS 번호는 context에서 별도로 유지됨)
    const sourceOrder = getStatusOrder(sourceStatus);
    const destOrder = getStatusOrder(destinationStatus);

    const filteredSourceOrder = sourceOrder.filter((id) => id !== activeId);

    let insertIndex = destOrder.length;
    if (overTask && overTask.status === destinationStatus) {
      const idx = destOrder.indexOf(overTask.id);
      if (idx !== -1) insertIndex = idx;
    }

    const nextDestOrder = [...destOrder];
    nextDestOrder.splice(insertIndex, 0, activeId);

    const updatedOrder: Record<string, string[]> = {
      ...kanbanOrder,
      [sourceStatus]: filteredSourceOrder,
      [destinationStatus]: nextDestOrder,
    };

    setKanbanOrder(updatedOrder);
    saveKanbanOrder(effectiveProjectId || 'all', updatedOrder);

    const statusConfig = wbsSettings.statusConfigs.find((c) => c.id === destinationStatus);
    const progress = statusConfig ? statusConfig.progress : undefined;

    if (destinationStatus !== task.status || progress !== undefined) {
      updateTask(activeId, {
        status: destinationStatus,
        ...(progress !== undefined ? { progress } : {}),
      });
    }
  };

  const handleTaskClick = (task: Task) => {
    setEditingTask(task);
    setIsModalOpen(true);
  };

  /** 새 카드는 항상 컬럼 순서 배열의 맨 뒤에 두어 화면에서도 맨 아래에 보이게 한다.
   *  단, 정렬 로직이 "order에 있는 id를 앞쪽, 없는 id를 뒤쪽"으로 두므로, 기존 카드 일부가
   *  아직 order에 없으면 새 카드만 order에 들어가 새 카드가 위로 올라가는 회귀가 발생한다.
   *  이를 막기 위해 같은 컬럼의 기존 카드들을 현재 표시 순서대로 모두 order에 보충한 뒤
   *  새 id를 맨 뒤에 push한다. */
  const appendTaskIdToColumnOrder = useCallback(
    (status: string, taskId: string) => {
      setKanbanOrder((prev) => {
        const cur = (prev[status] ?? []).filter((id) => id !== taskId);
        const knownIds = new Set(cur);
        const tasksInStatus = filteredTasks
          .filter((t) => t.status === status && t.id !== taskId && !knownIds.has(t.id))
          .sort((a, b) => (taskLevels.get(a.id) ?? 1) - (taskLevels.get(b.id) ?? 1))
          .map((t) => t.id);
        const updated = { ...prev, [status]: [...cur, ...tasksInStatus, taskId] };
        saveKanbanOrder(effectiveProjectId || 'all', updated);
        return updated;
      });
    },
    [effectiveProjectId, filteredTasks, taskLevels],
  );

  const handleAddTask = useCallback(
    (status: TaskStatus, name: string) => {
      const today = new Date().toISOString().split('T')[0];
      const newId = addTask({
        name,
        status,
        startDate: filters.startDate || today,
        endDate: filters.endDate || today,
        progress: 0,
        workEffort: 0.5,
        assignee: filters.assignee || '',
        parentId: null,
      });
      appendTaskIdToColumnOrder(status, newId);
    },
    [addTask, appendTaskIdToColumnOrder, filters.assignee, filters.endDate, filters.startDate],
  );

  const handlePasteCardImage = useCallback(
    async (status: TaskStatus, dataUrl: string, titleOrEmpty: string) => {
      let url = dataUrl;
      try {
        url = await downscaleDataUrlIfNeeded(dataUrl);
      } catch {
        // 원본 유지
      }
      const today = new Date().toISOString().split('T')[0];
      const name = titleOrEmpty.trim() || defaultScreenshotCardTitle();
      const newId = addTask({
        name,
        status,
        startDate: filters.startDate || today,
        endDate: filters.endDate || today,
        progress: 0,
        workEffort: 0.5,
        assignee: filters.assignee || '',
        parentId: null,
        description: `![image](${url})`,
      });
      appendTaskIdToColumnOrder(status, newId);
    },
    [addTask, appendTaskIdToColumnOrder, filters.assignee, filters.endDate, filters.startDate],
  );

  const handleSaveTask = (taskData: Partial<Task>) => {
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
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 h-full min-w-max">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id] ?? []}
              displayWbsMap={displayWbsMap}
              parentWbsLabelMap={parentWbsLabelMap}
              canEdit={canEditCurrentProject}
              onTaskClick={handleTaskClick}
              onAddTask={handleAddTask}
              onPasteCardImage={canEditCurrentProject ? handlePasteCardImage : undefined}
              onDeleteTask={handleDeleteClick}
              onUpdateTask={updateTask}
              taskLevels={taskLevels}
              onRenameColumn={handleRenameColumn}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask ? (
            <KanbanCard
              task={activeTask}
              wbsId={displayWbsMap.get(activeTask.id)}
              parentWbsLabel={parentWbsLabelMap.get(activeTask.id)}
              isOverlay
            />
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
        onOpenTask={(task) => setEditingTask(task)}
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
