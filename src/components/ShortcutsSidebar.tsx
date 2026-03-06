import React from 'react';
import { Keyboard, ArrowUp, ArrowDown, X } from 'lucide-react';

export function ShortcutsSidebar({ onClose }: { onClose?: () => void }) {
    const shortcuts = [
        { label: '선택 이동', keys: [<ArrowUp size={14} key="up" />, <ArrowDown size={14} key="down" />] },
        { label: '작업 순서 변경', keys: ['Alt', '+', <ArrowUp size={14} key="alt-up" />, '/', <ArrowDown size={14} key="alt-down" />] },
        { label: '들여쓰기', keys: ['Tab'] },
        { label: '내어쓰기', keys: ['Shift', '+', 'Tab'] },
        { label: '동일 레벨 아래 추가', keys: ['Enter'] },
        { label: '작업 수정', keys: ['F2'] },
        { label: '작업 삭제', keys: ['Delete'] },
        { label: '복사', keys: ['Ctrl', '+', 'C'] },
        { label: '붙여넣기', keys: ['Ctrl', '+', 'V'] },
        { label: '전체 선택', keys: ['Ctrl', '+', 'A'] },
        { label: '레벨 펼치기', keys: ['Ctrl', '+', 'Alt', '+', '1~9'] },
        { label: '간트 확대', keys: ['+'] },
        { label: '간트 축소', keys: ['-'] },
    ];

    return (
        <div className="w-64 shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-2">
                <Keyboard size={16} className="text-slate-500" />
                <h2 className="text-sm font-bold text-slate-700 flex-1">키보드 단축키</h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                        title="닫기"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                {shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex flex-col gap-1.5 p-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight">{shortcut.label}</span>
                        <div className="flex flex-wrap items-center gap-1">
                            {shortcut.keys.map((key, kIndex) => (
                                <React.Fragment key={kIndex}>
                                    {typeof key === 'string' ? (
                                        <span className="px-1.5 py-0.5 min-w-[20px] text-center text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded-md shadow-sm">
                                            {key}
                                        </span>
                                    ) : (
                                        <span className="px-1.5 py-0.5 min-w-[20px] flex items-center justify-center text-slate-600 bg-slate-50 border border-slate-200 rounded-md shadow-sm">
                                            {key}
                                        </span>
                                    )}
                                    {kIndex < shortcut.keys.length - 1 && shortcut.keys[kIndex + 1] === '+' && (
                                        <span className="text-[10px] text-stone-400"></span>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-4 bg-slate-100/50 border-t border-slate-200">
                <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                    ※ 표/간트 화면에서 입력창 포커스가 아닐 때 동작
                </p>
            </div>
        </div>
    );
}
