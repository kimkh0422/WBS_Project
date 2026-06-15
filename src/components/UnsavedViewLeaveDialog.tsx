import React from 'react';
import { X } from 'lucide-react';
import type { UnsavedViewLeaveMode } from '../lib/viewPathLabels';
import { cn } from '../lib/utils';
import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_BASE_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
} from '../lib/modalChrome';

interface UnsavedViewLeaveDialogProps {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  mode: UnsavedViewLeaveMode;
  /** mode === 'path' 일 때 이동하려던 화면 표시용 */
  targetLabel?: string;
  busy: boolean;
  action: 'save' | 'discard' | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

/**
 * 미저장(DB 미반영) 상태에서 다른 화면으로 나가기·뒤로 가기 직전 확인.
 */
export function UnsavedViewLeaveDialog({
  dialogRef,
  mode,
  targetLabel,
  busy,
  action,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedViewLeaveDialogProps) {
  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[85]')}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-leave-unsaved-title"
        className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md overflow-hidden')}
      >
        <div className={MODAL_HEADER_CLASS}>
          <h2 id="view-leave-unsaved-title" className="text-lg font-bold text-[var(--color-ink)]">
            저장되지 않은 변경
          </h2>
          <button type="button" aria-label="닫기" onClick={onCancel} disabled={busy} className={MODAL_CLOSE_BUTTON_CLASS}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="text-sm text-slate-600 leading-relaxed">서버에는 아직 반영되지 않은 편집이 있습니다. 나가기 전에 저장할까요?</p>
          {mode === 'path' && targetLabel ? (
            <p className="mt-2 text-xs text-slate-500">
              이동하려던 화면: <span className="font-semibold text-slate-700">{targetLabel}</span>
            </p>
          ) : null}
          {busy && action === 'save' ? (
            <ol className="mt-3 space-y-1.5 text-xs text-indigo-700 dark:text-indigo-300 list-decimal list-inside">
              <li>편집 중인 셀·입력값을 확정하는 중…</li>
              <li>서버(DB)에 변경사항을 반영하는 중…</li>
            </ol>
          ) : null}
        </div>
        <div className={cn(MODAL_FOOTER_CLASS, 'justify-end gap-2 flex-wrap')}>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            머무르기
          </button>
          <button type="button" className="btn-ghost" onClick={onDiscard} disabled={busy}>
            저장 안 함
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={busy}>
            {action === 'save' ? '저장하는 중…' : '저장 후 이동'}
          </button>
        </div>
      </div>
    </div>
  );
}
