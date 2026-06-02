import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { resolvePersonAllocationLoadPresentation } from '../lib/allocationLoadLevel';
import type { AllocationEffortTooltipAggregate } from '../lib/allocationEffortIntegrity';
import {
  allocationEffortAllocatedInputTooltip,
  allocationEffortIntegrityCellSummaryTooltip,
  allocationEffortMismatchDetailTooltip,
  allocationEffortMismatchMessage,
  allocationEffortMissingWbsShortTooltip,
  allocationEffortWbsSumTooltip,
  evaluateAllocationEffortIntegrity,
  evaluateAllocationMissingMeaningfulWbs,
} from '../lib/allocationEffortIntegrity';
import { formatAllocationPercentSumForDisplay, formatEffortFromManDays } from '../lib/workEffortUnits';
import { cn } from '../lib/utils';

export function PersonAllocationEffortCell({
  totalPercent,
  totalWorkEffortMd,
  effortDisplayUnit,
  compact = false,
  align = 'right',
  tooltipAggregate = 'person_projects',
}: {
  totalPercent: number;
  totalWorkEffortMd: number;
  effortDisplayUnit: 'mm' | 'md';
  compact?: boolean;
  align?: 'left' | 'right';
  /** 툴팁에 집계 범위(인원 합계 vs 단일 프로젝트)를 반영 */
  tooltipAggregate?: AllocationEffortTooltipAggregate;
}) {
  const integrity = evaluateAllocationEffortIntegrity(totalPercent, totalWorkEffortMd);
  const { missing: missingMeaningfulWbs } = evaluateAllocationMissingMeaningfulWbs(totalPercent, totalWorkEffortMd);
  const presentation = resolvePersonAllocationLoadPresentation(totalPercent, integrity, missingMeaningfulWbs);

  const mismatchMessage = allocationEffortMismatchMessage(integrity);
  const mismatchDetail = allocationEffortMismatchDetailTooltip(integrity);
  const allocatedTip = allocationEffortAllocatedInputTooltip(totalPercent, effortDisplayUnit, {
    aggregate: tooltipAggregate,
  });
  const wbsTip = allocationEffortWbsSumTooltip(totalWorkEffortMd, effortDisplayUnit, { aggregate: tooltipAggregate });
  const cellSummaryTip = allocationEffortIntegrityCellSummaryTooltip(integrity, effortDisplayUnit, {
    aggregate: tooltipAggregate,
  });

  const highlightCell = integrity.hasMismatch || missingMeaningfulWbs;

  const allocatedBlock = (
    <div className="cursor-help">
      <div className={cn('text-[10px] font-medium text-slate-400', compact && 'sr-only')} title={allocatedTip}>
        할당 투입
        {!compact && <span className="block text-[9px] font-normal text-slate-400/90 normal-case tracking-normal">(투입율 → 공수)</span>}
      </div>
      <div
        className={cn('font-bold tabular-nums cursor-help', compact ? 'text-base' : 'text-base', presentation.percentTextClass)}
        title={allocatedTip}
      >
        {formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit)}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        align === 'left' ? 'text-left' : 'text-right',
        highlightCell && 'rounded-lg ring-1 ring-amber-300/90 bg-amber-50/50 px-2 py-1.5 -mx-1',
        'cursor-help',
      )}
      title={cellSummaryTip}
    >
      {allocatedBlock}
      {totalPercent > 100 && (
        <div
          className="text-[11px] font-medium text-red-600 mt-0.5 cursor-help"
          title="여러 프로젝트에 걸친 투입율(%) 합이 100%를 넘었습니다. 과다 배정이면 일부 투입율을 낮추거나, 표시 범위·담당을 확인하세요."
        >
          투입 합계 100% 초과
        </div>
      )}
      {totalWorkEffortMd > 0 && (
        <div className="cursor-help mt-1">
          <div className={cn('text-[10px] font-medium text-slate-400', compact && 'sr-only')} title={wbsTip}>
            WBS 공수
            {!compact && (
              <span className="block text-[9px] font-normal text-slate-400/90 normal-case tracking-normal">(담당 작업 추정 합)</span>
            )}
          </div>
          <div
            className={cn(
              'tabular-nums font-semibold cursor-help',
              compact ? 'text-xs' : 'text-sm',
              integrity.hasMismatch ? 'text-amber-800' : 'text-slate-600',
            )}
            title={wbsTip}
          >
            {formatEffortFromManDays(totalWorkEffortMd, effortDisplayUnit)}
          </div>
        </div>
      )}
      {integrity.hasMismatch && mismatchMessage && (
        <div
          className="mt-1 flex items-start gap-1 text-[10px] font-semibold text-amber-800 leading-snug cursor-help"
          title={mismatchDetail ?? mismatchMessage}
        >
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden />
          <span>{mismatchMessage}</span>
        </div>
      )}
      {!integrity.hasMismatch && missingMeaningfulWbs && (
        <div
          className="mt-1 flex items-start gap-1 text-[10px] font-semibold text-amber-800 leading-snug cursor-help"
          title={allocationEffortMissingWbsShortTooltip()}
        >
          <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden />
          <span>담당 WBS 공수가 거의 없습니다</span>
        </div>
      )}
    </div>
  );
}
