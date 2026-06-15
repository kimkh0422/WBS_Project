import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Task, TaskStatus, FilterState, SortConfig, Project, WorkEffortUnit } from '../../types';
import type { TableColumnId, WbsEditingCellPayload } from '../wbsTableTypes';
import type { TaskWithDepth } from '../../lib/taskView';
import { isComposingKeyEvent } from '../../lib/ime';
import { commitWbsInlineNameEditFromDom } from '../../lib/wbsInlineNameCommit';
import { pasteClipboardTasks, resolvePasteTargetAfterWhichInsert } from '../../lib/wbsClipboard';
import {
  buildMarqueeWbsCellClipboardGrid,
  buildWbsCellPasteUpdate,
  getWbsCellClipboardData,
  isCellClipboardColumn,
  wbsCopiedCellRegionToTsv,
  type WbsCellClipboardData,
  type WbsCopiedCellRegion,
  type WbsStatusConfigLite,
} from '../../lib/wbsCellClipboard';
import { DEFAULT_NEW_TASK_WORK_EFFORT, normalizeWorkEffortUnit, startEndForNewTaskBelowVisibleRow } from '../../lib/workEffortUnits';
import { delegateInlineEditColumnId, isDerivedScheduleColumnId } from '../../lib/wbsReadonlyGridColumns';
import { buildSiblingMoveStepsFromSelection, resolveProjectTasksForSiblingMove } from '../../lib/siblingMoveKeyboard';
import {
  cellMarqueeKeysToTargets,
  expandWbsMarqueeInternalPastePairs,
  expandWbsMarqueePlainPastePairs,
  jumpWbsCellArrowToEdge,
  parseClipboardTsvToTextGrid,
  stepWbsCellArrow,
  type WbsMarqueeCell,
} from '../../lib/wbsCellMarquee';

/** 작업명 열만 직사각형 선택된 경우 표시 순서의 작업 id. 다른 열이 섞이면 null */
function visibleOrderedTaskIdsForNameOnlyCellMarquee(
  cellMarqueeKeySet: ReadonlySet<string> | null,
  visibleTasks: TaskWithDepth[],
): string[] | null {
  if (!cellMarqueeKeySet || cellMarqueeKeySet.size === 0) return null;
  const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
  if (targets.length === 0) return null;
  if (!targets.every((t) => t.columnId === 'name')) return null;
  const idSet = new Set(targets.map((t) => t.taskId));
  const ordered = visibleTasks.filter((t) => idSet.has(t.id)).map((t) => t.id);
  return ordered.length > 0 ? ordered : null;
}

/** 마퀴에 포함된 모든 행 id(표시 순서). 열이 섞여 있어도 직사각형에 걸친 행 전부. */
function visibleOrderedTaskIdsFromCellMarquee(
  cellMarqueeKeySet: ReadonlySet<string> | null,
  visibleTasks: TaskWithDepth[],
): string[] | null {
  if (!cellMarqueeKeySet || cellMarqueeKeySet.size === 0) return null;
  const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
  if (targets.length === 0) return null;
  const idSet = new Set(targets.map((t) => t.taskId));
  const ordered = visibleTasks.filter((t) => idSet.has(t.id)).map((t) => t.id);
  return ordered.length > 0 ? ordered : null;
}
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

/**
 * `lastSelectedId`가 접힘·필터 등으로 `visibleTasks`에 없을 때 ↑/↓·←/→가 먹통이 되지 않도록
 * 실제 격자에 보이는 행 id로 정규화한다. 우선순위: 보이는 lastSelected → 보이는 focusedCell 행
 * → 숨겨진 lastSelected의 보이는 조상.
 */
function resolveVisibleTaskIdForKeyboardNav(opts: {
  lastSelectedId: string | null;
  focusedCellTaskId: string | null;
  visibleIndexById: Map<string, number>;
  tasks: Task[];
}): string | null {
  const { lastSelectedId, focusedCellTaskId, visibleIndexById, tasks } = opts;
  if (lastSelectedId && visibleIndexById.has(lastSelectedId)) return lastSelectedId;
  if (focusedCellTaskId && visibleIndexById.has(focusedCellTaskId)) return focusedCellTaskId;
  if (lastSelectedId) {
    let id: string | null = lastSelectedId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (visibleIndexById.has(id)) return id;
      const t = tasks.find((x) => x.id === id);
      id = t?.parentId ?? null;
    }
  }
  return null;
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
 * 첫 글자를 native value로 주입할 수 있는 컬럼, 또는 allocation·진척률·dependencies처럼 `typeToEditSeed`로
 * controlled 편집기에 넘기는 컬럼. status(select)·파생(계획율·차이) 셀은 제외.
 */
