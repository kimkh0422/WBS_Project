import React from 'react';
import { Keyboard, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X } from 'lucide-react';

export function ShortcutsSidebar({ onClose }: { onClose?: () => void }) {
  type KeyToken = string | React.ReactNode;
  type Shortcut = { label: string; keys: KeyToken[]; hint?: string };
  type Section = { title: string; items: Shortcut[] };

  const sections: Section[] = [
    {
      title: '뷰 전환',
      items: [{ label: '대시보드 / 투입 / 표+간트 / 표 / 간트 / 칸반 / 마인드맵', keys: ['Alt', '1~7'], hint: '뷰 순서대로 1~7 매핑' }],
    },
    {
      title: '공통',
      items: [
        { label: '되돌리기', keys: ['Ctrl', 'Z'] },
        { label: '다시 실행', keys: ['Ctrl', 'Y'] },
        { label: '즉시 서버 반영', keys: ['Ctrl', 'S'], hint: '자동 저장 대기 없이 업로드' },
        { label: '레벨 펼치기', keys: ['Ctrl', 'Alt', '1~9'], hint: '1~9 레벨로 트리 펼치기' },
        { label: '줄높이 높이기 / 낮추기', keys: ['Ctrl', '+ / -'] },
        { label: '단축키 사이드바 토글', keys: ['?'] },
      ],
    },
    {
      title: '표 (WBS)',
      items: [
        {
          label: '행 포커스 이동',
          keys: [<ArrowUp size={14} key="up" />, '/', <ArrowDown size={14} key="down" />],
          hint: '노란색 강조만 이동 (체크 X)',
        },
        {
          label: '하위 접기 / 펼치기',
          keys: [<ArrowLeft size={14} key="left" />, '/', <ArrowRight size={14} key="right" />],
          hint: '트리 뷰일 때만 동작',
        },
        { label: '체크박스 토글', keys: ['Space'] },
        {
          label: '작업 순서 변경',
          keys: ['Alt', <ArrowUp size={14} key="alt-up" />, '/', <ArrowDown size={14} key="alt-down" />],
          hint: 'WBS 정렬·필터 없는 상태에서만',
        },
        { label: '레벨 내리기 / 올리기', keys: ['Tab', '/', 'Shift+Tab'] },
        { label: '동일 레벨 아래 / 위 추가', keys: ['Enter', '/', 'Shift+Enter'] },
        { label: '작업 수정(인라인)', keys: ['F2'] },
        { label: '작업 삭제', keys: ['Delete'] },
        { label: '복사 / 잘라내기 / 붙여넣기', keys: ['Ctrl', 'C / X / V'] },
        { label: '전체 선택', keys: ['Ctrl', 'A'] },
        { label: '편집·선택 해제', keys: ['Esc'] },
      ],
    },
    {
      title: '간트',
      items: [{ label: '확대 / 축소', keys: ['+', '/', '-'], hint: '입력창 포커스 없을 때' }],
    },
  ];

  const KeyCap = ({ children }: { children: React.ReactNode }) => (
    <kbd className="px-2 py-1 min-w-[26px] inline-flex items-center justify-center text-[11px] font-black text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm leading-none">
      {children}
    </kbd>
  );

  const ShortcutRow = ({ shortcut }: { shortcut: Shortcut }) => (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-start py-2">
      <div className="min-w-0">
        <div className="text-[12px] font-bold text-slate-700 whitespace-normal break-keep leading-snug">{shortcut.label}</div>
        {shortcut.hint && <div className="text-[10px] text-slate-400 leading-snug mt-0.5">{shortcut.hint}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {shortcut.keys.map((token, idx) => (
          <React.Fragment key={idx}>
            <KeyCap>{token}</KeyCap>
            {idx < shortcut.keys.length - 1 && <span className="text-[10px] font-black text-slate-300 px-0.5 select-none">+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col h-full overflow-hidden">
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

      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {sections.map((section) => (
          <div key={section.title} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
              <div className="text-[11px] font-black text-slate-500 uppercase tracking-wider">{section.title}</div>
            </div>
            <div className="px-3 divide-y divide-slate-100">
              {section.items.map((shortcut) => (
                <React.Fragment key={shortcut.label}>
                  <ShortcutRow shortcut={shortcut} />
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 bg-slate-100/50 border-t border-slate-200">
        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">※ 입력창(텍스트/날짜 등)에 포커스가 없을 때 동작합니다.</p>
      </div>
    </div>
  );
}
