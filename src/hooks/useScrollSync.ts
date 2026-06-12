import { useEffect, type RefObject } from 'react';

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function clampScrollTop(el: HTMLElement, value: number): number {
  return Math.min(maxScrollTop(el), Math.max(0, value));
}

/** scrollTop 비율로 맞춘다 — 총 스크롤 높이가 조금 달라도 행 정렬이 유지된다. */
export function mirrorScrollTop(source: HTMLElement, target: HTMLElement) {
  const sourceMax = maxScrollTop(source);
  const targetMax = maxScrollTop(target);

  if (sourceMax <= 0) {
    target.scrollTop = 0;
    return;
  }

  // 높이가 같으면 비율 계산 없이 그대로 복사(지연·떨림 최소화)
  if (Math.abs(sourceMax - targetMax) <= 1) {
    target.scrollTop = Math.min(source.scrollTop, targetMax);
    return;
  }

  const ratio = source.scrollTop / sourceMax;
  target.scrollTop = ratio * targetMax;
}

export type SplitHorizontalScrollRefs = {
  tableHeader: RefObject<HTMLDivElement | null>;
  tableBody: RefObject<HTMLDivElement | null>;
  ganttHeader: RefObject<HTMLDivElement | null>;
  ganttBottom: RefObject<HTMLDivElement | null>;
};

/**
 * split 뷰: 표 컬럼 헤더·본문(scrollLeft) ↔ 간트 날짜 헤더·하단 스크롤바 가로 위치 동기화.
 * 간트 본문은 overflow-x-hidden이라 가로 스크롤이 헤더/하단에만 있어 별도 연동이 필요하다.
 */
export function useSplitHorizontalScrollSync(
  refs: SplitHorizontalScrollRefs,
  enabled: boolean,
  /** 엘리먼트가 늦게 붙거나(간트 빈 상태 등) 바뀔 때 리스너를 다시 붙이기 위한 키 */
  reattachDeps: unknown[],
) {
  useEffect(() => {
    if (!enabled) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;

    const attach = () => {
      const th = refs.tableHeader.current;
      const tb = refs.tableBody.current;
      const gh = refs.ganttHeader.current;
      const gb = refs.ganttBottom.current;

      if (!th || !tb || !gh || !gb) {
        if (!cancelled && attempts < 120) {
          attempts += 1;
          raf = requestAnimationFrame(attach);
        }
        return;
      }

      let hSync = false;

      const syncFromTable = () => {
        if (hSync) return;
        hSync = true;
        const left = th.scrollLeft;
        if (gh.scrollLeft !== left) gh.scrollLeft = left;
        if (gb.scrollLeft !== left) gb.scrollLeft = left;
        if (tb.scrollLeft !== left) tb.scrollLeft = left;
        hSync = false;
      };

      const syncFromGantt = (left: number) => {
        if (hSync) return;
        hSync = true;
        if (th.scrollLeft !== left) th.scrollLeft = left;
        if (tb.scrollLeft !== left) tb.scrollLeft = left;
        if (gh.scrollLeft !== left) gh.scrollLeft = left;
        if (gb.scrollLeft !== left) gb.scrollLeft = left;
        hSync = false;
      };

      const onTh = () => syncFromTable();
      const onGh = () => syncFromGantt(gh.scrollLeft);
      const onGb = () => syncFromGantt(gb.scrollLeft);

      th.addEventListener('scroll', onTh, { passive: true });
      gh.addEventListener('scroll', onGh, { passive: true });
      gb.addEventListener('scroll', onGb, { passive: true });

      cleanup = () => {
        th.removeEventListener('scroll', onTh);
        gh.removeEventListener('scroll', onGh);
        gb.removeEventListener('scroll', onGb);
      };
    };

    attach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs 객체는 안정적이며 reattachDeps로 재연결 시점을 제어
  }, [enabled, ...reattachDeps]);
}

