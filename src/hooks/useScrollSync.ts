import { useEffect, type RefObject } from 'react';

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function clampScrollTop(el: HTMLElement, value: number): number {
  return Math.min(maxScrollTop(el), Math.max(0, value));
}

/**
 * 표·간트 split 본문 세로 스크롤 동기화.
 * - scrollHeight가 거의 같으면 **같은 scrollTop**을 쓴다(행·강조가 일직선). 뷰포트 높이만 다른 경우(간트 하단 inset 등)도 동일.
 * - tail(퀵 추가 등) 때문에 scrollHeight만 살짝 다르면 비율 동기가 한 줄씩 어긋날 수 있어, shDiff가 작을 때는 복사 모드를 쓴다.
 * - 본문 길이가 크게 다를 때만 비율로 맞춘다.
 */
export function mirrorScrollTop(source: HTMLElement, target: HTMLElement) {
  const sourceMax = maxScrollTop(source);
  const targetMax = maxScrollTop(target);

  const assignIfNeeded = (next: number) => {
    const clamped = Math.min(targetMax, Math.max(0, next));
    if (Math.abs(target.scrollTop - clamped) < 1) return;
    target.scrollTop = clamped;
  };

  // 한쪽만 scrollHeight가 잠깝 줄어든 프레임(가상 행 교체·RO·하단 크롬 높이 변화)에서 sourceMax=0으로 보이면
  // 여기서 target을 무조건 0으로 맞추면 표·간트가 함께 맨 위로 튀는 현상이 생긴다.
  // 양쪽 모두 스크롤 여유가 없을 때만 동일(상단)으로 맞춘다.
  if (sourceMax <= 0) {
    if (targetMax <= 0) assignIfNeeded(0);
    return;
  }

  const shDiff = Math.abs(source.scrollHeight - target.scrollHeight);
  /**
   * 총 스크롤 길이가 같으면 항상 scrollTop 복사(클램프).
   * 표·간트 split에서 간트만 하단 inset 등으로 뷰포트 높이가 달라져도 본문 픽셀 오프셋은 같아야 행·선택 강조가 일직선이다.
   * 예전엔 clientHeight 차이까지 제한해 복사 모드가 아니면 비율 동기로 한 줄씩 어긋날 수 있었다.
   * scrollHeight가 크게 다를 때만 비율로 맞춘다.
   */
  const useCopyMode = shDiff <= 18;

  if (useCopyMode || Math.abs(sourceMax - targetMax) <= 1) {
    assignIfNeeded(Math.min(source.scrollTop, targetMax));
    return;
  }

  const ratio = source.scrollTop / sourceMax;
  assignIfNeeded(ratio * targetMax);
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

/** 표·간트 / 표·칸반 split: 휠 라우팅 시 두 번째 패널 루트(`root` 하위) */
const DEFAULT_SECOND_PANE_SELECTOR = '.list-gantt-pane';

export type ScrollSyncWheelOptions = {
  secondPaneSelector?: string;
  /**
   * true(기본): 간트처럼 두 번째 패널 위에서 세로 휠을 가로(타임라인) 이동으로 처리.
   * false: 칸반 등 — 세로 휠은 항상 세로 스크롤.
   */
  verticalWheelAsHorizontalInSecondPane?: boolean;
};

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

/** 표·간트 / 표·칸반 split 본문의 세로 스크롤(scrollTop)을 양방향으로 맞춘다. */
export function useScrollSync(
  aRef: RefObject<HTMLDivElement | null>,
  bRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  rootRef?: RefObject<HTMLElement | null>,
  wheelOptions?: ScrollSyncWheelOptions,
) {
  const secondPaneSelector = wheelOptions?.secondPaneSelector ?? DEFAULT_SECOND_PANE_SELECTOR;
  const verticalWheelAsHorizontalInSecondPane = wheelOptions?.verticalWheelAsHorizontalInSecondPane ?? true;

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

      // 1 = 표→우측 패널 동기화 중, 2 = 우측→표 (scroll 이벤트 루프 방지)
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

      const secondPane = root?.querySelector(secondPaneSelector);
      const paneEls = [a, b];

      const onRootWheel = (e: WheelEvent) => {
        if (e.ctrlKey) return; // Ctrl+휠은 브라우저 확대/축소 등 기본 동작 유지
        if (e.deltaX === 0 && e.deltaY === 0) return;
        const target = e.target;
        if (!(target instanceof HTMLElement) || !root?.contains(target)) return;
        if (isForeignNestedScrollable(target, root, paneEls)) return;

        const inSecondPane = secondPane?.contains(target) ?? false;

        // 가로 이동량: 마우스 가로 틸트/좌우 스크롤 휠(deltaX)이 있으면 그 값을,
        // 간트(split)에서는 두 번째 패널 위 세로 휠을 타임라인 좌우로 쓴다(옵션 true).
        const horizontalDelta =
          e.deltaX !== 0 ? e.deltaX : inSecondPane && verticalWheelAsHorizontalInSecondPane && !e.shiftKey ? e.deltaY : 0;

        // 간트: 타임라인 좌우 — 본문(b)은 overflow-x-hidden이어도 scrollLeft를 바꾸면 내부 effect가 헤더·하단·표 가로를 맞춘다.
        // 칸반: 보드 전체 가로 스크롤(컬럼이 많을 때).
        if (horizontalDelta !== 0) {
          e.preventDefault();
          const maxLeft = Math.max(0, b.scrollWidth - b.clientWidth);
          if (maxLeft > 0) b.scrollLeft = Math.min(maxLeft, Math.max(0, b.scrollLeft + horizontalDelta));
          return;
        }

        if (e.deltaY === 0) return;
        e.preventDefault();

        const source: 1 | 2 = inSecondPane ? 2 : 1;
        const primary = source === 1 ? a : b;

        syncing = source;
        primary.scrollTop = clampScrollTop(primary, primary.scrollTop + e.deltaY);
        mirrorScrollTop(primary, source === 1 ? b : a);
        syncing = null;
      };

      let resizeRaf = 0;
      let resizeRaf2 = 0;
      const ro = new ResizeObserver(() => {
        if (syncing !== null) return;
        cancelAnimationFrame(resizeRaf);
        cancelAnimationFrame(resizeRaf2);
        // 한 프레임 안에서 가상 행 교체·RO가 연쇄되면 scrollHeight가 잠깐 흔들린다.
        // 이중 rAF로 레이아웃이 안정된 뒤에만 동기해 표·간트 하단이 깜빡이지 않게 한다.
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf2 = requestAnimationFrame(() => {
            if (syncing === null) syncFrom(1);
          });
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
        cancelAnimationFrame(resizeRaf2);
        if (root) root.removeEventListener('wheel', onRootWheel, true);
      };
    };

    attach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [aRef, bRef, enabled, rootRef, secondPaneSelector, verticalWheelAsHorizontalInSecondPane]);
}
