import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { WBSTable } from './WBSTable';
import { KanbanBoard } from './KanbanBoard';
import { useScrollSync } from '../hooks/useScrollSync';
import type { FilterState, SortConfig, Task } from '../types';

const SPLIT_TABLE_KANBAN_WIDTH_KEY = 'wbs.split.tableKanbanWidth';
const MIN_TABLE_PCT = 25;
const MAX_TABLE_PCT = 75;

function readTablePaneWidthPct(): number {
  try {
    const raw = localStorage.getItem(SPLIT_TABLE_KANBAN_WIDTH_KEY);
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

export interface TableKanbanSplitProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  onOpenColumnSettings: () => void;
  scrollToTaskId: string | null;
  sharedRowHeight: number;
  onRowHeightChange: (h: number) => void;
}

/** 표 + 칸반 split (데스크톱: 좌우·드래그로 너비 조절, 모바일: 위·아래). 세로 스크롤은 표 본문과 칸반 보드를 동기화한다. */
export function TableKanbanSplit({
  filters,
  sortConfig,
  onSort,
  onOpenColumnSettings,
  scrollToTaskId,
  sharedRowHeight,
  onRowHeightChange,
}: TableKanbanSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const kanbanScrollRef = useRef<HTMLDivElement | null>(null);
  const taskContextMenuHandlerRef = useRef<((e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void) | null>(null);
  const paneResizeRef = useRef<{ startX: number; startPct: number } | null>(null);
  const tablePaneWidthPctRef = useRef(readTablePaneWidthPct());
  const resizeRafRef = useRef(0);
  const resizeClientXRef = useRef(0);

  const [topDockSlot, setTopDockSlot] = useState<HTMLDivElement | null>(null);
  const [bottomDockSlot, setBottomDockSlot] = useState<HTMLDivElement | null>(null);
  const [tablePaneWidthPct, setTablePaneWidthPct] = useState(readTablePaneWidthPct);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_TABLE_KANBAN_WIDTH_KEY, String(tablePaneWidthPct));
    } catch {
      /* ignore */
    }
  }, [tablePaneWidthPct]);

  tablePaneWidthPctRef.current = tablePaneWidthPct;

  useScrollSync(tableScrollRef, kanbanScrollRef, true, containerRef, {
    secondPaneSelector: '.list-kanban-pane',
    verticalWheelAsHorizontalInSecondPane: false,
  });

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
      <div
        ref={setTopDockSlot}
        className="w-full shrink-0 sticky top-0 z-[60] border-b border-[var(--color-line)] bg-[#f0f4f8] shadow-[0_1px_0_rgba(15,23,42,0.06)]"
      />

      <div className="flex flex-col md:flex-row flex-1 min-h-0 w-full overflow-hidden">
        <div className="list-table-pane h-[min(50vh,480px)] md:h-full min-h-0 flex flex-col overflow-hidden max-md:w-full">
          <WBSTable
            fillHeight
            filters={filters}
            sortConfig={sortConfig}
            onOpenColumnSettings={onOpenColumnSettings}
            scrollToTaskId={scrollToTaskId}
            onSort={onSort}
            syncScrollRef={tableScrollRef}
            splitHeaderScrollRef={tableHeaderScrollRef}
            rowHeight={sharedRowHeight}
            onRowHeightChange={onRowHeightChange}
            topDockContainer={topDockSlot}
            bottomDockContainer={bottomDockSlot}
            taskContextMenuHandlerRef={taskContextMenuHandlerRef}
          />
        </div>

        <button
          type="button"
          aria-label="표와 칸반 영역 너비 조절"
          title="드래그하여 표·칸반 영역 너비 조절"
          className="hidden md:flex shrink-0 w-3 self-stretch cursor-col-resize touch-none z-[35] flex-col items-center justify-center border-0 p-0 bg-slate-200/90 hover:bg-indigo-400/40 active:bg-indigo-500/50 transition-colors"
          onMouseDown={handleSplitterMouseDown}
        >
          <ChevronsLeftRight className="h-4 w-4 text-slate-500 pointer-events-none" aria-hidden />
        </button>

        <div className="list-kanban-pane flex-1 min-h-0 min-w-0 h-[min(50vh,480px)] md:h-full overflow-hidden">
          <KanbanBoard filters={filters} syncScrollRef={kanbanScrollRef} />
        </div>
      </div>

      <div ref={setBottomDockSlot} className="w-full shrink-0 z-[60] bg-[var(--color-surface)]" />
    </div>
  );
}
