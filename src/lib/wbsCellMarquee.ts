import type { TaskWithDepth } from './taskView';
import type { TableColumnId } from '../components/wbsTableTypes';
import type { WbsCellClipboardData } from './wbsCellClipboard';

export type WbsMarqueeCell = { taskId: string; columnId: TableColumnId };

export const wbsCellMarqueeKey = (taskId: string, columnId: TableColumnId) => `${taskId}::${columnId}`;

const MARQUEE_KEY_SEP = '::';

/**
 * `wbsCellMarqueeKey`로 만든 키 집합을 셀 좌표 배열로 복원한다.
 * `columnId`에 `custom:...`처럼 `:`가 포함돼도 첫 번째 `::`만 구분자로 쓴다.
 */
export function cellMarqueeKeysToTargets(keys: ReadonlySet<string> | null | undefined): WbsMarqueeCell[] {
  if (!keys || keys.size === 0) return [];
  const out: WbsMarqueeCell[] = [];
  for (const key of keys) {
    const i = key.indexOf(MARQUEE_KEY_SEP);
    if (i <= 0) continue;
    const taskId = key.slice(0, i);
    const columnId = key.slice(i + MARQUEE_KEY_SEP.length) as TableColumnId;
    if (taskId && columnId) out.push({ taskId, columnId });
  }
  return out;
}

/** 편집 격자에서 한 칸 이동(표 키보드·Shift 범위 확장과 동일 규칙). 끝에 도달해 못 움직이면 null */
export function stepWbsCellArrow(
  cell: WbsMarqueeCell,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  opts: {
    visibleTasks: TaskWithDepth[];
    columnIds: TableColumnId[];
    visibleTaskRowIndexById: Map<string, number>;
    defaultNavColumn: TableColumnId;
  },
): WbsMarqueeCell | null {
  const { visibleTasks, columnIds, visibleTaskRowIndexById, defaultNavColumn } = opts;
  const rowIdx = visibleTaskRowIndexById.get(cell.taskId) ?? -1;
  let colIdx = columnIds.indexOf(cell.columnId);
  if (colIdx < 0) colIdx = Math.max(0, columnIds.indexOf(defaultNavColumn));
  if (rowIdx < 0 || colIdx < 0 || columnIds.length === 0) return null;

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    let nextRowIdx: number;
    let nextColIdx: number;
    if (key === 'ArrowLeft') {
      if (colIdx === 0) {
        nextColIdx = columnIds.length - 1;
        nextRowIdx = Math.max(0, rowIdx - 1);
      } else {
        nextColIdx = colIdx - 1;
        nextRowIdx = rowIdx;
      }
    } else if (colIdx === columnIds.length - 1) {
      nextColIdx = 0;
      nextRowIdx = Math.min(visibleTasks.length - 1, rowIdx + 1);
    } else {
      nextColIdx = colIdx + 1;
      nextRowIdx = rowIdx;
    }
    const nextTask = visibleTasks[nextRowIdx];
    const nextCol = columnIds[nextColIdx];
    if (!nextTask || !nextCol) return null;
    const out: WbsMarqueeCell = { taskId: nextTask.id, columnId: nextCol };
    if (out.taskId === cell.taskId && out.columnId === cell.columnId) return null;
    return out;
  }

  const delta = key === 'ArrowUp' ? -1 : 1;
  const nextRowIdx = Math.min(visibleTasks.length - 1, Math.max(0, rowIdx + delta));
  const nextTask = visibleTasks[nextRowIdx];
  const nextCol = columnIds[colIdx];
  if (!nextTask || !nextCol) return null;
  const out: WbsMarqueeCell = { taskId: nextTask.id, columnId: nextCol };
  if (out.taskId === cell.taskId && out.columnId === cell.columnId) return null;
  return out;
}

/**
 * Ctrl+Shift+화살표용: 표시 격자에서 같은 열의 첫/마지막 행, 같은 행의 첫/마지막 열까지 점프(엑셀식 “끝까지”).
 * 이미 그 끝이면 null.
 */
export function jumpWbsCellArrowToEdge(
  cell: WbsMarqueeCell,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  opts: {
    visibleTasks: TaskWithDepth[];
    columnIds: TableColumnId[];
    visibleTaskRowIndexById: Map<string, number>;
    defaultNavColumn: TableColumnId;
  },
): WbsMarqueeCell | null {
  const { visibleTasks, columnIds, visibleTaskRowIndexById, defaultNavColumn } = opts;
  if (visibleTasks.length === 0 || columnIds.length === 0) return null;
  const rowIdx = visibleTaskRowIndexById.get(cell.taskId) ?? -1;
  let colIdx = columnIds.indexOf(cell.columnId);
  if (colIdx < 0) colIdx = Math.max(0, columnIds.indexOf(defaultNavColumn));
  if (rowIdx < 0 || colIdx < 0) return null;

  let out: WbsMarqueeCell;
  if (key === 'ArrowUp') {
    out = { taskId: visibleTasks[0]!.id, columnId: columnIds[colIdx]! };
  } else if (key === 'ArrowDown') {
    out = { taskId: visibleTasks[visibleTasks.length - 1]!.id, columnId: columnIds[colIdx]! };
  } else if (key === 'ArrowLeft') {
    out = { taskId: visibleTasks[rowIdx]!.id, columnId: columnIds[0]! };
  } else {
    out = { taskId: visibleTasks[rowIdx]!.id, columnId: columnIds[columnIds.length - 1]! };
  }
  if (out.taskId === cell.taskId && out.columnId === cell.columnId) return null;
  return out;
}

