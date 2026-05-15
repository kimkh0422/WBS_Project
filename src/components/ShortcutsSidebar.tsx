import React, { useMemo } from 'react';
import { Keyboard, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, X } from 'lucide-react';

/** App.tsx `view`와 동일 — 단축키 안내 분기용 */
export type ShortcutsContextView =
  | 'table'
  | 'tablegantt'
  | 'gantt'
  | 'kanban'
  | 'mindmap'
  | 'dashboard'
  | 'projects'
  | 'allocation'
  | 'guide';

type KeyToken = string | React.ReactNode;
type Shortcut = { label: string; keys: KeyToken[]; hint?: string };
type Section = { title: string; items: Shortcut[] };

export function ShortcutsSidebar({ view, onClose }: { view: ShortcutsContextView; onClose?: () => void }) {
  const sections = useMemo((): Section[] => {
    const commonItems: Shortcut[] = [
      { label: '되돌리기 · 다시 실행', keys: ['Ctrl+Z', 'Ctrl+Y'] },
      { label: '레벨 펼치기', keys: ['Ctrl', 'Alt', '1~9'] },
      { label: '이 패널', keys: ['Shift', '?'] },
    ];

    const rowHeightItem: Shortcut = { label: '줄높이 ±', keys: ['Ctrl', '+ / -'] };
    const showRowHeight = view === 'table' || view === 'tablegantt' || view === 'gantt';

    const wbsTableSection: Section = {
      title: '표 (WBS)',
      items: [
        {
          label: '행 포커스 ↑↓',
          keys: [<ArrowUp size={12} key="up" />, '/', <ArrowDown size={12} key="down" />],
        },
        {
          label: '트리 접기·펼치기',
          keys: ['Shift', <ArrowLeft size={12} key="left" />, '/', <ArrowRight size={12} key="right" />],
        },
        { label: '체크 토글', keys: ['Space'] },
        {
          label: '순서 변경',
          keys: ['Alt', <ArrowUp size={12} key="au" />, '/', <ArrowDown size={12} key="ad" />],
        },
        { label: '레벨 내리기·올리기', keys: ['Tab', '/', 'Shift+Tab'] },
        { label: '형제 아래·위 추가', keys: ['Enter', '/', 'Shift+Enter'] },
        { label: '인라인 수정', keys: ['F2'] },
        { label: '삭제', keys: ['Del'] },
        { label: '편집·선택 해제', keys: ['Esc'] },
      ],
    };

    const ganttItems: Shortcut[] =
      view === 'gantt'
        ? [
            {
              label: '활성 행 ↑↓',
              keys: [<ArrowUp size={12} key="gu" />, '/', <ArrowDown size={12} key="gd" />],
              hint: '(간트에 포커스)',
            },
            { label: '확대·축소', keys: ['+', '/', '-'] },
          ]
        : [{ label: '확대·축소', keys: ['+', '/', '-'] }];

    const ganttSection: Section = {
      title: '간트',
      items: ganttItems,
    };

    const mindmapSection: Section = {
      title: '마인드맵',
      items: [
        { label: '부모 · 자식', keys: [<ArrowUp size={12} key="mu" />, '/', <ArrowDown size={12} key="md" />] },
        {
          label: '이전·다음 형제',
          keys: [<ArrowLeft size={12} key="ml" />, '/', <ArrowRight size={12} key="mr" />],
        },
        { label: '자식 추가 · 상위로', keys: ['Tab', '/', 'Shift+Tab'] },
        { label: '가지 접기·펼치기', keys: ['Space'], hint: '(자식 있을 때)' },
        { label: '첫 노드 · 끝 노드', keys: ['Home', '/', 'End'] },
        { label: '인라인 이름', keys: ['F2'] },
        { label: '상세 편집', keys: ['Enter'] },
        { label: '자식 작업 추가', keys: ['Ctrl', 'Enter'] },
        { label: '삭제 확인', keys: ['Del'] },
        { label: '선택 해제', keys: ['Esc'] },
      ],
    };

    const out: Section[] = [
      {
        title: '공통',
        items: showRowHeight ? [...commonItems.slice(0, 2), rowHeightItem, ...commonItems.slice(2)] : commonItems,
      },
    ];

    if (view === 'table' || view === 'tablegantt') {
      out.push(wbsTableSection);
    }
    if (view === 'gantt') {
      out.push(ganttSection);
    }
    if (view === 'mindmap') {
      out.push(mindmapSection);
    }

    return out;
  }, [view]);

  const KeyCap = ({ children }: { children: React.ReactNode }) => (
    <kbd className="px-1.5 py-0.5 min-w-[20px] inline-flex items-center justify-center text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded shadow-sm leading-none shrink-0">
      {children}
    </kbd>
  );

  const ShortcutRow = ({ shortcut }: { shortcut: Shortcut }) => (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 flex-1">
        <span className="text-[10px] font-semibold text-slate-700 leading-tight break-keep">{shortcut.label}</span>
        {shortcut.hint && <span className="text-[9px] text-slate-400 ml-1">{shortcut.hint}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-0.5 shrink-0 max-w-[52%]">
        {shortcut.keys.map((token, idx) => (
          <React.Fragment key={idx}>
            <KeyCap>{token}</KeyCap>
            {idx < shortcut.keys.length - 1 && <span className="text-[9px] font-bold text-slate-300 px-0.5 select-none">+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  const footerHint =
    view === 'dashboard' || view === 'projects' || view === 'allocation' || view === 'guide'
      ? '※ 이 화면은 주로 마우스·터치로 조작합니다. 전역 단축키(되돌리기 등)는 입력 포커스에 따라 다릅니다.'
      : '※ 입력 포커스 없을 때 · 트리/정렬 등 일부는 조건부 동작';

  return (
    <div className="w-72 shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center gap-2 shrink-0">
        <Keyboard size={14} className="text-slate-500 shrink-0" />
        <h2 className="text-xs font-bold text-slate-700 flex-1">키보드 단축키</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors shrink-0"
            title="닫기"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-2 space-y-2">
        {sections.map((section) => (
          <div key={section.title} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-2 py-1 bg-slate-50 border-b border-slate-200">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{section.title}</div>
            </div>
            <div className="px-2">
              {section.items.map((shortcut) => (
                <React.Fragment key={shortcut.label}>
                  <ShortcutRow shortcut={shortcut} />
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 bg-slate-100/50 border-t border-slate-200 shrink-0">
        <p className="text-[9px] text-slate-500 leading-snug font-medium">{footerHint}</p>
      </div>
    </div>
  );
}
