import React from 'react';
import { CalendarDays, Clock, TrendingUp, ListChecks, Pencil, Edit2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatSummaryDate, type SummaryStats } from '../hooks/useWbsSummaryStats';

const StatChip = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="flex items-center gap-1.5 px-3 py-1">
    <span className="text-stone-400">{icon}</span>
    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</span>
    <span className="text-xs font-semibold text-[var(--color-ink)]">{value}</span>
  </div>
);

const Divider = () => <div className="w-px h-4 bg-stone-200 flex-shrink-0" />;

interface SummaryBarProps {
  summaryStats: SummaryStats | null;
  isSplitView: boolean;
  maxTreeLevel: number;
  treeExpandLevel: number;
  setTreeExpandLevel: (n: number) => void;
  expandToLevel: (n: number) => void;
  toggleTableEditMode: () => void;
  tableEditMode: boolean;
  excelView: boolean;
  setExcelView: React.Dispatch<React.SetStateAction<boolean>>;
  rowHeight: number;
  handleSetRowHeight: (h: number) => void;
  onOpenMdEditor: () => void;
}

export function SummaryBar({
  summaryStats,
  isSplitView,
  maxTreeLevel,
  treeExpandLevel,
  setTreeExpandLevel,
  expandToLevel,
  toggleTableEditMode,
  tableEditMode,
  excelView,
  setExcelView,
  rowHeight,
  handleSetRowHeight,
  onOpenMdEditor,
}: SummaryBarProps) {
  return (
    <div
      className={cn(
        // split view에서는 높이를 고정해 간트와 행 시작 위치를 완전히 맞춤
        isSplitView
          ? 'min-h-12 flex items-center gap-0 border-b px-4 py-1.5 text-xs bg-stone-50 flex-shrink-0 overflow-x-auto overflow-y-visible whitespace-nowrap'
          : 'flex items-center gap-0 border-b px-4 py-2 text-xs bg-stone-50 flex-wrap flex-shrink-0',
        'border-[var(--color-line)]',
      )}
    >
      {summaryStats ? (
        <>
          <StatChip icon={<ListChecks size={12} />} label="작업" value={`${summaryStats.taskCount}개 (단말 ${summaryStats.leafCount}개)`} />
          <Divider />
          <StatChip
            icon={<Clock size={12} />}
            label="총 공수"
            value={`${Number(summaryStats.effortDisplayAmount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${summaryStats.effortDisplayLabel}`}
          />
          <Divider />
          <StatChip icon={<TrendingUp size={12} />} label="전체 진척율" value={`${summaryStats.avgProgress}%`} />
          <Divider />
          <StatChip
            icon={<CalendarDays size={12} />}
            label="기간"
            value={`${formatSummaryDate(summaryStats.startDate)} ~ ${formatSummaryDate(summaryStats.endDate)}`}
          />

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">레벨 펼치기</span>
            <div className="flex items-center gap-1">
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
                    'h-7 min-w-[2.25rem] rounded-md border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                    treeExpandLevel === lv
                      ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                  )}
                >
                  {lv}
                </button>
              ))}
            </div>
            <Divider />
            <button
              type="button"
              onClick={toggleTableEditMode}
              aria-pressed={tableEditMode}
              className={cn(
                'flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
                tableEditMode ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
              )}
              title="스프레드시트 편집 모드 (F2)"
            >
              <Pencil size={14} strokeWidth={2} aria-hidden />
            </button>
            {/* MD편집·엑셀편집 버튼은 일시 숨김 처리 */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
              <input
                type="range"
                min={15}
                max={64}
                step={2}
                value={rowHeight}
                onChange={(e) => handleSetRowHeight(Number(e.target.value))}
                className="w-20 h-1.5 accent-indigo-500 cursor-pointer"
                title={`줄간격: ${rowHeight}px`}
              />
              <span className="text-[11px] font-bold text-slate-600 w-8 text-right tabular-nums">{rowHeight}</span>
            </div>
          </div>
        </>
      ) : (
        // split view: 표 영역 상단에 편집·줄간격만 배치 (간트 쪽은 자체 줌/줄간격 바 있음)
        <>
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggleTableEditMode}
            aria-pressed={tableEditMode}
            className={cn(
              'flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20',
              tableEditMode ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
            )}
            title="스프레드시트 편집 모드 (F2)"
          >
            <Pencil size={14} strokeWidth={2} aria-hidden />
          </button>
          {/* MD편집·엑셀편집 버튼은 일시 숨김 처리 */}
          <div className="w-px h-5 bg-stone-200 shrink-0" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
            <input
              type="range"
              min={15}
              max={64}
              step={2}
              value={rowHeight}
              onChange={(e) => handleSetRowHeight(Number(e.target.value))}
              className="w-20 h-1.5 accent-indigo-500 cursor-pointer"
              title={`줄간격: ${rowHeight}px`}
            />
            <span className="text-[11px] font-bold text-slate-600 w-8 text-right tabular-nums">{rowHeight}</span>
          </div>
        </>
      )}
    </div>
  );
}
