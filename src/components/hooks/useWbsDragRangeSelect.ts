import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { TaskWithDepth } from '../../lib/taskView';
import type { TableColumnId } from '../wbsTableTypes';

const RANGE_CELL = '[data-wbs-range-cell]';
/** 클릭과 구분하기 위한 드래그 선택 시작 임계 거리(px) — 그립 정렬(dnd) 활성 거리와 동일하게 5px */
const DRAG_ACTIVATE_PX = 5;
/** 뷰포트 위·아래 가장자리에서 자동 스크롤이 시작되는 영역(px) */
const EDGE_ZONE = 28;
/** 자동 스크롤 프레임당 최대 이동(px) */
const EDGE_MAX_SPEED = 16;

/** 드래그 선택을 시작하면 안 되는(자체 동작이 있는) 요소들 + 첫 열 그립([data-row-grip]은 순서 이동 전담) */
const SKIP_SELECTOR =
  'input, textarea, select, button, a, option, [role="listbox"], [role="option"], [data-deps-input="true"], [data-row-grip]';

export type WbsCellPointer = { taskId: string; columnId: TableColumnId };

interface UseWbsDragRangeSelectOptions {
  /** 표시 순서대로의 작업 목록(범위 계산 기준) */
  visibleTasks: TaskWithDepth[];
  /** 표에 보이는 데이터 컬럼 순서(직사각형 범위 계산) */
  visibleColumnIds: TableColumnId[];
  /** 자동 스크롤 대상 컨테이너(표 본문) */
  tableScrollRef: MutableRefObject<HTMLDivElement | null>;
  /** 체크박스 행 선택 해제(셀 드래그 시작 시) */
  clearCheckboxSelection: () => void;
  setLastSelectedId: (id: string | null) => void;
  setFocusedCell: (cell: { taskId: string; columnId: TableColumnId } | null) => void;
  /** 앵커~현재 셀까지의 직사각형 범위 */
  setCellMarqueeRange: (range: { anchor: WbsCellPointer; end: WbsCellPointer } | null) => void;
  rangeAnchorRef: MutableRefObject<string | null>;
  setAnchorTaskId: (id: string | null) => void;
  enabled?: boolean;
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
}

/**
 * 엑셀식 마우스 드래그: 데이터 셀 직사각형만 범위 선택(행 체크 다중 선택과 분리).
 *
 * - [data-wbs-range-cell]이 있는 셀에서만 드래그가 시작된다.
 * - 순서 이동은 첫 열 그립([data-row-grip]) 전담.
 * - 단순 클릭(이동 없음)은 기존 클릭 핸들러가 처리하도록 드래그 비활성 상태로 종료한다.
 * - 터치는 표 세로 스크롤과 충돌하므로 제외(마우스·펜만).
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
}: UseWbsDragRangeSelectOptions) {
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;
  const visibleColumnIdsRef = useRef(visibleColumnIds);
  visibleColumnIdsRef.current = visibleColumnIds;
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

  const cellFromPoint = useCallback((x: number, y: number): WbsCellPointer | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return readCellFromEl(el);
  }, []);

  const applyRangeTo = useCallback((current: WbsCellPointer) => {
    const st = stateRef.current;
    if (!st) return;
    const key = `${current.taskId}::${current.columnId}`;
    if (key === st.lastAppliedKey) return;
    st.lastAppliedKey = key;
    setCellMarqueeRangeRef.current({ anchor: st.anchorCell, end: current });
    setLastSelectedIdRef.current(current.taskId);
    setFocusedCellRef.current(current);
  }, []);

  const stopEdgeScroll = useCallback(() => {
    const st = stateRef.current;
    if (st?.edgeRaf != null) {
      cancelAnimationFrame(st.edgeRaf);
      st.edgeRaf = null;
    }
  }, []);

  const edgeTick = useCallback(() => {
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
      const cell = cellFromPoint(x, y);
      if (cell) applyRangeTo(cell);
    }
    st.edgeRaf = requestAnimationFrame(edgeTick);
  }, [tableScrollRef, applyRangeTo, cellFromPoint]);

  const syncEdgeScroll = useCallback(() => {
    const st = stateRef.current;
    const scroller = tableScrollRef.current;
    if (!st || !st.active || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const inEdge = st.lastY < rect.top + EDGE_ZONE || st.lastY > rect.bottom - EDGE_ZONE;
    if (inEdge && st.edgeRaf == null) st.edgeRaf = requestAnimationFrame(edgeTick);
    else if (!inEdge && st.edgeRaf != null) stopEdgeScroll();
  }, [tableScrollRef, edgeTick, stopEdgeScroll]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const st = stateRef.current;
      if (!st) return;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      if (!st.active) {
        const moved = Math.abs(e.clientX - st.startX) >= DRAG_ACTIVATE_PX || Math.abs(e.clientY - st.startY) >= DRAG_ACTIVATE_PX;
        const over = cellFromPoint(e.clientX, e.clientY);
        const anchorKey = `${st.anchorCell.taskId}::${st.anchorCell.columnId}`;
        const overKey = over ? `${over.taskId}::${over.columnId}` : null;
        if (!moved && !(overKey && overKey !== anchorKey)) return;
        st.active = true;
        document.body.style.userSelect = 'none';
        clearCheckboxSelectionRef.current();
        rangeAnchorRef.current = st.anchorCell.taskId;
        setAnchorTaskIdRef.current(st.anchorCell.taskId);
      }
      e.preventDefault();
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (cell) applyRangeTo(cell);
      syncEdgeScroll();
    },
    [applyRangeTo, syncEdgeScroll, rangeAnchorRef, cellFromPoint],
  );

  const onUp = useCallback(() => {
    const st = stateRef.current;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    stopEdgeScroll();
    document.body.style.userSelect = '';
    const wasActive = !!st?.active;
    stateRef.current = null;
    if (wasActive) {
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', swallow, true);
      };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 400);
    }
  }, [onMove, stopEdgeScroll]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabledRef.current || e.button !== 0 || e.pointerType === 'touch') return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(SKIP_SELECTOR)) return;
      const anchorCell = readCellFromEl(target);
      if (!anchorCell) return;
      stateRef.current = {
        anchorCell,
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastAppliedKey: null,
        edgeRaf: null,
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    },
    [onMove, onUp],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      const st = stateRef.current;
      if (st?.edgeRaf != null) cancelAnimationFrame(st.edgeRaf);
      document.body.style.userSelect = '';
    },
    [onMove, onUp],
  );

  return { onPointerDown };
}
