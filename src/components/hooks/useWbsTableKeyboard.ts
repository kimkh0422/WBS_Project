import { useEffect, useMemo, type RefObject } from 'react';
import type { Task, TaskStatus, FilterState, SortConfig, Project, WorkEffortUnit } from '../../types';
import type { TableColumnId, WbsEditingCellPayload } from '../wbsTableTypes';
import type { TaskWithDepth } from '../../lib/taskView';
import { isComposingKeyEvent } from '../../lib/ime';
import { commitWbsInlineNameEditFromDom } from '../../lib/wbsInlineNameCommit';
import { pasteClipboardTasks } from '../../lib/wbsClipboard';
import {
  buildWbsCellPasteUpdate,
  getWbsCellClipboardData,
  isCellClipboardColumn,
  type WbsCellClipboardData,
  type WbsStatusConfigLite,
} from '../../lib/wbsCellClipboard';
import { DEFAULT_NEW_TASK_WORK_EFFORT, defaultEndDateForNewTask, normalizeWorkEffortUnit } from '../../lib/workEffortUnits';
import { delegateInlineEditColumnId, isDerivedScheduleColumnId } from '../../lib/wbsReadonlyGridColumns';

/** 표시 순서 기준: 한 행과 접혀 있지 않은 한 화면에 보이는 모든 하위 행 */
function collectVisibleSubtreeRows(visibleTasks: TaskWithDepth[], rootId: string): TaskWithDepth[] {
  const rootIdx = visibleTasks.findIndex((t) => t.id === rootId);
  if (rootIdx === -1) return [];
  const root = visibleTasks[rootIdx]!;
  const rootDepth = root.depth ?? 0;
  const out: TaskWithDepth[] = [root];
  for (let i = rootIdx + 1; i < visibleTasks.length; i++) {
    const t = visibleTasks[i]!;
    const d = t.depth ?? 0;
    if (d <= rootDepth) break;
    out.push(t);
  }
  return out;
}

/** 표 안에서 비어 있지 않은 텍스트 선택이 있는지(앵커·포커스가 표 내부). `hasNonEmptyTextSelectionInEditableControl`에서 사용 */
function hasNonEmptyTextSelectionInside(root: HTMLElement | null): boolean {
  if (!root || typeof window === 'undefined') return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  if (!sel.toString().trim()) return false;
  const nodeInsideRoot = (n: Node | null): boolean => {
    if (!n) return false;
    const el = n.nodeType === Node.TEXT_NODE ? (n.parentElement as HTMLElement | null) : (n as HTMLElement);
    return !!(el && root.contains(el));
  };
  return nodeInsideRoot(sel.anchorNode) && nodeInsideRoot(sel.focusNode);
}

/** 인라인 편집 input/textarea 등 안에서만 true — 셀 드래그 선택 시에는 false로 두어 TSV 행 복사 대신 작업명만 복사 */
function hasNonEmptyTextSelectionInEditableControl(root: HTMLElement | null): boolean {
  if (!hasNonEmptyTextSelectionInside(root)) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const nodeToEl = (n: Node | null): HTMLElement | null => {
    if (!n) return null;
    return n.nodeType === Node.TEXT_NODE ? (n.parentElement as HTMLElement | null) : (n as HTMLElement);
  };
  const a = nodeToEl(sel.anchorNode);
  const f = nodeToEl(sel.focusNode);
  if (!a || !f) return false;
  const edA = a.closest('input, textarea, [contenteditable="true"]');
  const edF = f.closest('input, textarea, [contenteditable="true"]');
  return !!(edA && edA === edF && root.contains(edA));
}

/** 시스템 클립보드용: 포커스가 값 셀이면 그 셀의 값, 그 외에는 키보드 포커스 행의 작업명 (체크박스 다중 선택과 무관) */
export function getWbsTableCopyPlainText(opts: {
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  lastSelectedId: string | null;
  tasks: Task[];
  /** 둘 다 주어지면 값 셀 포커스 시 작업명 대신 그 셀 값 텍스트를 복사 (우클릭·메뉴 복사를 Ctrl+C와 일치시킴) */
  statusConfigs?: WbsStatusConfigLite[];
  visibleTaskIds?: string[];
}): { text: string; count: number } | null {
  const cursorTaskId = opts.focusedCell?.taskId ?? opts.lastSelectedId;
  if (!cursorTaskId) return null;
  const task = opts.tasks.find((t) => t.id === cursorTaskId);
  if (!task) return null;
  if (opts.focusedCell && opts.statusConfigs && opts.visibleTaskIds && isCellClipboardColumn(opts.focusedCell.columnId)) {
    const cell = getWbsCellClipboardData(task, opts.focusedCell.columnId, {
      statusConfigs: opts.statusConfigs,
      visibleTaskIds: opts.visibleTaskIds,
    });
    if (cell) return { text: cell.text, count: 1 };
  }
  const name = (task.name ?? '').trim();
  if (!name) return null;
  return { text: name, count: 1 };
}

/**
 * 타이핑 즉시 편집(type-to-edit) 대상 컬럼 — 셀 편집기가 uncontrolled(`defaultValue`) 텍스트/숫자 input이라
 * 첫 글자를 native value로 주입할 수 있는 컬럼, 또는 allocation·dependencies처럼 `typeToEditSeed`로
 * controlled 편집기에 넘기는 컬럼. status(select)·파생(계획율·차이) 셀은 제외.
 */
const TYPE_TO_EDIT_COLUMNS = new Set<string>([
  'name',
  'startDate',
  'endDate',
  'duration',
  'workEffort',
  'weight',
  'progress',
  'assignee',
  'deliverables',
  'allocation',
  'dependencies',
]);
/** 첫 글자는 DOM seed 대신 `editingCell.typeToEditSeed`로 행에 전달(controlled input). */
const TYPE_TO_EDIT_SEED_CONTROLLED_COLUMNS = new Set<string>(['allocation', 'dependencies']);
/** 요약(자식 있는) 행에서도 편집 가능 — 저장 후 롤업은 rollups.ts·useTaskOps의 growOnly·exclude 규칙을 따름 */
export function canTypeToEditColumn(columnId: TableColumnId, _hasChildren: boolean): boolean {
  const isCustom = columnId.startsWith('custom:');
  if (!TYPE_TO_EDIT_COLUMNS.has(columnId) && !isCustom) return false;
  return true;
}

/** Enter로 즉시 인라인 편집을 열 수 있는 컬럼(읽기 전용·파생 제외). */
function canEnterInlineOnFocusedColumn(columnId: TableColumnId, hasChildren: boolean): boolean {
  if (columnId === 'plannedProgress') return false;
  if (columnId === 'status' || columnId === 'allocation' || columnId === 'dependencies') return true;
  return canTypeToEditColumn(columnId, hasChildren);
}

function resolveEnterOpensCellEdit(opts: {
  focusedCell: { taskId: string; columnId: TableColumnId };
  editableColumnIds: TableColumnId[];
  tasks: Task[];
  visibleTasks: TaskWithDepth[];
}): WbsEditingCellPayload | null {
  const { focusedCell, editableColumnIds, tasks, visibleTasks } = opts;
  const { taskId, columnId: focusCol } = focusedCell;
  if (!editableColumnIds.includes(focusCol)) return null;
  const t = tasks.find((x) => x.id === taskId);
  if (!t || !visibleTasks.some((vt) => vt.id === taskId) || t.mirroredFromTaskId) return null;
  if (focusCol === 'plannedProgress') return null;
  const editCol = delegateInlineEditColumnId(focusCol, editableColumnIds);
  if (isDerivedScheduleColumnId(focusCol) && editCol === focusCol) return null;
  const hasChildren = tasks.some((x) => x.parentId === taskId);
  // 작업명: Enter는 형제 작업 추가로만 쓰고, 인라인 편집은 F2·type-to-edit 사용
  if (focusCol === 'name') {
    return null;
  }
  if (!canEnterInlineOnFocusedColumn(editCol, hasChildren)) return null;
  return { taskId, columnId: editCol };
}

