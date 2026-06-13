import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
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
  /** 간트 막대 우클릭 → WBSTable과 동일한 작업 메뉴 */
  const taskContextMenuHandlerRef = useRef<((e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void) | null>(null);
  const paneResizeRef = useRef<{ startX: number; startPct: number } | null>(null);
  const tablePaneWidthPctRef = useRef(readTablePaneWidthPct());
  const resizeRafRef = useRef(0);
  const resizeClientXRef = useRef(0);

  const [rowHeights, setRowHeights] = useState<number[]>([]);
  /** 표+간트: 셀 서식 툴바를 최상단 고정(sticky) */
  const [topDockSlot, setTopDockSlot] = useState<HTMLDivElement | null>(null);
  /** 일괄 수정(다중 선택) 바 — 화면 하단(표+간트 영역) 고정 */
  const [bottomDockSlot, setBottomDockSlot] = useState<HTMLDivElement | null>(null);
  /** 통합 한 줄: 표 요약(SummaryBar) */
  const [summaryChromeSlot, setSummaryChromeSlot] = useState<HTMLDivElement | null>(null);
  const [ganttBottomInset, setGanttBottomInset] = useState(0);
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
      className="list-split-view flex flex-col h-full min-h-0 overflow-hidden bg-white"
      style={{ ['--split-table-pct' as string]: `${tablePaneWidthPct}%` }}
    >
      {/* 셀 서식 → 최상단. 간트 헤더(z-40)보다 위에 두어 가려지지 않게 함. */}
      <div
        ref={setTopDockSlot}
        className="w-full shrink-0 sticky top-0 z-[60] bg-[var(--color-surface)] border-b border-[var(--color-line)] shadow-[0_1px_0_rgba(15,23,42,0.06)]"
      />
      <div className="relative z-[55] flex h-14 min-h-14 w-full shrink-0 items-stretch border-b border-[var(--color-line)] bg-gradient-to-r from-slate-50/95 via-white to-slate-50/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
        <div
          ref={setSummaryChromeSlot}
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col justify-center overflow-x-auto overflow-y-hidden"
        />
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 w-full overflow-hidden">
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
            topDockContainer={topDockSlot}
            bottomDockContainer={bottomDockSlot}
            splitSummaryChromeContainer={summaryChromeSlot}
            onBottomInsetChange={setGanttBottomInset}
            taskContextMenuHandlerRef={taskContextMenuHandlerRef}
          />
        </div>

        <button
          type="button"
          aria-label="표와 간트 영역 너비 조절"
          title="드래그하여 표·간트 너비 조절"
          className="hidden md:flex shrink-0 w-3 self-stretch cursor-col-resize touch-none z-[35] flex-col items-center justify-center border-0 p-0 bg-slate-200/90 hover:bg-indigo-400/40 active:bg-indigo-500/50 transition-colors"
          onMouseDown={handleSplitterMouseDown}
        >
          <ChevronsLeftRight className="h-4 w-4 text-slate-500 pointer-events-none" aria-hidden />
        </button>

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
            bottomInsetHeight={ganttBottomInset}
            onOpenTaskContextMenu={(e, taskId) => taskContextMenuHandlerRef.current?.(e, taskId)}
          />
        </div>
      </div>

      {/* 일괄 수정(다중 선택) 바 — 표·간트 패널 아래 전체 너비(내용은 WBSTable이 포털). 빈 슬롯일 땐 높이 0·테두리 없음 */}
      <div ref={setBottomDockSlot} className="w-full shrink-0 z-[60] bg-[var(--color-surface)]" />
    </div>
  );
}
