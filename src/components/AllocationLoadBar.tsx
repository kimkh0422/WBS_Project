import React from 'react';
import { cn, formatPercent1 } from '../lib/utils';
import {
  allocationLoadBarFillClass,
  allocationLoadLabel,
  allocationLoadTextClass,
  getAllocationLoadLevel,
  type PersonAllocationLoadPresentation,
} from '../lib/allocationLoadLevel';

export function AllocationLoadBar({
  totalPercent,
  size = 'md',
  showPercent = true,
  showLevelChip = false,
  className,
  presentation,
}: {
  totalPercent: number;
  size?: 'sm' | 'md';
  showPercent?: boolean;
  /** 여유·적정·과부하·WBS 맥락 칩 표시 */
  showLevelChip?: boolean;
  className?: string;
  /** 지정 시 막대·%·칩이 할당/WBS 맥락에 맞게 표시됨(인원별 투입 현황) */
  presentation?: PersonAllocationLoadPresentation;
}) {
  const level = getAllocationLoadLevel(totalPercent);
  const barWidth = Math.min(100, Math.max(0, totalPercent));
  const displayPct = totalPercent > 100 ? totalPercent : barWidth;
  const levelLabel = allocationLoadLabel(level);

  const barFill = presentation ? presentation.barFillClass : allocationLoadBarFillClass(level);
  const percentClass = presentation ? presentation.percentTextClass : allocationLoadTextClass(level);
  const chipLabel = presentation ? presentation.chipLabel : levelLabel;
  const chipTitle = presentation?.chipTitle;
  const chipContainerClass = presentation?.chipContainerClass;

  return (
    <div className={cn('flex items-center gap-2 min-w-0', className)} title={chipTitle}>
      <div
        className={cn(
          'flex-1 bg-stone-100 rounded-full overflow-hidden ring-1 ring-stone-200/40',
          size === 'sm' ? 'h-2 min-w-[3rem]' : 'h-2.5 min-w-[4rem]',
        )}
      >
        <div className={cn('h-full rounded-full transition-[width]', barFill)} style={{ width: `${barWidth}%` }} />
      </div>
      {showPercent && (
        <span
          className={cn(
            'text-xs tabular-nums shrink-0 text-right',
            size === 'sm' ? 'w-[2.75rem]' : 'w-[3.25rem]',
            percentClass,
            !presentation && level === 'overload' && 'font-semibold',
            presentation && totalPercent > 100 && 'font-semibold',
          )}
          title={totalPercent > 100 ? `실제 합계 ${formatPercent1(totalPercent)}%` : chipTitle}
        >
          {formatPercent1(displayPct)}%
        </span>
      )}
      {showLevelChip && chipLabel && (
        <span
          className={cn(
            'text-[10px] font-bold shrink-0 rounded px-1.5 py-px border leading-none',
            chipContainerClass ??
              cn(
                level === 'overload' && 'text-red-700 bg-red-50 border-red-200',
                level === 'high' && 'text-amber-800 bg-amber-50 border-amber-200',
                level === 'normal' && 'text-teal-700 bg-teal-50 border-teal-200',
                level === 'low' && 'text-emerald-700 bg-emerald-50 border-emerald-200',
              ),
          )}
          title={chipTitle}
        >
          {chipLabel}
        </span>
      )}
      {!presentation && level === 'overload' && !showLevelChip && (
        <span className="text-[10px] font-semibold text-red-600 shrink-0 hidden sm:inline">초과</span>
      )}
    </div>
  );
}

export { getAllocationLoadLevel, allocationLoadTextClass };
export type { PersonAllocationLoadPresentation } from '../lib/allocationLoadLevel';
