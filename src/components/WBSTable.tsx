import React, { useState, useMemo, useEffect } from 'react';
import { useWBS } from '../context/WBSContext';
import { cn, formatDate } from '../lib/utils';
import { ChevronRight, ChevronDown, Plus, Trash2, Edit2, ArrowUpDown, ArrowUp, ArrowDown, X, MoreHorizontal, CornerDownRight, GripVertical, CalendarDays, Clock, TrendingUp, ListChecks, Settings2, RefreshCw } from 'lucide-react';
import { Task, TaskStatus, FilterState, SortConfig } from '../types';
import { TaskModal } from './TaskModal';
import { ContextMenu } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { v4 as uuidv4 } from 'uuid';

interface WBSTableProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task) => void;
  syncScrollRef?: React.RefObject<HTMLDivElement>;
  onRowHeightChange?: (h: number) => void;
  hotkeysEnabled?: boolean;
  onOpenColumnSettings?: () => void;
}

type TableColumnId = 'wbsId' | 'name' | 'startDate' | 'endDate' | 'workEffort' | 'assignee' | 'status' | 'progress' | 'deliverables';

const StatChip = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="flex items-center gap-1.5 px-3 py-1">
    <span className="text-stone-400">{icon}</span>
    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</span>
    <span className="text-xs font-semibold text-[var(--color-ink)]">{value}</span>
  </div>
);

const Divider = () => <div className="w-px h-4 bg-stone-200 flex-shrink-0" />;

/** 간트차트와 동일한 레벨별 색상 (좌측 테두리·배경 톤) */
function getLevelStyle(level: number) {
  switch (level) {
    // GanttChart getLevelStyle의 레벨 컬러와 일치
    // 요청: 행 전체 배경색으로 레벨 구분
    case 1: return { rowBg: 'rgba(147, 51, 234, 0.20)' }; // purple-600
    case 2: return { rowBg: 'rgba(37, 99, 235, 0.20)' }; // blue-600
    case 3: return { rowBg: 'rgba(5, 150, 105, 0.20)' }; // emerald-600
    default: return { rowBg: 'rgba(87, 83, 78, 0.14)' }; // stone-600-ish
  }
}

