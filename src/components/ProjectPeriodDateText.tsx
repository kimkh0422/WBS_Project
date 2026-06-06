import React from 'react';
import { cn } from '../lib/utils';
import { formatProjectPeriodDate, isProjectPeriodDateUnset } from '../lib/projectPeriod';

export function ProjectPeriodDateText({
  date,
  className,
  emptyClassName = 'text-amber-700 font-medium',
  emptyLabel,
}: {
  date: string | undefined;
  className?: string;
  emptyClassName?: string;
  /** 날짜 미설정 시 표시할 문구(미지정이면 기본 포맷 결과 사용) */
  emptyLabel?: string;
}) {
  const unset = isProjectPeriodDateUnset(date);
  return (
    <span className={cn('tabular-nums whitespace-nowrap', unset ? emptyClassName : className)}>
      {unset && emptyLabel != null ? emptyLabel : formatProjectPeriodDate(date)}
    </span>
  );
}
