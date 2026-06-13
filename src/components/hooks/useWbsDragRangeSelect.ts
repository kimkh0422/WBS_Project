import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { TaskWithDepth } from '../../lib/taskView';

const ROW_ID_PREFIX = 'task-row-';
/** 클릭과 구분하기 위한 드래그 선택 시작 임계 거리(px) — 그립 정렬(dnd) 활성 거리와 동일하게 5px */
const DRAG_ACTIVATE_PX = 5;
/** 뷰포트 위·아래 가장자리에서 자동 스크롤이 시작되는 영역(px) */
const EDGE_ZONE = 28;
/** 자동 스크롤 프레임당 최대 이동(px) */
const EDGE_MAX_SPEED = 16;

/** 드래그 선택을 시작하면 안 되는(자체 동작이 있는) 요소들 + 첫 열 그립([data-row-grip]은 순서 이동 전담) */
const SKIP_SELECTOR =
  'input, textarea, select, button, a, option, [role="listbox"], [role="option"], [data-deps-input="true"], [data-row-grip]';

interface UseWbsDragRangeSelectOptions {
  /** 표시 순서대로의 작업 목록(범위 계산 기준) */
  visibleTasks: TaskWithDepth[];
  /** 자동 스크롤 대상 컨테이너(표 본문) */
  tableScrollRef: MutableRefObject<HTMLDivElement | null>;
  setSelection: (ids: Set<string>) => void;
  setLastSelectedId: (id: string | null) => void;
  /** 드래그가 지나간 행을 활성 셀로 맞춘다(셀 링 이동용 — 선택 자체는 건드리지 않음) */
  setFocusCellForRow: (id: string) => void;
  rangeAnchorRef: MutableRefObject<string | null>;
  setAnchorTaskId: (id: string | null) => void;
  enabled?: boolean;
}

interface DragState {
  anchorId: string;
  anchorIndex: number;
  active: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastAppliedId: string | null;
  edgeRaf: number | null;
}

/**
 * 엑셀식 마우스 드래그 다중 선택.
 *
 * 표 본문에서 (그립·입력·버튼이 아닌) 행을 누른 채 위·아래로 끌면 앵커 행부터
 * 포인터가 가리키는 행까지 연속 범위를 선택한다. 뷰포트 가장자리에서는 자동 스크롤한다.
 *
 * - 순서 이동(정렬)은 첫 열 그립([data-row-grip])이 전담하므로 본문 드래그는 선택만 한다.
 * - 단순 클릭(이동 없음)은 기존 포커스/편집 동작을 그대로 둔다(드래그가 실제로 시작된 뒤에만
 *   직후 합성 click을 가로채, 행 포커스 핸들러가 방금 만든 선택을 지우지 않게 한다).
 * - 터치는 표 세로 스크롤과 충돌하므로 제외(마우스·펜만).
 */
export function useWbsDragRangeSelect({
  visibleTasks,
  tableScrollRef,
  setSelection,
  setLastSelectedId,
  setFocusCellForRow,
  rangeAnchorRef,
  setAnchorTaskId,
  enabled = true,
}: UseWbsDragRangeSelectOptions) {
  // 윈도우 리스너는 드래그마다 새로 붙이므로, 콜백을 stable하게 유지하려고 최신 값을 ref로 읽는다.
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const setSelectionRef = useRef(setSelection);
  setSelectionRef.current = setSelection;
  const setLastSelectedIdRef = useRef(setLastSelectedId);
  setLastSelectedIdRef.current = setLastSelectedId;
  const setFocusCellForRowRef = useRef(setFocusCellForRow);
  setFocusCellForRowRef.current = setFocusCellForRow;
  const setAnchorTaskIdRef = useRef(setAnchorTaskId);
  setAnchorTaskIdRef.current = setAnchorTaskId;

  const stateRef = useRef<DragState | null>(null);

  const rowIdFromPoint = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = el?.closest?.(`[id^="${ROW_ID_PREFIX}"]`) as HTMLElement | null;
    return row ? row.id.slice(ROW_ID_PREFIX.length) : null;
  };

  const applyRangeTo = useCallback((currentId: string) => {
    const st = stateRef.current;
    if (!st || currentId === st.lastAppliedId) return; // 같은 행을 계속 가리키면 재선택 생략
    const list = visibleTasksRef.current;
    const curIdx = list.findIndex((t) => t.id === currentId);
    if (curIdx === -1) return;
    st.lastAppliedId = currentId;
    const start = Math.min(st.anchorIndex, curIdx);
    const end = Math.max(st.anchorIndex, curIdx);
    const next = new Set<string>();
    for (let i = start; i <= end; i += 1) next.add(list[i].id);
    setSelectionRef.current(next);
    setLastSelectedIdRef.current(currentId);
    setFocusCellForRowRef.current(currentId);
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
      const id = rowIdFromPoint(x, y);
      if (id) applyRangeTo(id);
    }
    st.edgeRaf = requestAnimationFrame(edgeTick);
  }, [tableScrollRef, applyRangeTo]);

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
        const overId = rowIdFromPoint(e.clientX, e.clientY);
        if (!moved && !(overId && overId !== st.anchorId)) return; // 아직 클릭 범위 — 활성화하지 않음
        st.active = true;
        document.body.style.userSelect = 'none';
        // 이후 Shift+클릭이 이 앵커에서 이어지도록 범위 앵커를 맞춰 둔다.
        rangeAnchorRef.current = st.anchorId;
        setAnchorTaskIdRef.current(st.anchorId);
      }
      e.preventDefault();
      const id = rowIdFromPoint(e.clientX, e.clientY);
      if (id) applyRangeTo(id);
      syncEdgeScroll();
    },
    [applyRangeTo, syncEdgeScroll, rangeAnchorRef],
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
      // 드래그 직후 합성되는 click이 행 포커스 핸들러로 전달돼 방금 만든 선택을 지우는 것을 막는다.
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
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return; // 수정키 조합은 기존 행 핸들러가 처리
      const target = e.target as HTMLElement | null;
      if (!target || target.closest(SKIP_SELECTOR)) return;
      const row = target.closest(`[id^="${ROW_ID_PREFIX}"]`) as HTMLElement | null;
      if (!row) return;
      const anchorId = row.id.slice(ROW_ID_PREFIX.length);
      const anchorIndex = visibleTasksRef.current.findIndex((t) => t.id === anchorId);
      if (anchorIndex === -1) return;
      stateRef.current = {
        anchorId,
        anchorIndex,
        active: false,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastAppliedId: null,
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
