import React from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '../../lib/utils';

const Divider = () => (
  <div className="h-5 w-px shrink-0 bg-gradient-to-b from-transparent via-[var(--color-line)] to-transparent opacity-80" aria-hidden />
);

interface SummaryBarProps {
  /** 계획율 기준일(YYYY-MM-DD). 빈 문자열이면 "오늘 자동" 모드. */
  plannedRefDateIso: string;
  setPlannedRefDateIso: (iso: string) => void;
  maxTreeLevel: number;
  treeExpandLevel: number;
  setTreeExpandLevel: (n: number) => void;
  expandToLevel: (n: number) => void;
  rowHeight: number;
  handleSetRowHeight: (h: number) => void;
  /** 표+간트 split: 표 영역 비율(%). 함께 전달될 때만 간트 너비 슬라이더 표시(데스크톱만). */
  splitTablePaneWidthPct?: number;
  onSplitTablePaneWidthPctChange?: (tablePaneWidthPct: number) => void;
  /**
   * default: 표 단독 상단 줄(전체 너비·하단 구분선).
   * toolbarRail: 셀 서식 툴바와 한 줄 — 기준일·줄간격 뒤에 레벨 펼치기(맨 오른쪽).
   */
  layout?: 'default' | 'toolbarRail';
}

/** 표 상단: 계획율 기준일·트리 레벨·줄간격(집계 칩은 표 본문과 중복되어 생략). */
export function SummaryBar({
  plannedRefDateIso,
  setPlannedRefDateIso,
  maxTreeLevel,
  treeExpandLevel,
  setTreeExpandLevel,
  expandToLevel,
  rowHeight,
  handleSetRowHeight,
  splitTablePaneWidthPct,
  onSplitTablePaneWidthPctChange,
  layout = 'default',
}: SummaryBarProps) {
  const rail = layout === 'toolbarRail';
  const showSplitWidthSlider =
    typeof splitTablePaneWidthPct === 'number' && Number.isFinite(splitTablePaneWidthPct) && onSplitTablePaneWidthPctChange != null;
  /** 표 25~75% 제약과 동일 → 간트 영역 25~75% */
  const ganttWidthPct = showSplitWidthSlider ? 100 - splitTablePaneWidthPct : 50;

  const plannedDateBlock = (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5',
        plannedRefDateIso ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white',
      )}
      title={
        plannedRefDateIso
          ? `계획율 기준일: ${plannedRefDateIso}\n— 이 날짜 시점의 영업일 진행률로 계획(%)·차이(%P)가 산정됩니다.\n— 비우면 "오늘 자동" 모드(매일 자동 갱신).`
          : '계획율 기준일이 비어 있어 "오늘 자동" 모드입니다. 날짜를 입력하면 그 시점 기준으로 모든 계획율이 즉시 재계산됩니다.'
      }
    >
      <CalendarDays size={12} className={plannedRefDateIso ? 'text-indigo-600' : 'text-slate-400'} />
      <span className={cn('text-[10px] font-bold uppercase tracking-[0.06em]', plannedRefDateIso ? 'text-indigo-700' : 'text-slate-500')}>
        기준일
      </span>
      <input
        type="date"
        value={plannedRefDateIso}
        onChange={(e) => setPlannedRefDateIso(e.target.value)}
        className={cn(
          'h-6 max-w-[9.5rem] shrink rounded border px-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-400/30',
          plannedRefDateIso ? 'border-indigo-300 bg-white font-semibold text-indigo-800' : 'border-slate-200 bg-white text-slate-600',
        )}
        aria-label="계획율 기준일"
      />
      {plannedRefDateIso && (
        <button
          type="button"
          onClick={() => setPlannedRefDateIso('')}
          className="rounded px-1 py-0.5 text-[10px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-600"
          title="기준일 비우기 → 오늘 자동"
        >
          오늘
        </button>
      )}
    </div>
  );

  const rowHeightBlock = (
    <div className="flex shrink-0 items-center gap-2">
      <span className="whitespace-nowrap text-[10px] font-bold text-slate-500">줄간격</span>
      <input
        type="range"
        min={15}
        max={64}
        step={2}
        value={rowHeight}
        onChange={(e) => handleSetRowHeight(Number(e.target.value))}
        className="h-1.5 w-20 cursor-pointer accent-indigo-500"
        title={`줄간격: ${rowHeight}px`}
      />
      <span className="w-8 text-right text-[11px] font-bold tabular-nums text-slate-600">{rowHeight}</span>
    </div>
  );

  const splitGanttWidthBlock = showSplitWidthSlider ? (
    <div className="hidden md:flex shrink-0 items-center gap-2">
      <span className="whitespace-nowrap text-[10px] font-bold text-slate-500">간트 너비</span>
      <input
        type="range"
        min={25}
        max={75}
        step={1}
        value={ganttWidthPct}
        onChange={(e) => onSplitTablePaneWidthPctChange!(100 - Number(e.target.value))}
        className="h-1.5 w-20 cursor-pointer accent-indigo-500"
        title={`간트 영역 약 ${ganttWidthPct}%(표 ${splitTablePaneWidthPct}%). 화면 중앙 세로 구분선을 드래그해도 같이 조절됩니다.`}
      />
      <span className="w-8 text-right text-[11px] font-bold tabular-nums text-slate-600">{ganttWidthPct}%</span>
    </div>
  ) : null;

  const levelExpandBlock = (
    <>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">레벨 펼치기</span>
      <div className="flex shrink-0 items-center gap-1">
        {Array.from({ length: Math.max(1, maxTreeLevel) }, (_, i) => i + 1).map((lv) => (
          <button
            key={lv}
            type="button"
            title={`${lv}레벨까지 펼치기`}
            onClick={() => {
              setTreeExpandLevel(lv);
              expandToLevel(lv);
            }}
            className={cn(
              'h-7 min-w-[2.25rem] rounded-md border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
              treeExpandLevel === lv
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {lv}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        rail
          ? 'flex h-11 min-h-11 w-auto shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap border-l border-[#dadce0] bg-transparent px-2 py-0 text-xs shadow-none'
          : 'flex h-14 flex-shrink-0 items-center justify-end gap-2.5 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-[var(--color-line)] bg-gradient-to-r from-slate-50/95 via-white to-slate-50/95 px-4 py-0 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
      )}
      role="toolbar"
      aria-label="표 보기 옵션"
    >
      {rail ? (
        <>
          {plannedDateBlock}
          <Divider />
          {rowHeightBlock}
          {splitGanttWidthBlock ? (
            <>
              <Divider />
              {splitGanttWidthBlock}
            </>
          ) : null}
          <Divider />
          {levelExpandBlock}
        </>
      ) : (
        <>
          {plannedDateBlock}
          <Divider />
          {levelExpandBlock}
          <Divider />
          {rowHeightBlock}
          {splitGanttWidthBlock ? (
            <>
              <Divider />
              {splitGanttWidthBlock}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