const TYPE_TO_EDIT_COLUMNS = new Set<string>([
  'name',
  'startDate',
  'endDate',
  'duration',
  'progress',
  'assignee',
  'deliverables',
  'allocation',
  'dependencies',
]);
/** 첫 글자는 DOM seed 대신 `editingCell.typeToEditSeed`로 행에 전달(controlled input). */
const TYPE_TO_EDIT_SEED_CONTROLLED_COLUMNS = new Set<string>(['allocation', 'progress', 'dependencies']);
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
  /** 마우스 마퀴 셀 범위 — Esc 시 함께 해제 */
  cellMarqueeRange: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null;
  /** 마퀴로 선택된 셀 키 집합(`taskId::columnId`) — Ctrl+V 일괄 붙여넣기에 사용 */
  cellMarqueeKeySet: ReadonlySet<string> | null;
  editableColumnIds: TableColumnId[];
  /** 표에 보이는 컬럼 순서 — 마퀴 TSV/격자 붙여넣기 기하에 사용 */
  visibleColumnIds: TableColumnId[];
  /** 확인 없이 즉시 삭제(하위 포함). Delete 키·Ctrl+X 공통 */
  performDeleteTaskIds: (taskIds: string[]) => void;
  copiedTasks: Task[];
  /** 엑셀식 셀 단위 클립보드 — 행(작업) 클립보드와 둘 중 "가장 최근 복사"만 유효 */
  copiedCellRegion: WbsCopiedCellRegion | null;
  setCopiedCellRegion: (region: WbsCopiedCellRegion | null) => void;
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
  /** Ctrl/Meta+↑↓ 체크 추가 시 앵커 동기화 등 — 키보드 포커스와 rangeAnchor 정합 */
  syncRangeAnchorForKeyboardFocus?: (taskId: string | null) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setCellMarqueeRange: (
    range: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null,
  ) => void;
  setInlineEditingNameId: (id: string | null) => void;
  setEditingCell: (cell: WbsEditingCellPayload | null) => void;
  setSelection: (next: Set<string>) => void;
  setBulkStatus: (v: TaskStatus | '') => void;
  setBulkAssignee: (v: string) => void;
  setBulkDurationDays: (v: string) => void;
  setBulkProgress: (v: string) => void;
  setCopiedTasks: (tasks: Task[]) => void;

  // Actions
  addTask: (task: Partial<Task>, insertAfterId?: string) => string;
  insertPastedTasksInOrder: (
    rows: Array<{ id: string; draft: Omit<Task, 'id' | 'projectId'>; insertAfterId?: string }>,
    projectIdOverride?: string,
  ) => string[];
  updateTask: (id: string, updates: Partial<Task>) => void;
  moveTask: (id: string, direction: 'up' | 'down') => void;
  applySiblingMoveSteps: (steps: ReadonlyArray<{ id: string; direction: 'up' | 'down' }>) => void;
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
    cellMarqueeRange,
    cellMarqueeKeySet,
    editableColumnIds,
    visibleColumnIds,
    performDeleteTaskIds,
    copiedTasks,
    copiedCellRegion,
    setCopiedCellRegion,
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
    setCellMarqueeRange,
    setInlineEditingNameId,
    setEditingCell,
    setSelection,
    setBulkStatus,
    setBulkAssignee,
    setBulkDurationDays,
    setBulkProgress,
    setCopiedTasks,
    addTask,
    insertPastedTasksInOrder,
    updateTask,
    moveTask,
    applySiblingMoveSteps,
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

  /** 연속 화살표: 리렌더 전 다음 keydown이 와도 엑셀처럼 한 칸씩 즉시 이동하도록 커서를 동기 유지 */
  const cellNavCursorRef = useRef<{ lastSelectedId: string | null; focusedCell: { taskId: string; columnId: TableColumnId } | null }>({
    lastSelectedId,
    focusedCell,
  });
  useEffect(() => {
    cellNavCursorRef.current.lastSelectedId = lastSelectedId;
    cellNavCursorRef.current.focusedCell = focusedCell;
  }, [lastSelectedId, focusedCell]);

  const focusTableScrollIfNeeded = () => {
    const el = tableScrollRef.current;
    if (el && document.activeElement !== el) el.focus();
  };

  /** 리스너는 마운트 시 한 번만 붙이고 본문은 ref로 최신화 — Shift+↑↓ 연타 시 effect 재구독 사이에 keydown이 유실되는 것을 방지 */
  const hotkeysEnabledRef = useRef(hotkeysEnabled);
  hotkeysEnabledRef.current = hotkeysEnabled;
  const excelViewRef = useRef(excelView);
  excelViewRef.current = excelView;

  /** Shift+↑/↓ 체크 구간용(행 id). 셀 마퀴 앵커는 keyboardCellShiftAnchorRef */
  const keyboardShiftPivotIdRef = useRef<string | null>(null);
  /** Shift+화살표로 셀 범위 확장 시 고정 앵커(엑셀). Shift 없는 화살표·Esc에서 해제 */
  const keyboardCellShiftAnchorRef = useRef<WbsMarqueeCell | null>(null);

  useEffect(() => {
    if (!cellMarqueeRange) {
      keyboardCellShiftAnchorRef.current = null;
      return;
    }
    const ma = cellMarqueeRange.anchor;
    const ka = keyboardCellShiftAnchorRef.current;
    if (!ka || ka.taskId !== ma.taskId || ka.columnId !== ma.columnId) {
      keyboardCellShiftAnchorRef.current = ma;
    }
  }, [cellMarqueeRange]);

  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});

  handleKeyDownRef.current = (e: KeyboardEvent) => {
    if (!hotkeysEnabledRef.current) return;
    if (isComposingKeyEvent(e)) return;
    const target = e.target as HTMLElement;
    if (editingTask) return;
    if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;

    // 엑셀 뷰(ag-grid)에서는 기본 키보드 동작(Tab/Enter/Insert 등)을 그대로 사용하도록
    // 전역 단축키를 비활성화한다.
    if (excelViewRef.current) {
      const inAgGrid = (target as HTMLElement).closest?.('.ag-root');
      if (inAgGrid) return;
    }

    const inWbsTable = (target as HTMLElement).closest?.('[data-wbs-table]');
    const inQuickAdd = (target as HTMLElement).closest?.('[data-quick-add]');

    // 화살표로 셀을 옮긴 직후, 리렌더·리스너 재구독 전에 이어지는 keydown은 closure의 focusedCell/lastSelectedId가
    // 한 틱 늦을 수 있다. cellNavCursorRef는 같은 keydown 처리 안에서 동기 갱신되므로 여기서 우선한다.
    const cursorFocusedCell = cellNavCursorRef.current.focusedCell ?? focusedCell;
    const cursorLastSelectedId = cellNavCursorRef.current.lastSelectedId ?? lastSelectedId;

    /** 키보드로 셀/행 커서만 옮길 때는 체크 다중 선택을 해제해 포커스 행과 어긋나지 않게 한다 (Ctrl/Meta+↑↓ 범위 확장은 제외). */
    const clearBulkCheckboxSelectionOnKeyboardCursorMove = () => {
      if (selectedTaskIds.size > 0) {
        setSelection(new Set());
        setBulkStatus('');
        setBulkAssignee('');
        setBulkDurationDays('');
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
            cellNavCursorRef.current = {
              lastSelectedId: lastTask.id,
              focusedCell: { taskId: lastTask.id, columnId: 'name' },
            };
            document.getElementById(`task-row-${lastTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
          focusTableScrollIfNeeded();
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
    /** 일괄 수정 바 등 표 밖 포커스에서도 Ctrl/Meta+↑↓ 로 체크 범위·다중 선택 확장 (Shift+↑↓는 셀 이동 전용 — SELECT·간트 막대는 제외) */
    const rangeArrowFromOutsideTable =
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
      (e.ctrlKey || e.metaKey) &&
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
    // 이 시점부터 ←/→로 자유 이동 가능. Shift+Enter: 표와 동일하게 현재 행 위에 형제 새 작업 추가 후 작업명 인라인 편집.
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
          if (!canEditCurrentProject) {
            pushToast('편집 권한이 없어 새 작업을 추가할 수 없습니다.', { variant: 'info', id: 'wbs-no-edit-permission' });
            setFocusedCell({ taskId: currentTaskId, columnId: currentColId });
          } else {
            const baseTask = tasks.find((t) => t.id === currentTaskId) || null;
            const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
            const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
            const parentIdForNew = baseTask?.parentId ?? null;
            const fallbackStart = filters.startDate || defaultDate;
            let insertAfterId: string | undefined;
            let rowAboveNew: (typeof tasks)[number] | null | undefined;
            if (baseTask) {
              const baseIndex = visibleTaskRowIndexById.get(baseTask.id) ?? -1;
              rowAboveNew = baseIndex > 0 ? visibleTasks[baseIndex - 1] : null;
              insertAfterId = baseIndex > 0 ? visibleTasks[baseIndex - 1].id : undefined;
            } else {
              rowAboveNew = null;
              insertAfterId = undefined;
            }
            const { startIso, endIso } = startEndForNewTaskBelowVisibleRow(rowAboveNew, fallbackStart, filters.endDate);
            const newId = addTask(
              {
                name: '',
                startDate: startIso,
                endDate: endIso,
                progress: 0,
                workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
                assignee: filters.assignee || '',
                status: 'todo',
                parentId: parentIdForNew,
              },
              insertAfterId,
            );
            clearBulkCheckboxSelectionOnKeyboardCursorMove();
            setLastSelectedId(newId);
            maybeSyncShiftRangeAnchor(newId);
            setInlineEditingNameId(newId);
            document.getElementById(`task-row-${newId}`)?.scrollIntoView({ block: 'nearest' });
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
    // Shift+Enter는 위에 행 추가(로컬 onInsertRowAbove)로만 처리 — 캡처 단계에서 여기 잡으면 이중 커밋·충돌이 난다.
    // 정책: 다음 기존 행을 자동으로 편집 모드로 만들지 않는다(기존 작업명 오타 수정 사고 방지).
    // 실제 작업명 input에 포커스가 있으면 Enter는 SortableTaskRow만 처리한다. 전역 캡처에서 먼저 커밋·편집 종료까지
    // 하면 로컬의 onAdvanceInlineEditToNextRow와 setState 배치 순서가 꼬여 다음 빈 행 편집으로 넘어가지 못하고
    // Enter를 한 번 더 눌러야 하는 회귀가 난다.
    if (e.key === 'Enter' && inlineEditingNameId && inWbsTable && !e.shiftKey) {
      const nameInputId = `wbs-edit-${inlineEditingNameId}-name`;
      if (target.id === nameInputId) {
        return;
      }
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

    // 다중(체크 ≥2행 또는 셀 마퀴 2칸 이상) + 비편집: Tab/Shift+Tab은 엑셀식 셀 이동보다 들여쓰기·내어쓰기 우선
    // (작업명만 마퀴가 아닌 열 혼합 직사각형일 때도 Shift+Tab이 마지막 셀만 움직이던 문제 방지)
    const tabBulkLevelTargets = selectedTaskIds.size > 1 || (cellMarqueeKeySet?.size ?? 0) > 1;
    const tabPreferBulkLevel = e.key === 'Tab' && !editingCell && !inlineEditingNameId && tabBulkLevelTargets;

    // Tab / Shift+Tab: 셀 단위 좌우 이동 (Excel 스타일)
    // - 편집 중(셀 편집 또는 작업명 인라인 편집): 현재 입력값 커밋(blur) 후 다음/이전 셀로 이동하여 계속 편집
    // - 편집 모드 + 셀 포커스만 있는 상태: 포커스만 다음/이전 셀로 이동
    // - 행 끝/시작에서는 인접 행의 처음/마지막 셀로 자동 이동(엑셀과 동일)
    // - number 타입 input에서도 Tab은 셀 이동(arrow는 값 증감용)
    if (
      e.key === 'Tab' &&
      target.closest('[data-wbs-table]') &&
      editableColumnIds.length > 0 &&
      !tabPreferBulkLevel &&
      (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target))
    ) {
      const currentTaskId = editingCell?.taskId ?? inlineEditingNameId ?? focusedCell?.taskId ?? null;
      const currentColId: TableColumnId | null = editingCell?.columnId ?? (inlineEditingNameId ? 'name' : (focusedCell?.columnId ?? null));
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
    // Alt+↑↓(행 순서)·Ctrl/Meta+↑↓(체크)는 아래에서 처리.
    // Shift+화살표: 엑셀처럼 앵커~활성 셀 직사각형 확장. Shift 없음: 한 칸 이동(마퀴·키보드 앵커 해제).
    const defaultNavColumn: TableColumnId = editableColumnIds.includes('name')
      ? 'name'
      : ((editableColumnIds[0] as TableColumnId | undefined) ?? 'name');
    const snap = cellNavCursorRef.current;
    const navColFromFocus =
      snap.focusedCell && editableColumnIds.includes(snap.focusedCell.columnId) ? snap.focusedCell.columnId : defaultNavColumn;
    const keyboardNavTaskId = resolveVisibleTaskIdForKeyboardNav({
      lastSelectedId: snap.lastSelectedId,
      focusedCellTaskId: snap.focusedCell?.taskId ?? null,
      visibleIndexById: visibleTaskRowIndexById,
      tasks,
    });
    const effectiveArrowCell = keyboardNavTaskId != null ? { taskId: keyboardNavTaskId, columnId: navColFromFocus } : null;
    const arrowCellNavKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const ctrlShiftCellMarqueeNav = e.shiftKey && (e.ctrlKey || e.metaKey) && arrowCellNavKey;
    if (
      !editingCell &&
      !inlineEditingNameId &&
      !isWbsTableCellTypingTarget(target) &&
      effectiveArrowCell &&
      editableColumnIds.length > 0 &&
      !e.altKey &&
      ((!e.ctrlKey && !e.metaKey) || ctrlShiftCellMarqueeNav)
    ) {
      const stepOpts = {
        visibleTasks,
        columnIds: editableColumnIds,
        visibleTaskRowIndexById,
        defaultNavColumn,
      } as const;

      const applySingleCellNav = (next: WbsMarqueeCell) => {
        keyboardShiftPivotIdRef.current = null;
        clearBulkCheckboxSelectionOnKeyboardCursorMove();
        setFocusedCell(next);
        setLastSelectedId(next.taskId);
        maybeSyncShiftRangeAnchor(next.taskId);
        cellNavCursorRef.current = {
          lastSelectedId: next.taskId,
          focusedCell: next,
        };
        document.getElementById(`task-row-${next.taskId}`)?.scrollIntoView({ block: 'nearest' });
        focusTableScrollIfNeeded();
      };

      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const endCell: WbsMarqueeCell =
          cellMarqueeRange?.end ??
          (snap.focusedCell && editableColumnIds.includes(snap.focusedCell.columnId)
            ? { taskId: snap.focusedCell.taskId, columnId: snap.focusedCell.columnId }
            : { taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId });

        let anchorCell = keyboardCellShiftAnchorRef.current;
        if (!anchorCell) {
          anchorCell = cellMarqueeRange?.anchor ?? endCell;
          keyboardCellShiftAnchorRef.current = anchorCell;
        }

        const dir = e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
        const next = e.ctrlKey || e.metaKey ? jumpWbsCellArrowToEdge(endCell, dir, stepOpts) : stepWbsCellArrow(endCell, dir, stepOpts);
        if (!next) {
          e.preventDefault();
          focusTableScrollIfNeeded();
          return;
        }
        e.preventDefault();
        keyboardShiftPivotIdRef.current = null;
        clearBulkCheckboxSelectionOnKeyboardCursorMove();
        setCellMarqueeRange({ anchor: anchorCell, end: next });
        applySingleCellNav(next);
        return;
      }

      keyboardCellShiftAnchorRef.current = null;
      setCellMarqueeRange(null);

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const next = stepWbsCellArrow({ taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId }, e.key, stepOpts);
        if (next) {
          e.preventDefault();
          applySingleCellNav(next);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        keyboardShiftPivotIdRef.current = null;
        const rowIdx = visibleTaskRowIndexById.get(effectiveArrowCell.taskId) ?? -1;
        let colIdx = editableColumnIds.indexOf(effectiveArrowCell.columnId);
        if (colIdx < 0) colIdx = Math.max(0, editableColumnIds.indexOf(defaultNavColumn));
        if (
          rowIdx >= 0 &&
          colIdx >= 0 &&
          e.key === 'ArrowDown' &&
          rowIdx === visibleTasks.length - 1 &&
          canEditCurrentProject &&
          ghostPlaceholderRowCount > 0
        ) {
          e.preventDefault();
          clearBulkCheckboxSelectionOnKeyboardCursorMove();
          setFocusedCell(null);
          setGhostFocusIdx(0);
          cellNavCursorRef.current.focusedCell = null;
          focusTableScrollIfNeeded();
          return;
        }
        const next = stepWbsCellArrow({ taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId }, e.key, stepOpts);
        e.preventDefault();
        clearBulkCheckboxSelectionOnKeyboardCursorMove();
        if (next) {
          applySingleCellNav(next);
        }
        focusTableScrollIfNeeded();
        return;
      }
    }

    // Esc: 편집·포커스·편집 모드·인라인 추가·선택을 한 번에 해제 (여러 상태가 겹쳐 있어도 1회로 정리)
    if (e.key === 'Escape') {
      const hadOverlay =
        editingCell != null ||
        inlineEditingNameId != null ||
        focusedCell != null ||
        inlineAddingTaskId != null ||
        selectedTaskIds.size > 0 ||
        cellMarqueeRange != null;

      if (!hadOverlay) return;

      if (editingCell) setEditingCell(null);
      if (inlineEditingNameId) setInlineEditingNameId(null);
      if (focusedCell) setFocusedCell(null);
      if (inlineAddingTaskId) setInlineAddingTaskId(null);
      if (cellMarqueeRange != null) setCellMarqueeRange(null);
      keyboardShiftPivotIdRef.current = null;
      keyboardCellShiftAnchorRef.current = null;
      if (selectedTaskIds.size > 0) {
        setSelection(new Set());
        setBulkStatus('');
        setBulkAssignee('');
        setBulkDurationDays('');
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
    if (inlineEditingNameId) return;
    // 시작일 등은 클릭만으로 편집 input에 포커스가 가므로, 내부 격자/행 붙여넣기(Ctrl+V)는 여기서 막지 않는다.
    // (막으면 브라우저 기본 붙여넣기만 시도해 type=date 등에서는 아무 반응이 없는 것처럼 보임)
    const isPasteKey = (e.ctrlKey || e.metaKey) && e.key === 'v';
    const internalPasteShortcut = isPasteKey && (copiedCellRegion != null || copiedTasks.length > 0 || loadClipboardTasks().length > 0);
    if ((editingCell && !internalPasteShortcut) || (typingInWbsCell && !tabPreferBulkLevel && !internalPasteShortcut)) return;
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
      // 0) 셀 클립보드(가장 최근 복사가 셀/마퀴 영역) — 커서 기준 격자 붙여넣기(엑셀과 동일)
      // 1) 내부 작업 클립보드가 있으면 작업 단위 붙여넣기 — 다중 행 선택 시 맨 위 선택 행 아래에 끼워 넣기
      // 2) 없으면 시스템 클립보드 텍스트(TSV면 격자)를 커서 기준으로 반영
      e.preventDefault();
      // 편집 중 input에 포커스가 있어도 위에서 통과한 경우 — blur 후 상태로 붙여넣기 적용
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditingCell(null);

      const applyInternalPastePairs = (pairs: Array<{ taskId: string; columnId: TableColumnId; source: WbsCellClipboardData }>) => {
        const visibleTaskIds = visibleTasks.map((t) => t.id);
        let applied = 0;
        let failed = 0;
        let firstError: string | null = null;
        for (const p of pairs) {
          const t = tasks.find((x) => x.id === p.taskId);
          if (!t) continue;
          const res = buildWbsCellPasteUpdate(t, p.columnId, p.source, {
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
        } else if (pairs.length > 1) {
          pushToast(`${applied}개 셀에 붙여넣었습니다${failed > 0 ? ` (${failed}개 실패)` : ''}.`, { variant: 'success' });
        } else if (applied > 0) {
          pushToast('셀 값을 붙여넣었습니다.', { variant: 'success' });
        } else {
          pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
        }
      };

      if (copiedCellRegion) {
        if (!canEditCurrentProject) {
          pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
          return;
        }
        const grid = copiedCellRegion.grid;
        const gridRows = grid.length;
        const gridCols = grid[0]?.length ?? 0;
        if (gridRows === 0 || gridCols === 0) {
          pushToast('붙여넣을 셀 내용이 없습니다.', { variant: 'info' });
          return;
        }
        const marqueeMultiCells = (cellMarqueeKeySet?.size ?? 0) > 1;
        const checkedRows = selectedTaskIds.size > 0 ? visibleTasks.filter((t) => selectedTaskIds.has(t.id)) : [];

        let pairs: Array<{ taskId: string; columnId: TableColumnId; source: WbsCellClipboardData }>;

        if (marqueeMultiCells) {
          // 엑셀: 단일 셀 복사 후 직사각형 선택에 붙여넣으면 선택된 모든 셀에 동일 값
          if (gridRows === 1 && gridCols === 1) {
            const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
            const cell0 = grid[0]![0]!;
            if (targets.length > 0) {
              pairs = targets.map((cell) => ({
                taskId: cell.taskId,
                columnId: cell.columnId,
                source: cell0,
              }));
            } else {
              const anchor: WbsMarqueeCell | null =
                focusedCell ??
                (cellMarqueeRange ? { taskId: cellMarqueeRange.anchor.taskId, columnId: cellMarqueeRange.anchor.columnId } : null);
              if (!anchor) {
                pushToast('붙여넣기할 셀 커서를 먼저 지정하세요.', { variant: 'info' });
                return;
              }
              pairs = expandWbsMarqueeInternalPastePairs({
                anchor,
                sourceGrid: grid,
                visibleTasks,
                visibleColumnIds,
              });
            }
          } else {
            const anchor: WbsMarqueeCell | null =
              focusedCell ??
              (cellMarqueeRange ? { taskId: cellMarqueeRange.anchor.taskId, columnId: cellMarqueeRange.anchor.columnId } : null);
            if (!anchor) {
              pushToast('붙여넣기할 셀 커서를 먼저 지정하세요.', { variant: 'info' });
              return;
            }
            pairs = expandWbsMarqueeInternalPastePairs({
              anchor,
              sourceGrid: grid,
              visibleTasks,
              visibleColumnIds,
            });
          }
        } else if (checkedRows.length > 1 && gridRows === 1 && gridCols === 1) {
          const cell0 = grid[0]![0]!;
          pairs = checkedRows.map((row) => ({ taskId: row.id, columnId: cell0.columnId, source: cell0 }));
        } else {
          const cell00 = grid[0]![0]!;
          const anchor: WbsMarqueeCell | null =
            focusedCell ?? (lastSelectedId ? { taskId: lastSelectedId, columnId: cell00.columnId } : null);
          if (!anchor) {
            pushToast('붙여넣을 셀을 먼저 클릭하세요.', { variant: 'info' });
            return;
          }
          pairs = expandWbsMarqueeInternalPastePairs({
            anchor,
            sourceGrid: grid,
            visibleTasks,
            visibleColumnIds,
          });
        }

        if (pairs.length === 0) {
          pushToast('붙여넣을 수 있는 범위가 없습니다.', { variant: 'info' });
          return;
        }
        applyInternalPastePairs(pairs);
        return;
      }

      const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
      if (clipboard.length > 0) {
        if (!canEditCurrentProject) {
          pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
          return;
        }
        const pasteAnchorTaskId = resolvePasteTargetAfterWhichInsert({
          focusedOrLastTaskId: focusedCell?.taskId ?? lastSelectedId,
          selectedTaskIds,
          visibleTasks,
        });
        const addedIds = pasteClipboardTasks({
          clipboard,
          targetId: pasteAnchorTaskId,
          visibleTaskIds: visibleTasks.map((t) => t.id),
          tasks,
          insertPastedTasksInOrder,
          updateTask,
        });
        if (addedIds.length > 0) {
          setSelection(new Set(addedIds));
          const lastPasted = addedIds[addedIds.length - 1];
          setLastSelectedId(lastPasted);
          syncRangeAnchorForKeyboardFocus?.(lastPasted);
          pushToast(`${addedIds.length}개 작업을 붙여넣었습니다.`, { variant: 'success' });
        }
        return;
      }

      // 내부 행 클립보드가 없을 때: 시스템 클립보드 — 마퀴 다중이면 커서 기준 격자, 아니면 TSV/첫 줄 규칙
      const checkedRows = selectedTaskIds.size > 0 ? visibleTasks.filter((t) => selectedTaskIds.has(t.id)) : [];
      const cursorTaskId = focusedCell?.taskId ?? lastSelectedId;
      const targetColumnId: TableColumnId = focusedCell?.columnId ?? 'name';
      if (!canEditCurrentProject) return;
      const visibleTaskIds = visibleTasks.map((t) => t.id);
      void (async () => {
        let text = '';
        try {
          text = await navigator.clipboard.readText();
        } catch {
          pushToast('클립보드를 읽을 수 없습니다.', { variant: 'error' });
          return;
        }
        const trimmedAll = text.trim();
        if (!trimmedAll) {
          pushToast('붙여넣을 텍스트가 없습니다.', { variant: 'info' });
          return;
        }

        const applyPlainPairs = (pairs: Array<{ taskId: string; columnId: TableColumnId; text: string }>) => {
          let applied = 0;
          let failed = 0;
          let firstError: string | null = null;
          for (const p of pairs) {
            const t = tasks.find((x) => x.id === p.taskId);
            if (!t) continue;
            const cellText = p.text ?? '';
            if (!cellText.trim()) continue;
            const res = buildWbsCellPasteUpdate(
              t,
              p.columnId,
              { text: cellText },
              {
                tasks,
                visibleTaskIds,
                statusConfigs,
                effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
              },
            );
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
          } else if (pairs.filter((x) => (x.text ?? '').trim()).length > 1) {
            pushToast(`${applied}개 셀에 붙여넣었습니다${failed > 0 ? ` (${failed}개 실패)` : ''}.`, { variant: 'success' });
          } else if (applied > 0) {
            const soleCol = pairs[0]?.columnId;
            pushToast(soleCol === 'name' ? '작업명을 붙여넣었습니다.' : '셀에 붙여넣었습니다.', { variant: 'success' });
          } else {
            pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
          }
        };

        const marqueeMultiCells = (cellMarqueeKeySet?.size ?? 0) > 1;
        const tsvGrid = parseClipboardTsvToTextGrid(text);

        if (marqueeMultiCells) {
          const multiSourceGrid = tsvGrid.length > 1 || (tsvGrid[0]?.length ?? 0) > 1;
          const singleCellText = tsvGrid[0]?.[0] ?? text;
          if (!multiSourceGrid) {
            const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
            if (targets.length > 0) {
              const pairs = targets.map((cell) => ({
                taskId: cell.taskId,
                columnId: cell.columnId,
                text: singleCellText,
              }));
              applyPlainPairs(pairs);
              return;
            }
          }
          const anchor: WbsMarqueeCell | null =
            focusedCell ??
            (cellMarqueeRange ? { taskId: cellMarqueeRange.anchor.taskId, columnId: cellMarqueeRange.anchor.columnId } : null);
          if (!anchor) {
            pushToast('붙여넣기할 셀 커서를 먼저 지정하세요.', { variant: 'info' });
            return;
          }
          const pairs = multiSourceGrid
            ? expandWbsMarqueePlainPastePairs({ anchor, textGrid: tsvGrid, visibleTasks, visibleColumnIds })
            : [{ taskId: anchor.taskId, columnId: anchor.columnId, text: singleCellText }];
          applyPlainPairs(pairs);
          return;
        }

        const multiCellTsv = tsvGrid.length > 1 || (tsvGrid[0]?.length ?? 0) > 1;
        if (multiCellTsv) {
          const anchor: WbsMarqueeCell | null = focusedCell ?? (cursorTaskId ? { taskId: cursorTaskId, columnId: targetColumnId } : null);
          if (!anchor) {
            pushToast('작업을 선택한 뒤 붙여넣기 하세요.', { variant: 'info' });
            return;
          }
          const pairs = expandWbsMarqueePlainPastePairs({ anchor, textGrid: tsvGrid, visibleTasks, visibleColumnIds });
          applyPlainPairs(pairs);
          return;
        }

        const firstLine = (text.split(/\r?\n/)[0] ?? '').trim();
        if (!firstLine) {
          pushToast('붙여넣을 텍스트가 없습니다.', { variant: 'info' });
          return;
        }
        const pasteTargets: Array<{ taskId: string; columnId: TableColumnId }> =
          checkedRows.length > 0
            ? checkedRows.map((t) => ({ taskId: t.id, columnId: targetColumnId }))
            : cursorTaskId
              ? [{ taskId: cursorTaskId, columnId: targetColumnId }]
              : [];
        if (pasteTargets.length === 0) {
          pushToast('작업을 선택한 뒤 붙여넣기 하세요.', { variant: 'info' });
          return;
        }
        let applied = 0;
        let failed = 0;
        let firstError: string | null = null;
        for (const pt of pasteTargets) {
          const t = tasks.find((x) => x.id === pt.taskId);
          if (!t) continue;
          const res = buildWbsCellPasteUpdate(
            t,
            pt.columnId,
            { text: firstLine },
            {
              tasks,
              visibleTaskIds,
              statusConfigs,
              effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
            },
          );
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
        } else if (pasteTargets.length > 1) {
          pushToast(`${applied}개 셀에 붙여넣었습니다${failed > 0 ? ` (${failed}개 실패)` : ''}.`, { variant: 'success' });
        } else if (applied > 0) {
          const soleCol = pasteTargets[0]?.columnId;
          pushToast(soleCol === 'name' ? '작업명을 붙여넣었습니다.' : '셀에 붙여넣었습니다.', { variant: 'success' });
        } else {
          pushToast('값이 같아 변경할 내용이 없습니다.', { variant: 'info' });
        }
      })();
      return;
    }

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
      setCopiedCellRegion(null); // 가장 최근 복사(행)만 유효 — 셀 클립보드 대체
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

    // Cut: copy + delete (즉시 삭제, 확인 없음)
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
        performDeleteTaskIds(idsForDelete);
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
      if (selectedTaskIds.size === 0 && cellMarqueeRange && (cellMarqueeKeySet?.size ?? 0) > 1) {
        const region = buildMarqueeWbsCellClipboardGrid(visibleTasks, visibleColumnIds, cellMarqueeRange.anchor, cellMarqueeRange.end, {
          statusConfigs,
          visibleTaskIds: visibleTasks.map((t) => t.id),
        });
        if (region) {
          setCopiedCellRegion(region);
          clearTaskClipboard();
          try {
            void navigator.clipboard?.writeText(wbsCopiedCellRegionToTsv(region));
          } catch {
            // ignore clipboard errors (permissions, insecure context)
          }
          const rows = region.grid.length;
          const cols = region.grid[0]?.length ?? 0;
          pushToast(`셀 영역을 복사했습니다 (${rows}×${cols}). 커서 셀을 기준으로 Ctrl+V 하면 엑셀처럼 붙여넣습니다.`, {
            variant: 'success',
          });
          return;
        }
      }
      // 작업명 셀만 포커스(체크 다중 선택 없음): 문자열만 시스템 클립보드 — 내부 행 클립보드 비움(Ctrl+V로 새 작업 추가 방지)
      if (selectedTaskIds.size === 0 && focusedCell?.columnId === 'name' && focusedCell.taskId) {
        const sourceTask = tasks.find((t) => t.id === focusedCell.taskId);
        if (sourceTask) {
          try {
            void navigator.clipboard?.writeText(sourceTask.name ?? '');
          } catch {
            // ignore clipboard errors (permissions, insecure context)
          }
          setCopiedCellRegion(null);
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
          setCopiedCellRegion({ grid: [[cell]] });
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
      // 표 안 값 입력 중이면 문자 삭제 등 기본 동작 유지
      if (isWbsTableCellTypingTarget(target)) return;
      e.preventDefault();
      if (!canEditCurrentProject) return;
      // 셀 마퀴(1칸 이상): 엑셀처럼 행 삭제가 아니라 선택 셀 값만 비움
      const marqueeHasCells = (cellMarqueeKeySet?.size ?? 0) >= 1;
      if (marqueeHasCells && cellMarqueeKeySet) {
        const visibleTaskIds = visibleTasks.map((t) => t.id);
        const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
        let cleared = 0;
        let failed = 0;
        let firstError: string | null = null;
        for (const cell of targets) {
          if (!editableColumnIds.includes(cell.columnId)) continue;
          const t = tasks.find((x) => x.id === cell.taskId);
          if (!t || t.mirroredFromTaskId) continue;
          if (!visibleTasks.some((vt) => vt.id === cell.taskId)) continue;

          if (cell.columnId === 'name') {
            if ((t.name ?? '').trim() !== '') {
              updateTask(cell.taskId, { name: '' });
              cleared += 1;
            }
            continue;
          }

          const res = buildWbsCellPasteUpdate(
            t,
            cell.columnId,
            { text: '' },
            {
              tasks,
              visibleTaskIds,
              statusConfigs,
              effortUnit: normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(t.projectId)),
            },
          );
          if (res.error) {
            failed += 1;
            if (!firstError) firstError = res.error;
            continue;
          }
          if (res.updates) {
            updateTask(cell.taskId, res.updates);
            cleared += 1;
          }
        }
        if (cleared > 0) {
          pushToast(
            failed > 0
              ? `${cleared}개 셀 내용을 지웠습니다${firstError ? ` (${failed}개는 지울 수 없음)` : ''}.`
              : `${cleared}개 셀 내용을 지웠습니다.`,
            { variant: 'success' },
          );
        } else if (failed > 0 && firstError) {
          pushToast(firstError, { variant: 'warning' });
        }
        return;
      }
      // 마퀴 없이 값 셀(종료일·시작일 등)만 포커스: 엑셀처럼 그 셀만 비움. 체크 다중 선택이 있으면 아래 행 삭제로 유지.
      if (
        selectedTaskIds.size === 0 &&
        cursorFocusedCell &&
        isCellClipboardColumn(cursorFocusedCell.columnId) &&
        editableColumnIds.includes(cursorFocusedCell.columnId)
      ) {
        const cell = cursorFocusedCell;
        const visibleTaskIds = visibleTasks.map((t) => t.id);
        const t = visibleTasks.some((vt) => vt.id === cell.taskId) ? tasks.find((x) => x.id === cell.taskId) : undefined;
        if (t && !t.mirroredFromTaskId) {
          const res = buildWbsCellPasteUpdate(
            t,
            cell.columnId,
            { text: '' },
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
            updateTask(cell.taskId, res.updates);
            pushToast('셀 내용을 지웠습니다.', { variant: 'success' });
          }
          return;
        }
        // 값 셀 포커스인데 지울 수 없는 행(거울 등)이면 행 삭제 확인으로 넘기지 않음
        if (t?.mirroredFromTaskId) return;
      }
      const targetIds = effectiveSelectedIds.length > 0 ? effectiveSelectedIds : lastSelectedId ? [lastSelectedId] : [];
      if (targetIds.length > 0) {
        performDeleteTaskIds(targetIds);
      }
      return;
    }

    // 타이핑 즉시 편집(엑셀식 type-to-edit): 셀 포커스(미편집) 상태에서 인쇄 가능한 문자를 누르면
    // 그 글자로 편집을 시작한다. F2(기존값 유지)와 달리 기존 값을 친 글자로 대체한다.
    // - Ctrl/Meta/Alt 조합·Space(체크 토글)는 제외.
    // - 한글 등 IME 조합 첫 글자는 위 isComposing 가드로 걸러져 영문/숫자/기호에 적용된다.
    if (
      cursorFocusedCell &&
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
      const taskId = cursorFocusedCell.taskId;
      const col = cursorFocusedCell.columnId;
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
            const useSeed = col === 'allocation' ? /^\d$/.test(ch) : col === 'progress' ? /^[\d.]$/.test(ch) : true;
            if (useSeed) {
              setEditingCell({ taskId, columnId: col, typeToEditSeed: ch });
            } else {
              setEditingCell({ taskId, columnId: col });
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
      const taskIdFromFocusedCell =
        cursorFocusedCell && visibleTasks.some((t) => t.id === cursorFocusedCell.taskId) ? cursorFocusedCell.taskId : null;
      const taskId = taskIdFromFocusedCell ?? cursorLastSelectedId ?? visibleTasks[0]?.id;
      if (!taskId || editableColumnIds.length === 0) return;
      const focusColumnId =
        cursorFocusedCell && cursorFocusedCell.taskId === taskId && editableColumnIds.includes(cursorFocusedCell.columnId)
          ? cursorFocusedCell.columnId
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
    // Ctrl/Meta+↑↓ 는 일괄 수정 패널 등으로 포커스가 나가도 체크 선택 범위 확장이 되도록 예외.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !target.closest('[data-wbs-table]')) {
      if (!rangeArrowFromOutsideTable) return;
    }

    // 선택 행이 없을 때: 세로 화살표는 처리하지 않음(아래 Alt+↑↓는 lastSelectedId 필요). 그 외 키는 계속 진행.
    // 예외: Alt+↑↓ + 체크 다중 선택(≥2)은 lastSelectedId 없이도 형제 이동만 처리한다.
    if (!cursorLastSelectedId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const allowAltMulti = e.altKey && selectedTaskIds.size > 1 && canEditCurrentProject;
      if (!allowAltMulti) return;
    }

    // Space: 체크 토글 — 행 포커스(lastSelectedId) 우선(↑/↓와 동일 기준). 없으면 셀 링 행.
    // 다중 셀(마퀴) 선택 중이면: 마퀴에 걸친 모든 행을 체크 다중 선택으로 전환(엑셀식).
    if (e.key === ' ') {
      e.preventDefault();
      const marqueeMultiCells = (cellMarqueeKeySet?.size ?? 0) > 1;
      if (marqueeMultiCells && cellMarqueeKeySet) {
        const idSet = new Set(cellMarqueeKeysToTargets(cellMarqueeKeySet).map((c) => c.taskId));
        const orderedRowIds = visibleTasks.filter((t) => idSet.has(t.id)).map((t) => t.id);
        if (orderedRowIds.length > 0) {
          setSelection(new Set(orderedRowIds));
          setBulkStatus('');
          setBulkAssignee('');
          setBulkDurationDays('');
          setBulkProgress('');
          const primary = orderedRowIds[0]!;
          setLastSelectedId(primary);
          syncRangeAnchorForKeyboardFocus?.(primary);
          cellNavCursorRef.current = {
            lastSelectedId: primary,
            focusedCell: cursorFocusedCell ?? { taskId: primary, columnId: 'name' },
          };
          return;
        }
      }
      const rowId = cursorLastSelectedId ?? cursorFocusedCell?.taskId;
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
      keyboardShiftPivotIdRef.current = null;
      if (e.altKey) {
        e.preventDefault();
        if (!canEditCurrentProject) return;
        if (isSortedOrFiltered) return;
        if (selectedTaskIds.size > 1) {
          const pt = resolveProjectTasksForSiblingMove(tasks, currentProjectId, selectedTaskIds);
          if (pt) {
            const steps = buildSiblingMoveStepsFromSelection(pt, selectedTaskIds, 'up');
            if (steps.length > 0) {
              applySiblingMoveSteps(steps);
              const scrollId = lastSelectedId && selectedTaskIds.has(lastSelectedId) ? lastSelectedId : [...selectedTaskIds][0]!;
              requestAnimationFrame(() => document.getElementById(`task-row-${scrollId}`)?.scrollIntoView({ block: 'nearest' }));
            }
          }
          return;
        }
        const canMove =
          selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && lastSelectedId != null && selectedTaskIds.has(lastSelectedId));
        if (canMove && lastSelectedId) {
          moveTask(lastSelectedId, 'up');
          requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
        }
        return;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Meta+↑: 한 줄 위 행을 체크 선택에 추가 (일괄 수정 패널 등 표 밖 포커스 포함)
        const snapR = cellNavCursorRef.current;
        const idx = snapR.lastSelectedId != null ? (visibleTaskRowIndexById.get(snapR.lastSelectedId) ?? -1) : -1;
        const nextIdx = idx > 0 ? idx - 1 : idx;
        if (idx >= 0 && nextIdx !== idx) {
          e.preventDefault();
          const nextTask = visibleTasks[nextIdx]!;
          keyboardShiftPivotIdRef.current = null;
          handleSelect(nextTask.id, true, true);
          const navCol: TableColumnId =
            snapR.focusedCell && editableColumnIds.includes(snapR.focusedCell.columnId) ? snapR.focusedCell.columnId : defaultNavColumn;
          setFocusedCell({ taskId: nextTask.id, columnId: navCol });
          cellNavCursorRef.current = {
            lastSelectedId: nextTask.id,
            focusedCell: { taskId: nextTask.id, columnId: navCol },
          };
          document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
          focusTableScrollIfNeeded();
        }
      }
      return;
    } else if (e.key === 'ArrowDown') {
      keyboardShiftPivotIdRef.current = null;
      if (e.altKey) {
        e.preventDefault();
        if (!canEditCurrentProject) return;
        if (isSortedOrFiltered) return;
        if (selectedTaskIds.size > 1) {
          const pt = resolveProjectTasksForSiblingMove(tasks, currentProjectId, selectedTaskIds);
          if (pt) {
            const steps = buildSiblingMoveStepsFromSelection(pt, selectedTaskIds, 'down');
            if (steps.length > 0) {
              applySiblingMoveSteps(steps);
              const scrollId = lastSelectedId && selectedTaskIds.has(lastSelectedId) ? lastSelectedId : [...selectedTaskIds][0]!;
              requestAnimationFrame(() => document.getElementById(`task-row-${scrollId}`)?.scrollIntoView({ block: 'nearest' }));
            }
          }
          return;
        }
        const canMove =
          selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && lastSelectedId != null && selectedTaskIds.has(lastSelectedId));
        if (canMove && lastSelectedId) {
          moveTask(lastSelectedId, 'down');
          requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
        }
        return;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Meta+↓: 한 줄 아래 행을 체크 선택에 추가 (일괄 수정 패널 등 표 밖 포커스 포함)
        const snapR = cellNavCursorRef.current;
        const idx = snapR.lastSelectedId != null ? (visibleTaskRowIndexById.get(snapR.lastSelectedId) ?? -1) : -1;
        const nextIdx = idx >= 0 && idx < visibleTasks.length - 1 ? idx + 1 : idx;
        if (idx >= 0 && nextIdx !== idx) {
          e.preventDefault();
          const nextTask = visibleTasks[nextIdx]!;
          keyboardShiftPivotIdRef.current = null;
          handleSelect(nextTask.id, true, true);
          const navCol: TableColumnId =
            snapR.focusedCell && editableColumnIds.includes(snapR.focusedCell.columnId) ? snapR.focusedCell.columnId : defaultNavColumn;
          setFocusedCell({ taskId: nextTask.id, columnId: navCol });
          cellNavCursorRef.current = {
            lastSelectedId: nextTask.id,
            focusedCell: { taskId: nextTask.id, columnId: navCol },
          };
          document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
          focusTableScrollIfNeeded();
        }
      }
      return;
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift+←/→: 트리 접기/펼치기 (←/→는 셀 이동에 전용). Ctrl+Shift+←/→는 셀 마퀴 끝까지 확장 전용.
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
      if (isTreeView && cursorLastSelectedId) {
        const task = tasks.find((t) => t.id === cursorLastSelectedId);
        const hasChildren = task ? tasks.some((t) => t.parentId === task.id) : false;
        if (hasChildren) {
          if (e.key === 'ArrowLeft' && task?.expanded) {
            e.preventDefault();
            toggleExpand(cursorLastSelectedId);
          } else if (e.key === 'ArrowRight' && !task?.expanded) {
            e.preventDefault();
            toggleExpand(cursorLastSelectedId);
          }
        }
      }
    } else if (e.key === 'Tab') {
      // 셀 입력 중 Tab은 위 Excel식 이동 블록에서 처리. 그 외에는 들여쓰기/내어쓰기.
      if (editingCell || inlineEditingNameId || (isWbsTableCellTypingTarget(target) && !tabPreferBulkLevel)) return;
      if (!canEditCurrentProject) return; // 편집 권한 없으면 레벨 변경 비활성화
      e.preventDefault();
      // Tab: 레벨 한 단계 내리기(들여쓰기), Shift+Tab: 레벨 한 단계 올리기(내어쓰기)
      // 체크 선택 → 작업명 열만 셀 마퀴(Shift+화살표) → 마지막으로 포커스 행(lastSelectedId) 순.
      const fromNameMarquee = visibleOrderedTaskIdsForNameOnlyCellMarquee(cellMarqueeKeySet, visibleTasks);
      const fromAnyMarquee = visibleOrderedTaskIdsFromCellMarquee(cellMarqueeKeySet, visibleTasks);
      const marqueeRangeSnap =
        cellMarqueeRange && (cellMarqueeKeySet?.size ?? 0) > 1
          ? ({ anchor: cellMarqueeRange.anchor, end: cellMarqueeRange.end } as const)
          : null;

      let orderedIds: string[] = [];
      /** 작업명 열 마퀴 1행만: 들여·내어쓴 뒤 마퀴를 다시 그린다. 2행 이상은 아래에서 행 선택으로 바꿔 체크 다중과 동일 처리. */
      let nameMarqueeRestore: string[] | null = null;
      /** 작업명 마퀴 다중 → 체크 다중으로 전환했으므로 마퀴 스냅샷으로 복원하지 않는다. */
      let syncedNameMarqueeToCheckboxRows = false;

      if (selectedTaskIds.size > 0) {
        orderedIds = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
      } else if (fromNameMarquee && fromNameMarquee.length >= 2) {
        // 작업명 셀만 직사각형 2행 이상: Tab/Shift+Tab은 체크박스로 여러 행을 고른 것과 동일 경로(동일 id·순서).
        orderedIds = fromNameMarquee;
        syncedNameMarqueeToCheckboxRows = true;
        setCellMarqueeRange(null);
        setSelection(new Set(fromNameMarquee));
        syncRangeAnchorForKeyboardFocus?.(fromNameMarquee[0]!);
        const lastRow = fromNameMarquee[fromNameMarquee.length - 1]!;
        setLastSelectedId(lastRow);
        setFocusedCell({ taskId: lastRow, columnId: 'name' });
      } else if (fromNameMarquee && fromNameMarquee.length > 0) {
        orderedIds = fromNameMarquee;
        nameMarqueeRestore = fromNameMarquee;
      } else if (fromAnyMarquee && fromAnyMarquee.length > 0) {
        orderedIds = fromAnyMarquee;
      } else if (cursorLastSelectedId) {
        orderedIds = [cursorLastSelectedId];
      }
      if (orderedIds.length === 0) return;
      if (e.shiftKey) {
        outdentTasks(orderedIds);
      } else {
        indentTasks(orderedIds);
      }
      if (nameMarqueeRestore && nameMarqueeRestore.length > 0) {
        const first = nameMarqueeRestore[0]!;
        const last = nameMarqueeRestore[nameMarqueeRestore.length - 1]!;
        requestAnimationFrame(() => {
          setCellMarqueeRange({
            anchor: { taskId: first, columnId: 'name' },
            end: { taskId: last, columnId: 'name' },
          });
        });
      } else if (!syncedNameMarqueeToCheckboxRows && marqueeRangeSnap) {
        requestAnimationFrame(() => {
          setCellMarqueeRange({ anchor: marqueeRangeSnap.anchor, end: marqueeRangeSnap.end });
        });
      }
    } else if (e.key === 'Enter') {
      // Enter: 동일 레벨(형제) 작업을 현재 행 "아래"에 추가
      // Shift+Enter: 동일 레벨(형제) 작업을 현재 행 "위"에 추가
      // 셀 편집·입력 중에는 비활성화 (작업명 등은 상단 별도 Enter 블록에서 처리)
      if (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target)) return;

      // 셀 포커스만 있을 때 Enter → 작업명 제외 편집 가능 열에서 즉시 편집. Shift+Enter는 위에 행 추가.
      if (!e.shiftKey && cursorFocusedCell && canEditCurrentProject) {
        const enterEdit = resolveEnterOpensCellEdit({
          focusedCell: cursorFocusedCell,
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
        (cursorLastSelectedId
          ? tasks.find((t) => t.id === cursorLastSelectedId)
          : visibleTasks.length > 0
            ? tasks.find((t) => t.id === visibleTasks[visibleTasks.length - 1].id)
            : undefined) || null;

      const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
      const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

      const parentIdForNew = baseTask?.parentId ?? null; // 기준 행이 없으면 루트 작업으로 추가

      const fallbackStart = filters.startDate || defaultDate;

      let insertAfterId: string | undefined;
      let rowAboveNew: (typeof tasks)[number] | null | undefined;
      if (e.shiftKey && baseTask) {
        // 위에 추가: 기준 행 바로 직전의 표시 행 다음에 삽입 → 결과적으로 기준 행 위에 위치
        const baseIndex = visibleTaskRowIndexById.get(baseTask.id) ?? -1;
        rowAboveNew = baseIndex > 0 ? visibleTasks[baseIndex - 1] : null;
        insertAfterId = baseIndex > 0 ? visibleTasks[baseIndex - 1].id : undefined;
      } else {
        insertAfterId = baseTask?.id;
        rowAboveNew = baseTask ?? null;
      }

      const { startIso, endIso } = startEndForNewTaskBelowVisibleRow(rowAboveNew, fallbackStart, filters.endDate);
      const newId = addTask(
        {
          name: '',
          startDate: startIso,
          endDate: endIso,
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
        const fallbackStart = filters.startDate || defaultDate;
        const { startIso, endIso } = startEndForNewTaskBelowVisibleRow(previousSibling, fallbackStart, filters.endDate);
        const newId = addTask(
          {
            name: '',
            startDate: startIso,
            endDate: endIso,
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
        const fallbackStart = filters.startDate || defaultDate;
        const { startIso, endIso } = startEndForNewTaskBelowVisibleRow(baseTask, fallbackStart, filters.endDate);
        const newId = addTask(
          {
            name: '',
            startDate: startIso,
            endDate: endIso,
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

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      handleKeyDownRef.current(e);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        keyboardShiftPivotIdRef.current = null;
      }
    };
    window.addEventListener('keydown', listener, true);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', listener, true);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

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
