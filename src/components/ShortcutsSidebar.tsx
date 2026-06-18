import React from 'react';
import { Keyboard, ArrowUp, ArrowDown, X, CheckSquare, ArrowUpDown, IndentIncrease, Trash2, Undo2 } from 'lucide-react';

/** App.tsx `view`와 동일 — 단축키 안내 분기용(호환 유지) */
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
type KeyChord = KeyPart[];

type CoreShortcut = {
  label: string;
  chords: KeyChord | KeyChord[];
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: 'accent' | 'neutral' | 'danger';
};

const CORE_SHORTCUTS: CoreShortcut[] = [
  {
    label: '체크 토글',
    chords: ['Space'],
    hint: '선택 행·범위의 완료 체크를 켜거나 끕니다',
    icon: CheckSquare,
    tone: 'accent',
  },
  {
    label: '순서 변경',
    chords: [
      ['Alt', <ArrowUp size={13} key="au" />],
      ['Alt', <ArrowDown size={13} key="ad" />],
    ],
    hint: '정렬·필터가 없을 때 형제 간 위·아래로 이동',
    icon: ArrowUpDown,
    tone: 'accent',
  },
  {
    label: '레벨 내리기 · 올리기',
    chords: ['Tab', ['Shift', 'Tab']],
    hint: '하위 작업으로 들여쓰기 · 상위로 내어쓰기',
    icon: IndentIncrease,
    tone: 'accent',
  },
  {
    label: '삭제',
    chords: ['Del'],
    hint: '선택한 작업을 삭제합니다',
    icon: Trash2,
    tone: 'danger',
  },
  {
    label: '편집 · 선택 해제',
    chords: ['Esc'],
    hint: '인라인 편집을 닫거나 셀·행 선택을 해제합니다',
    icon: Undo2,
    tone: 'neutral',
  },
];

function normalizeChords(chords: KeyChord | KeyChord[]): KeyChord[] {
  if (chords.length === 0) return [];
  if (Array.isArray(chords[0])) return chords as KeyChord[];
  return [chords as KeyChord];
}

function KeyCap({ children, emphasized }: { children: React.ReactNode; emphasized?: boolean }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center leading-none shrink-0 font-bold rounded-lg border shadow-sm ${
        emphasized
          ? 'min-h-[28px] min-w-[28px] px-2 text-[12px] text-[var(--color-accent)] bg-[var(--color-accent-soft)] border-[var(--color-accent)]/35 shadow-[0_2px_0_rgba(79,70,229,0.12)]'
          : 'min-h-[22px] min-w-[22px] px-1.5 text-[11px] text-slate-700 bg-white border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.08)]'
      }`}
    >
      {children}
    </kbd>
  );
}

function KeyChordDisplay({ chord, emphasized }: { chord: KeyChord; emphasized?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {chord.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span
              className={`font-semibold select-none ${emphasized ? 'text-[var(--color-accent)]/60 text-xs' : 'text-[10px] text-slate-400'}`}
              aria-hidden
            >
              +
            </span>
          )}
          <KeyCap emphasized={emphasized}>{part}</KeyCap>
        </React.Fragment>
      ))}
    </span>
  );
}

function KeysDisplay({ chords, emphasized }: { chords: KeyChord | KeyChord[]; emphasized?: boolean }) {
  const list = normalizeChords(chords);
  if (list.length === 1) {
    return (
      <span className="inline-flex justify-end">
        <KeyChordDisplay chord={list[0]} emphasized={emphasized} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1.5">
      {list.map((chord, i) => (
        <KeyChordDisplay key={i} chord={chord} emphasized={emphasized} />
      ))}
    </span>
  );
}

const TONE_STYLES = {
  accent: {
    card: 'border-[var(--color-accent)]/25 bg-gradient-to-br from-[var(--color-accent-soft)] to-white shadow-[0_1px_0_rgba(79,70,229,0.06),inset_3px_0_0_var(--color-accent)]',
    icon: 'bg-[var(--color-accent)] text-white shadow-sm',
    label: 'text-[var(--color-ink)]',
  },
  danger: {
    card: 'border-[var(--color-danger)]/25 bg-gradient-to-br from-[var(--color-danger-soft)] to-white shadow-[0_1px_0_rgba(239,68,68,0.06),inset_3px_0_0_var(--color-danger)]',
    icon: 'bg-[var(--color-danger)] text-white shadow-sm',
    label: 'text-[var(--color-ink)]',
  },
  neutral: {
    card: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white shadow-[0_1px_0_rgba(15,23,42,0.04),inset_3px_0_0_#94A3B8]',
    icon: 'bg-slate-600 text-white shadow-sm',
    label: 'text-[var(--color-ink)]',
  },
} as const;

function CoreShortcutCard({ shortcut }: { shortcut: CoreShortcut }) {
  const styles = TONE_STYLES[shortcut.tone];
  const Icon = shortcut.icon;
  const hasAlternatives = normalizeChords(shortcut.chords).length > 1;

  return (
    <div className={`rounded-xl border p-3 transition-colors ${styles.card}`}>
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 ${hasAlternatives ? 'items-start' : 'items-center'}`}>
        <div className={`flex gap-2.5 min-w-0 ${hasAlternatives ? 'pt-0.5' : ''}`}>
          <div className={`shrink-0 w-8 h-8 rounded-lg inline-flex items-center justify-center ${styles.icon}`}>
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <div className={`text-[13px] font-bold leading-snug ${styles.label}`}>{shortcut.label}</div>
            {shortcut.hint && <p className="text-[10px] text-[var(--color-ink-muted)] mt-1 leading-relaxed">{shortcut.hint}</p>}
          </div>
        </div>
        <KeysDisplay chords={shortcut.chords} emphasized />
      </div>
    </div>
  );
}

