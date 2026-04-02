import { useEffect, useRef, useState, type MutableRefObject } from 'react';

/**
 * Synchronizes vertical scroll between two scroll containers (e.g. WBS table and Gantt chart).
 */
export function useScrollSync(view: string) {
  const wbsScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);
  const [scrollSyncRetry, setScrollSyncRetry] = useState(0);
  const scrollSyncRetryCountRef = useRef(0);

  useEffect(() => {
    if (view !== 'list') {
      scrollSyncRetryCountRef.current = 0;
      return;
    }
    const wbs = wbsScrollRef.current;
    const gantt = ganttScrollRef.current;
    if (!wbs || !gantt) {
      if (scrollSyncRetryCountRef.current < 30) {
        scrollSyncRetryCountRef.current += 1;
        const t = setTimeout(() => setScrollSyncRetry((r) => r + 1), 80);
        return () => clearTimeout(t);
      }
      return;
    }
    scrollSyncRetryCountRef.current = 0;

    const syncFromWbs = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const top = (e.target as HTMLDivElement).scrollTop;
      gantt.scrollTop = top;
      requestAnimationFrame(() => { isSyncingScroll.current = false; });
    };
    const syncFromGantt = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const top = (e.target as HTMLDivElement).scrollTop;
      wbs.scrollTop = top;
      requestAnimationFrame(() => { isSyncingScroll.current = false; });
    };

    wbs.addEventListener('scroll', syncFromWbs, { passive: true });
    gantt.addEventListener('scroll', syncFromGantt, { passive: true });
    gantt.scrollTop = wbs.scrollTop;

    return () => {
      wbs.removeEventListener('scroll', syncFromWbs);
      gantt.removeEventListener('scroll', syncFromGantt);
    };
  }, [view, scrollSyncRetry]);

  return { wbsScrollRef, ganttScrollRef };
}
