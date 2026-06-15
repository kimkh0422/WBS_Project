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

type KeyPart = string | React.ReactNode;
/** 동시에 누르는 키 (+ 로 연결) */
type KeyChord = KeyPart[];
type Shortcut = { label: string; chords: KeyChord | KeyChord[]; hint?: string };
type Section = { title: string; items: Shortcut[] };

function normalizeChords(chords: KeyChord | KeyChord[]): KeyChord[] {
  if (chords.length === 0) return [];
  if (Array.isArray(chords[0])) return chords as KeyChord[];
  return [chords as KeyChord];
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="min-h-[22px] min-w-[22px] px-1.5 inline-flex items-center justify-center text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-md shadow-[0_1px_0_rgba(15,23,42,0.08)] leading-none shrink-0">
      {children}
    </kbd>
  );
}

function KeyChordDisplay({ chord }: { chord: KeyChord }) {
  return (
    <span className="inline-flex items-center gap-1">
      {chord.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="text-[10px] font-medium text-slate-400 select-none" aria-hidden>
              +
            </span>
          )}
          <KeyCap>{part}</KeyCap>
        </React.Fragment>
      ))}
    </span>
  );
}

function KeysDisplay({ chords }: { chords: KeyChord | KeyChord[] }) {
  const list = normalizeChords(chords);
  if (list.length === 1) {
    return (
      <span className="inline-flex justify-end">
        <KeyChordDisplay chord={list[0]} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {list.map((chord, i) => (
        <KeyChordDisplay key={i} chord={chord} />
      ))}
    </span>
  );
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  const hasAlternatives = normalizeChords(shortcut.chords).length > 1;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5 border-b border-slate-100 last:border-b-0 ${
        hasAlternatives ? 'items-start' : 'items-center'
      }`}
    >
      <div className={`min-w-0 ${hasAlternatives ? 'pt-0.5' : ''}`}>
        <span className="text-[11px] font-medium text-slate-700 leading-snug">{shortcut.label}</span>
        {shortcut.hint && <span className="block text-[10px] text-slate-400 mt-0.5 leading-tight">{shortcut.hint}</span>}
      </div>
      <KeysDisplay chords={shortcut.chords} />
    </div>
  );
}

export function ShortcutsSidebar({
  view,
  onClose,
  onNeverShow,
}: {
  view: ShortcutsContextView;
  /** 이번만 닫기 — 세션 동안만 닫힘. 새로고침 시 다시 표시 */
  onClose?: () => void;
  /** 다시 보지 않기 — 다음 접속부터 자동 표시 안 함(메뉴·Shift+? 로는 다시 열 수 있음) */
  onNeverShow?: () => void;
}) {
  const sections = useMemo((): Section[] => {
    const commonItems: Shortcut[] = [
      { label: '되돌리기', chords: ['Ctrl', 'Z'] },
      { label: '다시 실행', chords: ['Ctrl', 'Y'] },
      { label: '레벨 펼치기', chords: ['Ctrl', 'Alt', '1~9'] },
      { label: '관리자 메뉴 표시', chords: ['Shift', 'F12'], hint: '헤더 우클릭: 보완 가이드·컬럼 설정' },
      { label: '이 패널', chords: ['Shift', '?'] },
    ];

    const rowHeightItem: Shortcut = {
      label: '줄높이',
      chords: [
        ['Ctrl', '+'],
        ['Ctrl', '-'],
      ],
    };
    const showRowHeight = view === 'table' || view === 'tablegantt' || view === 'gantt';

    const wbsTableSection: Section = {
      title: '표 (WBS)',
      items: [
        {
          label: '셀 이동 (← → ↑ ↓)',
          chords: [
            [<ArrowLeft size={12} key="cellL" />],
            [<ArrowRight size={12} key="cellR" />],
            [<ArrowUp size={12} key="cellU" />],
            [<ArrowDown size={12} key="cellD" />],
          ],
          hint: 'Shift+화살표: 셀 직사각형 다중 선택(마퀴) 확장. Shift+Ctrl/Meta+화살표: 마퀴를 해당 방향 격자 끝까지 확장. Ctrl/Meta+화살표(Shift 없음): 커서만 같은 열·행의 표시 끝으로 점프. 화살표만: 한 칸 이동·마퀴 해제. Alt+↑↓: 표시 순서 이동(정렬·필터 없을 때만)',
        },
        {
          label: '트리 접기 · 펼치기',
          chords: [['작업명 열', '▾', '/', '▸']],
          hint: 'Shift+←/→는 셀 이동에 사용됩니다. 접기·펼치기는 트리 모드에서 행 왼쪽 버튼으로 하세요',
        },
        { label: '체크 토글', chords: ['Space'], hint: '다중 셀(마퀴) 선택 중이면 해당 행 전부 체크 선택' },
        {
          label: '복사 · 붙여넣기',
          chords: [
            ['Ctrl', 'C'],
            ['Ctrl', 'V'],
          ],
          hint: '값 셀은 셀 값 복사 → 이동 후 그 셀에 붙여넣기(체크한 여러 행엔 일괄). 작업명 셀·체크 선택은 행 단위 복사(하위·선행 유지)',
        },
        {
          label: '순서 변경',
          chords: [
            ['Alt', <ArrowUp size={12} key="au" />],
            ['Alt', <ArrowDown size={12} key="ad" />],
          ],
        },
        {
          label: '레벨 내리기 · 올리기',
          chords: ['Tab', ['Shift', 'Tab']],
        },
        {
          label: '형제 아래 · 위 새 작업',
          chords: ['Enter', ['Shift', 'Enter']],
          hint: '작업명 인라인 입력 중이 아닐 때',
        },
        { label: '작업명 편집 저장·닫기', chords: ['Enter'], hint: 'F2 인라인 편집 중' },
        { label: '인라인 수정', chords: ['F2'] },
        {
          label: '타이핑 즉시 편집',
          chords: [['A'], ['1']],
          hint: '셀 선택 후 영문·숫자를 치면 바로 입력(날짜·공수·진척 등 대체). 한글 텍스트는 클릭 또는 F2 후 입력',
        },
        { label: '삭제', chords: ['Del'] },
        { label: '편집 · 선택 해제', chords: ['Esc'] },
      ],
    };

    const ganttItems: Shortcut[] =
      view === 'gantt'
        ? [
            {
              label: '활성 행',
              chords: [[<ArrowUp size={12} key="gu" />], [<ArrowDown size={12} key="gd" />]],
              hint: '간트에 포커스할 때',
            },
            {
              label: '확대 · 축소',
              chords: [['+'], ['-']],
            },
          ]
        : [
            {
              label: '확대 · 축소',
              chords: [['+'], ['-']],
            },
          ];

    const ganttSection: Section = {
      title: '간트',
      items: ganttItems,
    };

    const mindmapSection: Section = {
      title: '마인드맵',
      items: [
        {
          label: '부모 · 자식',
          chords: [[<ArrowUp size={12} key="mu" />], [<ArrowDown size={12} key="md" />]],
        },
        {
          label: '이전 · 다음 형제',
          chords: [[<ArrowLeft size={12} key="ml" />], [<ArrowRight size={12} key="mr" />]],
        },
        {
          label: '자식 추가 · 상위로',
          chords: ['Tab', ['Shift', 'Tab']],
        },
        { label: '가지 접기 · 펼치기', chords: ['Space'], hint: '자식이 있을 때' },
        {
          label: '첫 노드 · 끝 노드',
          chords: ['Home', 'End'],
        },
        { label: '인라인 이름', chords: ['F2'] },
        { label: '상세 편집', chords: ['Enter'] },
        { label: '자식 작업 추가', chords: ['Ctrl', 'Enter'] },
        { label: '삭제 확인', chords: ['Del'] },
        { label: '선택 해제', chords: ['Esc'] },
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

  const footerHint =
    view === 'dashboard' || view === 'projects' || view === 'allocation' || view === 'guide'
      ? '※ 이 화면은 주로 마우스·터치로 조작합니다. 전역 단축키(되돌리기 등)는 입력 포커스에 따라 다릅니다.'
      : '※ 입력 포커스 없을 때 · 트리/정렬 등 일부는 조건부 동작';

  return (
    <div className="w-80 max-w-[min(20rem,100vw)] shrink-0 border-l border-slate-200 bg-slate-50/60 flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-white flex items-center gap-2 shrink-0">
        <Keyboard size={15} className="text-slate-500 shrink-0" />
        <h2 className="text-sm font-bold text-slate-800 flex-1">키보드 단축키</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors shrink-0"
            title="이번만 닫기 — 새로고침 시 다시 표시합니다"
            aria-label="단축키 패널 이번만 닫기"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
        {sections.map((section) => (
          <div key={section.title} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
              <div className="text-[11px] font-bold text-slate-500 tracking-wide">{section.title}</div>
            </div>
            <div className="px-2.5 py-0.5">
              {section.items.map((shortcut) => (
                <ShortcutRow key={shortcut.label} shortcut={shortcut} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2.5 bg-slate-100/50 border-t border-slate-200 shrink-0 space-y-2">
        <p className="text-[10px] text-slate-500 leading-relaxed">{footerHint}</p>
        {onNeverShow && (
          <button
            type="button"
            onClick={onNeverShow}
            className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline"
            title="다음 접속부터 이 패널을 자동으로 띄우지 않습니다. 메뉴 → 「단축키」 또는 Shift+? 로 언제든 다시 열 수 있어요."
          >
            다시 보지 않기
          </button>
        )}
      </div>
    </div>
  );
}
