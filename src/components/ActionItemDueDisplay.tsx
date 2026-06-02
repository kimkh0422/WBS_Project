import React from 'react';
import { cn } from '../lib/utils';
import { type ActionDueVisualState, resolveActionDueVisualState } from '../lib/actionItemDueFilter';

export function ActionDueStatusBadge({ state, className }: { state: ActionDueVisualState; className?: string }) {
  if (state === 'overdue') {
    return (
      <span
        className={cn(
          'inline-flex items-center shrink-0 rounded px-1.5 py-px text-[10px] font-bold leading-none border',
          'text-red-700 bg-red-50 border-red-200/90',
          className,
        )}
        title="기한이 지났으며 아직 완료되지 않았습니다"
      >
        연체
      </span>
    );
  }
  if (state === 'completedLate') {
    return (
      <span
        className={cn(
          'inline-flex items-center shrink-0 rounded px-1.5 py-px text-[10px] font-bold leading-none border',
          'text-amber-800 bg-amber-50 border-amber-200/90',
          className,
        )}
        title="기한 이후에 완료되었습니다"
      >
        지연완료
      </span>
    );
  }
  return null;
}

export function ActionDueDateCell({
  endDate,
  isCompleted,
  className,
  showBadge = true,
}: {
  endDate: string | undefined;
  isCompleted: boolean;
  className?: string;
  showBadge?: boolean;
}) {
  const state = resolveActionDueVisualState(endDate, isCompleted);
  const display = (endDate || '').trim() || '—';
  return (
    <span className={cn('inline-flex items-center gap-1.5 flex-wrap', className)}>
      <span
        className={cn(
          'tabular-nums',
          state === 'overdue' && 'text-red-600 font-semibold',
          state === 'completedLate' && 'text-amber-700',
          state === 'completed' && 'text-slate-500',
          state === 'pending' && 'text-slate-700',
        )}
      >
        {display}
      </span>
      {showBadge && <ActionDueStatusBadge state={state} />}
    </span>
  );
}

/** 액션 목록 행·카드 배경/테두리 클래스 */
export function actionDueSurfaceClassName(state: ActionDueVisualState, layout: 'row' | 'card' = 'row'): string {
  if (state === 'overdue') {
    return layout === 'card' ? 'border-red-200 bg-red-50/35 hover:border-red-300 hover:bg-red-50/50' : 'bg-red-50/45 hover:bg-red-50/65';
  }
  if (state === 'completedLate') {
    return layout === 'card'
      ? 'border-amber-200/80 bg-amber-50/25 hover:border-amber-300 hover:bg-amber-50/40'
      : 'bg-amber-50/30 hover:bg-amber-50/45';
  }
  if (state === 'completed') {
    return layout === 'card' ? 'bg-teal-50/45' : 'bg-teal-50/30';
  }
  return '';
}

export { resolveActionDueVisualState };
