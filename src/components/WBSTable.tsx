import React, { useState, useMemo, useEffect } from 'react';
import { useWBS } from '../context/WBSContext';
import { cn, formatDate } from '../lib/utils';
import { ChevronRight, ChevronDown, Plus, Trash2, Edit2, ArrowUpDown, ArrowUp, ArrowDown, X, MoreHorizontal, CornerDownRight, GripVertical } from 'lucide-react';
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

interface WBSTableProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task) => void;
}

export function WBSTable({ filters, sortConfig, onSort }: WBSTableProps) {
  const { tasks, toggleExpand, deleteTask, updateTask, addTask, moveTask, indentTask, outdentTask, reorderTask, wbsSettings, wbsMap, displayWbsMap } = useWBS();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [anchorTaskId, setAnchorTaskId] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);

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
    expand: 40,
    wbsId: 60,
    name: 300,
    startDate: 85,
    endDate: 85,
    workEffort: 50,
    assignee: 70,
    status: 70,
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

  const gridStyle = {
    gridTemplateColumns: `${columnWidths.grip}px ${columnWidths.checkbox}px ${columnWidths.expand}px ${columnWidths.wbsId}px minmax(${columnWidths.name}px, 1fr) ${columnWidths.startDate}px ${columnWidths.endDate}px ${columnWidths.workEffort}px ${columnWidths.assignee}px ${columnWidths.status}px ${columnWidths.deliverables}px ${columnWidths.actions}px`
  };

  // Bulk Edit State
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkWorkEffort, setBulkWorkEffort] = useState('');
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskIds: string[] }>({
    isOpen: false,
    taskIds: [],
  });

  // WBS ID Generation map logic was moved to WBSContext

  const visibleTasks = useMemo(() => {
    const hasFilters = filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;

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
      return tasks.filter(task => {
        if (filters.status !== 'all' && task.status !== filters.status) return false;
        if (filters.assignee && !task.assignee.toLowerCase().includes(filters.assignee.toLowerCase())) return false;
        if (filters.startDate && task.startDate < filters.startDate) return false;
        if (filters.endDate && task.endDate > filters.endDate) return false;
        return true;
      }).sort(compare).map(t => ({ ...t, depth: 0 }));
    } else {
      // Tree view for no filters (but respect sort for siblings)
      const buildTree = (parentId: string | null, depth: number): (Task & { depth: number })[] => {
        let children = tasks.filter(t => t.parentId === parentId);

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
  const handleSelect = (taskId: string, multi: boolean, range: boolean) => {
    const newSelected = new Set(multi ? selectedTaskIds : []);

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

    setSelectedTaskIds(newSelected);
    setLastSelectedId(taskId);
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.size === visibleTasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(visibleTasks.map(t => t.id)));
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
      // Ignore if editing a task (modal open) or typing in an input
      const target = e.target as HTMLElement;
      if (editingTask || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (target.tagName === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        if (type !== 'checkbox' && type !== 'radio') return;
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
          const orderedSelectedTasks = visibleTasks.filter(t => selectedTaskIds.has(t.id));
          orderedSelectedTasks.forEach(t => {
            if (e.shiftKey) {
              outdentTask(t.id);
            } else {
              indentTask(t.id);
            }
          });
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedTaskIds.size > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) });
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
              assignee: '',
              status: 'todo',
              parentId: task.id
            }, task.id);

            // Expand the parent so the new task is visible
            if (!task.expanded) {
              updateTask(task.id, { expanded: true });
            }

            setSelectedTaskIds(new Set([newId]));
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTaskIds, lastSelectedId, visibleTasks, editingTask, moveTask, indentTask, outdentTask, tasks, sortConfig, filters]);

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
      assignee: '',
      status: 'todo'
    }, insertTargetId || undefined);

    setQuickAddName('');
    setInlineAddingTaskId(null);
    setInsertTargetId(null);

    // Select the newly added task so pressing Enter again adds below it
    setSelectedTaskIds(new Set([newId]));
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
      assignee: '',
      status: 'todo',
      parentId: null,
    });
    setQuickAddName('');
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    if (!selectedTaskIds.has(taskId)) {
      handleSelect(taskId, false, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  const handleDeleteClick = (taskId: string) => {
    setDeleteConfirm({ isOpen: true, taskIds: [taskId] });
  };

  const executeDelete = () => {
    deleteConfirm.taskIds.forEach(id => deleteTask(id));
    setDeleteConfirm({ isOpen: false, taskIds: [] });
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  };

  const executeBulkEdit = () => {
    const updates: Partial<Task> = {};
    if (bulkStatus) updates.status = bulkStatus;
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
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  };

  const executeBulkStatus = () => {
    if (!bulkStatus) return;
    Array.from(selectedTaskIds).forEach(id => {
      updateTask(id, { status: bulkStatus });
    });
    setBulkStatus('');
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  };

  const executeBulkWorkEffort = () => {
    const value = parseFloat(bulkWorkEffort);
    if (isNaN(value) || value < 0) return;
    Array.from(selectedTaskIds).forEach(id => {
      updateTask(id, { workEffort: value });
    });
    setBulkWorkEffort('');
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  };

  const executeBulkStatus = () => {
    if (!bulkStatus) return;
    Array.from(selectedTaskIds).forEach(id => {
      updateTask(id, { status: bulkStatus });
    });
    setBulkStatus('');
    setSelectedTaskIds(new Set());
    setLastSelectedId(null);
  };

  const SortIcon = ({ column }: { column: keyof Task }) => {
    if (sortConfig?.key !== column) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  return (
    <>
      <div className="w-full pb-20">
        <div className="flex-1 overflow-auto relative bg-[var(--color-bg)]">
          <div className="min-w-fit w-full bg-white relative">
            {/* Header */}
            <div className="data-header" style={gridStyle}>
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
              <div className="col-header justify-center relative">
                #
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'expand')} />
              </div>
              <div className="col-header relative">
                ID
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'wbsId')} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('name')}
              >
                작업명 <SortIcon column="name" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'name'); }} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('startDate')}
              >
                시작일 <SortIcon column="startDate" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'startDate'); }} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('endDate')}
              >
                종료일 <SortIcon column="endDate" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'endDate'); }} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('workEffort')}
              >
                공수 <SortIcon column="workEffort" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'workEffort'); }} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('assignee')}
              >
                담당자 <SortIcon column="assignee" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'assignee'); }} />
              </div>

              <div
                className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
                onClick={() => onSort('status')}
              >
                상태 <SortIcon column="status" />
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'status'); }} />
              </div>

              <div className="col-header relative">
                산출물
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'deliverables')} />
              </div>

              <div className="col-header justify-end relative">
                관리
                <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 z-10" onMouseDown={(e) => handleMouseDown(e, 'actions')} />
              </div>
            </div>

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
                {visibleTasks.map((task) => (
                  <React.Fragment key={task.id}>
                    <SortableTaskRow
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
                      inlineEditingNameId={inlineEditingNameId}
                      setInlineEditingNameId={setInlineEditingNameId}
                      allAssignees={allAssignees}
                      updateTask={updateTask}
                    />
                    {inlineAddingTaskId === task.id && (
                      <div className="data-row bg-blue-50/60 border-dashed" style={gridStyle}>
                        <div className="data-cell justify-center text-blue-400 font-bold text-[10px]">*</div>
                        <div className="data-cell justify-center"></div>
                        <div className="data-cell justify-center text-blue-400">
                          <CornerDownRight size={14} />
                        </div>
                        <div className="data-cell text-[10px] font-mono text-blue-400">신규</div>
                        <div className="data-cell p-0" style={{ paddingLeft: `${((task.parentId === null ? 0 : task.depth || 0) + 1) * 20 + 12}px` }}>
                          <form onSubmit={(e) => handleInlineQuickAdd(e, task.parentId)} className="flex w-full h-full relative group/form">
                            <input
                              autoFocus
                              type="text"
                              value={quickAddName}
                              onChange={(e) => setQuickAddName(e.target.value)}
                              onBlur={() => setInlineAddingTaskId(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setInlineAddingTaskId(null);
                                e.stopPropagation(); // prevent triggering other global hotkeys
                              }}
                              placeholder="작업명 입력 후 Enter..."
                              className="w-[90%] bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-blue-600 placeholder:text-blue-300 h-full py-2"
                            />
                            <button
                              type="submit"
                              disabled={!quickAddName.trim()}
                              onMouseDown={(e) => e.preventDefault()} // Prevents blur before submit
                              className="absolute right-0 top-0 bottom-0 text-[10px] font-bold text-white bg-blue-500 disabled:bg-blue-300 uppercase px-3 hover:bg-blue-600 transition-colors opacity-0 group-hover/form:opacity-100"
                            >
                              확인
                            </button>
                          </form>
                        </div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
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
              <div className="data-cell justify-center text-stone-400">
                <Plus size={14} />
              </div>
              <div className="data-cell"></div>
              <div className="data-cell p-0" style={{ gridColumn: 'span 7' }}>
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
            </div>

            {visibleTasks.length === 0 && tasks.length === 0 && (
              <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
                등록된 작업이 없습니다. 새 작업을 추가해 보세요.
              </div>
            )}
          </div>
        </div>
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
                onClick={() => { setSelectedTaskIds(new Set()); setBulkStatus(''); setBulkAssignee(''); setBulkWorkEffort(''); setBulkProgress(''); }}
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
                onChange={(e) => setBulkStatus(e.target.value as TaskStatus | '')}
                className={cn(
                  "px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer",
                  bulkStatus ? "border-blue-400 text-blue-700 font-medium" : "border-stone-200 text-stone-500"
                )}
              >
                <option value="">변경 없음</option>
                <option value="todo">할 일</option>
                <option value="in-progress">진행 중</option>
                <option value="done">완료</option>
                <option value="blocked">지연됨</option>
              </select>
            </div>

          <div className="flex items-center gap-2 mr-2">
            <input
              type="number"
              min="0"
              step="0.5"
              value={bulkWorkEffort}
              onChange={(e) => setBulkWorkEffort(e.target.value)}
              placeholder="공수(일) 일괄 지정..."
              className="px-3 py-1.5 text-sm border border-stone-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') executeBulkWorkEffort();
              }}
            />
            <button
              onClick={executeBulkWorkEffort}
              disabled={bulkWorkEffort === '' || isNaN(parseFloat(bulkWorkEffort))}
              className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 px-3 py-1.5 rounded-full transition-colors"
            >
              적용
            </button>
          </div>

          <div className="h-4 w-px bg-stone-200" />

          <div className="flex items-center gap-2 mr-2">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as TaskStatus | '')}
              className="px-3 py-1.5 text-sm border border-stone-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">상태 일괄 변경...</option>
              <option value="todo">할 일</option>
              <option value="in-progress">진행 중</option>
              <option value="done">완료</option>
              <option value="blocked">차단됨</option>
            </select>
            <button
              onClick={executeBulkStatus}
              disabled={!bulkStatus}
              className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 px-3 py-1.5 rounded-full transition-colors"
            >
              적용
            </button>
          </div>

          <div className="h-4 w-px bg-stone-200" />

          <div className="flex items-center gap-2 mr-2">
            <input
              type="number"
              min="0"
              step="0.5"
              value={bulkWorkEffort}
              onChange={(e) => setBulkWorkEffort(e.target.value)}
              placeholder="공수(일) 일괄 지정..."
              className="px-3 py-1.5 text-sm border border-stone-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') executeBulkWorkEffort();
              }}
            />
            <button
              onClick={executeBulkWorkEffort}
              disabled={bulkWorkEffort === '' || isNaN(parseFloat(bulkWorkEffort))}
              className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 px-3 py-1.5 rounded-full transition-colors"
            >
              적용
            </button>
          </div>

          <div className="h-4 w-px bg-stone-200" />

          <div className="flex items-center gap-2 mr-2">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as TaskStatus | '')}
              className="px-3 py-1.5 text-sm border border-stone-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">상태 일괄 변경...</option>
              <option value="todo">할 일</option>
              <option value="in-progress">진행 중</option>
              <option value="done">완료</option>
              <option value="blocked">차단됨</option>
            </select>
            <button
              onClick={executeBulkStatus}
              disabled={!bulkStatus}
              className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 px-3 py-1.5 rounded-full transition-colors"
            >
              적용
            </button>
          </div>

          <div className="h-4 w-px bg-stone-200" />

          <button
            onClick={() => setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) })}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium"
          >
            <Trash2 size={14} />
            삭제
          </button>
          <button
            onClick={() => setSelectedTaskIds(new Set())}
            className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
          >
            <X size={14} />
          </button>
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
                if (selectedTaskIds.size > 1 && selectedTaskIds.has(contextMenu.taskId)) {
                  setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) });
                } else {
                  handleDeleteClick(contextMenu.taskId);
                }
              }
            }
          ]}
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
}

