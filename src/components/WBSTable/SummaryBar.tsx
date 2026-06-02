import React from 'react';
import { CalendarDays, Clock, TrendingUp, ListChecks, Pencil, Edit2, Maximize2, Target, ListOrdered } from 'lucide-react';
import { cn, formatPercent1 } from '../../lib/utils';
import { formatSummaryDate, type SummaryStats } from '../hooks/useWbsSummaryStats';
import { SUMMARY_BAR_PLANNED_HINT, summaryBarVarianceHint } from '../../lib/plannedProgressTooltips';

const StatChip = ({
  icon,
  label,
  value,
  hint,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  /** 네이티브 툴팁(계산 방식 등) */
  hint?: string;
  /** 값 텍스트 색 등 추가 클래스(예: 진척차이 양수/음수 색) */
  valueClassName?: string;
}) => (
  <div className="flex items-center gap-1.5 px-3 py-1" title={hint}>
    <span className="text-stone-400">{icon}</span>
    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</span>
    <span className={cn('text-xs font-semibold text-[var(--color-ink)]', valueClassName)}>{value}</span>
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
  /** 모든 보이는 컬럼 너비를 현재 데이터/헤더 텍스트 길이에 맞춰 일괄 자동 조정 */
  onAutoFitColumns: () => void;
  onOpenMdEditor: () => void;
  /** 등록 작업 기준 우선순위 보완 가이드(모달) */
  onOpenImprovementGuide?: () => void;
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
  onAutoFitColumns,
  onOpenMdEditor,
  onOpenImprovementGuide,
}: SummaryBarProps) {
  return (
    <div
      className={cn(
        // split view에서는 높이를 고정해 간트와 행 시작 위치를 완전히 맞춤
        isSplitView
          ? 'h-14 flex items-center gap-0 border-b px-4 py-0 text-xs bg-stone-50 flex-shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap'
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
          <StatChip
            icon={<TrendingUp size={12} />}
            label="전체 진척율"
            value={`${formatPercent1(summaryStats.avgProgress)}%`}
            hint={summaryStats.avgProgressTooltip}
          />
          <Divider />
          <StatChip
            icon={<Target size={12} />}
            label="전체 계획율"
            value={`${formatPercent1(summaryStats.avgPlanned)}%`}
            hint={SUMMARY_BAR_PLANNED_HINT}
          />
          <Divider />
          <StatChip
            icon={<TrendingUp size={12} />}
            label="계획대비"
            value={`${summaryStats.progressVariance > 0 ? '+' : ''}${formatPercent1(summaryStats.progressVariance)}%p`}
            valueClassName={
              summaryStats.progressVariance < 0 ? 'text-red-600' : summaryStats.progressVariance > 0 ? 'text-emerald-600' : undefined
            }
            hint={summaryBarVarianceHint(
              formatPercent1(summaryStats.avgProgress),
              formatPercent1(summaryStats.avgPlanned),
              `${summaryStats.progressVariance > 0 ? '+' : ''}${formatPercent1(summaryStats.progressVariance)}`,
              summaryStats.progressVariance < 0 ? '계획 대비 지연' : summaryStats.progressVariance > 0 ? '계획보다 앞섬' : '계획대로',
            )}
          />
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
            {onOpenImprovementGuide && (
              <button
                type="button"
                onClick={onOpenImprovementGuide}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                title="담당 미지정·일정 불일치·진척 지연 등을 우선순위 순으로 안내합니다"
              >
                <ListOrdered size={12} strokeWidth={2} aria-hidden />
                보완 가이드
              </button>
            )}
            <button
              type="button"
              onClick={onAutoFitColumns}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              title="컬럼 너비를 현재 데이터 길이에 맞춰 일괄 자동 조정. 표만 뷰에서 열 너비를 수동으로 맞춘 뒤에는 이 버튼으로 다시 ‘진입 시 자동 맞춤’을 켤 수 있습니다. 헤더 더블클릭은 단일 컬럼만 적용"
            >
              <Maximize2 size={12} strokeWidth={2} aria-hidden />
              자동 맞춤
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
          {onOpenImprovementGuide && (
            <button
              type="button"
              onClick={onOpenImprovementGuide}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
              title="등록 작업 기준 우선순위 보완 가이드"
            >
              <ListOrdered size={12} strokeWidth={2} aria-hidden />
              가이드
            </button>
          )}
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
          <button
            type="button"
            onClick={onAutoFitColumns}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            title="컬럼 너비를 현재 데이터 길이에 맞춰 일괄 자동 조정. 표만 뷰에서 열 너비를 수동으로 맞춘 뒤에는 이 버튼으로 다시 ‘진입 시 자동 맞춤’을 켤 수 있습니다. 헤더 더블클릭은 단일 컬럼만 적용"
          >
            <Maximize2 size={12} strokeWidth={2} aria-hidden />
            자동 맞춤
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
