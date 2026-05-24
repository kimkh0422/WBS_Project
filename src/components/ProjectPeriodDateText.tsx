import React from 'react';
import { cn } from '../lib/utils';
import { formatProjectPeriodDate, isProjectPeriodDateUnset } from '../lib/projectPeriod';

export function ProjectPeriodDateText({
  date,
  className,
  emptyClassName = 'text-amber-700 font-medium',
}: {
  date: string | undefined;
  className?: string;
  emptyClassName?: string;
}) {
  const unset = isProjectPeriodDateUnset(date);
  return <span className={cn('tabular-nums whitespace-nowrap', unset ? emptyClassName : className)}>{formatProjectPeriodDate(date)}</span>;
}
