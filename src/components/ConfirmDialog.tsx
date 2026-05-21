import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { isComposingKeyEvent } from '../lib/ime';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  isDanger = false,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      // Don't trigger if typing in an input inside a modal (though ConfirmDialog has no inputs, good practice)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onConfirm]);

  useEffect(() => {
    if (!isOpen) return;
    // Ensure Enter works reliably by focusing the primary action.
    // (window keydown may not fire depending on focus, e.g. DevTools.)
    queueMicrotask(() => confirmButtonRef.current?.focus());
  }, [isOpen]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  if (!isOpen) return null;

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-sm overflow-hidden')}
      >
        <div className="flex justify-between items-center gap-3 px-5 py-4 border-b border-slate-200/80 bg-gradient-to-b from-slate-50 to-slate-50/40">
          <div className="flex items-center gap-2">
            {isDanger && <AlertTriangle className="text-red-500" size={20} />}
            <h2 id="confirm-dialog-title" className="text-lg font-bold text-[var(--color-ink)]">
              {title}
            </h2>
          </div>
          <button
            aria-label="닫기"
            onClick={onClose}
            className="p-2 rounded-xl transition-colors text-slate-500 hover:text-slate-900 hover:bg-slate-200/80"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        <form
          className="flex justify-end gap-3 px-5 py-4 border-t border-slate-200/80 bg-slate-50/50"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
            onClose();
          }}
        >
          <button type="button" onClick={onClose} className="btn-ghost">
            {cancelLabel}
          </button>
          <button ref={confirmButtonRef} type="submit" className={cn('btn-primary', isDanger && 'bg-red-600 hover:bg-red-700')}>
            {confirmLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
