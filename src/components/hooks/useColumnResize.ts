import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { type TableColumnId } from '../wbsTableTypes';
import { formatDate, formatNum2 } from '../../lib/utils';
import type { Task } from '../../types';

// ── Default column widths ──────────────────────────────────────────
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  grip: 32,
  checkbox: 40,
  seq: 48,
  expand: 40,
  wbsId: 60,
  name: 300,
  startDate: 85,
  endDate: 85,
  workEffort: 56,
  weight: 56,
  assignee: 70,
  allocation: 72,
  status: 70,
  progress: 70,
  deliverables: 120,
  dependencies: 120,
  actions: 70,
};

/** 데이터 컬럼별 헤더 표시 텍스트 */
const COLUMN_HEADER_LABELS: Record<TableColumnId, string> = {
  wbsId: 'WBS',
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  workEffort: '공수(d)',
  weight: '가중치',
  assignee: '담당자',
  allocation: '투입율',
  status: '상태',
  progress: '진척(%)',
  deliverables: '산출물',
  dependencies: '선행작업',
};

// ── Hook params ────────────────────────────────────────────────────
export interface UseColumnResizeParams {
  wbsSettings: { columnWidths?: Record<string, number>; statusConfigs?: Array<{ id: string; name?: string }> } | undefined;
  updateWbsSettings: (updates: Record<string, unknown>) => void;
  visibleTasks: Task[];
  displayWbsMap: Map<string, string> | undefined;
  allocationDisplayByTaskId: Map<string, string>;
  taskIdToSeqNum: Map<string, number>;
}

export interface UseColumnResizeReturn {
  columnWidths: Record<string, number>;
  resizingCol: string | null;
  setResizingCol: Dispatch<SetStateAction<string | null>>;
  measureText: (text: string) => number;
  measureRef: RefObject<HTMLDivElement | null>;
  handleColumnHeaderDoubleClick: (col: string) => void;
  startColumnResize: (columnId: string, startX: number) => void;
}

// ── Hook ───────────────────────────────────────────────────────────
export function useColumnResize({
  wbsSettings,
  updateWbsSettings,
  visibleTasks,
  displayWbsMap,
  allocationDisplayByTaskId,
  taskIdToSeqNum,
}: UseColumnResizeParams): UseColumnResizeReturn {
  // ── State ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COLUMN_WIDTHS });
  const columnWidthsRef = useRef(columnWidths);
  const hasRestoredColumnWidths = useRef(false);

  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);

  // ── Restore saved widths from settings ──
  useEffect(() => {
    const saved = wbsSettings?.columnWidths;
    if (hasRestoredColumnWidths.current || !saved || Object.keys(saved).length === 0) return;
    setColumnWidths((prev) => ({ ...DEFAULT_COLUMN_WIDTHS, ...saved }));
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
      const newWidth = Math.max(30, start.startWidth + diff);
      setColumnWidths((prev) => ({ ...prev, [start.col]: newWidth }));
    };

    const handleMouseUp = () => {
      resizeStartRef.current = null;
      setResizingCol(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      updateWbsSettings({ columnWidths: columnWidthsRef.current });
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

  // ── Double-click auto-fit ──
  const handleColumnHeaderDoubleClick = useCallback(
    (col: string) => {
      const fixedCols: string[] = ['grip', 'checkbox', 'seq', 'expand', 'actions'];
      if (fixedCols.includes(col)) {
        setColumnWidths((prev) => ({ ...prev, [col]: DEFAULT_COLUMN_WIDTHS[col] }));
        updateWbsSettings({ columnWidths: { ...columnWidthsRef.current, [col]: DEFAULT_COLUMN_WIDTHS[col] } });
        return;
      }
      const colId = col as TableColumnId;
      let maxW = measureText(COLUMN_HEADER_LABELS[colId] ?? String(colId));
      for (const task of visibleTasks) {
        let cellText = '';
        if (colId === 'wbsId') cellText = displayWbsMap?.get(task.id) ?? '';
        else if (colId === 'name') cellText = (displayWbsMap?.get(task.id) ? `${displayWbsMap.get(task.id)} ` : '') + (task.name ?? '');
        else if (colId === 'startDate') cellText = formatDate(task.startDate);
        else if (colId === 'endDate') cellText = formatDate(task.endDate);
        else if (colId === 'workEffort') cellText = task.workEffort != null ? (Math.round(task.workEffort * 10) / 10).toFixed(1) : '-';
        else if (colId === 'weight') cellText = task.weight != null ? formatNum2(task.weight) : '-';
        else if (colId === 'assignee') {
          cellText = task.assignee || '—';
        } else if (colId === 'allocation') cellText = allocationDisplayByTaskId.get(task.id) ?? '—';
        else if (colId === 'status') {
          const name = (wbsSettings?.statusConfigs ?? []).find((c: { id: string }) => c.id === task.status);
          cellText = (name as { name?: string } | undefined)?.name ?? task.status ?? '—';
        } else if (colId === 'progress') cellText = typeof task.progress === 'number' ? `${formatNum2(task.progress)}%` : '—';
        else if (colId === 'deliverables') cellText = (task.deliverables?.trim() ?? '') || '—';
        else if (colId === 'dependencies') {
          const nums = (task.dependencies ?? [])
            .map((id: string) => taskIdToSeqNum.get(id))
            .filter((n: number | undefined): n is number => n != null)
            .sort((a: number, b: number) => a - b);
          cellText = nums.length > 0 ? nums.join(', ') : '';
        }
        const w = measureText(cellText);
        if (w > maxW) maxW = w;
      }
      const padding = 24;
      const newWidth = Math.max(30, Math.min(800, maxW + padding));
      setColumnWidths((prev) => ({ ...prev, [col]: newWidth }));
      updateWbsSettings({ columnWidths: { ...columnWidthsRef.current, [col]: newWidth } });
    },
    [visibleTasks, displayWbsMap, allocationDisplayByTaskId, taskIdToSeqNum, wbsSettings?.statusConfigs, measureText, updateWbsSettings],
  );

  return {
    columnWidths,
    resizingCol,
    setResizingCol,
    measureText,
    measureRef,
    handleColumnHeaderDoubleClick,
    startColumnResize,
  };
}