export function WBSTable({ filters, sortConfig, onSort, syncScrollRef, onRowHeightChange, hotkeysEnabled = true, onOpenColumnSettings }: WBSTableProps) {
  const {
    tasks,
    toggleExpand,
    expandToLevel,
    treeExpandLevel,
    setTreeExpandLevel,
    deleteTask,
    updateTask,
    addTask,
    moveTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    reorderTask,
    wbsSettings,
    wbsMap,
    displayWbsMap,
    selectedTaskIds: sharedSelectedTaskIds,
    setSelectedTaskIds: setSharedSelectedTaskIds
  } = useWBS();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [anchorTaskId, setAnchorTaskId] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'task' | 'header'; taskId?: string; columnId?: 'progress' | 'status' } | null>(null);

  // Clipboard state for copy-paste
  const CLIPBOARD_KEY = 'wbs-task-clipboard-v1';
  type ClipboardPayloadV1 = { version: 1; copiedAt: string; tasks: Task[] };
  const loadClipboardTasks = (): Task[] => {
    try {
      const raw = localStorage.getItem(CLIPBOARD_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ClipboardPayloadV1;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return [];
      // Basic shape check
      return parsed.tasks.filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.startDate === 'string' && typeof t.endDate === 'string') as Task[];
    } catch {
      return [];
    }
  };
  const [copiedTasks, setCopiedTasks] = useState<Task[]>(() => {
    if (typeof window === 'undefined') return [];
    return loadClipboardTasks();
  });

  const [quickAddName, setQuickAddName] = useState('');
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null);
  const [inlineAddingTaskId, setInlineAddingTaskId] = useState<string | null>(null);

  // F2 Inline Name Edit state
  const [inlineEditingNameId, setInlineEditingNameId] = useState<string | null>(null);

  // Global list of assignees for datalist autocomplete
  const allAssignees = useMemo(() => {
    return Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  }, [tasks]);

  // Custom Column Widths
  const [columnWidths, setColumnWidths] = useState({
    grip: 32,
    checkbox: 40,
    seq: 48,
    expand: 40,
    wbsId: 60,
    name: 300,
    startDate: 85,
    endDate: 85,
    workEffort: 56,
    assignee: 70,
    status: 70,
    progress: 70,
    deliverables: 120,
    actions: 70
  });

  const [resizingCol, setResizingCol] = useState<keyof typeof columnWidths | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  const handleMouseDown = (e: React.MouseEvent, col: keyof typeof columnWidths) => {
    e.stopPropagation();
    setResizingCol(col);
    setStartX(e.clientX);
    setStartWidth(columnWidths[col]);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingCol) return;
      const diff = e.clientX - startX;
      setColumnWidths(prev => ({
        ...prev,
        [resizingCol]: Math.max(30, startWidth + diff) // Min width 30px
      }));
    };

    const handleMouseUp = () => {
      if (resizingCol) {
        setResizingCol(null);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    if (resizingCol) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, startX, startWidth]);

  const DEFAULT_TABLE_COLUMNS: { id: TableColumnId; visible: boolean }[] = [
    { id: 'wbsId', visible: true },
    { id: 'name', visible: true },
    { id: 'startDate', visible: true },
    { id: 'endDate', visible: true },
    { id: 'workEffort', visible: true },
    { id: 'assignee', visible: true },
    { id: 'status', visible: true },
    { id: 'progress', visible: true },
    { id: 'deliverables', visible: true },
  ];

  const tableColumns: { id: TableColumnId; visible: boolean }[] = useMemo(() => {
    const incoming = Array.isArray((wbsSettings as any)?.tableColumns) && (wbsSettings as any).tableColumns.length > 0
      ? (wbsSettings as any).tableColumns
      : DEFAULT_TABLE_COLUMNS;

    const allow = new Set(DEFAULT_TABLE_COLUMNS.map(c => c.id));
    const seen = new Set<string>();
    const cleaned = incoming
      .filter((c: any) => c && typeof c.id === 'string')
      .map((c: any) => ({ id: String(c.id) as TableColumnId, visible: c.visible !== false }))
      .filter((c: any) => allow.has(c.id))
      .filter((c: any) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    for (const d of DEFAULT_TABLE_COLUMNS) {
      if (!seen.has(d.id)) cleaned.push(d);
    }

    return cleaned.map(c => c.id === 'name' ? { ...c, visible: true } : c);
  }, [wbsSettings, DEFAULT_TABLE_COLUMNS]);

  const visibleColumnIds = useMemo(() => tableColumns.filter(c => c.visible).map(c => c.id), [tableColumns]);

  const gridStyle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${columnWidths.grip}px`);
    parts.push(`${columnWidths.checkbox}px`);
    parts.push(`${columnWidths.seq}px`);
    parts.push(`${columnWidths.expand}px`);
    for (const id of visibleColumnIds) {
      if (id === 'name') parts.push(`minmax(${columnWidths.name}px, 1fr)`);
      else parts.push(`${(columnWidths as any)[id]}px`);
    }
    parts.push(`${columnWidths.actions}px`);
    return { gridTemplateColumns: parts.join(' ') } as React.CSSProperties;
  }, [columnWidths, visibleColumnIds]);

  // Bulk Edit State
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkWorkEffort, setBulkWorkEffort] = useState('');
  const [bulkProgress, setBulkProgress] = useState('');

  // Row height (density) state
  const [rowHeight, setRowHeight] = useState<number>(34);

  const maxTreeLevel = useMemo(() => {
    if (tasks.length === 0) return 1;
    const taskMap = new Map<string, Task>(tasks.map(t => [t.id, t] as const));
    const memo = new Map<string, number>();
    const depth = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      const t = taskMap.get(id);
      if (!t || !t.parentId || !taskMap.has(t.parentId)) {
        memo.set(id, 0);
        return 0;
      }
      const d = depth(t.parentId) + 1;
      memo.set(id, d);
      return d;
    };
    let maxDepth = 0;
    for (const t of tasks) maxDepth = Math.max(maxDepth, depth(t.id));
    return Math.max(1, maxDepth + 1); // 1-based level
  }, [tasks]);

  useEffect(() => {
    // Keep selection within bounds if data changes.
    setTreeExpandLevel(prev => Math.min(Math.max(1, prev), Math.max(1, maxTreeLevel)));
  }, [maxTreeLevel, setTreeExpandLevel]);

  const handleSetRowHeight = (h: number) => {
    setRowHeight(h);
    onRowHeightChange?.(h);
  };

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskIds: string[] }>({
    isOpen: false,
    taskIds: [],
  });

  // WBS ID Generation map logic was moved to WBSContext

  const visibleTasks = useMemo(() => {
    const hasFilters = filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;

    let baseTasks = tasks;
    if (filters.projectId !== 'all') {
      baseTasks = baseTasks.filter(t => t.projectId === filters.projectId);
    }

    // Helper to compare values
    const compare = (a: Task, b: Task) => {
      if (!sortConfig) return 0;
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];

      if (valA === valB) return 0;

      // Handle nulls/undefined if any (though types say mandatory)
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const comparison = valA < valB ? -1 : 1;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    };

    if (hasFilters) {
      // Flat list for filtering
      return baseTasks.filter(task => {
        if (filters.status !== 'all' && task.status !== filters.status) return false;
        if (filters.assignee && !task.assignee.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
        if (filters.startDate && task.startDate < filters.startDate) return false;
        if (filters.endDate && task.endDate > filters.endDate) return false;
        return true;
      }).sort(compare).map(t => ({ ...t, depth: 0 }));
    } else {
      // Tree view for no filters (but respect sort for siblings)
      const buildTree = (parentId: string | null, depth: number): (Task & { depth: number })[] => {
        let children = baseTasks.filter(t => t.parentId === parentId);

        if (sortConfig) {
          children.sort(compare);
        }

        let result: (Task & { depth: number })[] = [];
        for (const child of children) {
          result.push({ ...child, depth });
          if (child.expanded) {
            result = result.concat(buildTree(child.id, depth + 1));
          }
        }
        return result;
      };

      return buildTree(null, 0);
    }
  }, [tasks, filters, sortConfig]);

  // Selection Logic
  const setSelection = (next: Set<string>) => {
    setSelectedTaskIds(next);
    setSharedSelectedTaskIds(Array.from(next));
  };

  const handleSelect = (taskId: string, multi: boolean, range: boolean) => {
    const newSelected = new Set<string>(multi ? selectedTaskIds : ([] as string[]));

    if (range && anchorTaskId) {
      const currentIndex = visibleTasks.findIndex(t => t.id === taskId);
      const anchorIndex = visibleTasks.findIndex(t => t.id === anchorTaskId);

      if (currentIndex !== -1 && anchorIndex !== -1) {
        const start = Math.min(currentIndex, anchorIndex);
        const end = Math.max(currentIndex, anchorIndex);

        for (let i = start; i <= end; i++) {
          newSelected.add(visibleTasks[i].id);
        }
      } else {
        newSelected.add(taskId);
      }
    } else {
      if (multi) {
        if (newSelected.has(taskId)) {
          newSelected.delete(taskId);
        } else {
          newSelected.add(taskId);
        }
      } else {
        newSelected.add(taskId);
      }
      setAnchorTaskId(taskId);
    }

    setSelection(newSelected);
    setLastSelectedId(taskId);
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.size === visibleTasks.length) {
      setSelection(new Set());
    } else {
      setSelection(new Set(visibleTasks.map(t => t.id)));
    }
  };

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      reorderTask(active.id as string, over.id as string);
    }
  };

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      // Ignore if editing a task (modal open) or typing in an input
      const target = e.target as HTMLElement;
      if (editingTask || deleteConfirm.isOpen || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (target.tagName === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        if (type !== 'checkbox' && type !== 'radio') return;
      }

      // Allow paste even when no row is selected (e.g. focus on empty space)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        // Paste copied tasks into current project (supports cross-project via localStorage clipboard)
        e.preventDefault();
        const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
        if (clipboard.length === 0) return;

        // Paste target: if a row is selected, insert after it; otherwise append to the end.
        const fallbackInsertAfterId = visibleTasks.length > 0 ? visibleTasks[visibleTasks.length - 1].id : undefined;
        const baseInsertAfterId: string | undefined = lastSelectedId ?? fallbackInsertAfterId;

        // If a row is selected, paste as siblings under its parent; otherwise paste as root items.
        const selectedTask = lastSelectedId ? tasks.find(t => t.id === lastSelectedId) : undefined;
        const pasteParentId: string | null = selectedTask?.parentId ?? null;

        // IMPORTANT:
        // addTask() generates a NEW id. If we precompute ids and set parentId/dependencies
        // with those fake ids, children become orphans and won't render.
        // So we build mapping from OLD -> ACTUAL NEW id returned from addTask().
        const clipboardIdSet = new Set(clipboard.map(t => t.id));
        const idToNewId = new Map<string, string>();

        let insertAfterId: string | undefined = baseInsertAfterId;
        const addedIds: string[] = [];

        // Add tasks ensuring parents are created before children.
        const pending = [...clipboard];
        let safety = 0;
        while (pending.length > 0 && safety < clipboard.length * 4) {
          const idx = pending.findIndex(t => !t.parentId || !clipboardIdSet.has(t.parentId) || idToNewId.has(t.parentId));
          const t = idx === -1 ? pending[0] : pending[idx];
          pending.splice(idx === -1 ? 0 : idx, 1);

          const isRootOfCopy = !(t.parentId && clipboardIdSet.has(t.parentId));
          const newParentId = isRootOfCopy
            ? pasteParentId
            : (idToNewId.get(t.parentId!) ?? pasteParentId);

          // Strip fields that shouldn't be copied as-is / computed fields.
          // We also postpone dependency remap until all ids exist.
          const { id: _id, projectId: _pid, depth: _depth, dependencies: _deps, ...rest } = t as any;
          const addedId = addTask(
            {
              ...rest,
              parentId: newParentId,
              expanded: true,
              dependencies: undefined,
            },
            isRootOfCopy ? insertAfterId : undefined
          );

          if (isRootOfCopy) insertAfterId = addedId;
          idToNewId.set(t.id, addedId);
          addedIds.push(addedId);
          safety += 1;
        }

        // Remap dependencies inside the copied set after all ids are known
        for (const t of clipboard) {
          const newId = idToNewId.get(t.id);
          if (!newId) continue;
          const mappedDeps = (t.dependencies ?? [])
            .filter(depId => clipboardIdSet.has(depId))
            .map(depId => idToNewId.get(depId))
            .filter(Boolean) as string[];
          if (mappedDeps.length > 0) {
            updateTask(newId, { dependencies: mappedDeps });
          }
        }

        // Select newly pasted tasks
        if (addedIds.length > 0) {
          setSelection(new Set(addedIds));
          setLastSelectedId(addedIds[addedIds.length - 1]);
        }
        return;
      }

      const effectiveSelectedIds =
        selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (sharedSelectedTaskIds || []);

      if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
        e.preventDefault();
        if (effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      if (!lastSelectedId) return;

      // Check if sorted or filtered - disable structural changes if so
      const isSortedOrFiltered = sortConfig !== null ||
        filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;

      const currentIndex = visibleTasks.findIndex(t => t.id === lastSelectedId);
      if (currentIndex === -1) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.altKey) {
          if (!isSortedOrFiltered && selectedTaskIds.size === 1) {
            moveTask(lastSelectedId, 'up');
          }
        } else {
          const prevTask = visibleTasks[currentIndex - 1];
          if (prevTask) {
            handleSelect(prevTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            document.getElementById(`task-row-${prevTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.altKey) {
          if (!isSortedOrFiltered && selectedTaskIds.size === 1) {
            moveTask(lastSelectedId, 'down');
          }
        } else {
          const nextTask = visibleTasks[currentIndex + 1];
          if (nextTask) {
            handleSelect(nextTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (!isSortedOrFiltered && selectedTaskIds.size > 0) {
          // Sort selected IDs by their actual visual order so indents process correctly top-to-bottom
          const orderedIds = visibleTasks.filter(t => selectedTaskIds.has(t.id)).map(t => t.id);
          if (e.shiftKey) {
            outdentTasks(orderedIds);
          } else {
            indentTasks(orderedIds);
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedTaskIds.size === 1) {
          const task = tasks.find(t => t.id === lastSelectedId);
          if (task) {
            setInsertTargetId(task.id);
            setInlineAddingTaskId(task.id);
            setQuickAddName(''); // reset input
          }
        }
      } else if (e.key === 'Insert') {
        e.preventDefault();
        if (selectedTaskIds.size === 1) {
          const task = tasks.find(t => t.id === lastSelectedId);
          if (task) {
            // Add a subtask
            const today = new Date().toISOString().split('T')[0];
            const newId = addTask({
              name: '새 하위 작업',
              startDate: today,
              endDate: today,
              progress: 0,
              workEffort: 0.5,
              assignee: '',
              status: 'todo',
              parentId: task.id
            }, task.id);

            // Expand the parent so the new task is visible
            if (!task.expanded) {
              updateTask(task.id, { expanded: true });
            }

            setSelection(new Set([newId]));
            setLastSelectedId(newId);
            setInlineEditingNameId(newId);
          }
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (selectedTaskIds.size === 1) {
          setInlineEditingNameId(lastSelectedId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Copy selected tasks preserving hierarchy
        e.preventDefault();
        if (selectedTaskIds.size > 0) {
          // Gather selected tasks in their visual order
          const selected = visibleTasks
            .filter(t => selectedTaskIds.has(t.id))
            .map((t) => {
              // Strip computed fields like depth
              const { depth: _depth, ...rest } = t as any;
              return rest as Task;
            });
          setCopiedTasks(selected);
          try {
            const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
            localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
          } catch {
            // ignore storage errors (private mode, quota, etc.)
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, selectedTaskIds, sharedSelectedTaskIds, lastSelectedId, visibleTasks, editingTask, deleteConfirm, moveTask, indentTask, outdentTask, indentTasks, outdentTasks, tasks, sortConfig, filters, copiedTasks, addTask]);

  const handleQuickAddCancel = () => {
    setInlineAddingTaskId(null);
    setInsertTargetId(null);
  };

  const handleInlineQuickAdd = (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    if (!quickAddName.trim()) return;

    const newId = addTask({
      name: quickAddName.trim(),
      parentId,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      progress: 0,
      workEffort: 0.5,
      assignee: '',
      status: 'todo'
    }, insertTargetId || undefined);

    setQuickAddName('');
    setInlineAddingTaskId(null);
    setInsertTargetId(null);

    // Select the newly added task so pressing Enter again adds below it
    setSelection(new Set([newId]));
    setLastSelectedId(newId);
  };

  const handleSave = (updates: any) => {
    if (editingTask) {
      if (editingTask.id === '') {
        // Creating a new subtask
        addTask({
          parentId: editingTask.parentId, // Default to initial parent
          ...updates, // Override with form data if present
        }, insertTargetId || undefined);
        setInsertTargetId(null);
      } else {
        // Updating existing task
        updateTask(editingTask.id, updates);
      }
      setEditingTask(null);
    }
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddName.trim()) return;

    const today = new Date().toISOString().split('T')[0];
    addTask({
      name: quickAddName,
      startDate: today,
      endDate: today,
      progress: 0,
      workEffort: 0.5,
      assignee: '',
      status: 'todo',
      parentId: null,
    });
    setQuickAddName('');
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => {
    e.preventDefault();
    if (!selectedTaskIds.has(taskId)) {
      handleSelect(taskId, false, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', taskId, columnId });
  };

  const handleSyncProgressFromStatus = () => {
    const idsToSync = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (contextMenu?.taskId ? [contextMenu.taskId] : []);
    const configs = wbsSettings.statusConfigs || [];
    idsToSync.forEach((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const config = configs.find((c: any) => c.id === task.status);
      if (config && config.progress !== undefined) {
        updateTask(id, { progress: config.progress });
      }
    });
    setContextMenu(null);
  };

  const handleHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'header' });
  };

  const handleDeleteClick = (taskId: string) => {
    setDeleteConfirm({ isOpen: true, taskIds: [taskId] });
  };

  const executeDelete = () => {
    // 1. Fully identify all task IDs to be deleted (including descendants)
    const deleteSet = new Set<string>();
    const getIdsToDelete = (parentId: string) => {
      deleteSet.add(parentId);
      tasks.filter(t => t.parentId === parentId).forEach(child => getIdsToDelete(child.id));
    };
    deleteConfirm.taskIds.forEach(id => getIdsToDelete(id));

    // 2. Determine the next selection before performing the delete
    const visibleIndices = visibleTasks
      .map((t, i) => deleteSet.has(t.id) ? i : -1)
      .filter(i => i !== -1);

    let nextSelectId: string | null = null;
    if (visibleIndices.length > 0) {
      const minIndex = Math.min(...visibleIndices);
      const maxIndex = Math.max(...visibleIndices);

      // Search forward for first non-deleted item
      for (let i = maxIndex + 1; i < visibleTasks.length; i++) {
        if (!deleteSet.has(visibleTasks[i].id)) {
          nextSelectId = visibleTasks[i].id;
          break;
        }
      }

      // If no task after, search backward
      if (!nextSelectId) {
        for (let i = minIndex - 1; i >= 0; i--) {
          if (!deleteSet.has(visibleTasks[i].id)) {
            nextSelectId = visibleTasks[i].id;
            break;
          }
        }
      }
    }

    // 3. Perform deletion
    deleteConfirm.taskIds.forEach(id => deleteTask(id));
    setDeleteConfirm({ isOpen: false, taskIds: [] });

    // 4. Update selection
    if (nextSelectId) {
      setSelection(new Set([nextSelectId]));
      setLastSelectedId(nextSelectId);
      setAnchorTaskId(nextSelectId);
    } else {
      setSelection(new Set());
      setLastSelectedId(null);
      setAnchorTaskId(null);
    }
  };

  const executeBulkEdit = () => {
    const updates: Partial<Task> = {};
    if (bulkStatus) {
      updates.status = bulkStatus;
      const config = wbsSettings.statusConfigs.find(c => c.id === bulkStatus);
      if (config && config.progress !== undefined) updates.progress = config.progress;
    }
    if (bulkAssignee.trim()) updates.assignee = bulkAssignee.trim();
    if (bulkWorkEffort !== '') {
      const val = parseFloat(bulkWorkEffort);
      if (!isNaN(val) && val >= 0) updates.workEffort = val;
    }
    if (bulkProgress !== '') {
      const val = parseInt(bulkProgress, 10);
      if (!isNaN(val) && val >= 0 && val <= 100) updates.progress = val;
    }
    if (Object.keys(updates).length === 0) return;
    Array.from(selectedTaskIds).forEach(id => updateTask(id, updates));
    setBulkStatus('');
    setBulkAssignee('');
    setBulkWorkEffort('');
    setBulkProgress('');
  };

  const executeBulkWorkEffort = () => {
    const value = parseFloat(bulkWorkEffort);
    if (isNaN(value) || value < 0) return;
    Array.from(selectedTaskIds).forEach(id => {
      updateTask(id, { workEffort: value });
    });
    setBulkWorkEffort('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkStatus = () => {
    if (!bulkStatus) return;
    Array.from(selectedTaskIds).forEach(id => {
      const updates: Partial<Task> = { status: bulkStatus };
      if (wbsSettings.statusProgress?.[bulkStatus] !== undefined) {
        updates.progress = wbsSettings.statusProgress[bulkStatus];
      }
      updateTask(id, updates);
    });
    setBulkStatus('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkAssignee = () => {
    const value = bulkAssignee.trim();
    if (!value) return;
    Array.from(selectedTaskIds).forEach(id => {
      updateTask(id, { assignee: value });
    });
    setBulkAssignee('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const SortIcon = ({ column }: { column: keyof Task }) => {
    if (sortConfig?.key !== column) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  // Aggregate stats from visibleTasks (or selectedTasks if selection active)
  const summaryStats = useMemo(() => {
    const source = selectedTaskIds.size > 0
      ? visibleTasks.filter(t => selectedTaskIds.has(t.id))
      : visibleTasks;

    if (source.length === 0) return null;

    const totalEffort = source.reduce((sum, t) => sum + (t.workEffort || 0), 0);
    const avgProgress = Math.round(source.reduce((sum, t) => sum + (t.progress || 0), 0) / source.length);
    const startDate = source.reduce((min, t) => t.startDate < min ? t.startDate : min, source[0].startDate);
    const endDate = source.reduce((max, t) => t.endDate > max ? t.endDate : max, source[0].endDate);
    const leafTasks = source.filter(t => !source.some(other => other.parentId === t.id));

    return { totalEffort, avgProgress, startDate, endDate, taskCount: source.length, leafCount: leafTasks.length, isSelection: selectedTaskIds.size > 0 };
  }, [visibleTasks, selectedTaskIds]);

  const formatSummaryDate = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
  };

  const isSplitView = !!syncScrollRef;
  const headerStyle = isSplitView ? { ...gridStyle, height: 60, minHeight: 60 } : gridStyle;

  const renderHeaderCell = (id: TableColumnId) => {
    const commonResize = (
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10"
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, id as any); }}
      />
    );

    switch (id) {
      case 'wbsId':
        return (
          <div key={id} className="col-header relative">
            ID
            {commonResize}
          </div>
        );
      case 'name':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('name')}
          >
            작업명 <SortIcon column="name" />
            {commonResize}
          </div>
        );
      case 'startDate':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('startDate')}
          >
            시작일 <SortIcon column="startDate" />
            {commonResize}
          </div>
        );
      case 'endDate':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('endDate')}
          >
            종료일 <SortIcon column="endDate" />
            {commonResize}
          </div>
        );
      case 'workEffort':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('workEffort')}
          >
            공수(d) <SortIcon column="workEffort" />
            {commonResize}
          </div>
        );
      case 'progress':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('progress')}
          >
            진척(%) <SortIcon column="progress" />
            {commonResize}
          </div>
        );
      case 'assignee':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('assignee')}
          >
            담당자 <SortIcon column="assignee" />
            {commonResize}
          </div>
        );
      case 'status':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('status')}
          >
            상태 <SortIcon column="status" />
            {commonResize}
          </div>
        );
      case 'deliverables':
        return (
          <div key={id} className="col-header relative">
            산출물
            {commonResize}
          </div>
        );
      default:
        return null;
    }
  };

  const content = (
    <>
      {/* === Summary Bar === */}
      {(isSplitView || summaryStats) && (
        <div className={cn(
          // split view에서는 높이를 고정해 간트와 행 시작 위치를 완전히 맞춤
          isSplitView
            ? "h-11 flex items-center gap-0 border-b px-4 text-xs bg-stone-50 flex-shrink-0 overflow-x-auto whitespace-nowrap"
            : "flex items-center gap-0 border-b px-4 py-2 text-xs bg-stone-50 flex-wrap flex-shrink-0",
          summaryStats?.isSelection ? "border-blue-200 bg-blue-50" : "border-[var(--color-line)]"
        )}>
          {summaryStats ? (
            <>
              {summaryStats.isSelection && (
                <span className="text-[10px] font-bold text-blue-500 mr-3 bg-blue-100 px-2 py-0.5 rounded-full">선택 {summaryStats.taskCount}개</span>
              )}
              <StatChip icon={<ListChecks size={12} />} label="작업" value={`${summaryStats.taskCount}개 (단말 ${summaryStats.leafCount}개)`} />
              <Divider />
              <StatChip icon={<Clock size={12} />} label="총 공수" value={`${summaryStats.totalEffort.toLocaleString()}일`} />
              <Divider />
              <StatChip icon={<TrendingUp size={12} />} label="평균 진척" value={`${summaryStats.avgProgress}%`} />
              <Divider />
              <StatChip icon={<CalendarDays size={12} />} label="기간" value={`${formatSummaryDate(summaryStats.startDate)} ~ ${formatSummaryDate(summaryStats.endDate)}`} />

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">레벨 펼치기</span>
                <select
                  className="h-7 rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={treeExpandLevel}
                  onChange={(e) => {
                    const lv = parseInt(e.target.value, 10);
                    setTreeExpandLevel(lv);
                    expandToLevel(lv);
                  }}
                  title="레벨 기준 펼치기"
                >
                  {Array.from({ length: Math.max(1, maxTreeLevel) }, (_, i) => i + 1).map(lv => (
                    <option key={lv} value={lv}>{lv}레벨</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            // split view에서만 높이 유지를 위한 빈 내용
            <div className="flex-1" />
          )}
        </div>
      )}
      <div className={cn("w-full pb-20", isSplitView && "flex-1 min-h-0 flex flex-col")} style={{ '--row-height': `${rowHeight}px`, '--cell-padding': `${Math.max(2, (rowHeight - 20) / 2)}px` } as React.CSSProperties}>
        {/* Split view: 헤더를 스크롤 밖에 두어 표·간트 행만 스크롤로 1:1 맞춤 */}
        {isSplitView && (
          <div className="data-header flex-shrink-0 border-b border-slate-200 bg-slate-50/80" style={headerStyle} onContextMenu={handleHeaderContextMenu}>
            <div className="col-header justify-center relative">
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'grip')} />
            </div>
            <div className="col-header justify-center relative">
              <input
                type="checkbox"
                className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                onChange={handleSelectAll}
              />
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'checkbox')} />
            </div>
            <div className="col-header justify-center relative" title="순번">
              #
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'seq')} />
            </div>
            <div className="col-header justify-center relative" title="펼침">
              <span className="text-stone-300">▾</span>
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'expand')} />
            </div>
            {visibleColumnIds.map(renderHeaderCell)}
            <div className="col-header justify-end relative">
              관리
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'actions')} />
            </div>
          </div>
        )}
        <div
          ref={syncScrollRef}
          className={cn("overflow-auto relative bg-[var(--color-bg)]", isSplitView ? "flex-1 min-h-0" : "flex-1")}
          onScroll={(e) => {
            // No-op here: App.tsx handles syncing from the other side if needed
          }}
        >
          <div className="min-w-fit w-full bg-white relative">
            {/* Non-split: 헤더는 스크롤 안에 (기존 동작) */}
            {!isSplitView && (
              <div className="data-header" style={gridStyle} onContextMenu={handleHeaderContextMenu}>
                <div className="col-header justify-center relative">
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'grip')} />
                </div>
                <div className="col-header justify-center relative">
                  <input
                    type="checkbox"
                    className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                    checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                    onChange={handleSelectAll}
                  />
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'checkbox')} />
                </div>
                <div className="col-header justify-center relative" title="순번">
                  #
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'seq')} />
                </div>
                <div className="col-header justify-center relative" title="펼침">
                  <span className="text-stone-300">▾</span>
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'expand')} />
                </div>
                {visibleColumnIds.map(renderHeaderCell)}
                <div className="col-header justify-end relative">
                  관리
                  <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'actions')} />
                </div>
              </div>
            )}

            {/* Rows */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleTasks.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleTasks.map((task, rowIndex) => (
                  <React.Fragment key={task.id}>
                    <SortableTaskRow
                      rowIndex={rowIndex}
                      task={task}
                      tasks={tasks}
                      wbsId={wbsMap.get(task.id)}
                      displayWbsId={displayWbsMap.get(task.id)}
                      isSelected={selectedTaskIds.has(task.id)}
                      filters={filters}
                      onSelect={handleSelect}
                      onEdit={setEditingTask}
                      onDeleteClick={handleDeleteClick}
                      onContextMenu={handleContextMenu}
                      toggleExpand={toggleExpand}
                      gridStyle={gridStyle}
                      visibleColumnIds={visibleColumnIds}
                      inlineEditingNameId={inlineEditingNameId}
                      setInlineEditingNameId={setInlineEditingNameId}
                      allAssignees={allAssignees}
                      updateTask={updateTask}
                      wbsSettings={wbsSettings}
                    />
                    {inlineAddingTaskId === task.id && (
                      <div className="data-row bg-blue-50/60 border-dashed" style={gridStyle}>
                        <div className="data-cell justify-center text-blue-400 font-bold text-[10px]">*</div>
                        <div className="data-cell justify-center"></div>
                        <div className="data-cell justify-center"></div>
                        <div className="data-cell justify-center text-blue-400">
                          <CornerDownRight size={14} />
                        </div>
                        {visibleColumnIds.map((colId) => {
                          if (colId === 'name') {
                            return (
                              <div
                                key={colId}
                                className="data-cell p-0"
                                style={{ paddingLeft: `${((task.parentId === null ? 0 : task.depth || 0) + 1) * 20 + 12}px` }}
                              >
                                <form onSubmit={(e) => handleInlineQuickAdd(e, task.parentId)} className="flex w-full h-full relative group/form">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={quickAddName}
                                    onChange={(e) => setQuickAddName(e.target.value)}
                                    onBlur={() => setInlineAddingTaskId(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setInlineAddingTaskId(null);
                                      e.stopPropagation();
                                    }}
                                    placeholder="작업명 입력 후 Enter..."
                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-blue-600 placeholder:text-blue-300 h-full py-2 px-2"
                                  />
                                  <button
                                    type="submit"
                                    disabled={!quickAddName.trim()}
                                    onMouseDown={(e) => e.preventDefault()}
                                    className="absolute right-0 top-0 bottom-0 text-[10px] font-bold text-white bg-blue-500 disabled:bg-blue-300 uppercase px-3 hover:bg-blue-600 transition-colors opacity-0 group-hover/form:opacity-100"
                                  >
                                    확인
                                  </button>
                                </form>
                              </div>
                            );
                          }
                          if (colId === 'wbsId') {
                            return <div key={colId} className="data-cell text-[10px] font-mono text-blue-400">신규</div>;
                          }
                          return <div key={colId} className="data-cell"></div>;
                        })}
                        <div className="data-cell"></div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </SortableContext>
            </DndContext>

            {/* Quick Add Row */}
            <div className="data-row bg-stone-50/50 border-dashed" style={gridStyle}>
              <div className="data-cell"></div>
              <div className="data-cell"></div>
              <div className="data-cell"></div>
              <div className="data-cell justify-center text-stone-400">
                <Plus size={14} />
              </div>
              {visibleColumnIds.map((colId) => {
                if (colId !== 'name') return <div key={colId} className="data-cell"></div>;
                return (
                  <div key={colId} className="data-cell p-0">
                    <form onSubmit={handleQuickAdd} className="flex w-full h-full">
                      <input
                        type="text"
                        value={quickAddName}
                        onChange={(e) => setQuickAddName(e.target.value)}
                        placeholder="새 작업 추가 (Enter 키 입력)..."
                        className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm placeholder:text-stone-400 h-full px-3"
                      />
                      <button
                        type="submit"
                        disabled={!quickAddName.trim()}
                        className="text-[10px] font-bold text-[var(--color-accent)] disabled:opacity-50 uppercase px-4 hover:bg-blue-50 transition-colors"
                      >
                        추가
                      </button>
                    </form>
                  </div>
                );
              })}
              <div className="data-cell"></div>
            </div>

            {visibleTasks.length === 0 && tasks.length === 0 && (
              <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
                등록된 작업이 없습니다. 새 작업을 추가해 보세요.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row Height Slider */}
      <div className="fixed bottom-6 right-4 z-40 flex items-center gap-2 bg-white border border-stone-200 shadow-lg rounded-full px-3 py-1.5 select-none opacity-60 hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-bold text-stone-400 whitespace-nowrap">줄간격</span>
        <input
          type="range"
          min={15}
          max={64}
          step={2}
          value={rowHeight}
          onChange={(e) => handleSetRowHeight(Number(e.target.value))}
          className="w-20 h-1.5 accent-stone-500 cursor-pointer"
          title={`줄간격: ${rowHeight}px`}
        />
        <span className="text-[10px] font-bold text-stone-500 w-7 text-right">{rowHeight}</span>
      </div>

      {/* Bulk Action Bar - 다중선택(2개 이상)일 경우에만 표시 */}
      {selectedTaskIds.size > 1 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white shadow-2xl border border-stone-200 rounded-2xl z-50 animate-in slide-in-from-bottom-4 fade-in duration-200 overflow-hidden min-w-max">
          {/* Header */}
          <div className="bg-blue-600 px-4 py-2 flex items-center justify-between gap-6">
            <span className="text-xs font-bold text-white tracking-wide">일괄 수정</span>
            <div className="flex items-center gap-2">
              <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {selectedTaskIds.size}개 선택됨
              </span>
              <button
                onClick={() => { setSelection(new Set()); setBulkStatus(''); setBulkAssignee(''); setBulkWorkEffort(''); setBulkProgress(''); }}
                className="text-white/60 hover:text-white transition-colors"
                title="선택 해제"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Fields + Actions */}
          <div className="px-4 py-3 flex items-end gap-3">
            {/* 상태 */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">상태</label>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className={cn(
                  "px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer",
                  bulkStatus ? "border-blue-400 text-blue-700 font-medium" : "border-stone-200 text-stone-500"
                )}
              >
                <option value="">변경 없음</option>
                {wbsSettings.statusConfigs.map(config => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">담당자</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="all-assignees"
                    value={bulkAssignee}
                    onChange={(e) => setBulkAssignee(e.target.value)}
                    placeholder="담당자 일괄 지정..."
                    className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') executeBulkAssignee();
                    }}
                  />
                  <datalist id="all-assignees">
                    {allAssignees.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            {/* 공수(d) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">공수(d)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={bulkWorkEffort}
                onChange={(e) => setBulkWorkEffort(e.target.value)}
                placeholder="공수(d) 일괄 지정..."
                className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-36"
              />
            </div>

            {/* 적용 버튼 - 상태, 담당자, 공수 등 입력된 모든 항목 일괄 적용 */}
            <button
              onClick={executeBulkEdit}
              disabled={!bulkStatus && !bulkAssignee.trim() && (bulkWorkEffort === '' || isNaN(parseFloat(bulkWorkEffort)))}
              className="self-end text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-5 py-1.5 rounded-lg transition-colors"
              title="입력한 항목 모두 적용"
            >
              적용
            </button>

            <div className="h-4 w-px bg-stone-200" />

            <button
              onClick={() => setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) })}
              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium"
              title="선택된 모든 작업 삭제"
            >
              <Trash2 size={14} />
              삭제
            </button>
            <button
              onClick={() => setSelection(new Set())}
              className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

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
          actions={
            contextMenu.type === 'header'
              ? [
                  {
                    label: '컬럼 설정',
                    icon: <Settings2 size={14} />,
                    onClick: () => onOpenColumnSettings?.(),
                  },
                ]
              : [
                  ...(contextMenu.columnId === 'progress' || contextMenu.columnId === 'status'
                    ? [
                        {
                          label: '갱신',
                          icon: <RefreshCw size={14} />,
                          onClick: handleSyncProgressFromStatus,
                        },
                      ]
                    : []),
                  {
                    label: '수정',
                    icon: <Edit2 size={14} />,
                    onClick: () => {
                      const task = tasks.find(t => t.id === contextMenu.taskId);
                      if (task) setEditingTask(task);
                    }
                  },
                  {
                    label: '하위 작업 추가',
                    icon: <CornerDownRight size={14} />,
                    onClick: () => {
                      const parent = tasks.find(t => t.id === contextMenu.taskId);
                      if (parent) {
                        const today = new Date().toISOString().split('T')[0];
                        setEditingTask({
                          id: '', // New task marker
                          parentId: parent.id,
                          name: '',
                          startDate: today,
                          endDate: today,
                          progress: 0,
                          assignee: '',
                          status: 'todo'
                        } as Task);
                      }
                    }
                  },
                  {
                    label: `삭제 ${selectedTaskIds.size > 1 ? `(${selectedTaskIds.size})` : ''}`,
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: () => {
                      if (selectedTaskIds.size > 1 && contextMenu.taskId && selectedTaskIds.has(contextMenu.taskId)) {
                        setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) });
                      } else if (contextMenu.taskId) {
                        handleDeleteClick(contextMenu.taskId);
                      }
                    }
                  },
                  {
                    label: '컬럼 설정',
                    icon: <Settings2 size={14} />,
                    onClick: () => onOpenColumnSettings?.(),
                  },
                ]
          }
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ ...deleteConfirm, isOpen: false })}
        onConfirm={executeDelete}
        title={deleteConfirm.taskIds.length > 1 ? `${deleteConfirm.taskIds.length}개 작업 삭제` : '작업 삭제'}
        message={deleteConfirm.taskIds.length > 1 ? '선택한 작업들을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.' : '이 작업을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.'}
        confirmLabel="삭제"
        isDanger={true}
      />
    </>
  );
  return isSplitView ? <div className="h-full flex flex-col">{content}</div> : content;
}

