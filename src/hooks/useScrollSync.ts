import { useCallback, useEffect, useRef } from 'react';

/**
 * Synchronizes vertical scroll between two scroll containers (e.g. WBS table and Gantt chart).
 *
 * Callback-ref 패턴 사용:
 *  - element가 attach되는 순간 listener를 등록한다 (mount 타이밍 race 방지).
 *  - 한쪽 element가 detach되거나 view가 바뀌면 listener를 정리한다.
 *  - useEffect + setTimeout 재시도 방식은 mount 늦거나 view 전환 시 sync 실패가 잦아서 폐기.
 */
export function useScrollSync(view: string) {
  const wbsElRef = useRef<HTMLDivElement | null>(null);
  const ganttElRef = useRef<HTMLDivElement | null>(null);
  const isSyncing = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const wireUp = useCallback(() => {
    // 이전 listener 정리
    cleanupRef.current?.();
    cleanupRef.current = null;

    const wbs = wbsElRef.current;
    const gantt = ganttElRef.current;
    if (!wbs || !gantt) return;
    if (viewRef.current !== 'list') return;

    const syncFromWbs = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      gantt.scrollTop = wbs.scrollTop;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };
    const syncFromGantt = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      wbs.scrollTop = gantt.scrollTop;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };

    wbs.addEventListener('scroll', syncFromWbs, { passive: true });
    gantt.addEventListener('scroll', syncFromGantt, { passive: true });
    // 초기 정렬: 간트를 표의 위치에 맞춤
    gantt.scrollTop = wbs.scrollTop;

    // 패널 리사이즈(가로 스크롤바 등장/소멸, 너비 변경)·내용 크기 변화로 스크롤 위치가 어긋날 때 재정렬
    const onResize = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      gantt.scrollTop = wbs.scrollTop;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };
    const roWbs = new ResizeObserver(onResize);
    const roGantt = new ResizeObserver(onResize);
    roWbs.observe(wbs);
    roGantt.observe(gantt);

    cleanupRef.current = () => {
      wbs.removeEventListener('scroll', syncFromWbs);
      gantt.removeEventListener('scroll', syncFromGantt);
      roWbs.disconnect();
      roGantt.disconnect();
    };
  }, []);

  // view 전환 시 wire 재구성. element가 같으면 listener는 새로 붙고, 다르면 다음 callback ref에서 wireUp.
  useEffect(() => {
    wireUp();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [view, wireUp]);

  const wbsScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (wbsElRef.current === el) return;
      wbsElRef.current = el;
      wireUp();
    },
    [wireUp],
  );

  const ganttScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (ganttElRef.current === el) return;
      ganttElRef.current = el;
      wireUp();
    },
    [wireUp],
  );

  return { wbsScrollRef, ganttScrollRef };
}
