import React, { useState, useCallback, useEffect, useRef, type MutableRefObject } from 'react';

const WBS_TABLE_WIDTH_STORAGE_KEY = 'wbs.split.wbsTableWidth';
const DEFAULT_WBS_TABLE_WIDTH = 75;

/**
 * Manages resizable split-pane state and mouse-drag logic.
 */
export function useResizablePane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [wbsTableWidth, setWbsTableWidth] = useState(() => {
    try {
      const saved = window.localStorage.getItem(WBS_TABLE_WIDTH_STORAGE_KEY);
      const parsed = saved ? Number(saved) : NaN;
      if (!Number.isFinite(parsed)) return DEFAULT_WBS_TABLE_WIDTH;
      return Math.min(80, Math.max(20, parsed));
    } catch {
      return DEFAULT_WBS_TABLE_WIDTH;
    }
  });
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(WBS_TABLE_WIDTH_STORAGE_KEY, String(wbsTableWidth));
    } catch { /* ignore */ }
  }, [wbsTableWidth]);

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    setIsDraggingResizer(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDraggingResizer(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isDraggingResizer && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidthPx = mouseMoveEvent.clientX - containerRect.left;
        const newWidthPercent = (newWidthPx / containerRect.width) * 100;
        if (newWidthPercent > 20 && newWidthPercent < 80) {
          setWbsTableWidth(newWidthPercent);
        }
      }
    },
    [isDraggingResizer],
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return {
    containerRef,
    wbsTableWidth,
    isDraggingResizer,
    startResizing,
  };
}
