import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Tag,
  Calendar as CalendarIcon,
  CheckSquare,
  Plus,
  Trash2,
  Pencil,
  Check,
  ChevronDown,
  AlignLeft,
  Clock,
  Square,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  PERSONAL_TODO_COLUMNS,
  PERSONAL_TODO_LABEL_COLORS,
  type PersonalTodo,
  type PersonalTodoLabel,
  type PersonalTodoLabelColor,
  type PersonalTodoPatch,
  type PersonalTodoRow,
  type PersonalTodoStatus,
} from '../lib/db/personalTodos';

/** 라벨 팔레트 → 실제 색상 클래스. 다크 모드에서도 가시성이 충분하도록 채도 높은 색으로. */
const LABEL_PALETTE: Record<PersonalTodoLabelColor, { bg: string; text: string; ring: string; dot: string }> = {
  green: { bg: 'bg-emerald-500', text: 'text-white', ring: 'ring-emerald-300', dot: 'bg-emerald-500' },
  yellow: { bg: 'bg-amber-400', text: 'text-amber-950', ring: 'ring-amber-300', dot: 'bg-amber-400' },
  orange: { bg: 'bg-orange-500', text: 'text-white', ring: 'ring-orange-300', dot: 'bg-orange-500' },
  red: { bg: 'bg-rose-500', text: 'text-white', ring: 'ring-rose-300', dot: 'bg-rose-500' },
  purple: { bg: 'bg-violet-500', text: 'text-white', ring: 'ring-violet-300', dot: 'bg-violet-500' },
  blue: { bg: 'bg-blue-600', text: 'text-white', ring: 'ring-blue-300', dot: 'bg-blue-600' },
  sky: { bg: 'bg-sky-500', text: 'text-white', ring: 'ring-sky-300', dot: 'bg-sky-500' },
  pink: { bg: 'bg-pink-500', text: 'text-white', ring: 'ring-pink-300', dot: 'bg-pink-500' },
  gray: { bg: 'bg-slate-500', text: 'text-white', ring: 'ring-slate-300', dot: 'bg-slate-500' },
};

export function getLabelPalette(color: PersonalTodoLabelColor) {
  return LABEL_PALETTE[color] ?? LABEL_PALETTE.gray;
}

/** ISO 날짜를 YYYY-MM-DD(로컬)로. <input type="date"> 값으로 사용. */
function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD(로컬) → 그날 23:59 ISO. 마감일은 그날까지 라는 의미로 끝 시각 기준. */
function fromDateInputValue(v: string): string | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map((s) => Number(s));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 23, 59, 0, 0);
  return dt.toISOString();
}

