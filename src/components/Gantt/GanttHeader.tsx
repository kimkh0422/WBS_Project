import { differenceInDays, endOfMonth, format, isSameDay, max, min, startOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '../../lib/utils';
import type { ViewMode } from './ZOOM_LEVELS';

interface GanttHeaderProps {
  viewMode: ViewMode;
  dayWidth: number;
  minDate: Date;
  maxDate: Date;
  days: Date[];
  months: Date[];
  weeks: Date[];
  today: Date;
}

/** Render top header row (Year/Month container) */
export function GanttTopHeader({ viewMode, dayWidth, minDate, maxDate, months }: GanttHeaderProps) {
  if (viewMode === 'day' || viewMode === 'week') {
    return (
      <>
        {months.map((month) => {
          const monthStart = max([startOfMonth(month), minDate]);
          const monthEnd = min([endOfMonth(month), maxDate]);
          const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
          const width = daysInMonth * dayWidth;
          return (
            <div
              key={month.toISOString()}
              className="flex items-center px-3 text-[10px] font-bold tracking-wider text-slate-500 border-r border-slate-200 overflow-hidden"
              style={{ width }}
            >
              {format(month, width > 40 ? 'yyyy년 M월' : 'yy년 M월', { locale: ko })}
            </div>
          );
        })}
      </>
    );
  }
  // Month view: show years
  const years = Array.from(new Set(months.map((m) => m.getFullYear())));
  return (
    <>
      {years.map((year) => {
        const yearStart = max([new Date(year, 0, 1), minDate]);
        const yearEnd = min([new Date(year, 11, 31), maxDate]);
        const daysInYear = differenceInDays(yearEnd, yearStart) + 1;
        const width = daysInYear * dayWidth;
        return (
          <div
            key={year}
            className="flex items-center px-3 text-[10px] font-bold tracking-wider text-slate-500 border-r border-slate-200 overflow-hidden"
            style={{ width }}
          >
            {year}년
          </div>
        );
      })}
    </>
  );
}

function formatDayHeaderLabel(day: Date, dayWidth: number): string {
  if (dayWidth >= 14) return format(day, 'd', { locale: ko });
  if (dayWidth >= 8) {
    const isMonday = format(day, 'EEE', { locale: ko }) === '월';
    if (day.getDate() === 1 || isMonday) return format(day, 'd', { locale: ko });
  }
  return '';
}

/** Render bottom header row (Days/Weeks/Months) */
export function GanttBottomHeader({ viewMode, dayWidth, minDate, maxDate, days, months, weeks, today }: GanttHeaderProps) {
  if (viewMode === 'day' || viewMode === 'week') {
    return (
      <>
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'flex-shrink-0 border-r border-slate-200 flex items-center justify-center text-[10px] font-mono overflow-hidden',
                ['토', '일'].includes(format(day, 'EEE', { locale: ko })) ? 'bg-slate-50 text-slate-400' : 'text-slate-600',
                isToday && 'bg-red-500 text-white font-bold',
              )}
              style={{ width: dayWidth }}
            >
              {formatDayHeaderLabel(day, dayWidth)}
            </div>
          );
        })}
      </>
    );
  }
  // Month mode: show months
  return (
    <>
      {months.map((month) => {
        const monthStart = max([startOfMonth(month), minDate]);
        const monthEnd = min([endOfMonth(month), maxDate]);
        const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
        const width = daysInMonth * dayWidth;
        const isCurrentMonth = format(today, 'yyyy-MM') === format(month, 'yyyy-MM');
        return (
          <div
            key={month.toISOString()}
            className={cn(
              'flex-shrink-0 border-r border-slate-200 flex items-center justify-center text-[10px] font-mono overflow-hidden',
              isCurrentMonth ? 'bg-red-500 text-white font-bold' : '',
            )}
            style={{ width }}
          >
            {width >= 16 ? format(month, 'M월', { locale: ko }) : ''}
          </div>
        );
      })}
    </>
  );
}
