import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  MODAL_BACKDROP_CLASS,
  MODAL_PANEL_BASE_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_CLOSE_BUTTON_CLASS,
} from '../lib/modalChrome';

interface UnsavedProjectSwitchDialogProps {
  /** 포커스 트랩 대상이 되는 다이얼로그 패널 ref */
  dialogRef: React.RefObject<HTMLDivElement>;
  /** 전환 대상 프로젝트 표시명 */
  targetLabel: string;
  /** 저장/되돌리기 처리 중(이중 클릭·닫기 방지) */
  busy: boolean;
  action: 'save' | 'discard' | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

/**
 * 미저장 변경이 있을 때 다른 프로젝트로 전환 전 확인 모달.
 * App.tsx의 인라인 JSX에서 분리 — 동작 동일.
 */
export function UnsavedProjectSwitchDialog({
  dialogRef,
  targetLabel,
  busy,
  action,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedProjectSwitchDialogProps) {
  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[80]')}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-switch-unsaved-title"
        className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md overflow-hidden')}
      >
        <div className={MODAL_HEADER_CLASS}>
          <h2 id="project-switch-unsaved-title" className="text-lg font-bold text-[var(--color-ink)]">
            저장되지 않음
          </h2>
          <button type="button" aria-label="전환 취소" onClick={onCancel} disabled={busy} className={MODAL_CLOSE_BUTTON_CLASS}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <p className="text-sm text-slate-600 leading-relaxed">서버에는 아직 반영되지 않았습니다. 저장할까요?</p>
          <p className="mt-2 text-xs text-slate-500">전환: {targetLabel}</p>
          {busy && action === 'save' ? (
            <ol className="mt-3 space-y-1.5 text-xs text-indigo-700 dark:text-indigo-300 list-decimal list-inside">
              <li>편집 중인 셀·입력값을 확정하는 중…</li>
              <li>서버(DB)에 변경사항을 반영하는 중…</li>
            </ol>
          ) : null}
        </div>
        <div className={cn(MODAL_FOOTER_CLASS, 'justify-end gap-2')}>
          <button type="button" className="btn-ghost" onClick={onDiscard} disabled={busy}>
            저장 안 함
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={busy}>
            {action === 'save' ? '저장하는 중…' : '저장 후 전환'}
          </button>
        </div>
      </div>
    </div>
  );
}