interface SortableTaskRowProps {
  key?: string | number;
  rowIndex: number;
  task: Task & { depth?: number };
  tasks: Task[];
  wbsId?: string;
  displayWbsId?: string;
  isSelected: boolean;
  filters: FilterState;
  onSelect: (taskId: string, multi: boolean, range: boolean) => void;
  onEdit: (task: Task) => void;
  onDeleteClick: (taskId: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void;
  toggleExpand: (taskId: string) => void;
  gridStyle: React.CSSProperties;
  visibleColumnIds: TableColumnId[];
  inlineEditingNameId: string | null;
  setInlineEditingNameId: (id: string | null) => void;
  allAssignees: string[];
  updateTask: (id: string, updates: Partial<Task>) => void;
  wbsSettings: any;
}

function SortableTaskRow({
  rowIndex,
  task,
  tasks,
  wbsId,
  displayWbsId,
  isSelected,
  filters,
  onSelect,
  onEdit,
  onDeleteClick,
  onContextMenu,
  toggleExpand,
  gridStyle,
  visibleColumnIds,
  inlineEditingNameId,
  setInlineEditingNameId,
  allAssignees,
  updateTask,
  wbsSettings
}: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const depth = task.depth || 0;
  const level = depth + 1;
  const lvStyle = getLevelStyle(level);

  const zebraOverlay = rowIndex % 2 === 1 ? 'rgba(2, 6, 23, 0.03)' : 'transparent';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isSelected ? '#eff6ff' : lvStyle.rowBg,
    backgroundImage: isSelected ? undefined : `linear-gradient(${zebraOverlay}, ${zebraOverlay})`,
    zIndex: isDragging ? 10 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      className={cn(
        "data-row group cursor-pointer outline-none transition-colors",
        isSelected ? "bg-blue-50 font-medium text-blue-900" : "hover:brightness-[0.98]"
      )}
      onClick={(e) => onSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey)}
      tabIndex={0}
      onDoubleClick={() => onEdit(task)}
      onContextMenu={(e) => onContextMenu(e, task.id, undefined)}
    >
      <div
        className="data-cell justify-center cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </div>
      <div className="data-cell justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
          checked={isSelected}
          onChange={() => onSelect(task.id, true, false)}
        />
      </div>
      <div className="data-cell justify-center font-mono text-[10px] text-stone-500 tabular-nums">
        {rowIndex + 1}
      </div>
      <div className="data-cell justify-center">
        {!(filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate) && tasks.some((t) => t.parentId === task.id) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(task.id);
            }}
            className="hover:bg-stone-200 rounded p-0.5 text-stone-500 transition-colors"
            title={task.expanded ? "접기" : "펼치기"}
          >
            {task.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {visibleColumnIds.map((colId) => {
        if (colId === 'wbsId') {
          return (
            <div key={colId} className="data-cell font-mono text-[10px] text-stone-400">
              {wbsId}
            </div>
          );
        }
        if (colId === 'name') {
          return (
            <div key={colId} className="data-cell" style={{ paddingLeft: `${depth * 20 + 12}px` }}>
              {inlineEditingNameId === task.id ? (
                <input
                  autoFocus
                  defaultValue={task.name}
                  className="w-full text-sm font-bold bg-white text-blue-600 outline-none ring-1 ring-blue-500 rounded px-1"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== task.name) {
                      updateTask(task.id, { name: e.target.value.trim() });
                    }
                    setInlineEditingNameId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setInlineEditingNameId(null);
                    }
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span
                  className="font-medium text-[var(--color-ink)] truncate cursor-text"
                  onDoubleClick={() => setInlineEditingNameId(task.id)}
                  title="더블 클릭 또는 F2를 눌러 이름 수정"
                >
                  {displayWbsId ? `${displayWbsId} ` : ''}{task.name}
                </span>
              )}
            </div>
          );
        }
        if (colId === 'startDate') {
          return <div key={colId} className="data-cell font-mono text-xs text-stone-600">{formatDate(task.startDate)}</div>;
        }
        if (colId === 'endDate') {
          return <div key={colId} className="data-cell font-mono text-xs text-stone-600">{formatDate(task.endDate)}</div>;
        }
        if (colId === 'workEffort') {
          return <div key={colId} className="data-cell font-mono text-xs text-stone-600">{task.workEffort ? task.workEffort.toFixed(1) : '-'}</div>;
        }
        if (colId === 'progress') {
          return (
            <div
              key={colId}
              className="data-cell font-mono text-xs text-stone-600"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'progress');
              }}
              title="마우스 우클릭: 갱신 메뉴 (상태에 해당하는 진척 비율로 동기화)"
            >
              {typeof task.progress === 'number' ? `${task.progress}%` : '-'}
            </div>
          );
        }
        if (colId === 'assignee') {
          return (
            <div key={colId} className="data-cell text-xs text-stone-600 relative overflow-visible group/assignee" onClick={(e) => e.stopPropagation()}>
              <select
                value={task.assignee || ''}
                onChange={(e) => {
                  if (e.target.value !== task.assignee) {
                    updateTask(task.id, { assignee: e.target.value });
                  }
                }}
                className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 cursor-pointer truncate transition-colors appearance-none"
              >
                <option value="">배정 안됨</option>
                {allAssignees.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center px-1 text-stone-400 group-hover/assignee:text-stone-600">
                <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>
          );
        }
        if (colId === 'status') {
          return (
            <div key={colId} className="data-cell" onClick={(e) => e.stopPropagation()}>
              <select
                value={task.status}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  if (newStatus !== task.status) {
                    const config = wbsSettings.statusConfigs.find((c: any) => c.id === newStatus);
                    const updates: Partial<Task> = { status: newStatus };
                    if (config && config.progress !== undefined) {
                      updates.progress = config.progress;
                    }
                    updateTask(task.id, updates);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, task.id, 'status');
                }}
                className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 cursor-pointer truncate transition-colors appearance-none text-xs"
              >
                {wbsSettings.statusConfigs.map((config: any) => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </div>
          );
        }
        if (colId === 'deliverables') {
          return (
            <div key={colId} className="data-cell text-xs text-stone-600 truncate" title={task.deliverables || ''}>
              {task.deliverables || '-'}
            </div>
          );
        }
        return null;
      })}
      <div className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
          title="작업 수정"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(task.id);
          }}
          className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
          title="삭제"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  const { wbsSettings } = useWBS();
  const badgeClass = {
    todo: 'badge-todo',
    'in-progress': 'badge-progress',
    done: 'badge-done',
    blocked: 'badge-blocked',
  }[status];

  return (
    <span className={cn('badge', badgeClass)}>
      {wbsSettings.statusNames[status]}
    </span>
  );
}
