import { differenceInDays, endOfMonth, endOfWeek, format, max, min, startOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import type { ViewMode } from './ZOOM_LEVELS';

interface GanttGridProps {
  viewMode: ViewMode;
  dayWidth: number;
  minDate: Date;
  maxDate: Date;
  days: Date[];
  months: Date[];
  weeks: Date[];
}

export function GanttGrid({ viewMode, dayWidth, minDate, maxDate, days, months, weeks }: GanttGridProps) {
  if (viewMode === 'day') {
    return (
      <>
        {days.map((day) => (
          <div
            key={`grid-${day.toISOString()}`}
            className={cn(
              'flex-shrink-0 border-r border-stone-100 h-full',
              ['토', '일'].includes(format(day, 'EEE', { locale: ko })) && 'bg-stone-50/30',
            )}
            style={{ width: dayWidth }}
          />
        ))}
      </>
    );
  }
  if (viewMode === 'week') {
    return (
      <>
        {weeks.map((week) => {
          const weekStart = max([week, minDate]);
          const weekEnd = min([endOfWeek(week), maxDate]);
          const daysInWeek = differenceInDays(weekEnd, weekStart) + 1;
          const width = daysInWeek * dayWidth;
          return (
            <div key={`grid-week-${week.toISOString()}`} className="flex-shrink-0 border-r border-stone-100 h-full" style={{ width }} />
          );
        })}
      </>
    );
  }
  return (
    <>
      {months.map((month) => {
        const monthStart = max([startOfMonth(month), minDate]);
        const monthEnd = min([endOfMonth(month), maxDate]);
        const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
        const width = daysInMonth * dayWidth;
        return (
          <div key={`grid-month-${month.toISOString()}`} className="flex-shrink-0 border-r border-stone-100 h-full" style={{ width }} />
        );
      })}
    </>
  );
}