/** 표시 순서·표시 컬럼 기준 직사각형 셀 키 집합 (엑셀식 드래그 범위) */
export function buildCellMarqueeKeySet(
  visibleTasks: TaskWithDepth[],
  visibleColumnIds: TableColumnId[],
  anchor: { taskId: string; columnId: TableColumnId },
  end: { taskId: string; columnId: TableColumnId },
): Set<string> {
  const r1 = visibleTasks.findIndex((t) => t.id === anchor.taskId);
  const r2 = visibleTasks.findIndex((t) => t.id === end.taskId);
  if (r1 < 0 || r2 < 0) return new Set();
  const rowLo = Math.min(r1, r2);
  const rowHi = Math.max(r1, r2);
  const c1 = visibleColumnIds.indexOf(anchor.columnId);
  const c2 = visibleColumnIds.indexOf(end.columnId);
  if (c1 < 0 || c2 < 0) return new Set();
  const colLo = Math.min(c1, c2);
  const colHi = Math.max(c1, c2);
  const keys = new Set<string>();
  for (let r = rowLo; r <= rowHi; r++) {
    const tid = visibleTasks[r]!.id;
    for (let c = colLo; c <= colHi; c++) {
      keys.add(wbsCellMarqueeKey(tid, visibleColumnIds[c]!));
    }
  }
  return keys;
}

/**
 * 엑셀/시스템 클립보드 격자 텍스트를 2차원 배열로 파싱 (끝의 빈 줄 제거).
 * - 탭(TSV)이 한 줄이라도 있으면 행마다 탭으로 분할 (엑셀 기본).
 * - 탭이 없고 모든 줄의 쉼표 분할 열 개수가 같고 2열 이상이면 CSV로 취급(쉼표 뒤 공백 trim).
 * - 그 외는 한 줄 = 한 셀(한 열)로 두어 잘못된 열 분할을 피한다.
 */
export function parseClipboardTsvToTextGrid(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) return [];

  if (lines.some((line) => line.includes('\t'))) {
    return lines.map((line) => line.split('\t'));
  }

  const commaRows = lines.map((line) => line.split(',').map((cell) => cell.trim()));
  const widths = commaRows.map((r) => r.length);
  const w0 = widths[0] ?? 0;
  const commaGrid = w0 >= 2 && widths.every((w) => w === w0) && lines.some((line) => line.includes(','));
  if (commaGrid) {
    return commaRows;
  }

  return lines.map((line) => [line]);
}

/** 앵커 셀을 좌상단으로 하여 복사 격자만큼 (행·열) 기하학적으로 대상 셀에 매핑 — 표 밖은 생략 */
export function expandWbsMarqueeInternalPastePairs(opts: {
  anchor: WbsMarqueeCell;
  sourceGrid: WbsCellClipboardData[][];
  visibleTasks: TaskWithDepth[];
  visibleColumnIds: TableColumnId[];
}): Array<{ taskId: string; columnId: TableColumnId; source: WbsCellClipboardData }> {
  const { anchor, sourceGrid, visibleTasks, visibleColumnIds } = opts;
  const rowIdx = visibleTasks.findIndex((t) => t.id === anchor.taskId);
  const colIdx = visibleColumnIds.indexOf(anchor.columnId);
  if (rowIdx < 0 || colIdx < 0) return [];
  const out: Array<{ taskId: string; columnId: TableColumnId; source: WbsCellClipboardData }> = [];
  for (let r = 0; r < sourceGrid.length; r++) {
    const row = sourceGrid[r]!;
    for (let c = 0; c < row.length; c++) {
      const ti = rowIdx + r;
      const ci = colIdx + c;
      if (ti >= visibleTasks.length || ci >= visibleColumnIds.length) continue;
      out.push({
        taskId: visibleTasks[ti]!.id,
        columnId: visibleColumnIds[ci]!,
        source: row[c]!,
      });
    }
  }
  return out;
}

/** 앵커를 좌상단으로 하는 외부 텍스트 격자 붙여넣기 대상 */
export function expandWbsMarqueePlainPastePairs(opts: {
  anchor: WbsMarqueeCell;
  textGrid: string[][];
  visibleTasks: TaskWithDepth[];
  visibleColumnIds: TableColumnId[];
}): Array<{ taskId: string; columnId: TableColumnId; text: string }> {
  const { anchor, textGrid, visibleTasks, visibleColumnIds } = opts;
  const rowIdx = visibleTasks.findIndex((t) => t.id === anchor.taskId);
  const colIdx = visibleColumnIds.indexOf(anchor.columnId);
  if (rowIdx < 0 || colIdx < 0) return [];
  const out: Array<{ taskId: string; columnId: TableColumnId; text: string }> = [];
  for (let r = 0; r < textGrid.length; r++) {
    const row = textGrid[r]!;
    for (let c = 0; c < row.length; c++) {
      const ti = rowIdx + r;
      const ci = colIdx + c;
      if (ti >= visibleTasks.length || ci >= visibleColumnIds.length) continue;
      out.push({
        taskId: visibleTasks[ti]!.id,
        columnId: visibleColumnIds[ci]!,
        text: row[c] ?? '',
      });
    }
  }
  return out;
}
