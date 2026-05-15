import { useEffect, useRef, type RefObject } from 'react';

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
        if (e.deltaY === 0 || e.ctrlKey) return;
        const target = e.target;
        if (!(target instanceof HTMLElement) || !root?.contains(target)) return;
        if (isForeignNestedScrollable(target, root, paneEls)) return;

        e.preventDefault();

        const inGantt = ganttPane?.contains(target) ?? false;
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
