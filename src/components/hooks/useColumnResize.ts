import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { type BuiltInTableColumnId, type TableColumnId } from '../wbsTableTypes';
import { formatDate, formatNum1, formatPercent1 } from '../../lib/utils';
import { inclusiveCalendarDays } from '../../lib/durationDays';
import type { Task } from '../../types';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../../lib/assigneeOptions';

// ── Default column widths ──────────────────────────────────────────
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  grip: 32,
  checkbox: 40,
  seq: 48,
  expand: 40,
  wbsId: 60,
  name: 380,
  startDate: 85,
  endDate: 85,
  duration: 64,
  workEffort: 56,
  weight: 56,
  assignee: 70,
  allocation: 72,
  status: 70,
  progress: 82,
  plannedProgress: 82,
  progressVariance: 98,
  deliverables: 120,
  dependencies: 120,
  actions: 70,
};

/** 데이터 컬럼별 헤더 표시 텍스트 */
export const COLUMN_HEADER_LABELS: Record<BuiltInTableColumnId, string> = {
  wbsId: 'WBS',
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  duration: '기간',
  workEffort: '공수(d)',
  weight: '가중치',
  assignee: '담당자',
  allocation: '투입율',
  status: '상태',
  progress: '진척(%)',
  plannedProgress: '계획(%)',
  progressVariance: '차이(%p)',
  deliverables: '산출물',
  dependencies: '선행작업',
  actions: '관리',
};

// ── Hook params ────────────────────────────────────────────────────
export interface UseColumnResizeParams {
  wbsSettings:
    | {
        columnWidths?: Record<string, number>;
        skipImplicitTableColumnAutoFit?: boolean;
        statusConfigs?: Array<{ id: string; name?: string }>;
        prependDisplayWbsToTaskName?: boolean;
      }
    | undefined;
  updateWbsSettings: (updates: Record<string, unknown>) => void;
  visibleTasks: Task[];
  displayWbsMap: Map<string, string> | undefined;
  allocationDisplayByTaskId: Map<string, string>;
  taskIdToSeqNum: Map<string, number>;
  customColumnNameById: Map<string, string>;
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>;
  /** 표시 중인 크리티컬 패스(작업명 열 배지 너비 자동 맞춤용). Summary와 동일하게 `showCriticalPath` 반영된 집합을 넘긴다. */
  criticalPathTaskIds?: ReadonlySet<string>;
  /** 부모 id → 직속 자식 수(작업명 옆 `(n)` 표시 폭 자동 맞춤용) */
  directChildCountByParentId?: Map<string, number>;
}

export interface UseColumnResizeReturn {
  columnWidths: Record<string, number>;
  resizingCol: string | null;
  setResizingCol: Dispatch<SetStateAction<string | null>>;
  measureText: (text: string) => number;
  measureRef: RefObject<HTMLDivElement | null>;
  handleColumnHeaderDoubleClick: (col: string) => void;
  autoFitAllColumns: (visibleColumnIds: string[], opts?: { implicitOrToolbarAutoFit?: boolean }) => void;
  startColumnResize: (columnId: string, startX: number) => void;
}

// ── Hook ───────────────────────────────────────────────────────────
/** 긴 본문이 있는 컬럼은 자동 맞춤 시 너비 상한을 넉넉히 둔다(기존 800px에서는 말줄임이 남음). */
const AUTO_FIT_MAX_WIDE = 8000;
const AUTO_FIT_MAX_DEFAULT = 800;

function autoFitWidthCap(col: string): number {
  if (col === 'name' || col === 'deliverables' || col === 'dependencies' || col.startsWith('custom:')) return AUTO_FIT_MAX_WIDE;
  return AUTO_FIT_MAX_DEFAULT;
}

/** 리사이즈·저장값 복원·자동 맞춤 결과에 적용 — 작업명 입력 UX를 위해 `name`은 과도하게 좁게 두지 않음 */
const MIN_COLUMN_WIDTH_BY_ID: Record<string, number> = {
  name: 260,
  // 백분율 열은 값(예: 100.0%, -100.0%p)이 잘리지 않도록 최소 너비를 둔다.
  progress: 78,
  plannedProgress: 78,
  progressVariance: 92,
};

function minColumnWidth(columnId: string): number {
  return MIN_COLUMN_WIDTH_BY_ID[columnId] ?? 30;
}

function clampColumnWidths(widths: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...widths };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'number' && !Number.isNaN(v)) {
      out[k] = Math.max(minColumnWidth(k), v);
    }
  }
  return out;
}

type TaskWithDepth = Task & { depth?: number };