/** ISO → "2026-06-15 (오늘/내일/3일 후/3일 지남)" 형태의 사람이 읽기 좋은 표시. */
function formatDueLabel(iso: string | null): { text: string; tone: 'past' | 'today' | 'soon' | 'future' | 'none' } {
  if (!iso) return { text: '', tone: 'none' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: '', tone: 'none' };
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dayDiff = Math.round((startOf(d).getTime() - startOf(now).getTime()) / 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${day}`;
  if (dayDiff < 0) return { text: `${dateStr} · ${-dayDiff}일 지남`, tone: 'past' };
  if (dayDiff === 0) return { text: `${dateStr} · 오늘`, tone: 'today' };
  if (dayDiff === 1) return { text: `${dateStr} · 내일`, tone: 'soon' };
  if (dayDiff <= 3) return { text: `${dateStr} · ${dayDiff}일 후`, tone: 'soon' };
  return { text: dateStr, tone: 'future' };
}

interface PersonalTodoDetailModalProps {
  todo: PersonalTodo;
  /** 사용자가 정의한 라벨 전체 목록(드롭다운에서 토글). */
  labels: PersonalTodoLabel[];
  /** 행(스윔레인) 정보 — 카드가 속한 행 이름 표시용. */
  rows: PersonalTodoRow[];
  onClose: () => void;
  onPatch: (patch: PersonalTodoPatch) => Promise<void> | void;
  onAttachLabel: (labelId: string) => Promise<void> | void;
  onDetachLabel: (labelId: string) => Promise<void> | void;
  onCreateLabel: (input: { title: string; color: PersonalTodoLabelColor }) => Promise<PersonalTodoLabel>;
  onUpdateLabel: (id: string, patch: { title?: string; color?: PersonalTodoLabelColor }) => Promise<void> | void;
  onDeleteLabel: (id: string) => Promise<void> | void;
  onAddChecklist: (text: string) => Promise<void> | void;
  onUpdateChecklist: (id: string, patch: { text?: string; done?: boolean }) => Promise<void> | void;
  onDeleteChecklist: (id: string) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function PersonalTodoDetailModal({
  todo,
  labels,
  rows,
  onClose,
  onPatch,
  onAttachLabel,
  onDetachLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
  onAddChecklist,
  onUpdateChecklist,
  onDeleteChecklist,
  onDelete,
}: PersonalTodoDetailModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ─── 제목 인라인 편집 ───
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [editingTitle, setEditingTitle] = useState(false);
  useEffect(() => {
    setTitleDraft(todo.title);
  }, [todo.id, todo.title]);

  // ─── 설명(note) 인라인 편집 ───
  const [noteDraft, setNoteDraft] = useState(todo.note);
  const [editingNote, setEditingNote] = useState(false);
  useEffect(() => {
    setNoteDraft(todo.note);
  }, [todo.id, todo.note]);

  // ─── 상태 드롭다운 ───
  const [statusOpen, setStatusOpen] = useState(false);

  // ─── 패널 토글: 라벨/마감일/체크리스트 ───
  const [labelOpen, setLabelOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // ─── 라벨 패널: 새 라벨 만들기/수정 ───
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelTitle, setNewLabelTitle] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<PersonalTodoLabelColor>('green');

  // ─── 체크리스트 추가 ───
  const [addingChk, setAddingChk] = useState(false);
  const [newChkText, setNewChkText] = useState('');

  // ─── 카드 삭제 확인 ───
  const [confirmDel, setConfirmDel] = useState(false);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const saveTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== todo.title) void onPatch({ title: t });
    setEditingTitle(false);
  };
  const saveNote = () => {
    if (noteDraft !== todo.note) void onPatch({ note: noteDraft });
    setEditingNote(false);
  };

  const attachedLabels = useMemo(() => {
    const map = new Map(labels.map((l) => [l.id, l] as const));
    return todo.labelIds.map((id) => map.get(id)).filter(Boolean) as PersonalTodoLabel[];
  }, [labels, todo.labelIds]);

  const isAttached = useCallback((id: string) => todo.labelIds.includes(id), [todo.labelIds]);

  const chkCounts = useMemo(() => {
    const total = todo.checklist.length;
    const done = todo.checklist.filter((c) => c.done).length;
    return { total, done };
  }, [todo.checklist]);

  const rowLabel = useMemo(() => {
    if (!todo.rowId) return '기본';
    return rows.find((r) => r.id === todo.rowId)?.label || '(이름 없음)';
  }, [rows, todo.rowId]);

  const due = formatDueLabel(todo.dueDate);
  const statusInfo = PERSONAL_TODO_COLUMNS.find((c) => c.key === todo.status);

  const handleCreateLabel = async () => {
    const title = newLabelTitle.trim();
    try {
      await onCreateLabel({ title, color: newLabelColor });
      setNewLabelTitle('');
      setNewLabelColor('green');
      setCreatingLabel(false);
    } catch {
      /* onCreateLabel 측에서 에러 표시 */
    }
  };

  const submitNewChk = async () => {
    const t = newChkText.trim();
    if (!t) return;
    await onAddChecklist(t);
    setNewChkText('');
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl my-4 sm:my-0"
        role="dialog"
        aria-modal="true"
        aria-label="할일 상세"
      >
        {/* ─── 헤더 바: 상태 드롭다운 / 닫기 ─── */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setStatusOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
            >
              <span className={cn('size-2 rounded-full', statusDot(todo.status))} aria-hidden />
              {statusInfo?.label ?? '상태'}
              <ChevronDown size={13} />
            </button>
            {statusOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 min-w-[10rem] rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                {PERSONAL_TODO_COLUMNS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      if (c.key !== todo.status) void onPatch({ status: c.key });
                      setStatusOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-left hover:bg-slate-50',
                      c.key === todo.status && 'bg-indigo-50 text-indigo-700 font-semibold',
                    )}
                  >
                    <span className={cn('size-2 rounded-full', statusDot(c.key))} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
            title="닫기 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── 본문 ─── */}
        <div className="px-5 py-4 space-y-4">
          {/* 제목 */}
          <div>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTitle();
                  }
                  if (e.key === 'Escape') {
                    setTitleDraft(todo.title);
                    setEditingTitle(false);
                  }
                }}
                onBlur={saveTitle}
                className="w-full rounded-lg border border-indigo-200 px-2 py-1.5 text-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="할일 제목"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-lg font-bold text-slate-800 hover:bg-slate-50"
              >
                {todo.title || '(제목 없음)'}
              </button>
            )}
            <div className="mt-1 px-2 text-[11px] text-slate-500">
              <span>행: </span>
              <span className="font-medium text-slate-600">{rowLabel}</span>
            </div>
          </div>

          {/* 액션 버튼 행: + 라벨 / + 마감일 / + 체크리스트 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton
              icon={<Tag size={13} />}
              label="라벨"
              active={labelOpen}
              onClick={() => {
                setLabelOpen((v) => !v);
                setDateOpen(false);
              }}
            />
            <ActionButton
              icon={<CalendarIcon size={13} />}
              label="마감일"
              active={dateOpen}
              onClick={() => {
                setDateOpen((v) => !v);
                setLabelOpen(false);
              }}
            />
            <ActionButton
              icon={<CheckSquare size={13} />}
              label="체크리스트"
              active={addingChk}
              onClick={() => {
                setAddingChk(true);
                setLabelOpen(false);
                setDateOpen(false);
                setTimeout(() => {
                  const el = document.getElementById('chk-new-input');
                  if (el) (el as HTMLInputElement).focus();
                }, 30);
              }}
            />
          </div>

          {/* ─── 라벨 패널 ─── */}
          {labelOpen && (
            <Panel title="라벨" onClose={() => setLabelOpen(false)}>
              <div className="space-y-1">
                {labels.length === 0 && (
                  <p className="px-1 py-2 text-[12px] text-slate-500">아직 만든 라벨이 없습니다. 아래에서 새 라벨을 만들어 보세요.</p>
                )}
                {labels.map((l) => (
                  <LabelRow
                    key={l.id}
                    label={l}
                    checked={isAttached(l.id)}
                    onToggle={() => {
                      if (isAttached(l.id)) void onDetachLabel(l.id);
                      else void onAttachLabel(l.id);
                    }}
                    onSaveTitle={(title) => void onUpdateLabel(l.id, { title })}
                    onSaveColor={(color) => void onUpdateLabel(l.id, { color })}
                    onDelete={() => void onDeleteLabel(l.id)}
                  />
                ))}
              </div>

              {/* 새 라벨 만들기 */}
              <div className="mt-2 border-t border-slate-100 pt-2">
                {creatingLabel ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={newLabelTitle}
                      onChange={(e) => setNewLabelTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateLabel();
                        }
                        if (e.key === 'Escape') setCreatingLabel(false);
                      }}
                      placeholder="라벨 이름(선택)"
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    />
                    <ColorPicker value={newLabelColor} onChange={setNewLabelColor} />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCreatingLabel(false)}
                        className="px-2.5 py-1 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateLabel()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        <Check size={13} /> 만들기
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreatingLabel(true)}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Plus size={13} /> 새 라벨 만들기
                  </button>
                )}
              </div>
            </Panel>
          )}

          {/* ─── 마감일 패널 ─── */}
          {dateOpen && (
            <Panel title="마감일" onClose={() => setDateOpen(false)}>
              <div className="space-y-2">
                <input
                  type="date"
                  value={toDateInputValue(todo.dueDate)}
                  onChange={(e) => {
                    const next = fromDateInputValue(e.target.value);
                    void onPatch({ dueDate: next });
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                {todo.dueDate && (
                  <button
                    type="button"
                    onClick={() => void onPatch({ dueDate: null })}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-semibold rounded-lg text-rose-600 hover:bg-rose-50"
                  >
                    <X size={12} /> 마감일 지우기
                  </button>
                )}
              </div>
            </Panel>
          )}

          {/* ─── 부착된 라벨 표시 ─── */}
          {attachedLabels.length > 0 && (
            <Section icon={<Tag size={13} />} title="라벨">
              <div className="flex flex-wrap gap-1.5">
                {attachedLabels.map((l) => (
                  <span
                    key={l.id}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md',
                      getLabelPalette(l.color).bg,
                      getLabelPalette(l.color).text,
                    )}
                    title={l.title || l.color}
                  >
                    {l.title || ' '}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* ─── 마감일 표시 ─── */}
          {todo.dueDate && (
            <Section icon={<CalendarIcon size={13} />} title="마감일">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold',
                  due.tone === 'past' && 'bg-rose-100 text-rose-800',
                  due.tone === 'today' && 'bg-amber-100 text-amber-800',
                  due.tone === 'soon' && 'bg-yellow-50 text-yellow-800',
                  due.tone === 'future' && 'bg-slate-100 text-slate-700',
                )}
              >
                <CalendarIcon size={12} />
                {due.text}
              </span>
            </Section>
          )}

          {/* ─── 설명(note) ─── */}
          <Section icon={<AlignLeft size={13} />} title="설명">
            {editingNote ? (
              <div className="space-y-1.5">
                <textarea
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setNoteDraft(todo.note);
                      setEditingNote(false);
                    }
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      saveNote();
                    }
                  }}
                  rows={5}
                  placeholder="설명을 입력하세요(여러 줄 가능, Ctrl+Enter로 저장)"
                  className="w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNoteDraft(todo.note);
                      setEditingNote(false);
                    }}
                    className="px-2.5 py-1 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={saveNote}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    <Check size={13} /> 저장
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className={cn(
                  'block w-full whitespace-pre-wrap rounded-lg px-2 py-2 text-left text-[13px] hover:bg-slate-50',
                  todo.note ? 'text-slate-700' : 'text-slate-400 italic',
                )}
              >
                {todo.note || '설명을 추가하려면 클릭…'}
              </button>
            )}
          </Section>

          {/* ─── 체크리스트 ─── */}
          <Section
            icon={<CheckSquare size={13} />}
            title={`체크리스트${chkCounts.total ? ` (${chkCounts.done}/${chkCounts.total})` : ''}`}
            right={
              chkCounts.total > 0 && (
                <div className="flex-1 max-w-[14rem] ml-2">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${chkCounts.total ? Math.round((chkCounts.done / chkCounts.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )
            }
          >
            <div className="space-y-1">
              {todo.checklist.length === 0 && !addingChk && <p className="px-1 py-1 text-[12px] text-slate-500">아직 항목이 없습니다.</p>}
              {todo.checklist.map((c) => (
                <ChecklistRow
                  key={c.id}
                  item={c}
                  onToggle={() => void onUpdateChecklist(c.id, { done: !c.done })}
                  onSaveText={(text) => void onUpdateChecklist(c.id, { text })}
                  onDelete={() => void onDeleteChecklist(c.id)}
                />
              ))}
              {addingChk ? (
                <div className="flex items-center gap-1.5 px-1">
                  <input
                    id="chk-new-input"
                    value={newChkText}
                    onChange={(e) => setNewChkText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitNewChk();
                      }
                      if (e.key === 'Escape') {
                        setAddingChk(false);
                        setNewChkText('');
                      }
                    }}
                    placeholder="새 항목"
                    className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="button"
                    onClick={() => void submitNewChk()}
                    disabled={!newChkText.trim()}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    <Check size={13} /> 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingChk(false);
                      setNewChkText('');
                    }}
                    className="px-2 py-1.5 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingChk(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[12px] font-semibold text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  <Plus size={12} /> 항목 추가
                </button>
              )}
            </div>
          </Section>

          {/* ─── 활동(생성·수정) ─── */}
          <Section icon={<Clock size={13} />} title="활동">
            <p className="px-1 text-[11px] text-slate-500">
              생성: {formatDateTime(todo.createdAt)}
              <span className="mx-2">·</span>
              수정: {formatDateTime(todo.updatedAt)}
            </p>
          </Section>
        </div>

        {/* ─── 푸터: 삭제 ─── */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
          {confirmDel ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-rose-800">정말 삭제할까요?</span>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="px-2.5 py-1 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDel(false);
                  void onDelete();
                  onClose();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700"
              >
                <Trash2 size={12} /> 삭제
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-lg text-rose-600 hover:bg-rose-50"
            >
              <Trash2 size={12} /> 카드 삭제
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// 보조 컴포넌트
// ───────────────────────────────────────────────────────────

function statusDot(s: PersonalTodoStatus): string {
  switch (s) {
    case 'in-progress':
      return 'bg-blue-500';
    case 'done':
      return 'bg-emerald-500';
    case 'etc':
      return 'bg-violet-500';
    default:
      return 'bg-slate-400';
  }
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}
function ActionButton({ icon, label, active, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
        active ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}
function Section({ icon, title, right, children }: SectionProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-bold text-slate-600">
        <span className="inline-flex size-5 items-center justify-center rounded-md bg-slate-100 text-slate-500">{icon}</span>
        {title}
        {right}
      </div>
      <div>{children}</div>
    </div>
  );
}

interface PanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}
function Panel({ title, onClose, children }: PanelProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-700">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
          aria-label="닫기"
        >
          <X size={13} />
        </button>
      </div>
      {children}
    </div>
  );
}

interface ColorPickerProps {
  value: PersonalTodoLabelColor;
  onChange: (v: PersonalTodoLabelColor) => void;
}
function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PERSONAL_TODO_LABEL_COLORS.map((c) => {
        const p = getLabelPalette(c);
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn('size-7 rounded-md transition-transform', p.bg, active && 'ring-2 ring-offset-2 ring-indigo-400 scale-110')}
            title={c}
            aria-label={`색상 ${c}`}
          />
        );
      })}
    </div>
  );
}

interface LabelRowProps {
  label: PersonalTodoLabel;
  checked: boolean;
  onToggle: () => void;
  onSaveTitle: (title: string) => void;
  onSaveColor: (color: PersonalTodoLabelColor) => void;
  onDelete: () => void;
}
function LabelRow({ label, checked, onToggle, onSaveTitle, onSaveColor, onDelete }: LabelRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label.title);
  useEffect(() => setDraft(label.title), [label.title]);
  const p = getLabelPalette(label.color);

  if (editing) {
    return (
      <div className="space-y-1.5 rounded-lg border border-indigo-200 bg-white p-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSaveTitle(draft.trim());
              setEditing(false);
            }
            if (e.key === 'Escape') {
              setDraft(label.title);
              setEditing(false);
            }
          }}
          placeholder="라벨 이름"
          className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <ColorPicker value={label.color} onChange={(c) => onSaveColor(c)} />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onDelete();
              setEditing(false);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={11} /> 삭제
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setDraft(label.title);
                setEditing(false);
              }}
              className="px-2 py-0.5 text-[11px] font-semibold rounded-md text-slate-500 hover:bg-slate-100"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveTitle(draft.trim());
                setEditing(false);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Check size={11} /> 저장
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex size-4 items-center justify-center shrink-0"
        aria-label={checked ? '라벨 분리' : '라벨 부착'}
        title={checked ? '클릭하여 라벨 분리' : '클릭하여 라벨 부착'}
      >
        {checked ? <CheckSquare size={14} className="text-indigo-600" /> : <Square size={14} className="text-slate-400" />}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className={cn('flex-1 inline-flex items-center px-2 py-1 text-[12px] font-semibold rounded-md', p.bg, p.text)}
        title={label.title || label.color}
      >
        {label.title || ' '}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="라벨 편집"
        title="이름·색 변경"
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}

interface ChecklistRowProps {
  item: { id: string; text: string; done: boolean };
  onToggle: () => void;
  onSaveText: (text: string) => void;
  onDelete: () => void;
}
function ChecklistRow({ item, onToggle, onSaveText, onDelete }: ChecklistRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  useEffect(() => setDraft(item.text), [item.text]);

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 px-1">
        <button type="button" onClick={onToggle} className="shrink-0 inline-flex size-4 items-center justify-center" aria-label="토글">
          {item.done ? <CheckSquare size={14} className="text-emerald-600" /> : <Square size={14} className="text-slate-400" />}
        </button>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const t = draft.trim();
              if (t) onSaveText(t);
              setEditing(false);
            }
            if (e.key === 'Escape') {
              setDraft(item.text);
              setEditing(false);
            }
          }}
          onBlur={() => {
            const t = draft.trim();
            if (t && t !== item.text) onSaveText(t);
            setEditing(false);
          }}
          className="flex-1 min-w-0 rounded-lg border border-indigo-200 px-2 py-1 text-[13px] outline-none focus:ring-2 focus:ring-indigo-100"
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 px-1 py-1 rounded-lg hover:bg-slate-50">
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 inline-flex size-4 items-center justify-center"
        aria-label={item.done ? '체크 해제' : '체크'}
      >
        {item.done ? <CheckSquare size={14} className="text-emerald-600" /> : <Square size={14} className="text-slate-400" />}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn('flex-1 min-w-0 text-left text-[13px] break-words', item.done ? 'line-through text-slate-400' : 'text-slate-700')}
      >
        {item.text || '(빈 항목)'}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex size-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        aria-label="항목 삭제"
        title="항목 삭제"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
