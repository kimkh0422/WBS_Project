import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ClipboardList,
  Plus,
  X,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  Loader2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Rows3,
  LayoutGrid,
  Calendar as CalendarIcon,
  CheckSquare,
  AlignLeft,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useErrorStateWithToast } from '../hooks/useErrorStateWithToast';
import {
  PERSONAL_TODO_COLUMNS,
  fetchPersonalTodos,
  insertPersonalTodo,
  updatePersonalTodo,
  deletePersonalTodo,
  fetchPersonalTodoRows,
  insertPersonalTodoRow,
  updatePersonalTodoRow,
  deletePersonalTodoRow,
  fetchPersonalTodoLabels,
  insertPersonalTodoLabel,
  updatePersonalTodoLabel,
  deletePersonalTodoLabel,
  attachPersonalTodoLabel,
  detachPersonalTodoLabel,
  insertPersonalTodoChecklistItem,
  updatePersonalTodoChecklistItem,
  deletePersonalTodoChecklistItem,
  type PersonalTodo,
  type PersonalTodoLabel,
  type PersonalTodoLabelColor,
  type PersonalTodoPatch,
  type PersonalTodoRow,
  type PersonalTodoStatus,
} from '../lib/db/personalTodos';
import { PersonalTodoDetailModal, getLabelPalette } from './PersonalTodoDetailModal';

const COLUMN_THEME: Record<PersonalTodoStatus, { dot: string; ring: string; soft: string; count: string }> = {
  todo: { dot: 'bg-slate-400', ring: 'border-slate-200', soft: 'bg-slate-50/80', count: 'bg-slate-100 text-slate-600' },
  'in-progress': { dot: 'bg-blue-500', ring: 'border-blue-200', soft: 'bg-blue-50/70', count: 'bg-blue-100 text-blue-700' },
  done: { dot: 'bg-emerald-500', ring: 'border-emerald-200', soft: 'bg-emerald-50/70', count: 'bg-emerald-100 text-emerald-700' },
  etc: { dot: 'bg-violet-500', ring: 'border-violet-200', soft: 'bg-violet-50/70', count: 'bg-violet-100 text-violet-700' },
};

const DEFAULT_ROW_KEY = '__default__';
const rowKeyOf = (rowId: string | null): string => rowId ?? DEFAULT_ROW_KEY;
const cellDroppableId = (rowId: string | null, status: PersonalTodoStatus): string => `cell:${rowKeyOf(rowId)}:${status}`;

interface PersonalKanbanPageProps {
  userId: string;
}

interface Lane {
  id: string | null; // null = 기본(미분류) 행
  label: string;
}

