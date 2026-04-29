import { useEffect, type RefObject } from 'react';
import type { Task, TaskStatus, FilterState, SortConfig, Project } from '../../types';
import type { TableColumnId } from '../wbsTableTypes';
import type { TaskWithDepth } from '../../lib/taskView';
import { isComposingKeyEvent } from '../../lib/ime';

/** Clipboard payload shape (defined in WBSTable, passed in as type parameter) */
type ClipboardPayloadV1 = { version: 1; copiedAt: string; tasks: Task[] };

export interface WbsTableKeyboardDeps {
  // State values
  hotkeysEnabled: boolean;
  excelView: boolean;
  selectedTaskIds: Set<string>;
  sharedSelectedTaskIds: string[] | null;
  lastSelectedId: string | null;
  visibleTasks: TaskWithDepth[];
  editingTask: Task | null;
  editingCell: { taskId: string; columnId: TableColumnId } | null;
  inlineEditingNameId: string | null;
  tableEditMode: boolean;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  editableColumnIds: TableColumnId[];
  deleteConfirm: { isOpen: boolean; taskIds: string[] };
  copiedTasks: Task[];
  tasks: Task[];
  sortConfig: SortConfig | null;
  filters: FilterState;
  rowHeight: number;
  currentProjectId: string;
  projects: Project[];
  canEditCurrentProject: boolean;
  inlineAddingTaskId: string | null;

  // State setters
  setLastSelectedId: (id: string | null) => void;
  setTableEditMode: (v: boolean) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setInlineEditingNameId: (id: string | null) => void;
  setEditingCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setSelection: (next: Set<string>) => void;
  setBulkStatus: (v: TaskStatus | '') => void;
  setBulkAssignee: (v: string) => void;
  setBulkWorkEffort: (v: string) => void;
  setBulkProgress: (v: string) => void;
  setDeleteConfirm: (v: { isOpen: boolean; taskIds: string[] }) => void;
  setCopiedTasks: (tasks: Task[]) => void;

  // Actions
  addTask: (task: Partial<Task>, insertAfterId?: string) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  moveTask: (id: string, direction: 'up' | 'down') => void;
  indentTask: (id: string) => void;
  outdentTask: (id: string) => void;
  indentTasks: (ids: string[]) => void;
  outdentTasks: (ids: string[]) => void;
  toggleExpand: (id: string) => void;
  handleSetRowHeight: (h: number) => void;
  handleSelectAll: () => void;
  handleSelect: (taskId: string, multi: boolean, range: boolean) => void;
  pushToast: (msg: string, opts?: { variant?: string }) => void;
  loadClipboardTasks: () => Task[];

  // Refs
  tableScrollRef: RefObject<HTMLDivElement | null>;

  // Constants
  CLIPBOARD_KEY: string;
}

