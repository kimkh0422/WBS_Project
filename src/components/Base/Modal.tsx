import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_BASE_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
} from '../../lib/modalChrome';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { isComposingKeyEvent } from '../../lib/ime';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  /** 넓은 화면에서도 카드 형태가 유지되도록 상한을 둔 전체형 패널 */
  full: 'max-w-[min(calc(100vw-1.5rem),72rem)]',
};

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** aria-labelledby 연결용. 미지정 시 자동 생성 */
  titleId?: string;
  /** 기본 라벨: "닫기" */
  closeLabel?: string;
  /** 배경 클릭으로 닫기. 기본 true */
  closeOnBackdrop?: boolean;
  /** Esc로 닫기. 기본 true */
  closeOnEscape?: boolean;
  /** 우상단 X 버튼 표시. 기본 true */
  showCloseButton?: boolean;
  /** 모달 최대 너비 */
  size?: ModalSize;
  /** header 좌측 추가 요소 (예: 아이콘) */
  headerStart?: React.ReactNode;
  /** body 영역 */
  children?: React.ReactNode;
  /** footer 영역 (버튼 등) */
  footer?: React.ReactNode;
  /** 컨테이너 추가 클래스 */
  className?: string;
  /** body 영역 추가 클래스 */
  bodyClassName?: string;
}

/**
 * 공통 모달 래퍼.
 * ESC/배경클릭/focus trap/body scroll lock/aria-modal을 기본 제공.
 * 기존 모달을 점진적으로 이 컴포넌트로 마이그레이션할 수 있도록 설계됨.
 */
export function BaseModal({
  isOpen,
  onClose,
  title,
  titleId,
  closeLabel = '닫기',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  size = 'md',
  headerStart,
  children,
  footer,
  className,
  bodyClassName,
}: BaseModalProps) {
  const autoId = useId();
  const resolvedTitleId = titleId ?? (title ? `base-modal-title-${autoId}` : undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  // Esc로 닫기
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  // body 스크롤 잠금
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget) onClose();
  };

  const content = (
    <div className={MODAL_BACKDROP_CLASS} onMouseDown={handleBackdropClick}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        className={cn(MODAL_PANEL_BASE_CLASS, 'overflow-hidden flex flex-col max-h-[92vh]', SIZE_CLASS[size], className)}
      >
        {(title || showCloseButton) && (
          <div className={cn(MODAL_HEADER_CLASS, 'flex-shrink-0')}>
            <div className="flex items-center gap-2.5 min-w-0">
              {headerStart}
              {title &&
                (typeof title === 'string' ? (
                  <h2 id={resolvedTitleId} className="text-lg font-bold tracking-tight text-[var(--color-ink)] break-words">
                    {title}
                  </h2>
                ) : (
                  <div id={resolvedTitleId} className="text-lg font-bold tracking-tight text-[var(--color-ink)] min-w-0">
                    {title}
                  </div>
                ))}
            </div>
            {showCloseButton && (
              <button type="button" aria-label={closeLabel} onClick={onClose} className={cn(MODAL_CLOSE_BUTTON_CLASS, 'flex-shrink-0')}>
                <X size={18} strokeWidth={2} />
              </button>
            )}
          </div>
        )}

        <div className={cn('flex-1 min-h-0 overflow-y-auto p-5 sm:p-6', bodyClassName)}>{children}</div>

        {footer && <div className={cn(MODAL_FOOTER_CLASS, 'flex-shrink-0')}>{footer}</div>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
