import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WBSTable } from './WBSTable';
import { GanttChart } from './GanttChart';
import { mirrorScrollTop, useScrollSync } from '../hooks/useScrollSync';
import type { FilterState, SortConfig, Task } from '../types';

const SPLIT_TABLE_WIDTH_KEY = 'wbs.split.wbsTableWidth';
const MIN_TABLE_PCT = 25;
const MAX_TABLE_PCT = 75;

function readTablePaneWidthPct(): number {
  try {
    const raw = localStorage.getItem(SPLIT_TABLE_WIDTH_KEY);
    const n = raw ? Number(raw) : 50;
    if (!Number.isFinite(n)) return 50;
    return Math.min(MAX_TABLE_PCT, Math.max(MIN_TABLE_PCT, Math.round(n)));
  } catch {
    return 50;
  }
}

function clampPct(n: number): number {
  return Math.min(MAX_TABLE_PCT, Math.max(MIN_TABLE_PCT, Math.round(n)));
}

export interface TableGanttSplitProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  onOpenColumnSettings: () => void;
  onResetFilters: () => void;
  scrollToTaskId: string | null;
  sharedRowHeight: number;
  onRowHeightChange: (h: number) => void;
}

/** 표 + 간트 split view (데스크톱: 좌우·드래그로 너비 조절, 모바일: 상하). */
export function TableGanttSplit({
  filters,
  sortConfig,
  onSort,
  onOpenColumnSettings,
  onResetFilters,
  scrollToTaskId,
  sharedRowHeight,
  onRowHeightChange,
}: TableGanttSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttBottomScrollRef = useRef<HTMLDivElement | null>(null);
  const paneResizeRef = useRef<{ startX: number; startPct: number } | null>(null);
  const tablePaneWidthPctRef = useRef(readTablePaneWidthPct());
  const resizeRafRef = useRef(0);
  const resizeClientXRef = useRef(0);

  const [rowHeights, setRowHeights] = useState<number[]>([]);
  // 표 상단에 도킹된 서식/일괄 바 높이 — 간트 상단도 같은 높이만큼 띄워 행 정렬을 맞춘다.
  const [tableTopInset, setTableTopInset] = useState(0);
  const [tablePaneWidthPct, setTablePaneWidthPct] = useState(readTablePaneWidthPct);

  tablePaneWidthPctRef.current = tablePaneWidthPct;

  // 세로(행) 스크롤만 표↔간트 동기화한다.
  useScrollSync(tableScrollRef, ganttScrollRef, true, containerRef);

  // 가로 스크롤은 표(컬럼)와 간트(타임라인)가 서로 무관하므로 동기화하지 않는다.
  // 각 패널은 내부적으로(헤더↔본문↔하단) 자체 가로 동기를 유지하며, 간트를 좌우로 스크롤해도 표는 움직이지 않는다.

  // 줄바꿈 등으로 행 높이가 갱신되면 스크롤 위치를 다시 맞춤
  useEffect(() => {
    const table = tableScrollRef.current;
    const gantt = ganttScrollRef.current;
    if (!table || !gantt) return;
    mirrorScrollTop(table, gantt);
  }, [rowHeights]);

  const applySplitWidthPct = useCallback((pct: number) => {
    const next = clampPct(pct);
    tablePaneWidthPctRef.current = next;
    containerRef.current?.style.setProperty('--split-table-pct', `${next}%`);
  }, []);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    paneResizeRef.current = { startX: e.clientX, startPct: tablePaneWidthPctRef.current };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!paneResizeRef.current) return;
      resizeClientXRef.current = e.clientX;
      if (resizeRafRef.current) return;
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        const r = paneResizeRef.current;
        const c = containerRef.current;
        if (!r || !c) return;
        const width = c.getBoundingClientRect().width;
        if (width <= 0) return;
        const deltaPct = ((resizeClientXRef.current - r.startX) / width) * 100;
        applySplitWidthPct(r.startPct + deltaPct);
      });
    };

    const onUp = () => {
      if (!paneResizeRef.current) return;
      paneResizeRef.current = null;
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = 0;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const pct = tablePaneWidthPctRef.current;
      setTablePaneWidthPct(pct);
      try {
        localStorage.setItem(SPLIT_TABLE_WIDTH_KEY, String(pct));
      } catch {
        /* ignore */
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    };
  }, [applySplitWidthPct]);

  useEffect(() => {
    containerRef.current?.style.setProperty('--split-table-pct', `${tablePaneWidthPct}%`);
  }, [tablePaneWidthPct]);

  return (
    <div
      ref={containerRef}
      className="list-split-view flex flex-col md:flex-row h-full min-h-0 overflow-hidden bg-white"
      style={{ ['--split-table-pct' as string]: `${tablePaneWidthPct}%` }}
    >
      <div className="list-table-pane h-[min(50vh,480px)] md:h-full min-h-0 flex flex-col overflow-hidden max-md:w-full">
        <WBSTable
          fillHeight
          filters={filters}
          sortConfig={sortConfig}
          onOpenColumnSettings={onOpenColumnSettings}
          onResetFilters={onResetFilters}
          scrollToTaskId={scrollToTaskId}
          onSort={onSort}
          syncScrollRef={tableScrollRef}
          splitHeaderScrollRef={tableHeaderScrollRef}
          rowHeight={sharedRowHeight}
          onRowHeightChange={onRowHeightChange}
          onRowHeightsChange={setRowHeights}
          syncRowHeights={rowHeights}
          onTopInsetChange={setTableTopInset}
        />
      </div>

      <button
        type="button"
        aria-label="표와 간트 영역 너비 조절"
        title="드래그하여 표·간트 너비 조절"
        className="hidden md:block shrink-0 w-2 self-stretch cursor-col-resize touch-none z-[35] border-0 p-0 bg-slate-200/90 hover:bg-indigo-400/40 active:bg-indigo-500/50 transition-colors"
        onMouseDown={handleSplitterMouseDown}
      />

      <div data-tourid="tour-gantt" className="list-gantt-pane flex-1 min-h-0 min-w-0 h-[min(50vh,480px)] md:h-full overflow-hidden">
        <GanttChart
          filters={filters}
          sortConfig={sortConfig}
          hideSidebar
          syncScrollRef={ganttScrollRef}
          splitGanttHeaderScrollRef={ganttHeaderScrollRef}
          splitGanttBottomScrollRef={ganttBottomScrollRef}
          rowHeight={sharedRowHeight}
          rowHeights={rowHeights}
          onRowHeightChange={onRowHeightChange}
          bottomSpacerHeight={sharedRowHeight}
          topInsetHeight={tableTopInset}
        />
      </div>
    </div>
  );
}
