import { useEffect, useRef, type RefObject } from 'react';

/**
 * 모달 내부에 포커스를 가두는 훅.
 * Tab/Shift+Tab 시 모달 안의 포커스 가능 요소 사이에서만 순환.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    // 모달 열릴 때 기존 포커스 저장
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    // 모달 안의 첫 번째 포커스 가능 요소로 이동
    const focusFirst = () => {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    };
    // 약간 지연: 모달 애니메이션 후 포커스
    const t = setTimeout(focusFirst, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(t);
      container.removeEventListener('keydown', handleKeyDown);
      // 모달 닫힐 때 기존 포커스 복원
      previousFocusRef.current?.focus();
    };
  }, [containerRef, active]);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(', ');
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    el => !el.closest('[aria-hidden="true"]') && el.offsetParent !== null,
  );
}
