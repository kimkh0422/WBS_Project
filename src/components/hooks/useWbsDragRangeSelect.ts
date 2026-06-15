import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Virtualizer } from '@tanstack/virtual-core';
import type { TaskWithDepth } from '../../lib/taskView';
import type { TableColumnId } from '../wbsTableTypes';

const RANGE_CELL = '[data-wbs-range-cell]';
const DRAG_ACTIVATE_PX = 3;
const EDGE_ZONE = 28;
const EDGE_MAX_SPEED = 16;

/** 버튼·링크는 제외하지 않음 — 셀 전체가 엑셀처럼 드래그 앵커가 되어야 함. 편집 중 입력·그립·선행 입력만 제외. */
const SKIP_SELECTOR = 'input, textarea, select, option, [role="listbox"], [role="option"], [data-deps-input="true"], [data-row-grip]';

export type WbsCellPointer = { taskId: string; columnId: TableColumnId };

interface UseWbsDragRangeSelectOptions {
  visibleTasks: TaskWithDepth[];
  visibleColumnIds: TableColumnId[];
  tableScrollRef: MutableRefObject<HTMLDivElement | null>;
  clearCheckboxSelection: () => void;
  setLastSelectedId: (id: string | null) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  setCellMarqueeRange: (range: { anchor: WbsCellPointer; end: WbsCellPointer } | null) => void;
  rangeAnchorRef: MutableRefObject<string | null>;
  setAnchorTaskId: (id: string | null) => void;
  enabled?: boolean;
  virtualRangeFallback?: {
    enabledRef: MutableRefObject<boolean>;
    virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>;
  };
}

interface DragState {
  anchorCell: WbsCellPointer;
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastAppliedKey: string | null;
  edgeRaf: number | null;
  pointerId: number;
  scrollEl: HTMLDivElement;
  detachWindowListeners: () => void;
}

const CAPTURE_MOVE: AddEventListenerOptions = { capture: true, passive: false };

/**
 * 엑셀식 마우스 드래그: 데이터 셀 직사각형만 범위 선택.
 * 표 스크롤 루트에 네이티브 `pointerdown`(capture)로 붙인다 — React 합성 이벤트·자식 `stopPropagation`과 무관.
 */
