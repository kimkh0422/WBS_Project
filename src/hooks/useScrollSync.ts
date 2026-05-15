import { useEffect, useRef, type RefObject } from 'react';

function maxScrollTop(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

/** 동일한 scrollTop으로 맞춘다(총 스크롤 높이가 같을 때 행이 1:1 정렬). */

function mirrorScrollTop(source: HTMLElement, target: HTMLElement) {
  const cap = Math.min(maxScrollTop(source), maxScrollTop(target));

  target.scrollTop = Math.min(source.scrollTop, cap);
}

/** 표·간트 split 본문의 세로 스크롤(scrollTop)을 양방향으로 맞춘다. */

export function useScrollSync(
  aRef: RefObject<HTMLDivElement | null>,

  bRef: RefObject<HTMLDivElement | null>,

  enabled: boolean,
) {
  const lockRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let cleanup: (() => void) | undefined;

    let cancelled = false;

    let raf = 0;

    let attempts = 0;

    const attach = () => {
      const a = aRef.current;

      const b = bRef.current;

      if (!a || !b) {
        if (!cancelled && attempts < 120) {
          attempts += 1;

          raf = requestAnimationFrame(attach);
        }

        return;
      }

      const mirror = (source: HTMLElement, target: HTMLElement) => {
        if (lockRef.current) return;

        lockRef.current = true;

        mirrorScrollTop(source, target);

        requestAnimationFrame(() => {
          lockRef.current = false;
        });
      };

      const onA = () => mirror(a, b);

      const onB = () => mirror(b, a);

      a.addEventListener('scroll', onA, { passive: true });

      b.addEventListener('scroll', onB, { passive: true });

      cleanup = () => {
        a.removeEventListener('scroll', onA);

        b.removeEventListener('scroll', onB);
      };
    };

    attach();

    return () => {
      cancelled = true;

      cancelAnimationFrame(raf);

      cleanup?.();
    };
  }, [aRef, bRef, enabled]);
}
