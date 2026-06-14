import { useCallback, useRef, type MutableRefObject } from 'react';
import type { TaskWithDepth } from '../../lib/taskView';

const MOVE_THRESHOLD_PX = 5;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function rowIndexFromContentY(y: number, heights: readonly number[], rowCount: number, fallbackH: number): number {
  if (rowCount <= 0) return 0;
  if (y < 0) return 0;
  let acc = 0;
  for (let i = 0; i < rowCount; i++) {
    const h = heights[i] ?? fallbackH;
    const next = acc + h;
    if (y < next) return i;
    acc = next;
  }
  return rowCount - 1;
}

export interface UseGanttRowDragSelectOptions {
  visibleTasks: TaskWithDepth[];
  effectiveRowHeights: number[];
  fallbackRowHeight: number;
  getScrollEl: () => HTMLElement | null;
  /** 스크롤 콘텐츠 안에서 첫 작업 행이 시작하기 전 오프셋(px). split(행만 스크롤)=0, 단독 간트=날짜 헤더 높이. */
  rowAreaTopInset: number;
  setSelectedTaskIds: (ids: string[]) => void;
  setActiveTaskId: (id: string | null) => void;
  anchorTaskIdRef: MutableRefObject<string | null>;
}

/**
 * 간트 타임라인(막대 밖 빈 칸) 또는 사이드바 작업명 행에서 드래그해
 * 표의 체크 다중 선택(selectedTaskIds)과 동일한 구간을 선택한다.
 * Shift+클릭(이동 없음)만으로는 체크 구간을 넣지 않는다 — 표의 Shift+셀 범위와 혼동 방지.
 */
export function useGanttRowDragSelect({
  visibleTasks,
  effectiveRowHeights,
  fallbackRowHeight,
  getScrollEl,
  rowAreaTopInset,
  setSelectedTaskIds,
  setActiveTaskId,
  anchorTaskIdRef,
}: UseGanttRowDragSelectOptions) {
  const optsRef = useRef({
    visibleTasks,
    effectiveRowHeights,
    fallbackRowHeight,
    getScrollEl,
    rowAreaTopInset,
    setSelectedTaskIds,
    setActiveTaskId,
    anchorTaskIdRef,
  });
  optsRef.current = {
    visibleTasks,
    effectiveRowHeights,
    fallbackRowHeight,
    getScrollEl,
    rowAreaTopInset,
    setSelectedTaskIds,
    setActiveTaskId,
    anchorTaskIdRef,
  };

  const indexFromClientY = useCallback((clientY: number) => {
    const { getScrollEl, effectiveRowHeights, fallbackRowHeight, rowAreaTopInset, visibleTasks } = optsRef.current;
    const el = getScrollEl();
    if (!el || visibleTasks.length === 0) return 0;
    const r = el.getBoundingClientRect();
    const y = clientY - r.top + el.scrollTop - rowAreaTopInset;
    return rowIndexFromContentY(y, effectiveRowHeights, visibleTasks.length, fallbackRowHeight);
  }, []);

  const applyRange = useCallback((lo: number, hi: number) => {
    const { visibleTasks, setSelectedTaskIds, anchorTaskIdRef } = optsRef.current;
    if (visibleTasks.length === 0) return;
    const a = clamp(Math.min(lo, hi), 0, visibleTasks.length - 1);
    const b = clamp(Math.max(lo, hi), 0, visibleTasks.length - 1);
    const ids = visibleTasks.slice(a, b + 1).map((t) => t.id);
    setSelectedTaskIds(ids);
    anchorTaskIdRef.current = visibleTasks[b]?.id ?? null;
  }, []);

  const handleRowBackgroundMouseDown = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      if (e.button !== 0) return;
      const el = optsRef.current.getScrollEl();
      if (!el || optsRef.current.visibleTasks.length === 0) return;

      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const startIdx = clamp(rowIndex, 0, optsRef.current.visibleTasks.length - 1);
      const shiftAtStart = e.shiftKey;

      let shiftAnchorIdx = startIdx;
      if (shiftAtStart) {
        const anchor = optsRef.current.anchorTaskIdRef.current;
        const ai = anchor ? optsRef.current.visibleTasks.findIndex((t) => t.id === anchor) : -1;
        if (ai !== -1) shiftAnchorIdx = ai;
      }

      let dragging = false;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && (Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX)) {
          dragging = true;
          document.body.style.userSelect = 'none';
        }
        if (!dragging) return;
        const idx = indexFromClientY(ev.clientY);
        const base = shiftAtStart ? shiftAnchorIdx : startIdx;
        applyRange(base, idx);
        const t = optsRef.current.visibleTasks[idx];
        if (t) optsRef.current.setActiveTaskId(t.id);
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';

        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const moved = Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX;
        const endIdx = indexFromClientY(ev.clientY);

        if (dragging || moved) {
          const base = shiftAtStart ? shiftAnchorIdx : startIdx;
          applyRange(base, endIdx);
          const t = optsRef.current.visibleTasks[endIdx];
          if (t) optsRef.current.setActiveTaskId(t.id);
        } else {
          // Shift+클릭(이동 없음): 표와 같이 체크 구간 확장 없음 — 활성 행만 맞춤
          const t = optsRef.current.visibleTasks[startIdx];
          if (t) {
            optsRef.current.setActiveTaskId(t.id);
            if (shiftAtStart) optsRef.current.anchorTaskIdRef.current = t.id;
          }
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [applyRange, indexFromClientY],
  );

  return { handleRowBackgroundMouseDown };
}
