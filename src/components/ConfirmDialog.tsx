import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useFocusTrap } from '../hooks/useFocusTrap';

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
      // Don't trigger if typing in an input inside a modal (though ConfirmDialog has no inputs, good practice)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200"
      >
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            {isDanger && <AlertTriangle className="text-red-500" size={20} />}
            <h2 id="confirm-dialog-title" className="text-lg font-bold text-[var(--color-ink)]">{title}</h2>
          </div>
          <button aria-label="닫기" onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        <form
          className="flex justify-end gap-3 p-5 border-t border-slate-100 bg-slate-50/30"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
            onClose();
          }}
        >
          <button type="button" onClick={onClose} className="btn-ghost">
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="submit"
            className={cn(
              "btn-primary",
              isDanger && "bg-red-600 hover:bg-red-700"
            )}
          >
            {confirmLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