/** 작업명 셀: 트리 들여쓰기·접두 아이콘/배지가 문자 측정값에 포함되지 않으므로 가로 여유를 더한다. */
function nameColumnExtraWidth(task: TaskWithDepth, criticalPathTaskIds: ReadonlySet<string> | undefined): number {
  const depth = task.depth ?? 0;
  const leftPad = depth * 20 + 18; // 작업명 셀 들여쓰기 + 펼침 캐럿 공간
  const rightPad = 10; // .data-cell px-2.5 우측
  const gap = 6; // 작업명 행 flex gap-1.5
  const parts: number[] = [];
  if (task.isMilestone) parts.push(14);
  if (task.isIssue) parts.push(14);
  if (task.isActionItem) parts.push(14);
  if (criticalPathTaskIds?.has(task.id)) parts.push(72); // "크리티컬" 칩 대략 폭
  let prefixW = 0;
  for (let i = 0; i < parts.length; i++) {
    prefixW += parts[i] ?? 0;
    if (i < parts.length - 1) prefixW += gap;
  }
  if (parts.length > 0) prefixW += gap;
  return leftPad + rightPad + prefixW;
}

export function useColumnResize({
  wbsSettings,
  updateWbsSettings,
  visibleTasks,
  displayWbsMap,
  allocationDisplayByTaskId,
  taskIdToSeqNum,
  customColumnNameById,
  assigneeDisplayMetaByName,
  criticalPathTaskIds,
  directChildCountByParentId,
}: UseColumnResizeParams): UseColumnResizeReturn {
  // ── State ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => clampColumnWidths({ ...DEFAULT_COLUMN_WIDTHS }));
  const columnWidthsRef = useRef(columnWidths);
  const hasRestoredColumnWidths = useRef(false);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  // ── Restore saved widths from settings ──
  useEffect(() => {
    const saved = wbsSettings?.columnWidths;
    if (hasRestoredColumnWidths.current || !saved || Object.keys(saved).length === 0) return;
    setColumnWidths(() => clampColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, ...saved }));
    hasRestoredColumnWidths.current = true;
  }, [wbsSettings]);

  // ── Resize drag state ──
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  /** Begin a column resize drag. Typically called from a mousedown handler on the resize grip. */
  const startColumnResize = useCallback((columnId: string, startX: number) => {
    resizeStartRef.current = { col: columnId, startX, startWidth: columnWidthsRef.current[columnId] ?? 60 };
    setResizingCol(columnId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, []);

  // ── mousemove / mouseup listeners while dragging ──
  useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const diff = e.clientX - start.startX;
      const newWidth = Math.max(minColumnWidth(start.col), start.startWidth + diff);
      setColumnWidths((prev) => ({ ...prev, [start.col]: newWidth }));
    };

    const handleMouseUp = () => {
      resizeStartRef.current = null;
      setResizingCol(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      updateWbsSettings({ columnWidths: columnWidthsRef.current, skipImplicitTableColumnAutoFit: true });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, updateWbsSettings]);

  // ── Text measurement ──
  const measureRef = useRef<HTMLDivElement | null>(null);
  const measureText = useCallback((text: string): number => {
    const el = measureRef.current;
    if (!el) return 60;
    el.style.whiteSpace = 'nowrap';
    el.textContent = text || '0';
    return Math.ceil(el.getBoundingClientRect().width) + 1;
  }, []);

  // ── Auto-fit 한 컬럼의 너비 계산 (헤더+모든 보이는 셀의 최댓값 + 패딩) ──
  const computeAutoFitWidth = useCallback(
    (col: string): number => {
      // grip/checkbox/expand/actions: 아이콘·체크박스라 텍스트 측정 의미 없음 → 디폴트로 리셋
      const fixedCols: string[] = ['grip', 'checkbox', 'expand', 'actions'];
      if (fixedCols.includes(col)) return DEFAULT_COLUMN_WIDTHS[col] ?? 60;
      // 번호(seq) 컬럼: 보이는 작업 중 가장 큰 시퀀스 번호 자릿수에 맞춰 측정
      if (col === 'seq') {
        let maxNum = 0;
        for (const task of visibleTasks) {
          const n = taskIdToSeqNum.get(task.id);
          if (n != null && n > maxNum) maxNum = n;
        }
        const dataText = maxNum > 0 ? String(maxNum) : '0';
        const headerW = measureText('#');
        const dataW = measureText(dataText);
        const padding = 24;
        return Math.max(minColumnWidth(col), Math.min(autoFitWidthCap(col), Math.max(headerW, dataW) + padding));
      }
      const colId = col as TableColumnId;
      const headerLabel = colId.startsWith('custom:')
        ? (customColumnNameById.get(colId) ?? colId)
        : COLUMN_HEADER_LABELS[colId as BuiltInTableColumnId];
      let maxW = measureText(headerLabel ?? String(colId));
      const widthCap = autoFitWidthCap(col);
      for (const task of visibleTasks) {
        let cellText = '';
        let extraW = 0;
        if (colId === 'wbsId') cellText = displayWbsMap?.get(task.id) ?? '';
        else if (colId === 'name') {
          const dw = (displayWbsMap?.get(task.id) ?? '').trim();
          const prepend = wbsSettings?.prependDisplayWbsToTaskName === true;
          const nm = (task.name ?? '').trim();
          cellText = prepend && dw ? (nm ? `${dw} ${nm}` : dw) : (task.name ?? '');
          extraW = nameColumnExtraWidth(task, criticalPathTaskIds);
          const childN = directChildCountByParentId?.get(task.id);
          if (childN != null && childN > 0) {
            extraW += measureText(` (${childN})`);
          }
        } else if (colId === 'startDate') cellText = formatDate(task.startDate);
        else if (colId === 'endDate') cellText = formatDate(task.endDate);
        else if (colId === 'duration') {
          const d = inclusiveCalendarDays(task.startDate, task.endDate);
          cellText = d != null ? String(d) : '-';
        } else if (colId === 'workEffort') cellText = task.workEffort != null ? (Math.round(task.workEffort * 10) / 10).toFixed(1) : '-';
        else if (colId === 'weight') cellText = task.weight != null ? formatNum1(task.weight) : '-';
        else if (colId === 'assignee') {
          cellText = formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName) || '—';
        } else if (colId === 'allocation') cellText = allocationDisplayByTaskId.get(task.id) ?? '—';
        else if (colId === 'status') {
          const name = (wbsSettings?.statusConfigs ?? []).find((c: { id: string }) => c.id === task.status);
          cellText = (name as { name?: string } | undefined)?.name ?? task.status ?? '—';
        } else if (colId === 'progress') cellText = typeof task.progress === 'number' ? `${formatPercent1(task.progress)}%` : '—';
        // 계획율·진척차이는 파생값이라 task에 직접 없으므로 자릿수 최댓값(예: 100.0%, -100.0%p) 기준으로 측정한다.
        else if (colId === 'plannedProgress') cellText = `${formatPercent1(100)}%`;
        else if (colId === 'progressVariance') cellText = `-${formatPercent1(100)}%p`;
        else if (colId === 'deliverables') cellText = (task.deliverables?.trim() ?? '') || '—';
        else if (colId === 'dependencies') {
          const nums = (task.dependencies ?? [])
            .map((id: string) => taskIdToSeqNum.get(id))
            .filter((n: number | undefined): n is number => n != null)
            .sort((a: number, b: number) => a - b);
          cellText = nums.length > 0 ? nums.join(', ') : '';
        } else if (colId.startsWith('custom:')) {
          cellText = task.customFields?.[colId] ?? '';
        }
        const w = measureText(cellText) + extraW;
        if (w > maxW) maxW = w;
      }
      const padding = 24;
      return Math.max(minColumnWidth(col), Math.min(widthCap, maxW + padding));
    },
    [
      visibleTasks,
      directChildCountByParentId,
      displayWbsMap,
      allocationDisplayByTaskId,
      taskIdToSeqNum,
      customColumnNameById,
      assigneeDisplayMetaByName,
      criticalPathTaskIds,
      wbsSettings?.statusConfigs,
      wbsSettings?.prependDisplayWbsToTaskName,
      measureText,
    ],
  );

  // ── Double-click auto-fit (단일 컬럼) ──
  const handleColumnHeaderDoubleClick = useCallback(
    (col: string) => {
      const newWidth = computeAutoFitWidth(col);
      setColumnWidths((prev) => ({ ...prev, [col]: newWidth }));
      updateWbsSettings({ columnWidths: { ...columnWidthsRef.current, [col]: newWidth }, skipImplicitTableColumnAutoFit: true });
    },
    [computeAutoFitWidth, updateWbsSettings],
  );

  // ── 일괄 auto-fit: 보이는 모든 컬럼 너비를 현재 데이터에 맞게 한 번에 조정 ──
  // 호출부에서 넘어오는 visibleColumnIds는 데이터 컬럼만 포함하므로,
  // 좌측 보조 컬럼(grip/checkbox/seq/expand)과 우측 actions도 같이 리셋/측정한다.
  const autoFitAllColumns = useCallback(
    (visibleColumnIds: string[], opts?: { implicitOrToolbarAutoFit?: boolean }) => {
      const next: Record<string, number> = { ...columnWidthsRef.current };
      const allCols = Array.from(new Set(['grip', 'checkbox', 'seq', 'expand', ...visibleColumnIds, 'actions']));
      for (const col of allCols) {
        next[col] = computeAutoFitWidth(col);
      }
      setColumnWidths(next);
      if (opts?.implicitOrToolbarAutoFit) {
        updateWbsSettings({ columnWidths: next, skipImplicitTableColumnAutoFit: false });
      } else {
        updateWbsSettings({ columnWidths: next });
      }
    },
    [computeAutoFitWidth, updateWbsSettings],
  );

  return {
    columnWidths,
    resizingCol,
    setResizingCol,
    measureText,
    measureRef,
    handleColumnHeaderDoubleClick,
    autoFitAllColumns,
    startColumnResize,
  };
}
