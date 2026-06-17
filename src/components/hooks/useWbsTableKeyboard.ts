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
  taskDatePairEmptyAfterPatch,
  WBS_DATE_PAIR_NONEMPTY_MESSAGE,
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
  stepWbsCellPageVertical,
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

/** anchor~end 행 구간의 작업 id(표시 순서). keySet이 비어 있어도 range만으로 다중 행 판별·일괄 레벨 조정에 사용. */
function visibleOrderedTaskIdsFromMarqueeRange(
  range: { anchor: { taskId: string }; end: { taskId: string } } | null,
  visibleTasks: TaskWithDepth[],
): string[] | null {
  if (!range) return null;
  const r1 = visibleTasks.findIndex((t) => t.id === range.anchor.taskId);
  const r2 = visibleTasks.findIndex((t) => t.id === range.end.taskId);
  if (r1 < 0 || r2 < 0) return null;
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  const ordered = visibleTasks.slice(lo, hi + 1).map((t) => t.id);
  return ordered.length > 0 ? ordered : null;
}

/** Tab/Shift+Tab 일괄 들여쓰기·내어쓰기 대상 행 id(표시 순서)와 마퀴 복원 힌트 */
export function resolveTabLevelAdjustOrderedIds(opts: {
  selectedTaskIds: ReadonlySet<string>;
  visibleTasks: TaskWithDepth[];
  tasks: Task[];
  cellMarqueeKeySet: ReadonlySet<string> | null;
  cellMarqueeRange: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null;
  cursorLastSelectedId: string | null;
}): {
  orderedIds: string[];
  syncedMarqueeToCheckboxRows: boolean;
  nameMarqueeRestore: string[] | null;
  marqueeRangeSnap: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null;
} {
  const { selectedTaskIds, visibleTasks, tasks, cellMarqueeKeySet, cellMarqueeRange, cursorLastSelectedId } = opts;

  const fromRangeRows = visibleOrderedTaskIdsFromMarqueeRange(cellMarqueeRange, visibleTasks);
  const fromKeySetRows = visibleOrderedTaskIdsFromCellMarquee(cellMarqueeKeySet, visibleTasks);
  const fromAnyMarquee = fromKeySetRows ?? fromRangeRows;

  const fromNameMarquee =
    visibleOrderedTaskIdsForNameOnlyCellMarquee(cellMarqueeKeySet, visibleTasks) ??
    (cellMarqueeRange && cellMarqueeRange.anchor.columnId === 'name' && cellMarqueeRange.end.columnId === 'name' ? fromRangeRows : null);

  const marqueeRangeSnap =
    cellMarqueeRange && ((cellMarqueeKeySet?.size ?? 0) > 1 || (fromRangeRows?.length ?? 0) > 1)
      ? ({ anchor: cellMarqueeRange.anchor, end: cellMarqueeRange.end } as const)
      : null;

  const checkboxOrdered =
    selectedTaskIds.size > 0
      ? (() => {
          const visibleOrdered = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
          const visibleSet = new Set(visibleOrdered);
          const hiddenSelected = tasks.filter((t) => selectedTaskIds.has(t.id) && !visibleSet.has(t.id)).map((t) => t.id);
          return [...visibleOrdered, ...hiddenSelected];
        })()
      : [];

  const marqueeRows = fromAnyMarquee && fromAnyMarquee.length >= 2 ? fromAnyMarquee : null;
  const preferMarqueeRows = marqueeRows != null && (selectedTaskIds.size <= 1 || marqueeRows.length > selectedTaskIds.size);

  let orderedIds: string[] = [];
  let nameMarqueeRestore: string[] | null = null;
  let syncedMarqueeToCheckboxRows = false;

  if (selectedTaskIds.size > 1 && !preferMarqueeRows) {
    orderedIds = checkboxOrdered;
  } else if (marqueeRows) {
    orderedIds = marqueeRows;
    syncedMarqueeToCheckboxRows = true;
  } else if (fromNameMarquee && fromNameMarquee.length >= 2) {
    orderedIds = fromNameMarquee;
    syncedMarqueeToCheckboxRows = true;
  } else if (checkboxOrdered.length > 0) {
    orderedIds = checkboxOrdered;
  } else if (fromNameMarquee && fromNameMarquee.length > 0) {
    orderedIds = fromNameMarquee;
    nameMarqueeRestore = fromNameMarquee;
  } else if (fromAnyMarquee && fromAnyMarquee.length > 0) {
    orderedIds = fromAnyMarquee;
  } else if (cursorLastSelectedId) {
    orderedIds = [cursorLastSelectedId];
  }

  return { orderedIds, syncedMarqueeToCheckboxRows, nameMarqueeRestore, marqueeRangeSnap };
}

export function shouldPreferBulkTabLevelChange(opts: {
  selectedTaskIdsSize: number;
  cellMarqueeKeySetSize: number;
  marqueeRangeRowCount: number;
}): boolean {
  return opts.selectedTaskIdsSize > 1 || opts.cellMarqueeKeySetSize > 1 || opts.marqueeRangeRowCount > 1;
}

/** Space 체크 토글: 다중 체크 선택이면 포커스 행이 선택 안에 있을 때 전체 해제, 밖이면 그 행만 추가 */
export function resolveSpaceCheckboxSelection(opts: { selectedTaskIds: ReadonlySet<string>; focusRowId: string }): Set<string> {
  const { selectedTaskIds, focusRowId } = opts;
  if (selectedTaskIds.size > 1) {
    if (selectedTaskIds.has(focusRowId)) {
      return new Set();
    }
    const next = new Set(selectedTaskIds);
    next.add(focusRowId);
    return next;
  }
  const next = new Set(selectedTaskIds);
  if (next.has(focusRowId)) next.delete(focusRowId);
  else next.add(focusRowId);
  return next;
}