/** 표·간트 본문 외부(드롭다운 등)의 세로 스크롤만 제외 */
function isForeignNestedScrollable(el: HTMLElement, root: HTMLElement, paneEls: HTMLElement[]): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    if (paneEls.includes(node)) {
      node = node.parentElement;
      continue;
    }
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** 표·간트 split 본문의 세로 스크롤(scrollTop)을 양방향으로 맞춘다. */
export function useScrollSync(
  aRef: RefObject<HTMLDivElement | null>,
  bRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  rootRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!enabled) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;

    const attach = () => {
      const a = aRef.current;
      const b = bRef.current;
      const root = rootRef?.current;

      if (!a || !b) {
        if (!cancelled && attempts < 120) {
          attempts += 1;
          raf = requestAnimationFrame(attach);
        }
        return;
      }

      // 1 = 표→간트 동기화 중, 2 = 간트→표 동기화 중 (scroll 이벤트 루프 방지)
      let syncing: 1 | 2 | null = null;

      const syncFrom = (source: 1 | 2) => {
        if (syncing !== null) return;
        syncing = source;
        const src = source === 1 ? a : b;
        const tgt = source === 1 ? b : a;
        mirrorScrollTop(src, tgt);
        syncing = null;
      };

      const onA = () => syncFrom(1);
      const onB = () => syncFrom(2);

      a.addEventListener('scroll', onA, { passive: true });
      b.addEventListener('scroll', onB, { passive: true });

      const ganttPane = root?.querySelector('.list-gantt-pane');
      const paneEls = [a, b];

      const onRootWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // Ctrl+휠은 브라우저 확대/축소 등 기본 동작 유지
        if (e.deltaX === 0 && e.deltaY === 0) return;
        const target = e.target;
        if (!(target instanceof HTMLElement) || !root?.contains(target)) return;
        if (isForeignNestedScrollable(target, root, paneEls)) return;

        const inGantt = ganttPane?.contains(target) ?? false;

        // 가로 이동량: 마우스 가로 틸트/좌우 스크롤 휠(deltaX)이 있으면 그 값을,
        // 없으면 간트 위에서의 평범한 세로 휠(deltaY, Shift 없음)을 가로 이동으로 사용한다.
        const horizontalDelta = e.deltaX !== 0 ? e.deltaX : inGantt && !e.shiftKey ? e.deltaY : 0;

        // 타임라인 좌우 이동 — 간트 본문(b)은 overflow-x-hidden이지만 scrollLeft는 프로그램적으로 설정 가능하며,
        // GanttChart 내부 가로 동기 effect가 날짜 헤더·하단 바·표 가로 위치를 함께 맞춘다.
        if (horizontalDelta !== 0) {
          e.preventDefault();
          const maxLeft = Math.max(0, b.scrollWidth - b.clientWidth);
          if (maxLeft > 0) b.scrollLeft = Math.min(maxLeft, Math.max(0, b.scrollLeft + horizontalDelta));
          return;
        }

        if (e.deltaY === 0) return;
        e.preventDefault();

        const source: 1 | 2 = inGantt ? 2 : 1;
        const primary = source === 1 ? a : b;

        syncing = source;
        primary.scrollTop = clampScrollTop(primary, primary.scrollTop + e.deltaY);
        mirrorScrollTop(primary, source === 1 ? b : a);
        syncing = null;
      };

      let resizeRaf = 0;
      const ro = new ResizeObserver(() => {
        if (syncing !== null) return;
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          if (syncing === null) syncFrom(1);
        });
      });
      ro.observe(a);
      ro.observe(b);

      if (root) {
        root.addEventListener('wheel', onRootWheel, { passive: false, capture: true });
      }

      cleanup = () => {
        a.removeEventListener('scroll', onA);
        b.removeEventListener('scroll', onB);
        ro.disconnect();
        cancelAnimationFrame(resizeRaf);
        if (root) root.removeEventListener('wheel', onRootWheel, true);
      };
    };

    attach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [aRef, bRef, enabled, rootRef]);
}
