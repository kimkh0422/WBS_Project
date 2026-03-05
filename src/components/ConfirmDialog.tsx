import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';

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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input inside a modal (though ConfirmDialog has no inputs, good practice)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)]">
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
          <div className="flex items-center gap-2">
            {isDanger && <AlertTriangle className="text-red-500" size={20} />}
            <h2 className="text-lg font-bold text-[var(--color-ink)]">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-[var(--color-line)] bg-stone-50/50">
          <button
            onClick={onClose}
            className="btn-ghost"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={cn(
              "btn-primary",
              isDanger && "bg-red-600 hover:bg-red-700"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
