import React from 'react';
import { X, Keyboard, ArrowUp, ArrowDown, CornerDownRight, CornerLeftUp, Trash2, Edit2 } from 'lucide-react';

interface ShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ isOpen, onClose }: ShortcutsDialogProps) {
  if (!isOpen) return null;

  const shortcuts = [
    { label: '선택 이동', keys: [<ArrowUp size={16} />, <ArrowDown size={16} />] },
    { label: '작업 순서 변경', keys: ['Alt', '+', <ArrowUp size={16} />, '/', <ArrowDown size={16} />] },
    { label: '들여쓰기 (하위 작업화)', keys: ['Tab'] },
    { label: '내어쓰기 (상위 작업화)', keys: ['Shift', '+', 'Tab'] },
    { label: '동일 레벨 아래 추가', keys: ['Enter'] },
    { label: '작업 수정', keys: ['F2'] },
    { label: '작업 삭제', keys: ['Delete'] },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-stone-100 rounded-lg text-stone-600">
              <Keyboard size={20} />
            </div>
            <h2 className="text-lg font-bold text-stone-800">키보드 단축키</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 p-1 hover:bg-stone-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-4 space-y-1">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between p-2 hover:bg-stone-50 rounded-lg group">
              <span className="text-sm font-medium text-stone-600 group-hover:text-stone-900">{shortcut.label}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, kIndex) => (
                  <React.Fragment key={kIndex}>
                    {typeof key === 'string' ? (
                      <span className="px-2 py-1 min-w-[24px] text-center text-xs font-bold text-stone-600 bg-white border border-stone-200 rounded shadow-sm">
                        {key}
                      </span>
                    ) : (
                      <span className="px-2 py-1 min-w-[24px] flex items-center justify-center text-stone-600 bg-white border border-stone-200 rounded shadow-sm">
                        {key}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
        
        <div className="p-4 bg-stone-50 border-t border-stone-100 text-xs text-stone-500 text-center">
          단축키는 작업 목록이 활성화되어 있고 필터가 적용되지 않은 상태에서 사용할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