export function useWbsDragRangeSelect({
  visibleTasks,
  visibleColumnIds,
  tableScrollRef,
  clearCheckboxSelection,
  setLastSelectedId,
  setFocusedCell,
  setCellMarqueeRange,
  rangeAnchorRef,
  setAnchorTaskId,
  enabled = true,
  virtualRangeFallback,
}: UseWbsDragRangeSelectOptions) {
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;
  const visibleColumnIdsRef = useRef(visibleColumnIds);
  visibleColumnIdsRef.current = visibleColumnIds;
  const virtualRangeFallbackRef = useRef(virtualRangeFallback);
  virtualRangeFallbackRef.current = virtualRangeFallback;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const clearCheckboxSelectionRef = useRef(clearCheckboxSelection);
  clearCheckboxSelectionRef.current = clearCheckboxSelection;
  const setLastSelectedIdRef = useRef(setLastSelectedId);
  setLastSelectedIdRef.current = setLastSelectedId;
  const setFocusedCellRef = useRef(setFocusedCell);
  setFocusedCellRef.current = setFocusedCell;
  const setCellMarqueeRangeRef = useRef(setCellMarqueeRange);
  setCellMarqueeRangeRef.current = setCellMarqueeRange;
  const setAnchorTaskIdRef = useRef(setAnchorTaskId);
  setAnchorTaskIdRef.current = setAnchorTaskId;

  const stateRef = useRef<DragState | null>(null);
  const rangeDragScrollBoundRef = useRef<HTMLDivElement | null>(null);

  const readCellFromEl = (el: HTMLElement | null): WbsCellPointer | null => {
    if (!el) return null;
    const cell = el.closest(RANGE_CELL) as HTMLElement | null;
    if (!cell) return null;
    const taskId = cell.dataset.rangeTask;
    const columnId = cell.dataset.rangeCol as TableColumnId | undefined;
    if (!taskId || !columnId) return null;
    if (!visibleColumnIdsRef.current.includes(columnId)) return null;
    return { taskId, columnId };
  };

  const cellFromPoint = useCallback(
    (x: number, y: number): WbsCellPointer | null => {
      const tryStack = (xx: number, yy: number): WbsCellPointer | null => {
        const nodes = document.elementsFromPoint(xx, yy);
        for (const node of nodes) {
          const cell = readCellFromEl(node as HTMLElement);
          if (cell) return cell;
        }
        return null;
      };

      const fromDom = tryStack(x, y);
      if (fromDom) return fromDom;

      const vf = virtualRangeFallbackRef.current;
      if (!vf?.enabledRef.current) return null;
      const v = vf.virtualizerRef.current;
      const scroller = tableScrollRef.current;
      if (!v || !scroller) return null;

      const rect = scroller.getBoundingClientRect();
      const yClamped = Math.min(Math.max(y, rect.top + 1), rect.bottom - 1);
      const xClamped = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
      const offset = scroller.scrollTop + (yClamped - rect.top);
      const vItem = v.getVirtualItemForOffset(offset);
      if (!vItem) return null;

      const task = visibleTasksRef.current[vItem.index];
      if (!task) return null;

      const rowEl = document.getElementById(`task-row-${task.id}`) as HTMLElement | null;
      if (rowEl) {
        const rr = rowEl.getBoundingClientRect();
        const midY = Math.min(Math.max(y, rr.top + 2), rr.bottom - 2);
        const hit = tryStack(xClamped, midY);
        if (hit?.taskId === task.id) return hit;
        const hit2 = tryStack(x, midY);
        if (hit2?.taskId === task.id) return hit2;
      }

      const st = stateRef.current;
      const anchorCol = st?.anchorCell.columnId;
      const col =
        anchorCol && visibleColumnIdsRef.current.includes(anchorCol)
          ? anchorCol
          : (visibleColumnIdsRef.current.find((c) => c !== 'wbsId') ?? visibleColumnIdsRef.current[0]);
      if (!col || !visibleColumnIdsRef.current.includes(col)) return null;
      return { taskId: task.id, columnId: col };
    },
    [tableScrollRef],
  );

  const cellFromPointRef = useRef(cellFromPoint);
  cellFromPointRef.current = cellFromPoint;

  const applyRangeToRef = useRef<(c: WbsCellPointer) => void>(() => {});
  applyRangeToRef.current = (current: WbsCellPointer) => {
    const st = stateRef.current;
    if (!st) return;
    const key = `${current.taskId}::${current.columnId}`;
    if (key === st.lastAppliedKey) return;
    st.lastAppliedKey = key;
    setCellMarqueeRangeRef.current({ anchor: st.anchorCell, end: current });
    setLastSelectedIdRef.current(current.taskId);
    setFocusedCellRef.current(current);
  };

  const stopEdgeScroll = () => {
    const st = stateRef.current;
    if (st?.edgeRaf != null) {
      cancelAnimationFrame(st.edgeRaf);
      st.edgeRaf = null;
    }
  };

  const edgeTickRef = useRef(() => {
    const st = stateRef.current;
    const scroller = tableScrollRef.current;
    if (!st || !st.active || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    let dy = 0;
    if (st.lastY < rect.top + EDGE_ZONE) {
      const f = Math.min(1, (rect.top + EDGE_ZONE - st.lastY) / EDGE_ZONE);
      dy = -Math.max(1, Math.ceil(f * EDGE_MAX_SPEED));
    } else if (st.lastY > rect.bottom - EDGE_ZONE) {
      const f = Math.min(1, (st.lastY - (rect.bottom - EDGE_ZONE)) / EDGE_ZONE);
      dy = Math.max(1, Math.ceil(f * EDGE_MAX_SPEED));
    }
    if (dy === 0) {
      st.edgeRaf = null;
      return;
    }
    const before = scroller.scrollTop;
    scroller.scrollTop = before + dy;
    if (scroller.scrollTop !== before) {
      const x = Math.min(Math.max(st.lastX, rect.left + 4), rect.right - 4);
      const y = Math.min(Math.max(st.lastY, rect.top + 2), rect.bottom - 2);
      const cell = cellFromPointRef.current(x, y);
      if (cell) applyRangeToRef.current(cell);
    }
    st.edgeRaf = requestAnimationFrame(() => edgeTickRef.current());
  });

  const syncEdgeScrollRef = useRef(() => {
    const st = stateRef.current;
    const scroller = tableScrollRef.current;
    if (!st || !st.active || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const inEdge = st.lastY < rect.top + EDGE_ZONE || st.lastY > rect.bottom - EDGE_ZONE;
    if (inEdge && st.edgeRaf == null) st.edgeRaf = requestAnimationFrame(() => edgeTickRef.current());
    else if (!inEdge && st.edgeRaf != null) stopEdgeScroll();
  });

  const stableNativePointerDown = useCallback(
    (e: PointerEvent) => {
      if (!enabledRef.current || e.button !== 0 || e.pointerType === 'touch') return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(SKIP_SELECTOR)) return;
      const anchorCell = readCellFromEl(target);
      if (!anchorCell) return;
      const scrollEl = tableScrollRef.current;
      if (!scrollEl) return;
      if (stateRef.current) return;

      document.body.style.userSelect = 'none';
      try {
        scrollEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const onMove = (ev: PointerEvent) => {
        const st = stateRef.current;
        if (!st) return;
        if (ev.pointerId !== st.pointerId) return;
        st.lastX = ev.clientX;
        st.lastY = ev.clientY;
        if (!st.active) {
          const moved = Math.abs(ev.clientX - st.startX) >= DRAG_ACTIVATE_PX || Math.abs(ev.clientY - st.startY) >= DRAG_ACTIVATE_PX;
          const over = cellFromPointRef.current(ev.clientX, ev.clientY);
          const anchorKey = `${st.anchorCell.taskId}::${st.anchorCell.columnId}`;
          const overKey = over ? `${over.taskId}::${over.columnId}` : null;
          if (!moved && !(overKey && overKey !== anchorKey)) {
            ev.preventDefault();
            return;
          }
          st.active = true;
          document.body.style.userSelect = 'none';
          clearCheckboxSelectionRef.current();
          rangeAnchorRef.current = st.anchorCell.taskId;
          setAnchorTaskIdRef.current(st.anchorCell.taskId);
        }
        ev.preventDefault();
        const cell = cellFromPointRef.current(ev.clientX, ev.clientY);
        if (cell) applyRangeToRef.current(cell);
        syncEdgeScrollRef.current();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove, CAPTURE_MOVE);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        stopEdgeScroll();
        document.body.style.userSelect = '';
        const cur = stateRef.current;
        if (cur?.scrollEl) {
          try {
            if (cur.scrollEl.hasPointerCapture(cur.pointerId)) {
              cur.scrollEl.releasePointerCapture(cur.pointerId);
            }
          } catch {
            /* ignore */
          }
        }
        const wasActive = !!cur?.active;
        const anchorCell = cur?.anchorCell ?? null;
        stateRef.current = null;
        if (wasActive) {
          const swallow = (ev: Event) => {
            ev.stopPropagation();
            ev.preventDefault();
            window.removeEventListener('click', swallow, true);
          };
          window.addEventListener('click', swallow, true);
          window.setTimeout(() => window.removeEventListener('click', swallow, true), 400);
        } else if (anchorCell) {
          // 드래그로 범위를 넓히지 않고 뗀 경우(클릭): 한 칸 마퀴·포커스 — 체크 다중 선택은 유지(드래그 범위 시작 시에만 해제).
          setCellMarqueeRangeRef.current({ anchor: anchorCell, end: anchorCell });
          setLastSelectedIdRef.current(anchorCell.taskId);
          setFocusedCellRef.current(anchorCell);
          rangeAnchorRef.current = anchorCell.taskId;
          setAnchorTaskIdRef.current(anchorCell.taskId);
        }
      };

      stateRef.current = {
        anchorCell,
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastAppliedKey: null,
        edgeRaf: null,
        pointerId: e.pointerId,
        scrollEl,
        detachWindowListeners: () => {
          window.removeEventListener('pointermove', onMove, CAPTURE_MOVE);
          window.removeEventListener('pointerup', onUp, true);
          window.removeEventListener('pointercancel', onUp, true);
        },
      };

      window.addEventListener('pointermove', onMove, CAPTURE_MOVE);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    [rangeAnchorRef, tableScrollRef],
  );

  const bindRangeDragToScrollElement = useCallback(
    (el: HTMLDivElement | null) => {
      if (el === rangeDragScrollBoundRef.current) return;
      if (rangeDragScrollBoundRef.current) {
        rangeDragScrollBoundRef.current.removeEventListener('pointerdown', stableNativePointerDown, { capture: true });
        rangeDragScrollBoundRef.current = null;
      }
      if (!el) return;
      rangeDragScrollBoundRef.current = el;
      el.addEventListener('pointerdown', stableNativePointerDown, { capture: true });
    },
    [stableNativePointerDown],
  );

  useEffect(
    () => () => {
      const st = stateRef.current;
      st?.detachWindowListeners?.();
      if (st?.edgeRaf != null) cancelAnimationFrame(st.edgeRaf);
      document.body.style.userSelect = '';
      if (st?.scrollEl) {
        try {
          if (st.scrollEl.hasPointerCapture(st.pointerId)) {
            st.scrollEl.releasePointerCapture(st.pointerId);
          }
        } catch {
          /* ignore */
        }
      }
      stateRef.current = null;
      if (rangeDragScrollBoundRef.current) {
        rangeDragScrollBoundRef.current.removeEventListener('pointerdown', stableNativePointerDown, { capture: true });
        rangeDragScrollBoundRef.current = null;
      }
    },
    [stableNativePointerDown],
  );

  return { bindRangeDragToScrollElement };
}