export function useWbsTableKeyboard(deps: WbsTableKeyboardDeps) {
  const {
    hotkeysEnabled,
    excelView,
    selectedTaskIds,
    sharedSelectedTaskIds,
    lastSelectedId,
    visibleTasks,
    editingTask,
    editingCell,
    inlineEditingNameId,
    tableEditMode,
    focusedCell,
    editableColumnIds,
    deleteConfirm,
    copiedTasks,
    tasks,
    sortConfig,
    filters,
    rowHeight,
    currentProjectId,
    projects,
    canEditCurrentProject,
    inlineAddingTaskId,
    setLastSelectedId,
    setTableEditMode,
    setFocusedCell,
    setInlineEditingNameId,
    setEditingCell,
    setSelection,
    setBulkStatus,
    setBulkAssignee,
    setBulkWorkEffort,
    setBulkProgress,
    setDeleteConfirm,
    setCopiedTasks,
    addTask,
    updateTask,
    moveTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    toggleExpand,
    handleSetRowHeight,
    handleSelectAll,
    handleSelect,
    pushToast,
    loadClipboardTasks,
    tableScrollRef,
    CLIPBOARD_KEY,
  } = deps;

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      if (isComposingKeyEvent(e)) return;
      const target = e.target as HTMLElement;
      if (editingTask || deleteConfirm.isOpen) return;
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // 엑셀 뷰(ag-grid)에서는 기본 키보드 동작(Tab/Enter/Insert 등)을 그대로 사용하도록
      // 전역 단축키를 비활성화한다.
      if (excelView) {
        const inAgGrid = (target as HTMLElement).closest?.('.ag-root');
        if (inAgGrid) return;
      }

      const inWbsTable = (target as HTMLElement).closest?.('[data-wbs-table]');
      const inQuickAdd = (target as HTMLElement).closest?.('[data-quick-add]');

      // 새 작업 입력칸(하단/인라인)에서는 Enter가 폼 submit 되도록 전역 단축키 미동작
      if (inQuickAdd) return;
      // 표 밖의 일반 입력/셀렉트 포커스 중에는 단축키 미동작
      if (!inWbsTable && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

      // 셀/작업명 편집 중 Enter: 값 커밋(blur) 후
      // - 현재 행 바로 아래에 같은 레벨(형제) 새 작업을 추가하고 그 작업으로 계속 편집.
      // - (의존성 입력칸 등 자체 Enter 처리가 있는 input은 여기로 오기 전에 stopPropagation 되거나,
      //    아래의 target.closest 체크에서 제외되도록 설계되어 있음)
      if (e.key === 'Enter' && (editingCell || inlineEditingNameId) && inWbsTable) {
        e.preventDefault();
        const currentTaskId = editingCell?.taskId ?? inlineEditingNameId!;
        const columnId: TableColumnId = editingCell?.columnId ?? 'name';
        const currentIndex = visibleTasks.findIndex((t) => t.id === currentTaskId);

        // 1) 먼저 blur로 현재 입력을 커밋 (onBlur에서 updateTask 수행)
        (document.activeElement as HTMLElement | null)?.blur?.();

        // 2) 새 작업으로 이동
        const moveToTaskId = (nextId: string) => {
          setLastSelectedId(nextId);
          setTableEditMode(true);
          setFocusedCell({ taskId: nextId, columnId });
          if (columnId === 'name') {
            setInlineEditingNameId(nextId);
            setEditingCell(null);
          } else {
            setEditingCell({ taskId: nextId, columnId });
            setInlineEditingNameId(null);
          }
          document.getElementById(`task-row-${nextId}`)?.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            document.getElementById(`wbs-edit-${nextId}-${columnId}`)?.focus();
          });
        };

        window.setTimeout(() => {
          // 현재 행 아래에 같은 레벨(형제) 새 작업 추가
          const base = tasks.find((t) => t.id === currentTaskId);
          const pid = base?.projectId || currentProjectId;
          const proj = projects.find((p) => p.id === pid);
          const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
          const newId = addTask(
            {
              name: '',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: base?.parentId ?? null,
              expanded: true,
            },
            currentTaskId,
          );
          moveToTaskId(newId);
        }, 0);
        return;
      }

      // 셀/작업명 편집 중 화살표: 인접 셀(행/열)로 이동 후 계속 편집
      // number 타입 input에서는 화살표 키를 값 증감에만 사용하고 셀 이동하지 않는다
      // (빠르게 누를 경우 blur → row 포커스 → 행 더블클릭 오작동 방지)
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        (editingCell || inlineEditingNameId) &&
        target.closest('[data-wbs-table]')
      ) {
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') return;
        const currentTaskId = editingCell?.taskId ?? inlineEditingNameId!;
        const columnId: TableColumnId = editingCell?.columnId ?? 'name';
        const currentIndex = visibleTasks.findIndex((t) => t.id === currentTaskId);
        const colIdx = editableColumnIds.indexOf(columnId);
        if (currentIndex >= 0 && colIdx >= 0) {
          let nextRowIdx = currentIndex;
          let nextColIdx = colIdx;
          if (e.key === 'ArrowDown') nextRowIdx = Math.min(visibleTasks.length - 1, currentIndex + 1);
          else if (e.key === 'ArrowUp') nextRowIdx = Math.max(0, currentIndex - 1);
          else if (e.key === 'ArrowLeft') nextColIdx = Math.max(0, colIdx - 1);
          else if (e.key === 'ArrowRight') nextColIdx = Math.min(editableColumnIds.length - 1, colIdx + 1);

          const nextTask = visibleTasks[nextRowIdx];
          const nextCol = editableColumnIds[nextColIdx];
          if (nextTask && nextCol) {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur?.();
            setTimeout(() => {
              setLastSelectedId(nextTask.id);
              if (nextCol === 'name') {
                setInlineEditingNameId(nextTask.id);
                setEditingCell(null);
              } else {
                setEditingCell({ taskId: nextTask.id, columnId: nextCol });
                setInlineEditingNameId(null);
              }
              document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
              requestAnimationFrame(() => {
                document.getElementById(`wbs-edit-${nextTask.id}-${nextCol}`)?.focus();
              });
            }, 0);
          }
        }
        return;
      }

      // 편집 모드에서 셀 간 화살표 이동 (편집 중이 아닐 때)
      if (
        tableEditMode &&
        !editingCell &&
        !inlineEditingNameId &&
        target.closest('[data-wbs-table]') &&
        focusedCell &&
        editableColumnIds.length > 0
      ) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const rowIdx = visibleTasks.findIndex((t) => t.id === focusedCell.taskId);
          const colIdx = editableColumnIds.indexOf(focusedCell.columnId);
          if (rowIdx >= 0 && colIdx >= 0) {
            let nextRowIdx = rowIdx;
            let nextColIdx = colIdx;
            if (e.key === 'ArrowUp') nextRowIdx = Math.max(0, rowIdx - 1);
            else if (e.key === 'ArrowDown') nextRowIdx = Math.min(visibleTasks.length - 1, rowIdx + 1);
            else if (e.key === 'ArrowLeft') nextColIdx = Math.max(0, colIdx - 1);
            else if (e.key === 'ArrowRight') nextColIdx = Math.min(editableColumnIds.length - 1, colIdx + 1);
            const nextTask = visibleTasks[nextRowIdx];
            const nextCol = editableColumnIds[nextColIdx];
            if (nextTask && nextCol) {
              e.preventDefault();
              setFocusedCell({ taskId: nextTask.id, columnId: nextCol });
              setLastSelectedId(nextTask.id);
              document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
            }
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const { taskId, columnId } = focusedCell;
          if (columnId === 'name') {
            setInlineEditingNameId(taskId);
            setEditingCell(null);
          } else {
            setEditingCell(focusedCell);
            setInlineEditingNameId(null);
          }
          document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            document.getElementById(`wbs-edit-${taskId}-${columnId}`)?.focus();
          });
          return;
        }
      }

      // Esc: 편집/선택 해제는 포커스 위치와 무관하게 우선 처리
      // (입력 중/셀 편집 중에도 Esc로 빠져나오고, 최종적으로 선택도 해제 가능)
      if (e.key === 'Escape') {
        // 편집 중지 (셀 편집 → 작업명 편집 → 테이블 편집 모드 순으로 해제)
        if (editingCell) {
          setEditingCell(null);
          e.preventDefault();
          return;
        }
        if (inlineEditingNameId) {
          setInlineEditingNameId(null);
          e.preventDefault();
          return;
        }
        if (tableEditMode) {
          setTableEditMode(false);
          setFocusedCell(null);
          (document.activeElement as HTMLElement)?.blur();
          tableScrollRef.current?.focus();
          e.preventDefault();
          return;
        }
        // 선택 모두 취소
        if (selectedTaskIds.size > 0) {
          setSelection(new Set());
          setBulkStatus('');
          setBulkAssignee('');
          setBulkWorkEffort('');
          setBulkProgress('');
          e.preventDefault();
          return;
        }
      }

      // Ignore other non-shortcut keys when editing a cell or typing in an input
      if (editingCell || inlineEditingNameId) return;
      const inWbsTableFallback = (target as HTMLElement).closest?.('[data-wbs-table]');
      if (!inWbsTableFallback) {
        // 표 밖의 일반 입력/셀렉트는 기본 동작 유지 (검색창 등)
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      }

      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통)
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        handleSetRowHeight(Math.min(64, rowHeight + 2));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleSetRowHeight(Math.max(15, rowHeight - 2));
        return;
      }

      // Allow paste even when no row is selected (e.g. focus on empty space)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        // Paste copied tasks into current project (supports cross-project via localStorage clipboard)
        e.preventDefault();
        const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
        if (clipboard.length === 0) {
          pushToast('복사된 작업이 없습니다.', { variant: 'info' });
          return;
        }

        // Paste target: if a row is selected, insert after it; otherwise append to the end.
        const fallbackInsertAfterId = visibleTasks.length > 0 ? visibleTasks[visibleTasks.length - 1].id : undefined;
        const baseInsertAfterId: string | undefined = lastSelectedId ?? fallbackInsertAfterId;

        // If a row is selected, paste as siblings under its parent; otherwise paste as root items.
        const selectedTask = lastSelectedId ? tasks.find((t) => t.id === lastSelectedId) : undefined;
        const pasteParentId: string | null = selectedTask?.parentId ?? null;

        // IMPORTANT:
        // addTask() generates a NEW id. If we precompute ids and set parentId/dependencies
        // with those fake ids, children become orphans and won't render.
        // So we build mapping from OLD -> ACTUAL NEW id returned from addTask().
        const clipboardIdSet = new Set(clipboard.map((t) => t.id));
        const idToNewId = new Map<string, string>();

        let insertAfterId: string | undefined = baseInsertAfterId;
        const addedIds: string[] = [];

        // Add tasks ensuring parents are created before children.
        const pending = [...clipboard];
        let safety = 0;
        while (pending.length > 0 && safety < clipboard.length * 4) {
          const idx = pending.findIndex((t) => !t.parentId || !clipboardIdSet.has(t.parentId) || idToNewId.has(t.parentId));
          const t = idx === -1 ? pending[0] : pending[idx];
          pending.splice(idx === -1 ? 0 : idx, 1);

          const isRootOfCopy = !(t.parentId && clipboardIdSet.has(t.parentId));
          const newParentId = isRootOfCopy ? pasteParentId : (idToNewId.get(t.parentId!) ?? pasteParentId);

          // Strip fields that shouldn't be copied as-is / computed fields.
          // We also postpone dependency remap until all ids exist.
          const { id: _id, projectId: _pid, depth: _depth, dependencies: _deps, ...rest } = t as Task & { depth?: number };
          const addedId = addTask(
            {
              ...rest,
              parentId: newParentId,
              expanded: true,
              dependencies: undefined,
            },
            isRootOfCopy ? insertAfterId : undefined,
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
            .filter((depId) => clipboardIdSet.has(depId))
            .map((depId) => idToNewId.get(depId))
            .filter(Boolean) as string[];
          if (mappedDeps.length > 0) {
            updateTask(newId, { dependencies: mappedDeps, userLockedFields: ['dependencies'] });
          }
        }

        // Select newly pasted tasks
        if (addedIds.length > 0) {
          setSelection(new Set(addedIds));
          setLastSelectedId(addedIds[addedIds.length - 1]);
        }
        return;
      }

      // Select all (works even when no row is selected yet)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      const effectiveSelectedIds = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : sharedSelectedTaskIds || [];

      const copySelectionToClipboard = () => {
        if (selectedTaskIds.size === 0) return;
        const selected = visibleTasks
          .filter((t) => selectedTaskIds.has(t.id))
          .map((t) => {
            const { depth: _depth, ...rest } = t as TaskWithDepth;
            return rest as Task;
          });
        setCopiedTasks(selected);
        try {
          const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
          localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
        } catch {
          // ignore storage errors (private mode, quota, etc.)
        }
      };

      // Cut: copy + delete (with confirmation)
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        copySelectionToClipboard();
        if (effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      // Copy (works as long as there's a selection)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectionToClipboard();
        return;
      }

      // Delete만 삭제 메뉴 오픈 (Backspace는 브라우저 뒤로가기·입력 필드와 충돌 방지)
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (canEditCurrentProject && effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      // F2: 선택 셀(편집 모드 포커스) 또는 현재 행·작업명을 즉시 인라인 편집 (엑셀과 동일)
      if (e.key === 'F2') {
        e.preventDefault();
        const taskId = tableEditMode && focusedCell ? focusedCell.taskId : lastSelectedId || visibleTasks[0]?.id;
        if (!taskId || editableColumnIds.length === 0) return;
        const columnId =
          tableEditMode && focusedCell && focusedCell.taskId === taskId && editableColumnIds.includes(focusedCell.columnId)
            ? focusedCell.columnId
            : editableColumnIds.includes('name')
              ? 'name'
              : editableColumnIds[0]!;
        setTableEditMode(true);
        setFocusedCell({ taskId, columnId });
        setLastSelectedId(taskId);
        // 체크박스 선택은 유지 (편집만으로 행이 자동 체크되지 않음)
        if (columnId === 'name') {
          setInlineEditingNameId(taskId);
          setEditingCell(null);
        } else {
          setEditingCell({ taskId, columnId });
          setInlineEditingNameId(null);
        }
        document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
        requestAnimationFrame(() => {
          document.getElementById(`wbs-edit-${taskId}-${columnId}`)?.focus();
        });
        return;
      }

      // If nothing is selected yet, allow arrow keys to move focus (체크는 변경하지 않음)
      if (!lastSelectedId) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const first = visibleTasks[0];
          const last = visibleTasks[visibleTasks.length - 1];
          const next = e.key === 'ArrowDown' ? first : last;
          if (next) {
            setLastSelectedId(next.id);
            document.getElementById(`task-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
        return;
      }

      // Space: toggle selection (checkbox) of the focused row
      if (e.key === ' ') {
        e.preventDefault();
        const next = new Set(selectedTaskIds);
        if (next.has(lastSelectedId)) next.delete(lastSelectedId);
        else next.add(lastSelectedId);
        setSelection(next);
        return;
      }

      // WBS 정렬일 때만 순서/레벨 변경 허용 (다른 정렬·필터 시 표시 순서와 트리 순서가 달라 혼동 방지)
      const isSortedOrFiltered =
        (sortConfig !== null && sortConfig.key !== 'wbs') ||
        filters.status !== 'all' ||
        filters.assignee ||
        filters.startDate ||
        filters.endDate ||
        !!filters.milestoneOnly ||
        !!filters.issueOnly;

      const currentIndex = visibleTasks.findIndex((t) => t.id === lastSelectedId);
      if (currentIndex === -1) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.altKey) {
          // Alt+↑: 한 칸 위로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered && (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
            moveTask(lastSelectedId, 'up');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else {
          const prevTask = visibleTasks[currentIndex - 1];
          if (prevTask) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleSelect(prevTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            } else {
              setLastSelectedId(prevTask.id);
            }
            document.getElementById(`task-row-${prevTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.altKey) {
          // Alt+↓: 한 칸 아래로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered && (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
            moveTask(lastSelectedId, 'down');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else {
          const nextTask = visibleTasks[currentIndex + 1];
          if (nextTask) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleSelect(nextTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            } else {
              setLastSelectedId(nextTask.id);
            }
            document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 편집 모드에서는 화살표는 셀 이동으로만 사용 (펼치기/접기 비활성화)
        if (tableEditMode) return;
        // 트리 뷰에서만: ← 접기, → 펼치기 (자식이 있는 행에서만 동작)
        const isTreeView = !(
          filters.status !== 'all' ||
          filters.assignee ||
          filters.startDate ||
          filters.endDate ||
          !!filters.milestoneOnly ||
          !!filters.issueOnly
        );
        // NOTE: 체크박스 선택이 없어도, 포커스(lastSelectedId)가 있으면 접기/펼치기 가능해야 함.
        if (isTreeView && lastSelectedId) {
          const task = tasks.find((t) => t.id === lastSelectedId);
          const hasChildren = task ? tasks.some((t) => t.parentId === task.id) : false;
          if (hasChildren) {
            if (e.key === 'ArrowLeft' && task?.expanded) {
              e.preventDefault();
              toggleExpand(lastSelectedId);
            } else if (e.key === 'ArrowRight' && !task?.expanded) {
              e.preventDefault();
              toggleExpand(lastSelectedId);
            }
          }
        }
      } else if (e.key === 'Tab') {
        if (tableEditMode) return; // 편집 모드에서는 들여쓰기/내어쓰기 비활성화
        e.preventDefault();
        if (selectedTaskIds.size > 0) {
          // Tab: 레벨 한 단계 내리기(들여쓰기), Shift+Tab: 레벨 한 단계 올리기(내어쓰기)
          const orderedIds = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
          if (e.shiftKey) {
            outdentTasks(orderedIds);
          } else {
            indentTasks(orderedIds);
          }
        }
      } else if (e.key === 'Enter') {
        // Enter: 동일 레벨(형제) 작업을 현재 행 "아래"에 추가
        if (tableEditMode) return; // 편집 모드에서는 Enter는 셀 편집 시작으로만 사용
        e.preventDefault();

        // 기본 기준 행: lastSelectedId(포커스된 행) 우선, 없으면 마지막 표시 행
        // ※ selectedTaskIds.size === 1 체크 제거: 화살표 키 이동 시 selectedTaskIds는
        //    갱신되지 않아 size가 0 또는 다수가 될 수 있지만, lastSelectedId는 항상 올바른
        //    현재 행을 가리키므로 이를 기준으로 사용한다.
        const baseTask =
          (lastSelectedId
            ? tasks.find((t) => t.id === lastSelectedId)
            : visibleTasks.length > 0
              ? tasks.find((t) => t.id === visibleTasks[visibleTasks.length - 1].id)
              : undefined) || null;

        const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

        const parentIdForNew = baseTask?.parentId ?? null; // 기준 행이 없으면 루트 작업으로 추가

        const insertAfterId = baseTask?.id;

        const newId = addTask(
          {
            name: '',
            startDate: filters.startDate || defaultDate,
            endDate: filters.endDate || defaultDate,
            progress: 0,
            workEffort: 0.5,
            assignee: filters.assignee || '',
            status: 'todo',
            parentId: parentIdForNew,
          },
          insertAfterId,
        );
        setLastSelectedId(newId);
        setInlineEditingNameId(newId);
      } else if (e.key === 'Insert') {
        if (tableEditMode) return; // 편집 모드에서는 새 작업 추가 비활성화
        e.preventDefault();

        // 기준 행: lastSelectedId(포커스된 행) 우선, 없으면 마지막 표시 행
        const baseTask =
          (lastSelectedId
            ? tasks.find((t) => t.id === lastSelectedId)
            : visibleTasks.length > 0
              ? tasks.find((t) => t.id === visibleTasks[visibleTasks.length - 1].id)
              : undefined) || null;
        const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

        if (e.shiftKey) {
          // Shift+Insert: 같은 레벨에서 기준 행 "위에" 새 작업 추가
          if (!baseTask) return;
          const currentIndex = visibleTasks.findIndex((t) => t.id === baseTask.id);
          const previousSibling = currentIndex > 0 ? visibleTasks[currentIndex - 1] : undefined;
          const insertAfterId = previousSibling?.id;
          const newId = addTask(
            {
              name: '',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: baseTask.parentId ?? null,
            },
            insertAfterId,
          );
          setLastSelectedId(newId);
          setInlineEditingNameId(newId);
        } else {
          // Insert: 기준 행의 하위 작업 추가 (기준 행이 없으면 루트 하위로 추가)
          const parentForChildId = baseTask?.id ?? null;
          const newId = addTask(
            {
              name: '',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: parentForChildId,
            },
            baseTask?.id,
          );

          // Expand the parent so the new task is visible
          if (baseTask && !baseTask.expanded) {
            updateTask(baseTask.id, { expanded: true });
          }

          setLastSelectedId(newId);
          setInlineEditingNameId(newId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hotkeysEnabled,
    excelView,
    selectedTaskIds,
    sharedSelectedTaskIds,
    lastSelectedId,
    visibleTasks,
    editingTask,
    editingCell,
    inlineEditingNameId,
    tableEditMode,
    focusedCell,
    editableColumnIds,
    deleteConfirm,
    moveTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    tasks,
    sortConfig,
    filters,
    copiedTasks,
    addTask,
    rowHeight,
    handleSetRowHeight,
    handleSelectAll,
    toggleExpand,
    pushToast,
  ]);

  // 편집 모드가 아닐 때 테이블 내 입력 포커스 제거(커서 깜빡임 방지). 인라인 새 작업 추가 중이면 유지.
  useEffect(() => {
    if (tableEditMode || inlineAddingTaskId) return;
    const el = document.activeElement;
    if (!el || !tableScrollRef.current?.contains(el)) return;
    if ((el as HTMLElement).closest?.('[data-quick-add]')) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.blur();
      tableScrollRef.current?.focus();
    }
  }, [tableEditMode, inlineAddingTaskId]);
}