/** Space: 셀 마퀴·범위 → 체크할 행 id(표시 순서). 2행 이상일 때만 반환 */
export function resolveMarqueeRowsForSpaceCheckbox(opts: {
  cellMarqueeKeySet: ReadonlySet<string> | null;
  cellMarqueeRange: { anchor: { taskId: string }; end: { taskId: string } } | null;
  visibleTasks: TaskWithDepth[];
}): string[] | null {
  const { cellMarqueeKeySet, cellMarqueeRange, visibleTasks } = opts;
  if ((cellMarqueeKeySet?.size ?? 0) > 1 && cellMarqueeKeySet) {
    const idSet = new Set(cellMarqueeKeysToTargets(cellMarqueeKeySet).map((c) => c.taskId));
    const orderedRowIds = visibleTasks.filter((t) => idSet.has(t.id)).map((t) => t.id);
    return orderedRowIds.length > 1 ? orderedRowIds : null;
  }
  const fromRange = visibleOrderedTaskIdsFromMarqueeRange(cellMarqueeRange, visibleTasks);
  return fromRange && fromRange.length > 1 ? fromRange : null;
}

/** Tab/Shift+Tab 다중 레벨 변경: 셀 마퀴(2행 이상) → 체크 행 선택으로 전환 */
function syncCellMarqueeRowsToCheckboxSelection(
  rowIds: string[],
  setCellMarqueeRange: (
    range: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null,
  ) => void,
  setSelection: (next: Set<string>) => void,
  syncRangeAnchorForKeyboardFocus: ((id: string) => void) | undefined,
  setLastSelectedId: (id: string | null) => void,
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void,
): void {
  if (rowIds.length < 2) return;
  setCellMarqueeRange(null);
  setSelection(new Set(rowIds));
  syncRangeAnchorForKeyboardFocus?.(rowIds[0]!);
  const lastRow = rowIds[rowIds.length - 1]!;
  setLastSelectedId(lastRow);
  setFocusedCell({ taskId: lastRow, columnId: 'name' });
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
  'workEffort',
  'weight',
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

/** 편집 커밋 후·셀 선택만 있을 때 Enter — 같은 열의 아래 행(↓와 동일 격자 규칙). */
function applyWbsEnterMoveDown(opts: {
  currentTaskId: string;
  currentColId: TableColumnId;
  visibleTasks: TaskWithDepth[];
  editableColumnIds: TableColumnId[];
  visibleTaskRowIndexById: Map<string, number>;
  canEditCurrentProject: boolean;
  ghostPlaceholderRowCount: number;
  keyboardCellShiftAnchorRef: { current: WbsMarqueeCell | null };
  cellNavCursorRef: {
    current: { lastSelectedId: string | null; focusedCell: { taskId: string; columnId: TableColumnId } | null };
  };
  clearBulkCheckboxSelectionOnKeyboardCursorMove: () => void;
  maybeSyncShiftRangeAnchor: (taskId: string) => void;
  setCellMarqueeRange: (
    range: { anchor: { taskId: string; columnId: TableColumnId }; end: { taskId: string; columnId: TableColumnId } } | null,
  ) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setLastSelectedId: (id: string | null) => void;
  setGhostFocusIdx: (idx: number | null) => void;
  focusTableScrollIfNeeded: () => void;
}): void {
  const {
    currentTaskId,
    currentColId,
    visibleTasks,
    editableColumnIds,
    visibleTaskRowIndexById,
    canEditCurrentProject,
    ghostPlaceholderRowCount,
    keyboardCellShiftAnchorRef,
    cellNavCursorRef,
    clearBulkCheckboxSelectionOnKeyboardCursorMove,
    maybeSyncShiftRangeAnchor,
    setCellMarqueeRange,
    setFocusedCell,
    setLastSelectedId,
    setGhostFocusIdx,
    focusTableScrollIfNeeded,
  } = opts;
  const defaultNavColumnEnter: TableColumnId = editableColumnIds.includes('name')
    ? 'name'
    : ((editableColumnIds[0] as TableColumnId | undefined) ?? 'name');
  const stepOptsEnter = {
    visibleTasks,
    columnIds: editableColumnIds,
    visibleTaskRowIndexById,
    defaultNavColumn: defaultNavColumnEnter,
  } as const;
  const nextCell = stepWbsCellArrow({ taskId: currentTaskId, columnId: currentColId }, 'ArrowDown', stepOptsEnter);
  const rowIdx = visibleTaskRowIndexById.get(currentTaskId) ?? -1;
  let colIdx = editableColumnIds.indexOf(currentColId);
  if (colIdx < 0) colIdx = Math.max(0, editableColumnIds.indexOf(defaultNavColumnEnter));
  if (
    !nextCell &&
    rowIdx >= 0 &&
    colIdx >= 0 &&
    rowIdx === visibleTasks.length - 1 &&
    canEditCurrentProject &&
    ghostPlaceholderRowCount > 0
  ) {
    keyboardCellShiftAnchorRef.current = null;
    setCellMarqueeRange(null);
    clearBulkCheckboxSelectionOnKeyboardCursorMove();
    setFocusedCell(null);
    setGhostFocusIdx(0);
    cellNavCursorRef.current.focusedCell = null;
  } else if (nextCell) {
    keyboardCellShiftAnchorRef.current = null;
    setCellMarqueeRange(null);
    clearBulkCheckboxSelectionOnKeyboardCursorMove();
    setLastSelectedId(nextCell.taskId);
    maybeSyncShiftRangeAnchor(nextCell.taskId);
    setFocusedCell(nextCell);
    cellNavCursorRef.current = {
      lastSelectedId: nextCell.taskId,
      focusedCell: nextCell,
    };
    document.getElementById(`task-row-${nextCell.taskId}`)?.scrollIntoView({ block: 'nearest' });
  } else {
    setFocusedCell({ taskId: currentTaskId, columnId: currentColId });
  }
  focusTableScrollIfNeeded();
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
  /** 키보드로 행 포커스가 바뀔 때 rangeAnchor 정합 — Space·Shift 구간 등과 동기 */
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
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  applySiblingMoveSteps: (steps: ReadonlyArray<{ id: string; direction: 'up' | 'down' }>) => void;
  indentTask: (id: string) => void;
  outdentTask: (id: string) => void;
  indentTasks: (ids: string[]) => void;
  outdentTasks: (ids: string[]) => void;
  toggleExpand: (id: string) => void;
  handleSetRowHeight: (h: number) => void;
  handleSelectAll: () => void;
  pushToast: (msg: string, opts?: { variant?: string; id?: string; durationMs?: number }) => void;
  loadClipboardTasks: () => Task[];

  // Refs
  tableScrollRef: RefObject<HTMLDivElement | null>;

  // Constants
  CLIPBOARD_KEY: string;

  /** 다중 셀 붙여넣기 직후 붙여넣은 범위를 잠시 다른 색으로 표시(2셀 이상일 때만). */
  flashPastedCells: (keys: readonly string[]) => void;
  /** 복사·Esc 등으로 이전 붙여넣기 하이라이트를 즉시 지울 때 */
  clearPastedCellFlash?: () => void;
  /** 붙여넣기 직후 범위 표시가 켜져 있으면 Esc로 함께 해제한다 */
  pastedFlashActive?: boolean;
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
    undo,
    redo,
    canUndo,
    canRedo,
    moveTask,
    applySiblingMoveSteps,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    toggleExpand,
    handleSetRowHeight,
    handleSelectAll,
    pushToast,
    loadClipboardTasks,
    tableScrollRef,
    CLIPBOARD_KEY,
    flashPastedCells,
    clearPastedCellFlash,
    pastedFlashActive = false,
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
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const canRedoRef = useRef(canRedo);
  canRedoRef.current = canRedo;
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
    if (isComposingKeyEvent(e)) return;
    const target = e.target as HTMLElement;

    // Ctrl+Z / Ctrl+Y·Shift+Z — 셀 INPUT 편집 중에도 앱 실행 취소(브라우저 기본 undo는 React 입력에서 동작하지 않음)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = (k === 'y' && !e.shiftKey) || (k === 'z' && e.shiftKey);
      if (isUndo || isRedo) {
        const inWbsTable = target.closest?.('[data-wbs-table]');
        const tableHasFocus =
          !!tableScrollRef.current &&
          (document.activeElement === tableScrollRef.current || tableScrollRef.current.contains(document.activeElement));
        const inQuickAdd = target.closest?.('[data-quick-add]');
        if ((inWbsTable || tableHasFocus) && !inQuickAdd && !editingTask) {
          e.preventDefault();
          e.stopPropagation();
          if (inlineEditingNameId) {
            commitWbsInlineNameEditFromDom(inlineEditingNameId, tasks, updateTask, canEditCurrentProject);
            setInlineEditingNameId(null);
          }
          setEditingCell(null);
          (document.activeElement as HTMLElement | null)?.blur?.();
          tableScrollRef.current?.focus();
          if (isUndo && canUndoRef.current) undoRef.current();
          else if (isRedo && canRedoRef.current) redoRef.current();
          return;
        }
      }
    }

    if (!hotkeysEnabledRef.current) return;
    if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (editingTask) return;

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

    /** 체크(행) 다중 선택은 Esc로만 해제 — 셀/행 커서 이동 시에는 비우지 않는다. */
    const clearBulkCheckboxSelectionOnKeyboardCursorMove = () => {};

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
    /** 표 밖 INPUT/SELECT에 포커스여도 Ctrl/Meta+화살표(Shift 없음)로 격자 끝 이동은 처리(일괄 수정 바 등) */
    const isCtrlArrowNoShift =
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    const hasWbsKeyboardCursor =
      lastSelectedId != null ||
      focusedCell != null ||
      cellNavCursorRef.current.lastSelectedId != null ||
      cellNavCursorRef.current.focusedCell != null;
    const ctrlArrowCellEdgeFromOutsideInput =
      isCtrlArrowNoShift &&
      hasWbsKeyboardCursor &&
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

    const marqueeRowIdsFromRange = visibleOrderedTaskIdsFromMarqueeRange(cellMarqueeRange, visibleTasks);
    const marqueeRowIdsFromKeys = visibleOrderedTaskIdsFromCellMarquee(cellMarqueeKeySet, visibleTasks);
    const marqueeRowCountForTab = Math.max(marqueeRowIdsFromRange?.length ?? 0, marqueeRowIdsFromKeys?.length ?? 0);
    // 다중(체크 ≥2행 또는 셀 마퀴 2행·2칸 이상): Tab/Shift+Tab은 엑셀식 셀 이동·표 밖 입력 가드보다 들여쓰기·내어쓰기 우선
    const tabBulkLevelTargets = shouldPreferBulkTabLevelChange({
      selectedTaskIdsSize: selectedTaskIds.size,
      cellMarqueeKeySetSize: cellMarqueeKeySet?.size ?? 0,
      marqueeRangeRowCount: marqueeRowCountForTab,
    });
    const tabPreferBulkLevel = e.key === 'Tab' && tabBulkLevelTargets;
    if (tabPreferBulkLevel) {
      // Shift+Tab은 브라우저 기본(이전 포커스)보다 먼저 막아야 다중 내어쓰기가 동작한다.
      e.preventDefault();
      e.stopPropagation();
    }

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

    // 표 밖의 일반 입력/셀렉트 포커스 중에는 단축키 미동작 (Ctrl/Meta+화살표 격자 끝 이동·다중 Tab 레벨 변경만 예외)
    if (
      !inWbsTable &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT') &&
      !ctrlArrowCellEdgeFromOutsideInput &&
      !tabPreferBulkLevel
    )
      return;

    // 비-name 셀(assignee/status/progress/등) 편집 중 Enter: 값 커밋 후 엑셀처럼 같은 열의 한 행 아래로 포커스 이동.
    // 마지막 행에서는 ↓와 동일하게 ghost 행이 있으면 ghost로 진입, 없으면 같은 셀에 머무름.
    // Shift+Enter: 표와 동일하게 현재 행 위에 형제 새 작업 추가 후 작업명 인라인 편집.
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
          applyWbsEnterMoveDown({
            currentTaskId,
            currentColId,
            visibleTasks,
            editableColumnIds,
            visibleTaskRowIndexById,
            canEditCurrentProject,
            ghostPlaceholderRowCount,
            keyboardCellShiftAnchorRef,
            cellNavCursorRef,
            clearBulkCheckboxSelectionOnKeyboardCursorMove,
            maybeSyncShiftRangeAnchor,
            setCellMarqueeRange,
            setFocusedCell,
            setLastSelectedId,
            setGhostFocusIdx,
            focusTableScrollIfNeeded,
          });
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

    // 상태(select) 등 editingCell 없이 항상 보이는 컨트롤 포커스 중 Enter — 아래 행으로 이동(엑셀).
    if (e.key === 'Enter' && !e.shiftKey && !editingCell && !inlineEditingNameId && inWbsTable) {
      const active = document.activeElement;
      if (
        active instanceof HTMLSelectElement &&
        tableScrollRef.current?.contains(active) &&
        active.id.startsWith('wbs-edit-') &&
        cursorFocusedCell &&
        editableColumnIds.includes(cursorFocusedCell.columnId)
      ) {
        e.preventDefault();
        active.blur();
        applyWbsEnterMoveDown({
          currentTaskId: cursorFocusedCell.taskId,
          currentColId: cursorFocusedCell.columnId,
          visibleTasks,
          editableColumnIds,
          visibleTaskRowIndexById,
          canEditCurrentProject,
          ghostPlaceholderRowCount,
          keyboardCellShiftAnchorRef,
          cellNavCursorRef,
          clearBulkCheckboxSelectionOnKeyboardCursorMove,
          maybeSyncShiftRangeAnchor,
          setCellMarqueeRange,
          setFocusedCell,
          setLastSelectedId,
          setGhostFocusIdx,
          focusTableScrollIfNeeded,
        });
        return;
      }
    }

    // 편집 중 화살표는 input의 기본 동작(텍스트 커서 이동/숫자 값 증감)만 허용.
    // 셀 이동은 Enter(커밋·아래 행) 또는 Esc(취소) 또는 Tab/Shift+Tab(연속 편집) 후에만 가능.
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

    // Tab / Shift+Tab: 레벨 들여쓰기·내어쓰기 — Excel 셀 이동 블록 직후 처리(중간 return에 가로채이지 않게).
    if (e.key === 'Tab') {
      if (!tabPreferBulkLevel && (editingCell || inlineEditingNameId || isWbsTableCellTypingTarget(target))) {
        return;
      }
      if (!canEditCurrentProject) {
        if (tabPreferBulkLevel) e.preventDefault();
        return;
      }

      if (tabPreferBulkLevel) {
        if (inlineEditingNameId) {
          commitWbsInlineNameEditFromDom(inlineEditingNameId, tasks, updateTask, canEditCurrentProject);
          setInlineEditingNameId(null);
        }
        if (editingCell) {
          (document.activeElement as HTMLElement | null)?.blur?.();
          setEditingCell(null);
        }
        // armed 작업명 input 포커스여도 다중 마퀴·체크 선택이면 일괄 레벨 조정(Del 다중 비우기와 동일)
        if (!inlineEditingNameId && !editingCell) {
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      }

      const { orderedIds, syncedMarqueeToCheckboxRows, nameMarqueeRestore, marqueeRangeSnap } = resolveTabLevelAdjustOrderedIds({
        selectedTaskIds,
        visibleTasks,
        tasks,
        cellMarqueeKeySet,
        cellMarqueeRange,
        cursorLastSelectedId,
      });

      if (syncedMarqueeToCheckboxRows && orderedIds.length >= 2) {
        syncCellMarqueeRowsToCheckboxSelection(
          orderedIds,
          setCellMarqueeRange,
          setSelection,
          syncRangeAnchorForKeyboardFocus,
          setLastSelectedId,
          setFocusedCell,
        );
      }

      if (orderedIds.length > 0) {
        e.preventDefault();
        e.stopPropagation();
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
        } else if (!syncedMarqueeToCheckboxRows && marqueeRangeSnap) {
          requestAnimationFrame(() => {
            setCellMarqueeRange({ anchor: marqueeRangeSnap.anchor, end: marqueeRangeSnap.end });
          });
        }
        tableScrollRef.current?.focus({ preventScroll: true });
        return;
      }
    }

    // 셀 간 화살표 이동 (편집 중이 아닐 때): ←/→ 열 이동, ↑/↓ 같은 열에서 이전/다음 행.
    // 행 하이라이트(lastSelectedId)와 셀 링(focusedCell)이 어긋나면(행만 클릭·간트 동기 등)
    // ↑/↓·Space가 서로 다른 행을 가리키는 문제가 생기므로, 기준 행은 lastSelectedId를 우선한다.
    // 열은 focusedCell이 유효하면 유지해 같은 열 기준으로 세로 이동한다.
    // target.closest('[data-wbs-table]') 조건은 의도적으로 빼서, Enter 후 focus가 body로
    // 빠진 경우에도 화살표가 동작하도록 한다.
    // Alt+↑↓(행 순서)는 아래에서 처리.
    // Shift+화살표: 엑셀처럼 앵커~활성 셀 직사각형 다중 선택 확장. Ctrl/Meta+화살표(Shift 없음): 같은 열·행의 표시 격자 끝으로 점프. 그 외 화살표: 한 칸 이동(마퀴·키보드 앵커 해제).
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
    const ctrlOnlyCellEdgeNav = isCtrlArrowNoShift;
    // 값 셀 input 포커스 중에는 일반 화살표는 막되, Ctrl/Meta+화살표(Shift 없음) 격자 끝 점프는 허용(엑셀과 유사)
    const allowCellArrowDespiteTyping = isCtrlArrowNoShift;
    if (
      !editingCell &&
      !inlineEditingNameId &&
      (!isWbsTableCellTypingTarget(target) || allowCellArrowDespiteTyping) &&
      effectiveArrowCell &&
      editableColumnIds.length > 0 &&
      !e.altKey &&
      ((!e.ctrlKey && !e.metaKey) || ctrlShiftCellMarqueeNav || ctrlOnlyCellEdgeNav)
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

      // Ctrl/Meta+화살표(Shift 없음): 표시 격자에서 해당 방향 끝(첫/마지막 행·열)으로 점프
      if (ctrlOnlyCellEdgeNav) {
        if (isWbsTableCellTypingTarget(target)) {
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
        keyboardCellShiftAnchorRef.current = null;
        setCellMarqueeRange(null);
        const dir = e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
        const next = jumpWbsCellArrowToEdge({ taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId }, dir, stepOpts);
        e.preventDefault();
        if (next) {
          applySingleCellNav(next);
        } else if (e.key === 'ArrowDown' && canEditCurrentProject && ghostPlaceholderRowCount > 0) {
          const rowIdx = visibleTaskRowIndexById.get(effectiveArrowCell.taskId) ?? -1;
          let colIdx = editableColumnIds.indexOf(effectiveArrowCell.columnId);
          if (colIdx < 0) colIdx = Math.max(0, editableColumnIds.indexOf(defaultNavColumn));
          if (rowIdx >= 0 && colIdx >= 0 && rowIdx === visibleTasks.length - 1) {
            clearBulkCheckboxSelectionOnKeyboardCursorMove();
            setFocusedCell(null);
            setGhostFocusIdx(0);
            cellNavCursorRef.current.focusedCell = null;
          }
          focusTableScrollIfNeeded();
        } else {
          focusTableScrollIfNeeded();
        }
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

    // Home/End: 현재 행의 첫/마지막 편집 열. PageUp/PageDown: 스크롤 영역에 보이는 행 수만큼 위/아래(엑셀 PageUp/Down).
    const homeEndPageKey = e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown';
    if (
      ghostFocusIdx === null &&
      !editingCell &&
      !inlineEditingNameId &&
      !isWbsTableCellTypingTarget(target) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      homeEndPageKey &&
      effectiveArrowCell &&
      editableColumnIds.length > 0
    ) {
      const stepOpts = {
        visibleTasks,
        columnIds: editableColumnIds,
        visibleTaskRowIndexById,
        defaultNavColumn,
      } as const;

      keyboardCellShiftAnchorRef.current = null;
      setCellMarqueeRange(null);

      let next: WbsMarqueeCell | null = null;
      if (e.key === 'Home') {
        next = jumpWbsCellArrowToEdge({ taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId }, 'ArrowLeft', stepOpts);
      } else if (e.key === 'End') {
        next = jumpWbsCellArrowToEdge({ taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId }, 'ArrowRight', stepOpts);
      } else {
        const scrollEl = tableScrollRef.current;
        const pageRows = scrollEl && rowHeight > 0 ? Math.max(1, Math.floor(scrollEl.clientHeight / rowHeight)) : 10;
        next = stepWbsCellPageVertical(
          { taskId: effectiveArrowCell.taskId, columnId: effectiveArrowCell.columnId },
          e.key as 'PageUp' | 'PageDown',
          pageRows,
          stepOpts,
        );
      }

      e.preventDefault();
      if (next) {
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
      }
      focusTableScrollIfNeeded();
      return;
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

      if (!hadOverlay && !pastedFlashActive) return;

      if (editingCell) setEditingCell(null);
      if (inlineEditingNameId) setInlineEditingNameId(null);
      if (focusedCell) setFocusedCell(null);
      if (inlineAddingTaskId) setInlineAddingTaskId(null);
      if (cellMarqueeRange != null) setCellMarqueeRange(null);
      clearPastedCellFlash?.();
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
    if (inlineEditingNameId && !tabPreferBulkLevel) return;
    // 시작일 등은 클릭만으로 편집 input에 포커스가 가므로, 내부 격자/행 붙여넣기(Ctrl+V)는 여기서 막지 않는다.
    // (막으면 브라우저 기본 붙여넣기만 시도해 type=date 등에서는 아무 반응이 없는 것처럼 보임)
    const isPasteKey = (e.ctrlKey || e.metaKey) && e.key === 'v';
    const internalPasteShortcut = isPasteKey && (copiedCellRegion != null || copiedTasks.length > 0 || loadClipboardTasks().length > 0);
    // Shift+Enter: 현재 셀 행 위에 형제 추가 — status SELECT 등 typingInWbsCell 가드보다 통과해야 함
    const shiftEnterInsertSiblingAbove = e.key === 'Enter' && e.shiftKey && !!inWbsTable && !editingCell && !inlineEditingNameId;
    if (
      (editingCell && !tabPreferBulkLevel && !internalPasteShortcut) ||
      (typingInWbsCell && !tabPreferBulkLevel && !internalPasteShortcut && !shiftEnterInsertSiblingAbove)
    )
      return;
    const inWbsTableFallback = (target as HTMLElement).closest?.('[data-wbs-table]');
    if (!inWbsTableFallback) {
      // 표 밖의 일반 입력/셀렉트는 기본 동작 유지 (검색창 등). 다중 선택 Tab/Shift+Tab 레벨 변경은 일괄 수정 바 등에서도 허용.
      if ((target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') && !tabPreferBulkLevel) return;
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
        const mergedByTaskId = new Map<string, Partial<Task>>();
        const cellCountByTaskId = new Map<string, number>();
        const pairTracks: { key: string; taskId: string; includedInMerge: boolean }[] = [];
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
          pairTracks.push({
            key: `${p.taskId}::${p.columnId}`,
            taskId: p.taskId,
            includedInMerge: !!res.updates,
          });
          if (res.updates) {
            const cur = mergedByTaskId.get(p.taskId) ?? {};
            mergedByTaskId.set(p.taskId, { ...cur, ...res.updates });
            cellCountByTaskId.set(p.taskId, (cellCountByTaskId.get(p.taskId) ?? 0) + 1);
          }
        }
        const appliedTaskIds = new Set<string>();
        for (const [taskId, merged] of mergedByTaskId) {
          const t = tasks.find((x) => x.id === taskId);
          const nCells = cellCountByTaskId.get(taskId) ?? 0;
          if (!t) {
            failed += nCells;
            continue;
          }
          if (taskDatePairEmptyAfterPatch(t, merged)) {
            failed += nCells;
            if (!firstError) firstError = WBS_DATE_PAIR_NONEMPTY_MESSAGE;
            continue;
          }
          updateTask(taskId, merged);
          appliedTaskIds.add(taskId);
          applied += nCells;
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
        const pasteFlashKeys = pairTracks.filter((tr) => !tr.includedInMerge || appliedTaskIds.has(tr.taskId)).map((tr) => tr.key);
        flashPastedCells(pasteFlashKeys);
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
          const okKeys: string[] = [];
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
            okKeys.push(`${p.taskId}::${p.columnId}`);
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
          flashPastedCells(okKeys);
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
        const firstLineOkKeys: string[] = [];
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
          firstLineOkKeys.push(`${pt.taskId}::${pt.columnId}`);
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
        flashPastedCells(firstLineOkKeys);
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
      clearPastedCellFlash?.();
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

    // Delete (Backspace는 브라우저 뒤로가기·입력 필드와 충돌 방지)
    // - 체크박스(또는 공유 행 선택)가 있으면 Del은 마퀴·포커스 셀·armed 작업명 input보다 우선: 툴바 "삭제"와 동일하게 행 전체 삭제
    // - 행 선택이 없을 때만 엑셀식: 셀·다중셀(마퀴) 또는 포커스 한 칸 → 해당 셀 값만 비움(행 삭제 아님)
    if (e.key === 'Delete' || e.key === 'Del') {
      // 체크·공유 행 선택이 있으면 셀 편집기(armed 작업명 wbs-edit-* 포함)보다 먼저 처리
      if (effectiveSelectedIds.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (!canEditCurrentProject) return;
        if (inlineEditingNameId) {
          commitWbsInlineNameEditFromDom(inlineEditingNameId, tasks, updateTask, canEditCurrentProject);
          setInlineEditingNameId(null);
        }
        if (editingCell) setEditingCell(null);
        performDeleteTaskIds(effectiveSelectedIds);
        return;
      }
      // 표 안 값 입력 중이면 문자 삭제 등 기본 동작 유지
      if (isWbsTableCellTypingTarget(target)) return;
      // 작업명 인라인 편집 중(포커스가 잠깐 표로 나간 경우 등): 행 삭제 금지
      if (inlineEditingNameId) return;
      // 표 안 셀 편집기(input): 편집 중이면 Del은 브라우저 기본(글자·선택 영역 삭제).
      // 작업명 armed(포커스만)·다중 셀 마퀴는 아래 전역 비우기로 처리한다.
      const delTarget = target as HTMLElement;
      const marqueeCellCountForDel = cellMarqueeKeySet?.size ?? 0;
      const marqueeMultiCellsForDel = marqueeCellCountForDel > 1;
      if (delTarget.tagName === 'INPUT' && delTarget.closest?.('[data-wbs-table]') && !(delTarget as HTMLInputElement).disabled) {
        const id = (delTarget as HTMLInputElement).id ?? '';
        const isArmedNameCapture = delTarget.hasAttribute?.('data-wbs-armed');
        if (id.startsWith('wbs-edit-') && !marqueeMultiCellsForDel && !isArmedNameCapture) return;
      }
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (!canEditCurrentProject) return;
      // 셀 마퀴(1칸 이상): 엑셀처럼 행 삭제가 아니라 선택 셀 값만 비움
      const marqueeHasCells = (cellMarqueeKeySet?.size ?? 0) >= 1;
      if (marqueeHasCells && cellMarqueeKeySet) {
        const visibleTaskIds = visibleTasks.map((t) => t.id);
        const targets = cellMarqueeKeysToTargets(cellMarqueeKeySet);
        let cleared = 0;
        let failed = 0;
        let firstError: string | null = null;
        /** 같은 작업에 여러 셀(시작·종료 등)을 한 번에 비울 때: 패치를 합친 뒤 NOT NULL 일정 위반을 검사한다. */
        const mergedByTaskId = new Map<string, Partial<Task>>();
        const cellCountByTaskId = new Map<string, number>();

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
            const cur = mergedByTaskId.get(cell.taskId) ?? {};
            mergedByTaskId.set(cell.taskId, { ...cur, ...res.updates });
            cellCountByTaskId.set(cell.taskId, (cellCountByTaskId.get(cell.taskId) ?? 0) + 1);
          }
        }

        for (const [taskId, merged] of mergedByTaskId) {
          const t = tasks.find((x) => x.id === taskId);
          const nCells = cellCountByTaskId.get(taskId) ?? 0;
          if (!t) {
            failed += nCells;
            continue;
          }
          if (taskDatePairEmptyAfterPatch(t, merged)) {
            failed += nCells;
            if (!firstError) firstError = WBS_DATE_PAIR_NONEMPTY_MESSAGE;
            continue;
          }
          updateTask(taskId, merged);
          cleared += nCells;
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
      // 마퀴 없이 포커스 셀만: 엑셀처럼 Del은 그 셀(작업명 포함) 값만 비움 — lastSelectedId만으로는 행 삭제하지 않음
      if (selectedTaskIds.size === 0 && cursorFocusedCell && editableColumnIds.includes(cursorFocusedCell.columnId)) {
        const cell = cursorFocusedCell;
        const col = cell.columnId;
        if (
          col === 'wbsId' ||
          col === 'actions' ||
          col === 'plannedProgress' ||
          col === 'workComposition' ||
          col === 'progressVariance' ||
          col === 'allocation'
        ) {
          return;
        }
        const visibleTaskIds = visibleTasks.map((t) => t.id);
        const t = visibleTasks.some((vt) => vt.id === cell.taskId) ? tasks.find((x) => x.id === cell.taskId) : undefined;
        if (t?.mirroredFromTaskId) return;
        if (t && !t.mirroredFromTaskId) {
          if (col === 'name') {
            if ((t.name ?? '').trim() !== '') {
              updateTask(cell.taskId, { name: '' });
              pushToast('셀 내용을 지웠습니다.', { variant: 'success' });
            }
            return;
          }
          if (!isCellClipboardColumn(col)) {
            return;
          }
          const res = buildWbsCellPasteUpdate(
            t,
            col,
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
        return;
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

    // WBS 정렬일 때만 순서/레벨 변경 허용 (다른 정렬·필터 시 표시 순서와 트리 순서가 달라 혼동 방지)
    const isSortedOrFiltered =
      (sortConfig !== null && sortConfig.key !== 'wbs') ||
      filters.status !== 'all' ||
      filters.assignee ||
      filters.startDate ||
      filters.endDate ||
      !!filters.milestoneOnly ||
      !!filters.issueOnly;

    /** 표 로컬 Set과 Context(간트 등) 체크 선택 동기 — Alt+↑↓ 다중 이동에 공통 사용 */
    const checkboxSelectionForSiblingMove =
      selectedTaskIds.size > 0
        ? selectedTaskIds
        : sharedSelectedTaskIds && sharedSelectedTaskIds.length > 0
          ? new Set(sharedSelectedTaskIds)
          : selectedTaskIds;

    // ArrowUp/Down은 표 영역에 포커스가 있을 때만 처리. 그렇지 않으면 간트 등 다른 컴포넌트의
    // 자체 키보드 핸들러가 활성 행을 옮길 수 있도록 양보한다 (전역 window listener라 가드 없으면 가로챔).
    // 예외: Alt+↑↓ 형제 순서 이동은 간트 포커스·표 밖에서도 체크 다중 선택과 함께 동작한다.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !target.closest('[data-wbs-table]')) {
      const moveTargetId = cursorLastSelectedId ?? lastSelectedId;
      const allowAltSiblingMove =
        e.altKey && canEditCurrentProject && !isSortedOrFiltered && (checkboxSelectionForSiblingMove.size > 1 || moveTargetId != null);
      if (!allowAltSiblingMove) return;
    }

    // 선택 행이 없을 때: 세로 화살표는 처리하지 않음(아래 Alt+↑↓는 lastSelectedId 필요). 그 외 키는 계속 진행.
    // 예외: Alt+↑↓ + 체크 다중 선택(≥2)은 lastSelectedId 없이도 형제 이동만 처리한다.
    if (!cursorLastSelectedId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const allowAltMulti = e.altKey && checkboxSelectionForSiblingMove.size > 1 && canEditCurrentProject;
      if (!allowAltMulti) return;
    }

    // Space: 체크 토글 — 행 포커스(lastSelectedId) 우선(↑/↓와 동일 기준). 없으면 셀 링 행.
    // 다중 셀(마퀴)·2행 이상 범위 선택 중이면: 해당 행 전부 체크 선택(엑셀식).
    // 체크 다중 선택(≥2)이면 포커스 행이 선택 안에 있을 때 전체를 한 번에 해제.
    if (e.key === ' ') {
      e.preventDefault();
      const marqueeRowIds = resolveMarqueeRowsForSpaceCheckbox({
        cellMarqueeKeySet,
        cellMarqueeRange,
        visibleTasks,
      });
      if (marqueeRowIds) {
        setSelection(new Set(marqueeRowIds));
        setBulkStatus('');
        setBulkAssignee('');
        setBulkDurationDays('');
        setBulkProgress('');
        const primary = marqueeRowIds[0]!;
        setLastSelectedId(primary);
        syncRangeAnchorForKeyboardFocus?.(primary);
        cellNavCursorRef.current = {
          lastSelectedId: primary,
          focusedCell: cursorFocusedCell ?? { taskId: primary, columnId: 'name' },
        };
        return;
      }
      const rowId = cursorLastSelectedId ?? cursorFocusedCell?.taskId;
      if (!rowId) return;
      const next = resolveSpaceCheckboxSelection({ selectedTaskIds, focusRowId: rowId });
      if (next.size === 0) {
        setBulkStatus('');
        setBulkAssignee('');
        setBulkDurationDays('');
        setBulkProgress('');
      }
      setSelection(next);
      return;
    }

    if (e.key === 'ArrowUp') {
      keyboardShiftPivotIdRef.current = null;
      if (e.altKey) {
        e.preventDefault();
        if (!canEditCurrentProject) return;
        if (isSortedOrFiltered) return;
        const moveTargetId = cursorLastSelectedId ?? lastSelectedId;
        if (checkboxSelectionForSiblingMove.size > 1) {
          const pt = resolveProjectTasksForSiblingMove(tasks, currentProjectId, checkboxSelectionForSiblingMove);
          if (pt) {
            const steps = buildSiblingMoveStepsFromSelection(pt, checkboxSelectionForSiblingMove, 'up');
            if (steps.length > 0) {
              applySiblingMoveSteps(steps);
              const scrollId =
                moveTargetId && checkboxSelectionForSiblingMove.has(moveTargetId) ? moveTargetId : [...checkboxSelectionForSiblingMove][0]!;
              requestAnimationFrame(() => document.getElementById(`task-row-${scrollId}`)?.scrollIntoView({ block: 'nearest' }));
            }
          }
          return;
        }
        const canMove =
          checkboxSelectionForSiblingMove.size === 0 ||
          (checkboxSelectionForSiblingMove.size === 1 && moveTargetId != null && checkboxSelectionForSiblingMove.has(moveTargetId));
        if (canMove && moveTargetId) {
          moveTask(moveTargetId, 'up');
          requestAnimationFrame(() => document.getElementById(`task-row-${moveTargetId}`)?.scrollIntoView({ block: 'nearest' }));
        }
        return;
      }
      return;
    } else if (e.key === 'ArrowDown') {
      keyboardShiftPivotIdRef.current = null;
      if (e.altKey) {
        e.preventDefault();
        if (!canEditCurrentProject) return;
        if (isSortedOrFiltered) return;
        const moveTargetId = cursorLastSelectedId ?? lastSelectedId;
        if (checkboxSelectionForSiblingMove.size > 1) {
          const pt = resolveProjectTasksForSiblingMove(tasks, currentProjectId, checkboxSelectionForSiblingMove);
          if (pt) {
            const steps = buildSiblingMoveStepsFromSelection(pt, checkboxSelectionForSiblingMove, 'down');
            if (steps.length > 0) {
              applySiblingMoveSteps(steps);
              const scrollId =
                moveTargetId && checkboxSelectionForSiblingMove.has(moveTargetId) ? moveTargetId : [...checkboxSelectionForSiblingMove][0]!;
              requestAnimationFrame(() => document.getElementById(`task-row-${scrollId}`)?.scrollIntoView({ block: 'nearest' }));
            }
          }
          return;
        }
        const canMove =
          checkboxSelectionForSiblingMove.size === 0 ||
          (checkboxSelectionForSiblingMove.size === 1 && moveTargetId != null && checkboxSelectionForSiblingMove.has(moveTargetId));
        if (canMove && moveTargetId) {
          moveTask(moveTargetId, 'down');
          requestAnimationFrame(() => document.getElementById(`task-row-${moveTargetId}`)?.scrollIntoView({ block: 'nearest' }));
        }
        return;
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
    } else if (e.key === 'Enter') {
      // Enter: 동일 레벨(형제) 작업을 현재 행 "아래"에 추가
      // Shift+Enter: 동일 레벨(형제) 작업을 현재 행 "위"에 추가
      // 셀 편집·입력 중에는 비활성화 (작업명 등은 상단 별도 Enter 블록에서 처리)
      if (editingCell || inlineEditingNameId || (isWbsTableCellTypingTarget(target) && !e.shiftKey)) return;

      // 셀 포커스만(미편집) Enter — 작업명 제외 값 열은 엑셀처럼 같은 열 아래 행으로 이동. F2·더블클릭·타이핑으로 편집.
      if (!e.shiftKey && cursorFocusedCell) {
        const { taskId, columnId: focusCol } = cursorFocusedCell;
        if (focusCol !== 'name' && editableColumnIds.includes(focusCol) && visibleTasks.some((vt) => vt.id === taskId)) {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur?.();
          applyWbsEnterMoveDown({
            currentTaskId: taskId,
            currentColId: focusCol,
            visibleTasks,
            editableColumnIds,
            visibleTaskRowIndexById,
            canEditCurrentProject,
            ghostPlaceholderRowCount,
            keyboardCellShiftAnchorRef,
            cellNavCursorRef,
            clearBulkCheckboxSelectionOnKeyboardCursorMove,
            maybeSyncShiftRangeAnchor,
            setCellMarqueeRange,
            setFocusedCell,
            setLastSelectedId,
            setGhostFocusIdx,
            focusTableScrollIfNeeded,
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

      if (e.shiftKey) {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }

      // 기본 기준 행: 포커스된 셀의 행 우선, 없으면 lastSelectedId, 없으면 마지막 표시 행
      const baseRowId = cursorFocusedCell?.taskId ?? cursorLastSelectedId;
      const baseTask =
        (baseRowId
          ? tasks.find((t) => t.id === baseRowId)
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
      if (e.shiftKey) {
        clearBulkCheckboxSelectionOnKeyboardCursorMove();
        setFocusedCell({ taskId: newId, columnId: 'name' });
        cellNavCursorRef.current = {
          lastSelectedId: newId,
          focusedCell: { taskId: newId, columnId: 'name' },
        };
        document.getElementById(`task-row-${newId}`)?.scrollIntoView({ block: 'nearest' });
      }
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
