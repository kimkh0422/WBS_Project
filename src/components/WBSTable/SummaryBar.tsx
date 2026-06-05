import React from 'react';
import { CalendarDays, Clock, TrendingUp, ListChecks, Pencil, Edit2, Maximize2, Target, ListOrdered, Sparkles } from 'lucide-react';
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
  <div
    className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)]/60 bg-[var(--color-surface)]/80 px-2.5 py-1 shadow-[var(--shadow-xs)] backdrop-blur-sm transition-colors hover:border-[var(--color-line)]"
    title={hint}
  >
    <span className="text-slate-400 [&>svg]:opacity-90">{icon}</span>
    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.05em]">{label}</span>
    <span className={cn('text-xs font-semibold tabular-nums text-[var(--color-ink)]', valueClassName)}>{value}</span>
  </div>
);

const Divider = () => (
  <div className="w-px h-5 bg-gradient-to-b from-transparent via-[var(--color-line)] to-transparent flex-shrink-0 opacity-80" />
);

interface SummaryBarProps {
  summaryStats: SummaryStats | null;
  /** 계획율 기준일(YYYY-MM-DD). 빈 문자열이면 "오늘 자동" 모드. */
  plannedRefDateIso: string;
  setPlannedRefDateIso: (iso: string) => void;
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
  /** 작업표·간트: 레벨 배경·완료 강조 등 자동 서식(이 기기에서만 끄기 가능) */
  tableAutoFormatting?: {
    effectiveOn: boolean;
    globalEnabled: boolean;
    onToggle: () => void;
  };
}

export function SummaryBar({
  summaryStats,
  plannedRefDateIso,
  setPlannedRefDateIso,
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
  tableAutoFormatting,
}: SummaryBarProps) {
  return (
    <div
      className={cn(
        // split view에서는 높이를 고정해 간트와 행 시작 위치를 완전히 맞춤
        isSplitView
          ? 'h-14 flex items-center gap-1.5 border-b px-4 py-0 text-xs bg-gradient-to-r from-slate-50/95 via-white to-slate-50/95 flex-shrink-0 overflow-x-auto overflow-y-hidden whitespace-nowrap'
          : 'flex items-center gap-1.5 border-b px-4 py-2.5 text-xs bg-gradient-to-r from-slate-50/95 via-white to-slate-50/95 flex-wrap flex-shrink-0',
        'border-[var(--color-line)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
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
          <Divider />
          {/* 계획율 기준일 — 이 날짜 기준으로 모든 계획율(%)·차이(%P)가 즉시 재계산됨. */}
          <div
            className={cn(
              'flex items-center gap-1.5 px-1.5 py-0.5 rounded-md border',
              plannedRefDateIso ? 'border-indigo-300 bg-indigo-50/70' : 'border-slate-200 bg-white',
            )}
            title={
              plannedRefDateIso
                ? `계획율 기준일: ${plannedRefDateIso}\n— 이 날짜 시점의 영업일 진행률로 계획(%)·차이(%P)가 산정됩니다.\n— 비우면 "오늘 자동" 모드(매일 자동 갱신).`
                : '계획율 기준일이 비어 있어 "오늘 자동" 모드입니다. 날짜를 입력하면 그 시점 기준으로 모든 계획율이 즉시 재계산됩니다.'
            }
          >
            <CalendarDays size={12} className={plannedRefDateIso ? 'text-indigo-600' : 'text-slate-400'} />
            <span
              className={cn('text-[10px] font-bold uppercase tracking-[0.06em]', plannedRefDateIso ? 'text-indigo-700' : 'text-slate-500')}
            >
              기준일
            </span>
            <input
              type="date"
              value={plannedRefDateIso}
              onChange={(e) => setPlannedRefDateIso(e.target.value)}
              className={cn(
                'h-6 px-1 text-[11px] rounded border focus:outline-none focus:ring-2 focus:ring-indigo-400/30',
                plannedRefDateIso ? 'border-indigo-300 bg-white text-indigo-800 font-semibold' : 'border-slate-200 bg-white text-slate-600',
              )}
              aria-label="계획율 기준일"
            />
            {plannedRefDateIso && (
              <button
                type="button"
                onClick={() => setPlannedRefDateIso('')}
                className="text-[10px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-1 py-0.5 rounded"
                title="기준일 비우기 → 오늘 자동"
              >
                오늘
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2.5 pl-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.06em]">레벨 펼치기</span>
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
            <Divider />
            <button
              type="button"
              onClick={toggleTableEditMode}
              aria-pressed={tableEditMode}
              className={cn(
                'flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                tableEditMode
                  ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
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
            {tableAutoFormatting && (
              <button
                type="button"
                onClick={tableAutoFormatting.onToggle}
                disabled={!tableAutoFormatting.globalEnabled}
                aria-pressed={tableAutoFormatting.effectiveOn}
                className={cn(
                  'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                  !tableAutoFormatting.globalEnabled
                    ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    : tableAutoFormatting.effectiveOn
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                )}
                title={
                  !tableAutoFormatting.globalEnabled
                    ? '관리자가 전체 자동 서식(레벨 색·완료 강조)을 껐습니다.'
                    : tableAutoFormatting.effectiveOn
                      ? '레벨 배경·완료 취소선 등 자동 서식이 켜져 있습니다. 클릭하면 이 브라우저에서만 끕니다.'
                      : '이 브라우저에서 자동 서식이 꺼져 있습니다. 클릭하면 다시 켭니다.'
                }
              >
                <Sparkles size={12} strokeWidth={2} aria-hidden />
                자동 서식
              </button>
            )}
            <button
              type="button"
              onClick={onAutoFitColumns}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
              'flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
              tableEditMode
                ? 'border-indigo-400 bg-indigo-100 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
            title="스프레드시트 편집 모드 (F2)"
          >
            <Pencil size={14} strokeWidth={2} aria-hidden />
          </button>
          {tableAutoFormatting && (
            <button
              type="button"
              onClick={tableAutoFormatting.onToggle}
              disabled={!tableAutoFormatting.globalEnabled}
              aria-pressed={tableAutoFormatting.effectiveOn}
              className={cn(
                'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
                !tableAutoFormatting.globalEnabled
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : tableAutoFormatting.effectiveOn
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
              title={
                !tableAutoFormatting.globalEnabled
                  ? '관리자가 전체 자동 서식을 껐습니다.'
                  : tableAutoFormatting.effectiveOn
                    ? '클릭하면 이 브라우저에서만 자동 서식을 끕니다.'
                    : '클릭하면 자동 서식을 다시 켭니다.'
              }
            >
              <Sparkles size={12} strokeWidth={2} aria-hidden />
              자동 서식
            </button>
          )}
          <button
            type="button"
            onClick={onAutoFitColumns}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-[11px] font-medium shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            title="컬럼 너비를 현재 데이터 길이에 맞춰 일괄 자동 조정. 표만 뷰에서 열 너비를 수동으로 맞춘 뒤에는 이 버튼으로 다시 ‘진입 시 자동 맞춤’을 켤 수 있습니다. 헤더 더블클릭은 단일 컬럼만 적용"
          >
            <Maximize2 size={12} strokeWidth={2} aria-hidden />
            자동 맞춤
          </button>
          {/* MD편집·엑셀편집 버튼은 일시 숨김 처리 */}
          <div className="w-px h-5 bg-slate-200 shrink-0" />
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
