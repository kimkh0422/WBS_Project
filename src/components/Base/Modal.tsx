import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { isComposingKeyEvent } from '../../lib/ime';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[calc(100vw-2rem)] md:max-w-[calc(100vw-4rem)]',
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        className={cn(
          'bg-white rounded-2xl shadow-xl w-full overflow-hidden flex flex-col border border-slate-200',
          'max-h-[85vh] animate-in fade-in zoom-in-95 duration-200',
          SIZE_CLASS[size],
          className,
        )}
      >
        {(title || showCloseButton) && (
          <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {headerStart}
              {title &&
                (typeof title === 'string' ? (
                  <h2 id={resolvedTitleId} className="text-lg font-bold text-[var(--color-ink)] truncate">
                    {title}
                  </h2>
                ) : (
                  <div id={resolvedTitleId} className="text-lg font-bold text-[var(--color-ink)] min-w-0">
                    {title}
                  </div>
                ))}
            </div>
            {showCloseButton && (
              <button
                type="button"
                aria-label={closeLabel}
                onClick={onClose}
                className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800 flex-shrink-0"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className={cn('flex-1 min-h-0 overflow-y-auto p-6', bodyClassName)}>{children}</div>

        {footer && <div className="flex justify-end gap-3 p-5 border-t border-slate-100 bg-slate-50/30 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