export function PersonalKanbanPage({ userId }: PersonalKanbanPageProps) {
  const [todos, setTodos] = useState<PersonalTodo[]>([]);
  const [rows, setRows] = useState<PersonalTodoRow[]>([]);
  const [labels, setLabels] = useState<PersonalTodoLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, setError } = useErrorStateWithToast({ toastId: 'wbs-personal-kanban-error' });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [newRowLabel, setNewRowLabel] = useState('');
  // 행(스윔레인) 구분 보기 on/off. off면 행 없이 4개 상태 칸만 한 보드로 표시. localStorage에 영구.
  const [groupByRow, setGroupByRow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem('wbs.personalKanban.groupByRow') !== '0';
    } catch {
      return true;
    }
  });
  const groupByRowRef = useRef(groupByRow);
  groupByRowRef.current = groupByRow;
  const setGroupByRowPersist = useCallback((v: boolean) => {
    setGroupByRow(v);
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('wbs.personalKanban.groupByRow', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const todosRef = useRef<PersonalTodo[]>([]);
  todosRef.current = todos;
  const rowsRef = useRef<PersonalTodoRow[]>([]);
  rowsRef.current = rows;
  const labelsRef = useRef<PersonalTodoLabel[]>([]);
  labelsRef.current = labels;

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [t, r, l] = await Promise.all([fetchPersonalTodos(userId), fetchPersonalTodoRows(userId), fetchPersonalTodoLabels(userId)]);
      setTodos(t);
      setRows(r);
      setLabels(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : '할일을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // 기본(미분류) 행 + 사용자 행
  const lanes = useMemo<Lane[]>(() => {
    const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return [{ id: null, label: '기본' }, ...sorted.map((r) => ({ id: r.id, label: r.label || '(이름 없음)' }))];
  }, [rows]);

  const activeTodo = activeId ? (todos.find((t) => t.id === activeId) ?? null) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemsOf = useCallback(
    (rowId: string | null, status: PersonalTodoStatus) =>
      todos
        .filter((t) => (t.rowId ?? null) === rowId && t.status === status)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    [todos],
  );

  // 전체(행 구분 없음) 보기용: 상태별 모든 행의 카드
  const flatItemsOf = useCallback(
    (status: PersonalTodoStatus) =>
      todos.filter((t) => t.status === status).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    [todos],
  );

  // ─── 카드 CRUD ───
  const handleAdd = useCallback(
    async (rowId: string | null, status: PersonalTodoStatus, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const maxOrder = todosRef.current
        .filter((t) => (t.rowId ?? null) === rowId && t.status === status)
        .reduce((m, t) => Math.max(m, t.sortOrder), -1);
      try {
        const created = await insertPersonalTodo(userId, { title: trimmed, note: '', status, rowId, sortOrder: maxOrder + 1 });
        setTodos((prev) => [...prev, created]);
      } catch (e) {
        setError(e instanceof Error ? e.message : '할일 추가에 실패했습니다.');
      }
    },
    [userId],
  );

  const handleEdit = useCallback(
    async (id: string, patch: PersonalTodoPatch) => {
      const prev = todosRef.current;
      setTodos((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      try {
        await updatePersonalTodo(userId, id, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : '수정에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  // ─── 라벨 정의 CRUD ───
  const handleCreateLabel = useCallback(
    async (input: { title: string; color: PersonalTodoLabelColor }): Promise<PersonalTodoLabel> => {
      const maxOrder = labelsRef.current.reduce((m, l) => Math.max(m, l.sortOrder), -1);
      const created = await insertPersonalTodoLabel(userId, { title: input.title, color: input.color, sortOrder: maxOrder + 1 });
      setLabels((prev) => [...prev, created]);
      return created;
    },
    [userId],
  );

  const handleUpdateLabel = useCallback(
    async (id: string, patch: { title?: string; color?: PersonalTodoLabelColor }) => {
      const prev = labelsRef.current;
      setLabels((cur) => cur.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      try {
        await updatePersonalTodoLabel(userId, id, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : '라벨 수정에 실패했습니다.');
        setLabels(prev);
      }
    },
    [userId],
  );

  const handleDeleteLabel = useCallback(
    async (id: string) => {
      const prevLabels = labelsRef.current;
      const prevTodos = todosRef.current;
      setLabels((cur) => cur.filter((l) => l.id !== id));
      setTodos((cur) => cur.map((t) => (t.labelIds.includes(id) ? { ...t, labelIds: t.labelIds.filter((x) => x !== id) } : t)));
      try {
        await deletePersonalTodoLabel(userId, id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '라벨 삭제에 실패했습니다.');
        setLabels(prevLabels);
        setTodos(prevTodos);
      }
    },
    [userId],
  );

  // ─── 카드 ↔ 라벨 부착/분리 ───
  const handleAttachLabel = useCallback(
    async (todoId: string, labelId: string) => {
      const prev = todosRef.current;
      setTodos((cur) =>
        cur.map((t) => (t.id === todoId && !t.labelIds.includes(labelId) ? { ...t, labelIds: [...t.labelIds, labelId] } : t)),
      );
      try {
        await attachPersonalTodoLabel(userId, todoId, labelId);
      } catch (e) {
        setError(e instanceof Error ? e.message : '라벨 부착에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  const handleDetachLabel = useCallback(
    async (todoId: string, labelId: string) => {
      const prev = todosRef.current;
      setTodos((cur) => cur.map((t) => (t.id === todoId ? { ...t, labelIds: t.labelIds.filter((x) => x !== labelId) } : t)));
      try {
        await detachPersonalTodoLabel(userId, todoId, labelId);
      } catch (e) {
        setError(e instanceof Error ? e.message : '라벨 분리에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  // ─── 체크리스트 CRUD ───
  const handleAddChecklist = useCallback(
    async (todoId: string, text: string) => {
      const target = todosRef.current.find((t) => t.id === todoId);
      if (!target) return;
      const maxOrder = target.checklist.reduce((m, c) => Math.max(m, c.sortOrder), -1);
      try {
        const created = await insertPersonalTodoChecklistItem(userId, { todoId, text, sortOrder: maxOrder + 1 });
        setTodos((cur) => cur.map((t) => (t.id === todoId ? { ...t, checklist: [...t.checklist, created] } : t)));
      } catch (e) {
        setError(e instanceof Error ? e.message : '체크리스트 추가에 실패했습니다.');
      }
    },
    [userId],
  );

  const handleUpdateChecklist = useCallback(
    async (todoId: string, itemId: string, patch: { text?: string; done?: boolean }) => {
      const prev = todosRef.current;
      setTodos((cur) =>
        cur.map((t) => (t.id === todoId ? { ...t, checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, ...patch } : c)) } : t)),
      );
      try {
        await updatePersonalTodoChecklistItem(userId, itemId, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : '체크리스트 수정에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  const handleDeleteChecklist = useCallback(
    async (todoId: string, itemId: string) => {
      const prev = todosRef.current;
      setTodos((cur) => cur.map((t) => (t.id === todoId ? { ...t, checklist: t.checklist.filter((c) => c.id !== itemId) } : t)));
      try {
        await deletePersonalTodoChecklistItem(userId, itemId);
      } catch (e) {
        setError(e instanceof Error ? e.message : '체크리스트 삭제에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const prev = todosRef.current;
      setTodos((cur) => cur.filter((t) => t.id !== id));
      try {
        await deletePersonalTodo(userId, id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '삭제에 실패했습니다.');
        setTodos(prev);
      }
    },
    [userId],
  );

  // ─── 행 CRUD ───
  const handleAddRow = useCallback(async () => {
    const label = newRowLabel.trim();
    if (!label) return;
    const maxOrder = rowsRef.current.reduce((m, r) => Math.max(m, r.sortOrder), -1);
    setNewRowLabel('');
    setAddingRow(false);
    try {
      const created = await insertPersonalTodoRow(userId, label, maxOrder + 1);
      setRows((prev) => [...prev, created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '행 추가에 실패했습니다.');
    }
  }, [userId, newRowLabel]);

  const handleRenameRow = useCallback(
    async (id: string, label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, label: trimmed } : r)));
      try {
        await updatePersonalTodoRow(userId, id, { label: trimmed });
      } catch (e) {
        setError(e instanceof Error ? e.message : '행 이름 변경에 실패했습니다.');
        setRows(prev);
      }
    },
    [userId],
  );

  const handleMoveRow = useCallback(
    async (id: string, dir: -1 | 1) => {
      const ordered = [...rowsRef.current].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
      const idx = ordered.findIndex((r) => r.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= ordered.length) return;
      [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
      const reindexed = ordered.map((r, i) => ({ ...r, sortOrder: i }));
      const prev = rowsRef.current;
      const changed = reindexed.filter((r) => prev.find((p) => p.id === r.id)?.sortOrder !== r.sortOrder);
      setRows(reindexed);
      try {
        await Promise.all(changed.map((r) => updatePersonalTodoRow(userId, r.id, { sortOrder: r.sortOrder })));
      } catch (e) {
        setError(e instanceof Error ? e.message : '행 순서 변경에 실패했습니다.');
        setRows(prev);
      }
    },
    [userId],
  );

  const handleDeleteRow = useCallback(
    async (id: string) => {
      const prevRows = rowsRef.current;
      const prevTodos = todosRef.current;
      setRows((cur) => cur.filter((r) => r.id !== id));
      setTodos((cur) => cur.map((t) => (t.rowId === id ? { ...t, rowId: null } : t)));
      try {
        await deletePersonalTodoRow(userId, id);
      } catch (e) {
        setError(e instanceof Error ? e.message : '행 삭제에 실패했습니다.');
        setRows(prevRows);
        setTodos(prevTodos);
      }
    },
    [userId],
  );

  // ─── 드래그(칸=행×상태 간 이동·정렬) ───
  const handleDragStart = useCallback((e: DragStartEvent) => setActiveId(String(e.active.id)), []);

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e;
      setActiveId(null);
      if (!over) return;
      const activeKey = String(active.id);
      const overKey = String(over.id);
      if (activeKey === overKey) return;

      const current = todosRef.current;
      const activeTd = current.find((t) => t.id === activeKey);
      if (!activeTd) return;

      // 대상 칸(행·상태) 결정
      let targetRowKey: string;
      let targetStatus: PersonalTodoStatus;
      if (overKey.startsWith('flat:')) {
        // 전체(행 구분 없음) 보기: 상태만 바꾸고 카드의 행은 그대로 유지
        targetStatus = overKey.slice(5) as PersonalTodoStatus;
        targetRowKey = rowKeyOf(activeTd.rowId ?? null);
      } else if (overKey.startsWith('cell:')) {
        const rest = overKey.slice(5);
        const ci = rest.indexOf(':');
        targetRowKey = rest.slice(0, ci);
        targetStatus = rest.slice(ci + 1) as PersonalTodoStatus;
      } else {
        const overTd = current.find((t) => t.id === overKey);
        if (!overTd) return;
        targetStatus = overTd.status;
        // 전체 보기에서 카드 위에 드롭해도 행은 유지(행끼리 섞이지 않도록)
        targetRowKey = groupByRowRef.current ? rowKeyOf(overTd.rowId ?? null) : rowKeyOf(activeTd.rowId ?? null);
      }

      const cellKey = (t: PersonalTodo) => `${rowKeyOf(t.rowId ?? null)}:${t.status}`;
      const cells = new Map<string, string[]>();
      for (const t of [...current].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))) {
        const k = cellKey(t);
        const arr = cells.get(k) ?? [];
        arr.push(t.id);
        cells.set(k, arr);
      }

      const fromKey = cellKey(activeTd);
      const toKey = `${targetRowKey}:${targetStatus}`;
      const fromList = [...(cells.get(fromKey) ?? [])];
      const oldIdx = fromList.indexOf(activeKey);
      if (oldIdx >= 0) fromList.splice(oldIdx, 1);
      const toList = fromKey === toKey ? fromList : [...(cells.get(toKey) ?? [])];
      let insertIdx: number;
      if (overKey.startsWith('cell:') || overKey.startsWith('flat:')) {
        insertIdx = toList.length;
      } else {
        const oi = toList.indexOf(overKey);
        insertIdx = oi < 0 ? toList.length : oi;
      }
      toList.splice(insertIdx, 0, activeKey);
      cells.set(fromKey, fromList);
      cells.set(toKey, toList);

      const orderMap = new Map<string, { status: PersonalTodoStatus; rowId: string | null; sortOrder: number }>();
      for (const [k, ids] of cells) {
        const ci = k.indexOf(':');
        const rk = k.slice(0, ci);
        const st = k.slice(ci + 1) as PersonalTodoStatus;
        const rid = rk === DEFAULT_ROW_KEY ? null : rk;
        ids.forEach((id, i) => orderMap.set(id, { status: st, rowId: rid, sortOrder: i }));
      }

      const prevSnapshot = current;
      const next = current.map((t) => {
        const m = orderMap.get(t.id);
        if (m && (m.status !== t.status || (m.rowId ?? null) !== (t.rowId ?? null) || m.sortOrder !== t.sortOrder)) {
          return { ...t, status: m.status, rowId: m.rowId, sortOrder: m.sortOrder };
        }
        return t;
      });
      const changed = next.filter((t) => {
        const b = prevSnapshot.find((p) => p.id === t.id);
        return b && (b.status !== t.status || (b.rowId ?? null) !== (t.rowId ?? null) || b.sortOrder !== t.sortOrder);
      });
      if (changed.length === 0) return;

      setTodos(next);
      try {
        await Promise.all(
          changed.map((t) => updatePersonalTodo(userId, t.id, { status: t.status, rowId: t.rowId, sortOrder: t.sortOrder })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : '이동을 저장하지 못했습니다.');
        setTodos(prevSnapshot);
      }
    },
    [userId],
  );

  const total = todos.length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-[var(--color-bg)] p-3 pb-6 sm:p-4 md:p-5">
      <div className="max-w-[min(100%,96rem)] mx-auto w-full">
        {/* 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-lg md:text-xl font-bold text-[var(--color-ink)] flex items-center gap-2.5 m-0">
            <span className="inline-flex items-center justify-center size-8 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
              <ClipboardList size={18} />
            </span>
            칸반
            <span className="text-sm font-normal text-slate-500">개인 할일 {total}건</span>
          </h2>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setGroupByRowPersist(true)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-md transition-colors',
                  groupByRow ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
                title="행(스윔레인)별로 구분해서 보기"
              >
                <Rows3 size={13} /> 행별
              </button>
              <button
                type="button"
                onClick={() => setGroupByRowPersist(false)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-md transition-colors',
                  !groupByRow ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
                title="행 구분 없이 전체를 한 보드로 보기"
              >
                <LayoutGrid size={13} /> 전체
              </button>
            </div>
            {groupByRow &&
              (addingRow ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newRowLabel}
                    onChange={(e) => setNewRowLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddRow();
                      }
                      if (e.key === 'Escape') {
                        setAddingRow(false);
                        setNewRowLabel('');
                      }
                    }}
                    placeholder="행 이름 (예: 프로젝트 A)"
                    className="w-44 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddRow()}
                    disabled={!newRowLabel.trim()}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    <Check size={13} /> 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingRow(false);
                      setNewRowLabel('');
                    }}
                    className="px-2 py-1.5 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingRow(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                  title="가로 구분(행/스윔레인) 추가"
                >
                  <Rows3 size={14} aria-hidden /> 행 추가
                </button>
              ))}
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              title="새로고침"
            >
              <RefreshCw size={13} aria-hidden /> 새로고침
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 -mt-1 mb-3 leading-relaxed">
          나만 보는 개인 할일 보드입니다. 카드를 드래그해{' '}
          <strong className="font-semibold text-slate-600">할일 · 진행중 · 완료 · 기타</strong> 칸
          {groupByRow ? (
            <>
              이나 다른 <strong className="font-semibold text-slate-600">행</strong>으로 옮기세요.
            </>
          ) : (
            <>으로 옮기세요. (행 구분 없이 전체 보기 — 카드는 원래 행을 유지합니다.)</>
          )}
        </p>

        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-sm text-rose-900">
            <span>{error}</span>
            <button type="button" onClick={() => void reload()} className="shrink-0 font-semibold text-rose-700 hover:underline">
              다시 시도
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="animate-spin" size={26} />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            {groupByRow ? (
              <div className="space-y-4">
                {lanes.map((lane, laneIdx) => (
                  <section key={lane.id ?? DEFAULT_ROW_KEY} className="rounded-2xl border border-slate-200/80 bg-white/40">
                    {/* 행(스윔레인) 헤더 */}
                    <SwimlaneHeader
                      lane={lane}
                      count={todos.filter((t) => (t.rowId ?? null) === lane.id).length}
                      canMoveUp={lane.id != null && laneIdx > 1}
                      canMoveDown={lane.id != null && laneIdx < lanes.length - 1}
                      onRename={handleRenameRow}
                      onMove={handleMoveRow}
                      onDelete={handleDeleteRow}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2 pt-0 items-start">
                      {PERSONAL_TODO_COLUMNS.map((col) => (
                        <TodoCell
                          key={col.key}
                          rowId={lane.id}
                          status={col.key}
                          label={col.label}
                          items={itemsOf(lane.id, col.key)}
                          labels={labels}
                          onAdd={handleAdd}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                          onOpenDetail={setOpenCardId}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
                {PERSONAL_TODO_COLUMNS.map((col) => (
                  <TodoCell
                    key={col.key}
                    rowId={null}
                    status={col.key}
                    label={col.label}
                    items={flatItemsOf(col.key)}
                    labels={labels}
                    onAdd={handleAdd}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onOpenDetail={setOpenCardId}
                    flat
                  />
                ))}
              </div>
            )}
            <DragOverlay>{activeTodo ? <TodoCardView todo={activeTodo} labels={labels} dragging /> : null}</DragOverlay>
          </DndContext>
        )}
      </div>

      {/* ─── 카드 디테일(트렐로 스타일) 모달 ─── */}
      {openCardId &&
        (() => {
          const card = todos.find((t) => t.id === openCardId);
          if (!card) return null;
          return (
            <PersonalTodoDetailModal
              todo={card}
              labels={labels}
              rows={rows}
              onClose={() => setOpenCardId(null)}
              onPatch={(patch) => handleEdit(card.id, patch)}
              onAttachLabel={(labelId) => handleAttachLabel(card.id, labelId)}
              onDetachLabel={(labelId) => handleDetachLabel(card.id, labelId)}
              onCreateLabel={handleCreateLabel}
              onUpdateLabel={handleUpdateLabel}
              onDeleteLabel={handleDeleteLabel}
              onAddChecklist={(text) => handleAddChecklist(card.id, text)}
              onUpdateChecklist={(itemId, patch) => handleUpdateChecklist(card.id, itemId, patch)}
              onDeleteChecklist={(itemId) => handleDeleteChecklist(card.id, itemId)}
              onDelete={() => handleDelete(card.id)}
            />
          );
        })()}
    </div>
  );
}

interface SwimlaneHeaderProps {
  lane: Lane;
  count: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (id: string, label: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}

function SwimlaneHeader({ lane, count, canMoveUp, canMoveDown, onRename, onMove, onDelete }: SwimlaneHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(lane.label);
  const [confirmDel, setConfirmDel] = useState(false);
  const isDefault = lane.id == null;

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {editing && !isDefault ? (
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (lane.id) onRename(lane.id, label);
              setEditing(false);
            }
            if (e.key === 'Escape') {
              setLabel(lane.label);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (lane.id && label.trim() && label.trim() !== lane.label) onRename(lane.id, label);
            setEditing(false);
          }}
          className="rounded-lg border border-indigo-200 px-2 py-1 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"
        />
      ) : (
        <h3 className="text-sm font-bold text-[var(--color-ink)] m-0 flex items-center gap-1.5">
          <Rows3 size={14} className="text-slate-400 shrink-0" aria-hidden />
          {lane.label}
          {isDefault && <span className="text-[10px] font-medium text-slate-400">미분류</span>}
        </h3>
      )}
      <span className="text-[11px] font-bold tabular-nums rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">{count}</span>

      {!isDefault && lane.id && (
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMove(lane.id!, -1)}
            disabled={!canMoveUp}
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            title="위로"
            aria-label="행 위로"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            onClick={() => onMove(lane.id!, 1)}
            disabled={!canMoveDown}
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
            title="아래로"
            aria-label="행 아래로"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              setLabel(lane.label);
              setEditing(true);
            }}
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="이름 변경"
            aria-label="행 이름 변경"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="p-1 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            title="행 삭제(카드는 기본 행으로)"
            aria-label="행 삭제"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {confirmDel && lane.id && (
        <div className="ml-2 flex items-center gap-1.5 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1">
          <span className="text-[11px] font-medium text-rose-800">행 삭제? (카드는 기본 행으로)</span>
          <button
            type="button"
            onClick={() => setConfirmDel(false)}
            className="px-2 py-0.5 text-[11px] font-semibold rounded-md text-slate-500 hover:bg-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDel(false);
              if (lane.id) onDelete(lane.id);
            }}
            className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

interface TodoCellProps {
  rowId: string | null;
  status: PersonalTodoStatus;
  label: string;
  items: PersonalTodo[];
  labels: PersonalTodoLabel[];
  onAdd: (rowId: string | null, status: PersonalTodoStatus, title: string) => void;
  onEdit: (id: string, patch: PersonalTodoPatch) => void;
  onDelete: (id: string) => void;
  onOpenDetail: (id: string) => void;
  /** 전체(행 구분 없음) 보기: droppable id를 행과 무관한 flat:상태 로 두어 드롭 시 행이 유지되게 함 */
  flat?: boolean;
}

function TodoCell({ rowId, status, label, items, labels, onAdd, onEdit, onDelete, onOpenDetail, flat }: TodoCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: flat ? `flat:${status}` : cellDroppableId(rowId, status) });
  const theme = COLUMN_THEME[status];
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (!draft.trim()) return;
    onAdd(rowId, status, draft);
    setDraft('');
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border p-2 min-h-[5rem] transition-colors',
        theme.ring,
        theme.soft,
        isOver && 'ring-2 ring-indigo-300 border-indigo-200',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
        <span className={cn('size-2 rounded-full shrink-0', theme.dot)} aria-hidden />
        <span className="text-[11px] font-bold text-slate-600">{label}</span>
        <span className={cn('ml-auto text-[10px] font-bold tabular-nums rounded-full px-1.5 py-0.5', theme.count)}>{items.length}</span>
      </div>

      <div className="space-y-1.5">
        <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {items.map((todo) => (
            <SortableTodoCard key={todo.id} todo={todo} labels={labels} onEdit={onEdit} onDelete={onDelete} onOpenDetail={onOpenDetail} />
          ))}
        </SortableContext>

        <div className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="+ 추가"
            className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            className="shrink-0 inline-flex items-center justify-center size-7 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="추가"
            aria-label="할일 추가"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface TodoCardProps {
  todo: PersonalTodo;
  labels: PersonalTodoLabel[];
  onEdit: (id: string, patch: PersonalTodoPatch) => void;
  onDelete: (id: string) => void;
  onOpenDetail: (id: string) => void;
}

function SortableTodoCard({ todo, labels, onEdit, onDelete, onOpenDetail }: TodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <TodoCardView
        todo={todo}
        labels={labels}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpenDetail={onOpenDetail}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

interface TodoCardViewProps {
  todo: PersonalTodo;
  labels?: PersonalTodoLabel[];
  dragging?: boolean;
  onEdit?: (id: string, patch: PersonalTodoPatch) => void;
  onDelete?: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  dragHandleProps?: Record<string, unknown>;
}

function TodoCardView({ todo, labels, dragging, onEdit, onDelete, onOpenDetail, dragHandleProps }: TodoCardViewProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [note, setNote] = useState(todo.note);
  const [confirmDel, setConfirmDel] = useState(false);

  const startEdit = () => {
    setTitle(todo.title);
    setNote(todo.note);
    setEditing(true);
  };
  const save = () => {
    const t = title.trim();
    if (t && (t !== todo.title || note !== todo.note)) onEdit?.(todo.id, { title: t, note });
    setEditing(false);
  };

  // 카드 칩 데이터
  const labelMap = useMemo(() => new Map((labels ?? []).map((l) => [l.id, l] as const)), [labels]);
  const cardLabels = useMemo(
    () => todo.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as PersonalTodoLabel[],
    [todo.labelIds, labelMap],
  );
  const chkTotal = todo.checklist.length;
  const chkDone = todo.checklist.filter((c) => c.done).length;
  const dueTone = useMemo<'past' | 'today' | 'soon' | 'future' | 'none'>(() => {
    if (!todo.dueDate) return 'none';
    const d = new Date(todo.dueDate);
    if (Number.isNaN(d.getTime())) return 'none';
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((startOf(d).getTime() - startOf(now).getTime()) / 86400000);
    if (diff < 0) return 'past';
    if (diff === 0) return 'today';
    if (diff <= 3) return 'soon';
    return 'future';
  }, [todo.dueDate]);
  const dueShort = useMemo(() => {
    if (!todo.dueDate) return '';
    const d = new Date(todo.dueDate);
    if (Number.isNaN(d.getTime())) return '';
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${m}-${day}`;
  }, [todo.dueDate]);
  const allChkDone = chkTotal > 0 && chkDone === chkTotal;

  if (editing) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-white p-2.5 shadow-sm space-y-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="할일 제목"
          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] font-medium text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모(선택)"
          rows={2}
          className="w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] text-slate-600 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-2.5 py-1 text-[12px] font-semibold rounded-lg text-slate-500 hover:bg-slate-100"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Check size={13} /> 저장
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      {...(dragHandleProps ?? {})}
      onClick={() => {
        if (!dragging) onOpenDetail?.(todo.id);
      }}
      className={cn(
        // 카드와 카드가 아닌 영역(컬럼 배경) 구분: 진한 테두리 + 또렷한 그림자로 카드가 떠 보이게
        'group/card rounded-xl border border-slate-300 bg-white p-2.5 shadow-md ring-1 ring-black/5 hover:shadow-lg hover:border-slate-400 transition-all',
        !dragging && 'cursor-grab active:cursor-grabbing select-none',
        dragging && 'shadow-xl ring-2 ring-indigo-300 rotate-1',
      )}
    >
      {/* 라벨 칩(있을 때만) */}
      {cardLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {cardLabels.map((l) => {
            const p = getLabelPalette(l.color);
            return (
              <span
                key={l.id}
                className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold', p.bg, p.text)}
                title={l.title || l.color}
              >
                {l.title || ' '}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-1.5">
        {/* 드래그 핸들은 시각적 힌트만 — 카드 전체 영역을 잡아 이동한다 */}
        <span className="shrink-0 mt-0.5 text-slate-300 group-hover/card:text-slate-400 pointer-events-none" aria-hidden>
          <GripVertical size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-slate-800 break-words leading-snug m-0">{todo.title || '(제목 없음)'}</p>
          {todo.note && (
            <p className="mt-1 text-[12px] text-slate-500 break-words leading-snug whitespace-pre-wrap m-0 line-clamp-2">{todo.note}</p>
          )}
        </div>
        {!dragging && (
          <div
            className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="수정"
              aria-label="수정"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDel(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              title="삭제"
              aria-label="삭제"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {/* 하단 배지: 마감일·체크리스트 진행률·설명 표식 */}
      {(todo.dueDate || chkTotal > 0 || todo.note) && (
        <div className="mt-1.5 pl-5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
          {todo.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold',
                dueTone === 'past' && 'bg-rose-100 text-rose-700',
                dueTone === 'today' && 'bg-amber-100 text-amber-800',
                dueTone === 'soon' && 'bg-yellow-50 text-yellow-800',
                dueTone === 'future' && 'bg-slate-100 text-slate-600',
              )}
              title="마감일"
            >
              <CalendarIcon size={10} />
              {dueShort}
            </span>
          )}
          {chkTotal > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold',
                allChkDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
              )}
              title="체크리스트"
            >
              <CheckSquare size={10} />
              {chkDone}/{chkTotal}
            </span>
          )}
          {todo.note && (
            <span
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold bg-slate-100 text-slate-500"
              title="설명 있음"
            >
              <AlignLeft size={10} />
            </span>
          )}
        </div>
      )}

      {confirmDel && (
        <div
          className="mt-2 flex items-center justify-end gap-1.5 rounded-lg bg-rose-50 border border-rose-100 px-2 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mr-auto text-[11px] font-medium text-rose-800">삭제할까요?</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDel(false);
            }}
            className="px-2 py-0.5 text-[11px] font-semibold rounded-md text-slate-500 hover:bg-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDel(false);
              onDelete?.(todo.id);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700"
          >
            <X size={11} /> 삭제
          </button>
        </div>
      )}
    </div>
  );
}