interface SortableTaskRowProps {
  key?: string | number;
  task: Task & { depth?: number };
  tasks: Task[];
  wbsId?: string;
  displayWbsId?: string;
  isSelected: boolean;
  filters: FilterState;
  onSelect: (taskId: string, multi: boolean, range: boolean) => void;
  onEdit: (task: Task) => void;
  onDeleteClick: (taskId: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
  toggleExpand: (taskId: string) => void;
  gridStyle: React.CSSProperties;
  inlineEditingNameId: string | null;
  setInlineEditingNameId: (id: string | null) => void;
  allAssignees: string[];
  updateTask: (id: string, updates: Partial<Task>) => void;
}

function SortableTaskRow({
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
  inlineEditingNameId,
  setInlineEditingNameId,
  allAssignees,
  updateTask
}: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isSelected ? '#eff6ff' : undefined,
    borderLeft: isSelected ? '4px solid #2563EB' : '4px solid transparent',
    zIndex: isDragging ? 10 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  const depth = task.depth || 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      className={cn(
        "data-row group cursor-pointer outline-none transition-colors",
        isSelected ? "bg-blue-50 font-medium text-blue-900" : "hover:bg-stone-50"
      )}
      onClick={(e) => onSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey)}
      tabIndex={0}
      onDoubleClick={() => onEdit(task)}
      onContextMenu={(e) => onContextMenu(e, task.id)}
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
      <div className="data-cell justify-center">
        {!(filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate) && tasks.some((t) => t.parentId === task.id) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(task.id);
            }}
            className="hover:bg-stone-200 rounded p-0.5 text-stone-500 transition-colors"
          >
            {task.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      <div className="data-cell font-mono text-[10px] text-stone-400">
        {wbsId}
      </div>
      <div className="data-cell" style={{ paddingLeft: `${depth * 20 + 12}px` }}>
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
      <div className="data-cell font-mono text-xs text-stone-600">{formatDate(task.startDate)}</div>
      <div className="data-cell font-mono text-xs text-stone-600">{formatDate(task.endDate)}</div>
      <div className="data-cell font-mono text-xs text-stone-600">{task.workEffort ? task.workEffort.toFixed(1) : '-'}</div>
      <div className="data-cell text-xs text-stone-600 relative overflow-visible group/assignee" onClick={(e) => e.stopPropagation()}>
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
      <div className="data-cell">
        <StatusBadge status={task.status} />
      </div>
      <div className="data-cell text-xs text-stone-600 truncate" title={task.deliverables || ''}>
        {task.deliverables || '-'}
      </div>
      <div className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
          title="Edit"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(task.id);
          }}
          className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Task['status'] }) {
  const badgeClass = {
    todo: 'badge-todo',
    'in-progress': 'badge-progress',
    done: 'badge-done',
    blocked: 'badge-blocked',
  }[status];

  const labels = {
    todo: '할 일',
    'in-progress': '진행 중',
    done: '완료',
    blocked: '지연됨',
  };

  return (
    <span className={cn('badge', badgeClass)}>
      {labels[status]}
    </span>
  );
}