/**
 * type-to-edit으로 연 셀 편집기에 첫 글자를 채운다. uncontrolled input이라도 React가 인식하도록
 * native value setter + input 이벤트를 쓰고, 커서를 끝으로 보낸다(엑셀: 타이핑 시 기존값 대체).
 */
function seedCellEditorValue(el: HTMLInputElement | HTMLTextAreaElement, ch: string): void {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, ch);
  else el.value = ch;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const len = el.value.length;
  try {
    el.setSelectionRange(len, len);
  } catch {
    // number input 등은 setSelectionRange 미지원 — 무시
  }
}

/**
 * 편집기 input은 editingCell/inlineEditingNameId state 변경 후 React 리렌더로 mount되므로,
 * 고정 프레임 수로 기다리면 가상 스크롤·batching 타이밍에 따라 mount 전에 실행되어 첫 글자가 유실된다.
 * input이 나타날 때까지 rAF로 잠깐 폴링한 뒤 첫 글자를 주입한다.
 */
function seedCellEditorWhenReady(elementId: string, ch: string, tries = 0): void {
  const el = document.getElementById(elementId);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    seedCellEditorValue(el, ch);
    return;
  }
  if (tries < 24) requestAnimationFrame(() => seedCellEditorWhenReady(elementId, ch, tries + 1));
}

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
  editingCell: WbsEditingCellPayload | null;
  inlineEditingNameId: string | null;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  editableColumnIds: TableColumnId[];
  deleteConfirm: { isOpen: boolean; taskIds: string[] };
  copiedTasks: Task[];
  /** 엑셀식 셀 단위 클립보드 — 행(작업) 클립보드와 둘 중 "가장 최근 복사"만 유효 */
  copiedCell: WbsCellClipboardData | null;
  setCopiedCell: (cell: WbsCellClipboardData | null) => void;
  /** 셀 복사 시 행(작업) 클립보드를 비워 최근 복사만 남긴다 (안내 칩도 함께 닫힘) */
  clearTaskClipboard: () => void;
  statusConfigs: WbsStatusConfigLite[];
  projectEffortUnitByProjectId: Map<string, WorkEffortUnit>;
  tasks: Task[];
  sortConfig: SortConfig | null;
  filters: FilterState;
  rowHeight: number;
  currentProjectId: string;
  projects: Project[];
  canEditCurrentProject: boolean;
  inlineAddingTaskId: string | null;
  setInlineAddingTaskId: (id: string | null) => void;
  /** Excel 스타일 placeholder(ghost) 행 — 데이터 마지막 아래에서 ↓로 진입, 타이핑/Enter/F2로 새 작업 즉시 생성 */
  ghostFocusIdx: number | null;
  setGhostFocusIdx: (idx: number | null) => void;
  ghostPlaceholderRowCount: number;
  /** Ghost 행 활성화 — 새 빈 작업을 생성하고 인라인 편집으로 진입 */
  activateGhostRow: () => void;

  // State setters
  setLastSelectedId: (id: string | null) => void;
  /** Shift+↑/↓ 범위 선택 앵커: 화살표·탭·F2 등으로 행 포커스만 옮길 때 lastSelectedId와 ref가 어긋나지 않게 동기화 */
  syncRangeAnchorForKeyboardFocus?: (taskId: string | null) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setInlineEditingNameId: (id: string | null) => void;
  setEditingCell: (cell: WbsEditingCellPayload | null) => void;
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
  pushToast: (msg: string, opts?: { variant?: string; id?: string; durationMs?: number }) => void;
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
    focusedCell,
    editableColumnIds,
    deleteConfirm,
    copiedTasks,
    copiedCell,
    setCopiedCell,
    clearTaskClipboard,
    statusConfigs,
    projectEffortUnitByProjectId,
    tasks,
    sortConfig,
    filters,
    rowHeight,
    currentProjectId,
    projects,
    canEditCurrentProject,
    inlineAddingTaskId,
    setInlineAddingTaskId,
    ghostFocusIdx,
    setGhostFocusIdx,
    ghostPlaceholderRowCount,
    activateGhostRow,
    setLastSelectedId,
    syncRangeAnchorForKeyboardFocus,
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

  const visibleTaskRowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < visibleTasks.length; i++) {
      m.set(visibleTasks[i]!.id, i);
    }
    return m;
  }, [visibleTasks]);

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

      /** 키보드로 셀/행 커서만 옮길 때는 체크 다중 선택을 해제해 포커스 행과 어긋나지 않게 한다 (Shift/Ctrl+↑↓ 범위 확장은 제외). */
      const clearBulkCheckboxSelectionOnKeyboardCursorMove = () => {
        if (selectedTaskIds.size > 0) {
          setSelection(new Set());
          setBulkStatus('');
          setBulkAssignee('');
          setBulkWorkEffort('');
          setBulkProgress('');
        }
      };

      // ── Ghost (Excel placeholder) 행 포커스 처리 ──
      // ghostFocusIdx 가 설정돼 있으면 ↑/↓ 로 행 이동, Enter/F2/문자 입력은 새 작업 생성+편집, Esc 는 해제.
      if (ghostFocusIdx !== null && !inQuickAdd) {
        if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          const max = Math.max(0, ghostPlaceholderRowCount - 1);
          setGhostFocusIdx(Math.min(max, ghostFocusIdx + 1));
          return;
        }
        if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (ghostFocusIdx === 0) {
            // 최상단 ghost — 마지막 데이터 행으로 포커스 복귀
            const lastTask = visibleTasks[visibleTasks.length - 1];
            setGhostFocusIdx(null);
            if (lastTask) {
              clearBulkCheckboxSelectionOnKeyboardCursorMove();
              setFocusedCell({ taskId: lastTask.id, columnId: 'name' });
              setLastSelectedId(lastTask.id);
              document.getElementById(`task-row-${lastTask.id}`)?.scrollIntoView({ block: 'nearest' });
            }
            tableScrollRef.current?.focus();
          } else {
            setGhostFocusIdx(ghostFocusIdx - 1);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setGhostFocusIdx(null);
          tableScrollRef.current?.focus();
          return;
        }
        // Enter / F2 / 인쇄 가능 문자(영숫자·한글 등) → 새 작업 생성 + 인라인 편집 진입
        const isPrintableChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (e.key === 'Enter' || e.key === 'F2' || isPrintableChar) {
          e.preventDefault();
          activateGhostRow();
          return;
        }
        // 그 외 키는 무시(ghost 포커스 유지)
      }
      /** 일괄 수정 바 등 표 밖 포커스에서도 Shift/Ctrl/Meta+↑↓ 로 범위·다중 선택 확장 (SELECT·간트 막대는 제외) */
      const rangeArrowFromOutsideTable =
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        (e.shiftKey || e.ctrlKey || e.metaKey) &&
        (lastSelectedId != null || selectedTaskIds.size > 0) &&
        !(target as HTMLElement).closest?.('[data-gantt-task-bar]') &&
        target.tagName !== 'SELECT';

      /** Tab/Insert/트리 단축키와 겹치지 않도록: 표 안 실제 입력/선택 포커스 (체크박스 등 제외) */
      const isWbsTableCellTypingTarget = (el: HTMLElement): boolean => {
        if (!el.closest?.('[data-wbs-table]') || el.closest?.('[data-quick-add]')) return false;
        // armed(편집 전) 작업명 입력은 '타이핑 중'이 아니라 '포커스만 + 한글 IME 캐처' → 셀 이동·단축키가 동작해야 함
        if (el.hasAttribute?.('data-wbs-armed')) return false;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
        if (el.tagName !== 'INPUT') return false;
        const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
        return !['checkbox', 'radio', 'button', 'submit', 'file', 'hidden', 'reset'].includes(t);
      };

      /** 보라 다중 선택 안에서 ↑↓만으로는 Shift 앵커 유지; 선택 밖 행으로 포커스가 나가면 앵커를 그 행에 맞춘다 */
      const maybeSyncShiftRangeAnchor = (taskId: string) => {
        if (selectedTaskIds.size === 0 || !selectedTaskIds.has(taskId)) {
          syncRangeAnchorForKeyboardFocus?.(taskId);
        }
      };

      // 새 작업 입력칸(하단/인라인)에서는 Enter가 폼 submit 되도록 전역 단축키 미동작
      if (inQuickAdd) return;

      // 작업명 인라인 편집 중 ↑/↓(수정키 없음): 표·간트 동기/스크롤 등으로 행 포커스가 바뀌지 않도록 여기서 종료
      if (
        inlineEditingNameId &&
        inWbsTable &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 표 밖의 일반 입력/셀렉트 포커스 중에는 단축키 미동작 (범위 확장용 ↑↓+Shift/Ctrl/Meta 는 예외)
      if (!inWbsTable && (target.tagName === 'INPUT' || target.tagName === 'SELECT') && !rangeArrowFromOutsideTable) return;

      // 비-name 셀(assignee/status/progress/등) 편집 중 Enter: 값만 커밋하고 같은 셀에 머무름.
      // 이 시점부터 ←/→로 자유 이동 가능. (Shift+Enter는 다음 행 같은 컬럼으로 포커스 이동)
      if (e.key === 'Enter' && editingCell && inWbsTable) {
        e.preventDefault();
        const currentTaskId = editingCell.taskId;
        const currentColId = editingCell.columnId;
        // blur로 onBlur 핸들러를 트리거해 값 커밋
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => {
          setEditingCell(null);
          setInlineEditingNameId(null);
          if (e.shiftKey) {
            // Shift+Enter: 다음 행 같은 컬럼으로 포커스 이동 (편집은 시작 안 함, F2로 편집)
            const idx = visibleTaskRowIndexById.get(currentTaskId) ?? -1;
            const next = idx >= 0 ? visibleTasks[idx + 1] : null;
            if (next) {
              clearBulkCheckboxSelectionOnKeyboardCursorMove();
              setLastSelectedId(next.id);
              maybeSyncShiftRangeAnchor(next.id);
              setFocusedCell({ taskId: next.id, columnId: currentColId });
              document.getElementById(`task-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
            } else {
              setFocusedCell({ taskId: currentTaskId, columnId: currentColId });
            }
          } else {
            // 그냥 Enter: 같은 셀 유지 (←/→로 자유 이동)
            setFocusedCell({ taskId: currentTaskId, columnId: currentColId });
          }
          requestAnimationFrame(() => {
            tableScrollRef.current?.focus();
          });
        }, 0);
        return;
      }

      // 작업명(name) 인라인 편집 중 Enter — 보호망(SortableTaskRow 로컬 핸들러가 stopPropagation 하지만 포커스 분실 등으로 전역까지 흘러오는 경우 대응).
      // 정책: 다음 기존 행을 자동으로 편집 모드로 만들지 않는다(기존 작업명 오타 수정 사고 방지).
      // 신규 행 생성은 로컬 핸들러의 onAdvanceInlineEditToNextRow 콜백이 담당하므로, 여기서는 현재 행 커밋 후 편집만 종료한다.
      if (e.key === 'Enter' && inlineEditingNameId && inWbsTable) {
        e.preventDefault();
        const currentTaskId = inlineEditingNameId;
        if (!canEditCurrentProject) {
          setInlineEditingNameId(null);
          return;
        }
        commitWbsInlineNameEditFromDom(currentTaskId, tasks, updateTask, canEditCurrentProject);
        setInlineEditingNameId(null);
        setEditingCell(null);
        setFocusedCell({ taskId: currentTaskId, columnId: 'name' });
        setLastSelectedId(currentTaskId);
        maybeSyncShiftRangeAnchor(currentTaskId);
        requestAnimationFrame(() => {
          tableScrollRef.current?.focus();
        });
        return;
      }

      // 편집 중 화살표는 input의 기본 동작(텍스트 커서 이동/숫자 값 증감)만 허용.
      // 셀 이동은 Enter(커밋) 또는 Esc(취소) 또는 Tab/Shift+Tab(연속 편집) 후에만 가능.
      // → 사용자가 편집 중 의도치 않게 다른 셀로 이동되는 것을 방지.

      // Tab / Shift+Tab: 셀 단위 좌우 이동 (Excel 스타일)
      // - 편집 중(셀 편집 또는 작업명 인라인 편집): 현재 입력값 커밋(blur) 후 다음/이전 셀로 이동하여 계속 편집
      // - 편집 모드 + 셀 포커스만 있는 상태: 포커스만 다음/이전 셀로 이동
      // - 행 끝/시작에서는 인접 행의 처음/마지막 셀로 자동 이동(엑셀과 동일)
      // - number 타입 input에서도 Tab은 셀 이동(arrow는 값 증감용)
      if (
        e.key === 'Tab' &&
        target.closest('[data-wbs-table]') &&
        editableColumnIds.length > 0 &&
        (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target))
      ) {
        const currentTaskId = editingCell?.taskId ?? inlineEditingNameId ?? focusedCell?.taskId ?? null;
        const currentColId: TableColumnId | null =
          editingCell?.columnId ?? (inlineEditingNameId ? 'name' : (focusedCell?.columnId ?? null));
        if (!currentTaskId || !currentColId) {
          // fall through to other handlers
        } else {
          const rowIdx = visibleTaskRowIndexById.get(currentTaskId) ?? -1;
          const colIdx = editableColumnIds.indexOf(currentColId);
          if (rowIdx >= 0 && colIdx >= 0) {
            e.preventDefault();
            // editingCell/inlineEditingNameId 패턴을 쓰지 않는 셀(예: 선행작업 input, 상태 select)도
            // 입력 중이라면 다음 셀의 입력 요소로 자동 포커스되어야 함
            const isTypingInCell = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
            const wasEditing = !!(editingCell || inlineEditingNameId) || isTypingInCell;
            let nextRowIdx = rowIdx;
            let nextColIdx = colIdx + (e.shiftKey ? -1 : 1);
            if (nextColIdx >= editableColumnIds.length) {
              // 행 끝 → 다음 행 첫 셀
              nextColIdx = 0;
              nextRowIdx = Math.min(visibleTasks.length - 1, rowIdx + 1);
            } else if (nextColIdx < 0) {
              // 행 시작 → 이전 행 마지막 셀
              nextColIdx = editableColumnIds.length - 1;
              nextRowIdx = Math.max(0, rowIdx - 1);
            }
            const nextTask = visibleTasks[nextRowIdx];
            const nextCol = editableColumnIds[nextColIdx];
            if (nextTask && nextCol) {
              const editColAfterTab = wasEditing ? delegateInlineEditColumnId(nextCol, editableColumnIds) : nextCol;
              // 작업명 인라인 편집 중 Tab 이동: blur 전에 DOM에서 커밋(onBlur 미사용)
              if (inlineEditingNameId) {
                commitWbsInlineNameEditFromDom(inlineEditingNameId, tasks, updateTask, canEditCurrentProject);
              }
              // 현재 입력값 커밋(그 외 셀은 blur로 각 셀 onBlur가 처리)
              (document.activeElement as HTMLElement | null)?.blur?.();
              setTimeout(() => {
                clearBulkCheckboxSelectionOnKeyboardCursorMove();
                setLastSelectedId(nextTask.id);
                maybeSyncShiftRangeAnchor(nextTask.id);
                setFocusedCell({ taskId: nextTask.id, columnId: editColAfterTab });
                if (wasEditing) {
                  if (editColAfterTab === 'name') {
                    setInlineEditingNameId(nextTask.id);
                    setEditingCell(null);
                  } else {
                    setEditingCell({ taskId: nextTask.id, columnId: editColAfterTab });
                    setInlineEditingNameId(null);
                  }
                  requestAnimationFrame(() => {
                    document.getElementById(`wbs-edit-${nextTask.id}-${editColAfterTab}`)?.focus();
                  });
                }
                document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
              }, 0);
            }
            return;
          }
        }
      }

      // 셀 간 화살표 이동 (편집 중이 아닐 때): ←/→ 열 이동, ↑/↓ 같은 열에서 이전/다음 행.
      // 행 하이라이트(lastSelectedId)와 셀 링(focusedCell)이 어긋나면(행만 클릭·간트 동기 등)
      // ↑/↓·Space가 서로 다른 행을 가리키는 문제가 생기므로, 기준 행은 lastSelectedId를 우선한다.
      // 열은 focusedCell이 유효하면 유지해 같은 열 기준으로 세로 이동한다.
      // target.closest('[data-wbs-table]') 조건은 의도적으로 빼서, Enter 후 focus가 body로
      // 빠진 경우에도 화살표가 동작하도록 한다.
      // Alt+↑↓(행 순서)·Shift+←/→(트리 접기/펼치기)·Shift/Ctrl/Meta+↑↓(체크 범위)는 아래에서 처리.
      const defaultNavColumn: TableColumnId = editableColumnIds.includes('name')
        ? 'name'
        : ((editableColumnIds[0] as TableColumnId | undefined) ?? 'name');
      const navColFromFocus = focusedCell && editableColumnIds.includes(focusedCell.columnId) ? focusedCell.columnId : defaultNavColumn;
      const keyboardNavTaskId = lastSelectedId ?? focusedCell?.taskId ?? null;
      const effectiveArrowCell = keyboardNavTaskId != null ? { taskId: keyboardNavTaskId, columnId: navColFromFocus } : null;
      if (
        !editingCell &&
        !inlineEditingNameId &&
        !isWbsTableCellTypingTarget(target) &&
        effectiveArrowCell &&
        editableColumnIds.length > 0 &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const rowIdx = visibleTaskRowIndexById.get(effectiveArrowCell.taskId) ?? -1;
          let colIdx = editableColumnIds.indexOf(effectiveArrowCell.columnId);
          if (colIdx < 0) colIdx = Math.max(0, editableColumnIds.indexOf(defaultNavColumn));
          if (rowIdx >= 0 && colIdx >= 0) {
            let nextRowIdx = rowIdx;
            let nextColIdx = colIdx;
            if (e.key === 'ArrowLeft') {
              if (colIdx === 0) {
                nextColIdx = editableColumnIds.length - 1;
                nextRowIdx = Math.max(0, rowIdx - 1);
              } else {
                nextColIdx = colIdx - 1;
              }
            } else if (e.key === 'ArrowRight') {
              if (colIdx === editableColumnIds.length - 1) {
                nextColIdx = 0;
                nextRowIdx = Math.min(visibleTasks.length - 1, rowIdx + 1);
              } else {
                nextColIdx = colIdx + 1;
              }
            }
            const nextTask = visibleTasks[nextRowIdx];
            const nextCol = editableColumnIds[nextColIdx];
            if (nextTask && nextCol) {
              e.preventDefault();
              clearBulkCheckboxSelectionOnKeyboardCursorMove();
              setFocusedCell({ taskId: nextTask.id, columnId: nextCol });
              setLastSelectedId(nextTask.id);
              maybeSyncShiftRangeAnchor(nextTask.id);
              document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
              // 다음 키 입력도 안정적으로 받도록 표 컨테이너로 포커스 복원
              tableScrollRef.current?.focus();
              return;
            }
          }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const rowIdx = visibleTaskRowIndexById.get(effectiveArrowCell.taskId) ?? -1;
          let colIdx = editableColumnIds.indexOf(effectiveArrowCell.columnId);
          if (colIdx < 0) colIdx = Math.max(0, editableColumnIds.indexOf(defaultNavColumn));
          if (rowIdx >= 0 && colIdx >= 0) {
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            // 마지막 데이터 행에서 ↓ — Excel placeholder(ghost) 행 0번으로 진입.
            if (
              e.key === 'ArrowDown' &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey &&
              rowIdx === visibleTasks.length - 1 &&
              canEditCurrentProject &&
              ghostPlaceholderRowCount > 0
            ) {
              e.preventDefault();
              clearBulkCheckboxSelectionOnKeyboardCursorMove();
              setFocusedCell(null);
              setGhostFocusIdx(0);
              tableScrollRef.current?.focus();
              return;
            }
            const nextRowIdx = Math.min(visibleTasks.length - 1, Math.max(0, rowIdx + delta));
            e.preventDefault();
            clearBulkCheckboxSelectionOnKeyboardCursorMove();
            if (nextRowIdx !== rowIdx) {
              const nextTask = visibleTasks[nextRowIdx];
              const nextCol = editableColumnIds[colIdx];
              if (nextTask && nextCol) {
                setFocusedCell({ taskId: nextTask.id, columnId: nextCol });
                setLastSelectedId(nextTask.id);
                maybeSyncShiftRangeAnchor(nextTask.id);
                document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
              }
            }
            tableScrollRef.current?.focus();
            return;
          }
        }
      }

      // Esc: 편집·포커스·편집 모드·인라인 추가·선택을 한 번에 해제 (여러 상태가 겹쳐 있어도 1회로 정리)
      if (e.key === 'Escape') {
        const hadOverlay =
          editingCell != null ||
          inlineEditingNameId != null ||
          focusedCell != null ||
          inlineAddingTaskId != null ||
          selectedTaskIds.size > 0;

        if (!hadOverlay) return;

        if (editingCell) setEditingCell(null);
        if (inlineEditingNameId) setInlineEditingNameId(null);
        if (focusedCell) setFocusedCell(null);
        if (inlineAddingTaskId) setInlineAddingTaskId(null);
        if (selectedTaskIds.size > 0) {
          setSelection(new Set());
          setBulkStatus('');
          setBulkAssignee('');
          setBulkWorkEffort('');
          setBulkProgress('');
        }
        (document.activeElement as HTMLElement | null)?.blur?.();
        tableScrollRef.current?.focus();
        e.preventDefault();
        return;
      }

      // 셀 입력 중이면 행 선택·트리·붙여넣기 등 표 단축키 비활성화 (선행작업 input 등은 editingCell 없음)
      // `e.target`만 보면 포커스는 텍스트 input인데 target이 행 등으로 잡혀 Space가 체크 토글로 가는 경우가 있어 activeElement도 함께 본다.
      const activeEl = document.activeElement as HTMLElement | null;
      const typingInWbsCell = isWbsTableCellTypingTarget(target) || (!!activeEl && isWbsTableCellTypingTarget(activeEl));
      if (editingCell || inlineEditingNameId || typingInWbsCell) return;
      const inWbsTableFallback = (target as HTMLElement).closest?.('[data-wbs-table]');
      if (!inWbsTableFallback) {
        // 표 밖의 일반 입력/셀렉트는 기본 동작 유지 (검색창 등)
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      }

      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통) — e.code로 레이아웃 차이 완화
      if (e.ctrlKey || e.metaKey) {
        const isInc = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
        const isDec = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
        if (isInc) {
          e.preventDefault();
          handleSetRowHeight(Math.min(64, rowHeight + 2));
          return;
        }
        if (isDec) {
          e.preventDefault();
          handleSetRowHeight(Math.max(15, rowHeight - 2));
          return;
        }
      }

      // Allow paste even when no row is selected (e.g. focus on empty space)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        // 0) 셀 클립보드(가장 최근 복사가 셀)가 있으면 커서 셀에 셀 단위 붙여넣기 — 엑셀과 동일
        // 1) 내부 작업 클립보드(Ctrl+X 등)가 있으면 기존처럼 작업 단위 붙여넣기
        // 2) 없으면 시스템 클립보드 텍스트를 현재 커서 셀(없으면 작업명)에 반영
        e.preventDefault();
        // 작업명 셀만 포커스(체크 다중 선택 없음): 시스템 텍스트만 작업명에 반영 — 내부 행/셀 클립보드 무시(붙여넣기로 새 작업 추가 방지)
        if (selectedTaskIds.size === 0 && focusedCell?.columnId === 'name' && focusedCell.taskId) {
          if (!canEditCurrentProject) {
            pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
            return;
          }
          const cursorTaskId = focusedCell.taskId;
          void (async () => {
            let text = '';
            try {
              text = await navigator.clipboard.readText();
            } catch {
              pushToast('클립보드를 읽을 수 없습니다.', { variant: 'error' });
              return;
            }
            const firstLine = (text.split(/\r?\n/)[0] ?? '').trim();
            if (!firstLine) {
              pushToast('붙여넣을 텍스트가 없습니다.', { variant: 'info' });
              return;
            }
            const t = tasks.find((x) => x.id === cursorTaskId);
            if (!t) return;
            const visibleTaskIds = visibleTasks.map((vt) => vt.id);
            const res = buildWbsCellPasteUpdate(
              t,
              'name',
              { text: firstLine },
              {
                tasks,
                visibleTaskIds,
                statusConfigs,
                effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
              },
            );
            if (res.error) {
              pushToast(res.error, { variant: 'warning' });
              return;
            }
            if (res.updates) {
              updateTask(t.id, res.updates);
              pushToast('작업명을 붙여넣었습니다.', { variant: 'success' });
            } else {
              pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
            }
          })();
          return;
        }
        if (copiedCell) {
          if (!canEditCurrentProject) {
            pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
            return;
          }
          // 체크 다중 선택이 있으면 그 행들의 "복사한 컬럼"에 일괄 적용, 없으면 커서 셀 하나에(다른 컬럼도 허용).
          const checkedRows = selectedTaskIds.size > 0 ? visibleTasks.filter((t) => selectedTaskIds.has(t.id)) : [];
          const singleTarget = focusedCell ?? (lastSelectedId ? { taskId: lastSelectedId, columnId: copiedCell.columnId } : null);
          const targets: Array<{ taskId: string; columnId: TableColumnId }> =
            checkedRows.length > 0
              ? checkedRows.map((t) => ({ taskId: t.id, columnId: copiedCell.columnId }))
              : singleTarget
                ? [singleTarget]
                : [];
          if (targets.length === 0) {
            pushToast('붙여넣을 셀을 먼저 클릭하세요.', { variant: 'info' });
            return;
          }
          const visibleTaskIds = visibleTasks.map((t) => t.id);
          let applied = 0;
          let failed = 0;
          let firstError: string | null = null;
          for (const tgt of targets) {
            const t = tasks.find((x) => x.id === tgt.taskId);
            if (!t) continue;
            const res = buildWbsCellPasteUpdate(t, tgt.columnId, copiedCell, {
              tasks,
              visibleTaskIds,
              statusConfigs,
              effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
            });
            if (res.error) {
              failed += 1;
              if (!firstError) firstError = res.error;
              continue;
            }
            if (res.updates) {
              updateTask(t.id, res.updates);
              applied += 1;
            }
          }
          if (applied === 0 && failed > 0) {
            pushToast(firstError ?? '붙여넣지 못했습니다.', { variant: 'warning' });
          } else if (targets.length > 1) {
            pushToast(`${applied}개 행에 셀 값을 붙여넣었습니다${failed > 0 ? ` (${failed}개 실패)` : ''}.`, { variant: 'success' });
          } else if (applied > 0) {
            pushToast('셀 값을 붙여넣었습니다.', { variant: 'success' });
          } else {
            pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
          }
          return;
        }
        const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
        if (clipboard.length === 0) {
          // 시스템 클립보드 텍스트를 커서 셀(컬럼)에 붙여넣기 — 엑셀 등 외부 앱에서 복사한 값
          const cursorTaskId = focusedCell?.taskId ?? lastSelectedId;
          if (!cursorTaskId) {
            pushToast('작업을 선택한 뒤 붙여넣기 하세요.', { variant: 'info' });
            return;
          }
          if (!canEditCurrentProject) return;
          const targetColumnId: TableColumnId = focusedCell?.columnId ?? 'name';
          const visibleTaskIds = visibleTasks.map((t) => t.id);
          void (async () => {
            let text = '';
            try {
              text = await navigator.clipboard.readText();
            } catch {
              pushToast('클립보드를 읽을 수 없습니다.', { variant: 'error' });
              return;
            }
            const firstLine = (text.split(/\r?\n/)[0] ?? '').trim();
            if (!firstLine) {
              pushToast('붙여넣을 텍스트가 없습니다.', { variant: 'info' });
              return;
            }
            const t = tasks.find((x) => x.id === cursorTaskId);
            if (!t) return;
            const res = buildWbsCellPasteUpdate(
              t,
              targetColumnId,
              { text: firstLine },
              {
                tasks,
                visibleTaskIds,
                statusConfigs,
                effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
              },
            );
            if (res.error) {
              pushToast(res.error, { variant: 'warning' });
              return;
            }
            if (res.updates) {
              updateTask(t.id, res.updates);
              pushToast(targetColumnId === 'name' ? '작업명을 붙여넣었습니다.' : '셀에 붙여넣었습니다.', { variant: 'success' });
            } else {
              pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
            }
          })();
          return;
        }

        // 작업 단위 붙여넣기는 편집 권한이 있을 때만 (보기 전용 프로젝트 차단)
        if (!canEditCurrentProject) {
          pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
          return;
        }

        // 트리·선행관계를 보존하는 작업 단위 붙여넣기 (공용 함수). 기준 행은 키보드 포커스 행(lastSelectedId).
        const addedIds = pasteClipboardTasks({
          clipboard,
          targetId: lastSelectedId,
          visibleTaskIds: visibleTasks.map((t) => t.id),
          tasks,
          addTask,
          updateTask,
        });

        // Select newly pasted tasks
        if (addedIds.length > 0) {
          setSelection(new Set(addedIds));
          const lastPasted = addedIds[addedIds.length - 1];
          setLastSelectedId(lastPasted);
          syncRangeAnchorForKeyboardFocus?.(lastPasted);
          pushToast(`${addedIds.length}개 작업을 붙여넣었습니다.`, { variant: 'success' });
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

      const copySelectionToClipboard = (): Task[] => {
        // 체크박스 다중 선택이 없어도, 행 클릭·↑↓로 포커스된 행(lastSelectedId)이 있으면 그 행(및 펼쳐진 하위)을 행 단위 복사
        const rowsFromCheckbox = selectedTaskIds.size > 0 ? visibleTasks.filter((t) => selectedTaskIds.has(t.id)) : [];
        const rows =
          rowsFromCheckbox.length > 0 ? rowsFromCheckbox : lastSelectedId ? collectVisibleSubtreeRows(visibleTasks, lastSelectedId) : [];
        if (rows.length === 0) return [];
        const selected = rows.map((t) => {
          const { depth: _depth, ...rest } = t as TaskWithDepth;
          return rest as Task;
        });
        setCopiedTasks(selected);
        setCopiedCell(null); // 가장 최근 복사(행)만 유효 — 셀 클립보드 대체
        try {
          const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
          localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
        } catch {
          // ignore storage errors (private mode, quota, etc.)
        }
        return selected;
      };

      const wbsTableEl = document.querySelector('[data-wbs-table]') as HTMLElement | null;
      const deferCutCopyToBrowser = hasNonEmptyTextSelectionInEditableControl(wbsTableEl);

      // Cut: copy + delete (with confirmation)
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (deferCutCopyToBrowser) return;
        e.preventDefault();
        copySelectionToClipboard();
        const idsForDelete =
          selectedTaskIds.size > 0
            ? Array.from(selectedTaskIds)
            : lastSelectedId
              ? collectVisibleSubtreeRows(visibleTasks, lastSelectedId).map((t) => t.id)
              : effectiveSelectedIds;
        if (idsForDelete.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: idsForDelete });
        }
        return;
      }

      // Copy — 엑셀식 셀/행 복사:
      // - 체크 다중 선택이 없고 커서가 작업명이면 문자열만 복사(행 클립보드 비움) → Ctrl+V는 작업명 텍스트만
      // - 체크 다중 선택이 없고 커서가 값 셀(작업명·파생 제외)에 있으면 그 셀 값만 복사 → 다른 셀로 이동 후 Ctrl+V로 그 셀에 붙여넣기
      // - 체크 선택 행들(없으면 포커스 행 + 펼쳐진 하위)은 작업 단위로 복사 → 안내 칩 표시 + Ctrl+V로 행 붙여넣기 (계층·선행 유지)
      // - 복사 텍스트는 시스템 클립보드에도 넣어 다른 앱(엑셀·메모장 등)에 붙여넣기 가능
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (deferCutCopyToBrowser) return;
        e.preventDefault();
        // 작업명 셀만 포커스(체크 다중 선택 없음): 문자열만 시스템 클립보드 — 내부 행 클립보드 비움(Ctrl+V로 새 작업 추가 방지)
        if (selectedTaskIds.size === 0 && focusedCell?.columnId === 'name' && focusedCell.taskId) {
          const sourceTask = tasks.find((t) => t.id === focusedCell.taskId);
          if (sourceTask) {
            try {
              void navigator.clipboard?.writeText(sourceTask.name ?? '');
            } catch {
              // ignore clipboard errors (permissions, insecure context)
            }
            setCopiedCell(null);
            clearTaskClipboard();
            pushToast('작업명을 복사했습니다.', { variant: 'success' });
            return;
          }
        }
        if (selectedTaskIds.size === 0 && focusedCell && isCellClipboardColumn(focusedCell.columnId)) {
          const sourceTask = tasks.find((t) => t.id === focusedCell.taskId);
          const cell = sourceTask
            ? getWbsCellClipboardData(sourceTask, focusedCell.columnId, {
                statusConfigs,
                visibleTaskIds: visibleTasks.map((t) => t.id),
              })
            : null;
          if (cell) {
            setCopiedCell(cell);
            clearTaskClipboard(); // 가장 최근 복사(셀)만 유효 — 행 클립보드·안내 칩 정리
            try {
              void navigator.clipboard?.writeText(cell.text);
            } catch {
              // ignore clipboard errors (permissions, insecure context)
            }
            const shown = cell.text.length > 24 ? `${cell.text.slice(0, 24)}…` : cell.text;
            pushToast(`셀 값을 복사했습니다${shown ? `: ${shown}` : ' (빈 값)'} — 붙여넣을 셀에서 Ctrl+V`, { variant: 'success' });
            return;
          }
        }
        const copied = copySelectionToClipboard();
        if (copied.length > 0) {
          const namesText = copied
            .map((t) => (t.name ?? '').trim())
            .filter(Boolean)
            .join('\n');
          if (namesText) {
            try {
              void navigator.clipboard?.writeText(namesText);
            } catch {
              // ignore clipboard errors (permissions, insecure context)
            }
          }
          pushToast(`${copied.length}개 작업을 복사했습니다. 붙여넣기(Ctrl+V)로 추가할 수 있습니다.`, { variant: 'success' });
          return;
        }
        // 복사할 행이 전혀 없을 때(포커스도 없음): 포커스 셀의 작업명만이라도 시스템 클립보드에
        const packed = getWbsTableCopyPlainText({ focusedCell, lastSelectedId, tasks });
        if (!packed) return;
        try {
          void navigator.clipboard?.writeText(packed.text);
        } catch {
          // ignore clipboard errors (permissions, insecure context)
        }
        pushToast('작업명을 복사했습니다.', { variant: 'success' });
        return;
      }

      // Delete만 삭제 메뉴 오픈 (Backspace는 브라우저 뒤로가기·입력 필드와 충돌 방지)
      // - 체크박스로 선택된 항목이 있으면 그 항목들(다중) 삭제
      // - 체크가 없어도 현재 포커스된 행(lastSelectedId, 노란색 하이라이트)이 있으면 단일 삭제
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (!canEditCurrentProject) return;
        const targetIds = effectiveSelectedIds.length > 0 ? effectiveSelectedIds : lastSelectedId ? [lastSelectedId] : [];
        if (targetIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: targetIds });
        }
        return;
      }

      // 타이핑 즉시 편집(엑셀식 type-to-edit): 셀 포커스(미편집) 상태에서 인쇄 가능한 문자를 누르면
      // 그 글자로 편집을 시작한다. F2(기존값 유지)와 달리 기존 값을 친 글자로 대체한다.
      // - Ctrl/Meta/Alt 조합·Space(체크 토글)는 제외.
      // - 한글 등 IME 조합 첫 글자는 위 isComposing 가드로 걸러져 영문/숫자/기호에 적용된다.
      if (
        focusedCell &&
        !editingCell &&
        !inlineEditingNameId &&
        !isWbsTableCellTypingTarget(target) &&
        canEditCurrentProject &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.length === 1 &&
        e.key !== ' '
      ) {
        const taskId = focusedCell.taskId;
        const col = focusedCell.columnId;
        const t = tasks.find((x) => x.id === taskId);
        const onScreen = !!t && visibleTasks.some((vt) => vt.id === taskId);
        if (t && onScreen && editableColumnIds.includes(col) && !t.mirroredFromTaskId) {
          const hasChildren = tasks.some((x) => x.parentId === taskId);
          if (canTypeToEditColumn(col, hasChildren)) {
            e.preventDefault();
            const ch = e.key;
            setLastSelectedId(taskId);
            maybeSyncShiftRangeAnchor(taskId);
            document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
            if (col === 'name') {
              setInlineEditingNameId(taskId);
              setEditingCell(null);
              requestAnimationFrame(() => seedCellEditorWhenReady(`wbs-edit-${taskId}-name`, ch));
              return;
            }
            setInlineEditingNameId(null);
            if (TYPE_TO_EDIT_SEED_CONTROLLED_COLUMNS.has(col)) {
              if (col === 'allocation' && !/^\d$/.test(ch)) {
                setEditingCell({ taskId, columnId: col });
              } else {
                setEditingCell({ taskId, columnId: col, typeToEditSeed: ch });
              }
            } else {
              setEditingCell({ taskId, columnId: col });
              requestAnimationFrame(() => seedCellEditorWhenReady(`wbs-edit-${taskId}-${col}`, ch));
            }
            return;
          }
        }
      }

      // F2: 포커스 셀 또는 현재 행·작업명을 즉시 인라인 편집 (격자 UI는 쓰지 않음)
      if (e.key === 'F2') {
        e.preventDefault();
        // 편집 권한 없으면 F2도 동작 안 함 (보기 권한 사용자나 'all' 뷰에서 편집 차단)
        if (!canEditCurrentProject) return;
        if (inlineEditingNameId) {
          commitWbsInlineNameEditFromDom(inlineEditingNameId, tasks, updateTask, canEditCurrentProject);
        }
        // 셀 링(focusedCell)과 행 하이라이트(lastSelectedId)가 어긋난 경우(간트·동기화 등)에도
        // F2는 항상 "보이는 활성 셀" 기준이 되도록: 표시 중인 행에 대한 focusedCell을 lastSelectedId보다 우선한다.
        const taskIdFromFocusedCell = focusedCell && visibleTasks.some((t) => t.id === focusedCell.taskId) ? focusedCell.taskId : null;
        const taskId = taskIdFromFocusedCell ?? lastSelectedId ?? visibleTasks[0]?.id;
        if (!taskId || editableColumnIds.length === 0) return;
        const focusColumnId =
          focusedCell && focusedCell.taskId === taskId && editableColumnIds.includes(focusedCell.columnId)
            ? focusedCell.columnId
            : editableColumnIds.includes('name')
              ? 'name'
              : editableColumnIds[0]!;
        const editColumnId = delegateInlineEditColumnId(focusColumnId, editableColumnIds);
        const cannotOpenInlineEditor = isDerivedScheduleColumnId(focusColumnId) && editColumnId === focusColumnId;

        setLastSelectedId(taskId);
        maybeSyncShiftRangeAnchor(taskId);
        // 체크박스 선택은 유지 (편집만으로 행이 자동 체크되지 않음)
        if (cannotOpenInlineEditor) {
          setFocusedCell({ taskId, columnId: focusColumnId });
          setInlineEditingNameId(null);
          setEditingCell(null);
          document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              tableScrollRef.current?.focus();
            });
          });
          return;
        }

        setFocusedCell({ taskId, columnId: editColumnId });
        if (editColumnId === 'name') {
          setInlineEditingNameId(taskId);
          setEditingCell(null);
        } else {
          setEditingCell({ taskId, columnId: editColumnId });
          setInlineEditingNameId(null);
        }
        document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
        // 가상 스크롤/레이아웃 직후 input이 붙는 타이밍에 맞추기 위해 한 프레임 더 미룸
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.getElementById(`wbs-edit-${taskId}-${editColumnId}`);
            el?.focus();
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.select();
            }
          });
        });
        return;
      }

      // ArrowUp/Down은 표 영역에 포커스가 있을 때만 처리. 그렇지 않으면 간트 등 다른 컴포넌트의
      // 자체 키보드 핸들러가 활성 행을 옮길 수 있도록 양보한다 (전역 window listener라 가드 없으면 가로챔).
      // Shift/Ctrl/Meta+↑↓ 는 일괄 수정 패널 등으로 포커스가 나가도 선택 범위 확장이 되도록 예외.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !target.closest('[data-wbs-table]')) {
        if (!rangeArrowFromOutsideTable) return;
      }

      // 선택 행이 없을 때: 세로 화살표는 처리하지 않음(아래 Alt+↑↓는 lastSelectedId 필요). 그 외 키는 계속 진행.
      if (!lastSelectedId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return;
      }

      // Space: 체크 토글 — 행 포커스(lastSelectedId) 우선(↑/↓와 동일 기준). 없으면 셀 링 행.
      if (e.key === ' ') {
        e.preventDefault();
        const rowId = lastSelectedId ?? focusedCell?.taskId;
        if (!rowId) return;
        const next = new Set(selectedTaskIds);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
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

      if (e.key === 'ArrowUp') {
        if (e.altKey) {
          e.preventDefault();
          // Alt+↑: 한 칸 위로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered && (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
            moveTask(lastSelectedId, 'up');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Shift/Ctrl/Meta+↑: 앵커~한 줄 위까지 체크 범위 확장 (일괄 수정 패널 등 표 밖 포커스 포함)
          const idx = lastSelectedId != null ? (visibleTaskRowIndexById.get(lastSelectedId) ?? -1) : -1;
          const nextIdx = idx > 0 ? idx - 1 : idx;
          if (idx >= 0 && nextIdx !== idx) {
            e.preventDefault();
            const nextTask = visibleTasks[nextIdx]!;
            handleSelect(nextTask.id, e.ctrlKey || e.metaKey, true);
            const navCol: TableColumnId =
              focusedCell && editableColumnIds.includes(focusedCell.columnId) ? focusedCell.columnId : defaultNavColumn;
            setFocusedCell({ taskId: nextTask.id, columnId: navCol });
            document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
            tableScrollRef.current?.focus();
          }
        }
        return;
      } else if (e.key === 'ArrowDown') {
        if (e.altKey) {
          e.preventDefault();
          // Alt+↓: 한 칸 아래로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered && (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
            moveTask(lastSelectedId, 'down');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
          const idx = lastSelectedId != null ? (visibleTaskRowIndexById.get(lastSelectedId) ?? -1) : -1;
          const nextIdx = idx >= 0 && idx < visibleTasks.length - 1 ? idx + 1 : idx;
          if (idx >= 0 && nextIdx !== idx) {
            e.preventDefault();
            const nextTask = visibleTasks[nextIdx]!;
            handleSelect(nextTask.id, e.ctrlKey || e.metaKey, true);
            const navCol: TableColumnId =
              focusedCell && editableColumnIds.includes(focusedCell.columnId) ? focusedCell.columnId : defaultNavColumn;
            setFocusedCell({ taskId: nextTask.id, columnId: navCol });
            document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
            tableScrollRef.current?.focus();
          }
        }
        return;
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey) {
        // Shift+←/→: 트리 접기/펼치기 (←/→는 셀 이동에 전용)
        if (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target)) return;
        // 트리 뷰에서만: Shift+← 접기, Shift+→ 펼치기 (자식이 있는 행에서만 동작)
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
        // 셀 입력 중 Tab은 위 Excel식 이동 블록에서 처리. 그 외에는 들여쓰기/내어쓰기.
        if (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target)) return;
        if (!canEditCurrentProject) return; // 편집 권한 없으면 레벨 변경 비활성화
        e.preventDefault();
        // Tab: 레벨 한 단계 내리기(들여쓰기), Shift+Tab: 레벨 한 단계 올리기(내어쓰기)
        // 체크 선택이 있으면 그 대상들을 일괄 처리, 없으면 포커스된 행(lastSelectedId) 단독 처리.
        let orderedIds: string[] = [];
        if (selectedTaskIds.size > 0) {
          orderedIds = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
        } else if (lastSelectedId) {
          orderedIds = [lastSelectedId];
        }
        if (orderedIds.length === 0) return;
        if (e.shiftKey) {
          outdentTasks(orderedIds);
        } else {
          indentTasks(orderedIds);
        }
      } else if (e.key === 'Enter') {
        // Enter: 동일 레벨(형제) 작업을 현재 행 "아래"에 추가
        // Shift+Enter: 동일 레벨(형제) 작업을 현재 행 "위"에 추가
        // 셀 편집·입력 중에는 비활성화 (작업명 등은 상단 별도 Enter 블록에서 처리)
        if (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target)) return;

        // 셀 포커스만 있을 때 Enter → 작업명 제외 편집 가능 열에서 즉시 편집. Shift+Enter는 위에 행 추가.
        if (!e.shiftKey && focusedCell && canEditCurrentProject) {
          const enterEdit = resolveEnterOpensCellEdit({
            focusedCell,
            editableColumnIds,
            tasks,
            visibleTasks,
          });
          if (enterEdit) {
            e.preventDefault();
            const { taskId, columnId } = enterEdit;
            setLastSelectedId(taskId);
            maybeSyncShiftRangeAnchor(taskId);
            setFocusedCell({ taskId, columnId });
            setEditingCell(enterEdit);
            setInlineEditingNameId(null);
            document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const el = document.getElementById(`wbs-edit-${taskId}-${columnId}`);
                el?.focus();
                if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                  try {
                    el.select();
                  } catch {
                    /* number 등에서 select 미지원 */
                  }
                }
              });
            });
            return;
          }
        }

        if (!canEditCurrentProject) {
          // 조용히 무시하지 않고 이유를 안내 (사내 계정이 '회원 화면 체험' 등으로 막혀도 원인 파악이 쉽도록). id로 연타 시 중복 방지.
          pushToast('편집 권한이 없어 새 작업을 추가할 수 없습니다.', { variant: 'info', id: 'wbs-no-edit-permission' });
          return;
        }
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

        let insertAfterId: string | undefined;
        if (e.shiftKey && baseTask) {
          // 위에 추가: 기준 행 바로 직전의 표시 행 다음에 삽입 → 결과적으로 기준 행 위에 위치
          const baseIndex = visibleTaskRowIndexById.get(baseTask.id) ?? -1;
          insertAfterId = baseIndex > 0 ? visibleTasks[baseIndex - 1].id : undefined;
        } else {
          insertAfterId = baseTask?.id;
        }

        const startIso = filters.startDate || defaultDate;
        const newId = addTask(
          {
            name: '',
            startDate: startIso,
            endDate: filters.endDate || defaultEndDateForNewTask(startIso),
            progress: 0,
            workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
            assignee: filters.assignee || '',
            status: 'todo',
            parentId: parentIdForNew,
          },
          insertAfterId,
        );
        setLastSelectedId(newId);
        maybeSyncShiftRangeAnchor(newId);
        setInlineEditingNameId(newId);
      } else if (e.key === 'Insert') {
        if (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target)) return;
        if (!canEditCurrentProject) {
          // 조용히 무시하지 않고 이유를 안내 (사내 계정이 '회원 화면 체험' 등으로 막혀도 원인 파악이 쉽도록). id로 연타 시 중복 방지.
          pushToast('편집 권한이 없어 새 작업을 추가할 수 없습니다.', { variant: 'info', id: 'wbs-no-edit-permission' });
          return;
        }
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
          const currentIndex = visibleTaskRowIndexById.get(baseTask.id) ?? -1;
          const previousSibling = currentIndex > 0 ? visibleTasks[currentIndex - 1] : undefined;
          const insertAfterId = previousSibling?.id;
          const startIsoUp = filters.startDate || defaultDate;
          const newId = addTask(
            {
              name: '',
              startDate: startIsoUp,
              endDate: filters.endDate || defaultEndDateForNewTask(startIsoUp),
              progress: 0,
              workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: baseTask.parentId ?? null,
            },
            insertAfterId,
          );
          setLastSelectedId(newId);
          maybeSyncShiftRangeAnchor(newId);
          setInlineEditingNameId(newId);
        } else {
          // Insert: 기준 행의 하위 작업 추가 (기준 행이 없으면 루트 하위로 추가)
          const parentForChildId = baseTask?.id ?? null;
          const startIsoIns = filters.startDate || defaultDate;
          const newId = addTask(
            {
              name: '',
              startDate: startIsoIns,
              endDate: filters.endDate || defaultEndDateForNewTask(startIsoIns),
              progress: 0,
              workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
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
          maybeSyncShiftRangeAnchor(newId);
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
    visibleTaskRowIndexById,
    editingTask,
    editingCell,
    inlineEditingNameId,
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
    copiedCell,
    setCopiedCell,
    clearTaskClipboard,
    statusConfigs,
    projectEffortUnitByProjectId,
    addTask,
    rowHeight,
    handleSetRowHeight,
    handleSelectAll,
    toggleExpand,
    pushToast,
    inlineAddingTaskId,
    setInlineAddingTaskId,
    setEditingCell,
    setFocusedCell,
    setInlineEditingNameId,
    setSelection,
    setBulkStatus,
    setBulkAssignee,
    setBulkWorkEffort,
    setBulkProgress,
    tableScrollRef,
    setLastSelectedId,
    syncRangeAnchorForKeyboardFocus,
    handleSelect,
    setDeleteConfirm,
    setCopiedTasks,
    updateTask,
    canEditCurrentProject,
    currentProjectId,
    projects,
    CLIPBOARD_KEY,
    loadClipboardTasks,
  ]);

  // 테이블 내 입력 포커스 제거(커서 깜빡임 방지).
  // 인라인 작업명 편집·하단/인라인 새 작업 입력 중에는 유지 (F2/Enter 후 편집 가능).
  useEffect(() => {
    if (inlineAddingTaskId || inlineEditingNameId) return;
    const el = document.activeElement;
    if (!el || !tableScrollRef.current?.contains(el)) return;
    if ((el as HTMLElement).closest?.('[data-quick-add]')) return;
    // armed(편집 전) 작업명 입력은 한글 IME 첫 자모를 받기 위한 캐처라 blur하지 않는다(포커스 유지).
    if ((el as HTMLElement).hasAttribute?.('data-wbs-armed')) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.blur();
      tableScrollRef.current?.focus();
    }
  }, [inlineAddingTaskId, inlineEditingNameId]);
}
