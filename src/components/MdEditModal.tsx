import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';

interface MdEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 표 내용을 마크다운으로 변환한 초기 텍스트 */
  initialMarkdown: string;
  onSave: (editedMarkdown: string) => void;
}

/** 표 내용을 마크다운(.md)으로 표시해 직접 수정하는 텍스트창 모달 */
export function MdEditModal({ isOpen, onClose, initialMarkdown, onSave }: MdEditModalProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setText(initialMarkdown);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialMarkdown]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const handleSave = () => {
    onSave(text);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-4xl max-h-[90vh] overflow-hidden flex flex-col')}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 bg-slate-50/80 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">현재 프로젝트 표 — 마크다운 편집</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            title="닫기 (Esc)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-3 flex-1 min-h-0 flex flex-col">
          <p className="text-xs text-slate-500 mb-2 leading-relaxed">
            외부에서 만든 내용이 있으면 아래에 <strong>통째로 붙여넣기</strong>해도 됩니다. 단,{' '}
            <code className="rounded bg-slate-100 px-1 text-[11px]">| WBS | 작업명 | …</code> 형태의 <strong>8열 파이프 표</strong>와{' '}
            <code className="rounded bg-slate-100 px-1 text-[11px]">|-----|</code> 구분 줄이 있어야 합니다. 저장 시{' '}
            <strong>선택된 프로젝트</strong>의 작업만 갱신됩니다. WBS 열의 <strong>**코드**</strong>는 바꾸지 마세요.
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full flex-1 min-h-[320px] p-3 text-sm font-mono border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
            spellCheck={false}
          />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50/50 shrink-0">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
