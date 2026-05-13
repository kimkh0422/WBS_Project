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
  // ResizeObserver의 강제 정렬이 방금 사용자가 간트에서 한 스크롤을 표의 (클램프된) 위치로 되돌리는 것을
  // 막기 위해, 마지막으로 활성 스크롤된 쪽을 기억해 그쪽을 source로 삼는다.
  const lastScrolledRef = useRef<'wbs' | 'gantt'>('wbs');
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

    // scrollTop 차이가 이 임계값 이하면 무시 (서브픽셀 핑퐁 방지)
    const THRESHOLD = 0.5;

    // 두 element scrollTop이 이미 일치하면 set을 생략한다. 락(isSyncing) 없이도 무한 루프가 발생하지 않으므로,
    // 빠른 휠 이벤트가 rAF 락 때문에 누락되어 버벅거리는 문제를 피할 수 있다.
    const syncFromWbs = () => {
      if (Math.abs(gantt.scrollTop - wbs.scrollTop) > THRESHOLD) {
        gantt.scrollTop = wbs.scrollTop;
      }
    };
    const syncFromGantt = () => {
      if (Math.abs(wbs.scrollTop - gantt.scrollTop) > THRESHOLD) {
        wbs.scrollTop = gantt.scrollTop;
      }
    };

    // 사용자가 어디서 직접 스크롤했는지는 wheel 이벤트로만 추적한다.
    // scroll 이벤트로 업데이트하면 sync로 인한 반대편 scroll이 lastScrolled를 덮어써 ResizeObserver 방향이 오염된다.
    const markWbs = () => {
      lastScrolledRef.current = 'wbs';
    };
    const markGantt = () => {
      lastScrolledRef.current = 'gantt';
    };

    wbs.addEventListener('scroll', syncFromWbs, { passive: true });
    gantt.addEventListener('scroll', syncFromGantt, { passive: true });
    wbs.addEventListener('wheel', markWbs, { passive: true });
    gantt.addEventListener('wheel', markGantt, { passive: true });
    // 초기 정렬: 간트를 표의 위치에 맞춤
    gantt.scrollTop = wbs.scrollTop;

    // 패널 리사이즈(가로 스크롤바 등장/소멸, 너비 변경)·내용 크기 변화로 스크롤 위치가 어긋날 때 재정렬.
    // 단방향(wbs→gantt)이면 사용자가 방금 간트에서 한 스크롤을 표의 클램프된 값으로 되돌리는 버그가 생기므로,
    // 마지막으로 활성 스크롤된 쪽을 source로 삼는다.
    const onResize = () => {
      if (lastScrolledRef.current === 'gantt') {
        if (Math.abs(wbs.scrollTop - gantt.scrollTop) > THRESHOLD) wbs.scrollTop = gantt.scrollTop;
      } else {
        if (Math.abs(gantt.scrollTop - wbs.scrollTop) > THRESHOLD) gantt.scrollTop = wbs.scrollTop;
      }
    };
    const roWbs = new ResizeObserver(onResize);
    const roGantt = new ResizeObserver(onResize);
    roWbs.observe(wbs);
    roGantt.observe(gantt);

    cleanupRef.current = () => {
      wbs.removeEventListener('scroll', syncFromWbs);
      gantt.removeEventListener('scroll', syncFromGantt);
      wbs.removeEventListener('wheel', markWbs);
      gantt.removeEventListener('wheel', markGantt);
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
