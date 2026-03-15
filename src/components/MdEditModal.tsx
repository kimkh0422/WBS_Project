import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

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

  useEffect(() => {
    if (isOpen) {
      setText(initialMarkdown);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200">
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 bg-slate-50/80 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">
            표 내용 마크다운 편집
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700" title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>
        <div className="p-3 flex-1 min-h-0 flex flex-col">
          <p className="text-xs text-slate-500 mb-2">
            아래 표를 직접 수정한 뒤 저장하면 작업 데이터에 반영됩니다. WBS 코드(**1**, **1.1** 등)는 변경하지 마세요.
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
          <button type="button" onClick={handleSave} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