export function ShortcutsSidebar({
  onClose,
  onNeverShow,
}: {
  view?: ShortcutsContextView;
  /** 이번만 닫기 — 세션 동안만 닫힘. 새로고침 시 다시 표시 */
  onClose?: () => void;
  /** 다시 보지 않기 — 다음 접속부터 자동 표시 안 함(메뉴·Shift+? 로는 다시 열 수 있음) */
  onNeverShow?: () => void;
}) {
  return (
    <div className="w-80 max-w-[min(20rem,100vw)] shrink-0 border-l border-[var(--color-line)] bg-[var(--color-bg)] flex flex-col h-full overflow-hidden">
      <div className="px-3 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] inline-flex items-center justify-center shrink-0">
          <Keyboard size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-[var(--color-ink)] leading-tight">핵심 단축키</h2>
          <p className="text-[10px] text-[var(--color-ink-muted)] mt-0.5">WBS 표에서 자주 쓰는 조작</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--color-line-soft)] rounded-lg text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors shrink-0"
            title="이번만 닫기 — 새로고침 시 다시 표시합니다"
            aria-label="단축키 패널 이번만 닫기"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {CORE_SHORTCUTS.map((shortcut) => (
          <CoreShortcutCard key={shortcut.label} shortcut={shortcut} />
        ))}
      </div>

      <div className="px-3 py-2.5 bg-[var(--color-line-soft)]/80 border-t border-[var(--color-line)] shrink-0 space-y-2">
        <p className="text-[10px] text-[var(--color-ink-muted)] leading-relaxed">
          ※ 셀·행이 선택된 상태에서 동작합니다. 입력란에 포커스가 있으면 일부 단축키가 비활성화됩니다.
        </p>
        {onNeverShow && (
          <button
            type="button"
            onClick={onNeverShow}
            className="text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline"
            title="다음 접속부터 이 패널을 자동으로 띄우지 않습니다. 메뉴 → 「단축키」 또는 Shift+? 로 언제든 다시 열 수 있어요."
          >
            다시 보지 않기
          </button>
        )}
      </div>
    </div>
  );
}
