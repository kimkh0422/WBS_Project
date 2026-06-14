import { useMemo } from 'react';
import { addDays, differenceInDays, endOfWeek, max, min, parseISO, startOfWeek } from 'date-fns';
import type { TaskWithDepth } from '../../lib/taskView';
import { ZOOM_LEVELS, type ViewMode } from '../Gantt/ZOOM_LEVELS';

interface UseGanttViewportOptions {
  visibleTasks: TaskWithDepth[];
  zoomIndex: number;
  containerWidth: number;
  effectiveSidebarWidth: number;
  /** 계획율 기준일 등 — 작업 일정 밖이어도 타임라인·수직선이 보이도록 범위에 포함 */
  referenceAnchorDate?: Date | null;
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
  referenceAnchorDate = null,
}: UseGanttViewportOptions): GanttViewport {
  const dates = useMemo(
    () => visibleTasks.flatMap((t) => [parseISO(t.startDate), parseISO(t.endDate)]).filter((d) => !isNaN(d.getTime())),
    [visibleTasks],
  );
  // 간트 표시 범위에 오늘·기준일을 항상 포함(작업 일정이 모두 과거/미래여도 마커가 보이도록).
  const minDate = useMemo(() => {
    const today = new Date();
    const base = dates.length > 0 ? min(dates) : today;
    const anchorOk = referenceAnchorDate && !isNaN(referenceAnchorDate.getTime());
    const anchor = anchorOk ? referenceAnchorDate! : today;
    const earliest = min([base, today, anchor]);
    return startOfWeek(addDays(earliest, -7));
  }, [dates, referenceAnchorDate]);
  const maxDate = useMemo(() => {
    const today = new Date();
    const base = dates.length > 0 ? max(dates) : addDays(today, 14);
    const anchorOk = referenceAnchorDate && !isNaN(referenceAnchorDate.getTime());
    const anchor = anchorOk ? referenceAnchorDate! : today;
    const latest = max([base, today, anchor]);
    return endOfWeek(addDays(latest, 7));
  }, [dates, referenceAnchorDate]);
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
