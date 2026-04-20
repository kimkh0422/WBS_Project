import { useMemo } from 'react';
import { addDays, differenceInDays, endOfWeek, max, min, parseISO, startOfWeek } from 'date-fns';
import type { TaskWithDepth } from '../../lib/taskView';
import { ZOOM_LEVELS, type ViewMode } from '../Gantt/ZOOM_LEVELS';

interface UseGanttViewportOptions {
  visibleTasks: TaskWithDepth[];
  zoomIndex: number;
  containerWidth: number;
  effectiveSidebarWidth: number;
}

export interface GanttViewport {
  dates: Date[];
  minDate: Date;
  maxDate: Date;
  totalDays: number;
  autoZoomLevel: { mode: ViewMode; dayWidth: number; label: string };
  currentZoomEntry: { mode: ViewMode; dayWidth: number; label: string };
  dayWidth: number;
}

export function useGanttViewport({
  visibleTasks,
  zoomIndex,
  containerWidth,
  effectiveSidebarWidth,
}: UseGanttViewportOptions): GanttViewport {
  const dates = useMemo(
    () => visibleTasks.flatMap((t) => [parseISO(t.startDate), parseISO(t.endDate)]).filter((d) => !isNaN(d.getTime())),
    [visibleTasks],
  );
  const minDate = useMemo(() => (dates.length > 0 ? startOfWeek(addDays(min(dates), -7)) : startOfWeek(new Date())), [dates]);
  const maxDate = useMemo(() => (dates.length > 0 ? endOfWeek(addDays(max(dates), 7)) : endOfWeek(addDays(new Date(), 14))), [dates]);
  const totalDays = differenceInDays(maxDate, minDate) + 1;

  const availableWidth = containerWidth - effectiveSidebarWidth - 20;
  const autoDayWidth = Math.max(2, totalDays > 0 ? Math.floor(availableWidth / totalDays) : 40);
  const autoZoomLevel = ZOOM_LEVELS.reduce((prev, curr) =>
    Math.abs(curr.dayWidth - autoDayWidth) < Math.abs(prev.dayWidth - autoDayWidth) ? curr : prev,
  );
  const currentZoomEntry = zoomIndex === -1 ? { ...autoZoomLevel, dayWidth: autoDayWidth } : ZOOM_LEVELS[zoomIndex];
  const dayWidth = currentZoomEntry.dayWidth;

  return { dates, minDate, maxDate, totalDays, autoZoomLevel, currentZoomEntry, dayWidth };
}
