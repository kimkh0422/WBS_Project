import { supabase, isSupabaseConfigured } from '../supabase';
import { isDevAuthBypass } from '../devAuthBypass';
import { randomUUID } from '../utils';

/** 개인 To-Do 칸반의 칸(상태=열) */
export type PersonalTodoStatus = 'todo' | 'in-progress' | 'done' | 'etc';

/** 열(상태) 정의(표시 순서·라벨). 보드 렌더·검증에 공용 사용 */
export const PERSONAL_TODO_COLUMNS: { key: PersonalTodoStatus; label: string }[] = [
  { key: 'todo', label: '할일' },
  { key: 'in-progress', label: '진행중' },
  { key: 'done', label: '완료' },
  { key: 'etc', label: '기타' },
];

const STATUS_SET = new Set<PersonalTodoStatus>(['todo', 'in-progress', 'done', 'etc']);
export function normalizePersonalTodoStatus(v: unknown): PersonalTodoStatus {
  return STATUS_SET.has(v as PersonalTodoStatus) ? (v as PersonalTodoStatus) : 'todo';
}

/** 등록된 개인 To-Do 1건 */
export type PersonalTodo = {
  id: string;
  userId: string;
  title: string;
  note: string;
  status: PersonalTodoStatus;
  /** 행(스윔레인) id. null = 기본/미분류 행 */
  rowId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** 신규 등록 입력 */
export type PersonalTodoInput = {
  title: string;
  note?: string;
  status: PersonalTodoStatus;
  rowId?: string | null;
  sortOrder: number;
};

/** 부분 수정 입력 */
export type PersonalTodoPatch = Partial<{
  title: string;
  note: string;
  status: PersonalTodoStatus;
  rowId: string | null;
  sortOrder: number;
}>;

/** 행(스윔레인) 1건 */
export type PersonalTodoRow = {
  id: string;
  userId: string;
  label: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type PersonalTodoDbRow = {
  id: string;
  user_id: string;
  title: string | null;
  note: string | null;
  status: string | null;
  row_id: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

type PersonalTodoRowDbRow = {
  id: string;
  user_id: string;
  label: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

const TODO_COLUMNS = 'id, user_id, title, note, status, row_id, sort_order, created_at, updated_at';
const ROW_COLUMNS = 'id, user_id, label, sort_order, created_at, updated_at';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function mapTodoRow(r: PersonalTodoDbRow): PersonalTodo {
  return {
    id: r.id,
    userId: r.user_id,
    title: str(r.title),
    note: str(r.note),
    status: normalizePersonalTodoStatus(r.status),
    rowId: r.row_id ?? null,
    sortOrder: num(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapRowRow(r: PersonalTodoRowDbRow): PersonalTodoRow {
  return {
    id: r.id,
    userId: r.user_id,
    label: str(r.label),
    sortOrder: num(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── 로컬 전용 모드(dev 로그인 우회 / Supabase 미설정) 폴백: localStorage ───
// 운영(승인된 실제 세션)에서는 Supabase를 사용하고, dev 미리보기에서는 로컬에 저장해
// UI·상호작용을 그대로 검증할 수 있게 한다.
function isLocalOnly(): boolean {
  return isDevAuthBypass() || !isSupabaseConfigured || !supabase;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todoKey(userId: string): string {
  return `wbs.personalTodos.${userId || 'anon'}`;
}
function rowKey(userId: string): string {
  return `wbs.personalTodoRows.${userId || 'anon'}`;
}

function loadLocalTodos(userId: string): PersonalTodo[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(todoKey(userId)) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      id: str(r.id) || randomUUID(),
      userId: str(r.userId) || userId,
      title: str(r.title),
      note: str(r.note),
      status: normalizePersonalTodoStatus(r.status),
      rowId: strOrNull(r.rowId),
      sortOrder: num(r.sortOrder),
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveLocalTodos(userId: string, todos: PersonalTodo[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(todoKey(userId), JSON.stringify(todos));
  } catch {
    /* 용량 초과 등 무시 */
  }
}

function loadLocalRows(userId: string): PersonalTodoRow[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(rowKey(userId)) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      id: str(r.id) || randomUUID(),
      userId: str(r.userId) || userId,
      label: str(r.label),
      sortOrder: num(r.sortOrder),
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveLocalRows(userId: string, rows: PersonalTodoRow[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(rowKey(userId), JSON.stringify(rows));
  } catch {
    /* 무시 */
  }
}

// ─── To-Do CRUD ───
/** 사용자의 개인 To-Do 전체 조회(상태·순서 정렬) */
export async function fetchPersonalTodos(userId: string): Promise<PersonalTodo[]> {
  if (!userId) return [];
  if (isLocalOnly()) {
    return loadLocalTodos(userId).sort((a, b) => a.status.localeCompare(b.status) || a.sortOrder - b.sortOrder);
  }
  const { data, error } = await supabase!
    .from('personal_todos')
    .select(TODO_COLUMNS)
    .eq('user_id', userId)
    .order('status', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PersonalTodoDbRow[]).map(mapTodoRow);
}

/** 개인 To-Do 등록(신규). user_id는 RLS(본인만)에 맞춰 현재 사용자로 설정. */
export async function insertPersonalTodo(userId: string, input: PersonalTodoInput): Promise<PersonalTodo> {
  if (isLocalOnly()) {
    const ts = nowIso();
    const todo: PersonalTodo = {
      id: randomUUID(),
      userId,
      title: input.title,
      note: input.note ?? '',
      status: input.status,
      rowId: input.rowId ?? null,
      sortOrder: input.sortOrder,
      createdAt: ts,
      updatedAt: ts,
    };
    const list = loadLocalTodos(userId);
    list.push(todo);
    saveLocalTodos(userId, list);
    return todo;
  }
  const { data, error } = await supabase!
    .from('personal_todos')
    .insert({
      user_id: userId,
      title: input.title,
      note: input.note ?? '',
      status: input.status,
      row_id: input.rowId ?? null,
      sort_order: input.sortOrder,
    })
    .select(TODO_COLUMNS)
    .single();
  if (error) throw error;
  return mapTodoRow(data as PersonalTodoDbRow);
}

/** 개인 To-Do 수정(제목·메모·상태·행·순서 일부). 본인 항목만 — RLS. */
export async function updatePersonalTodo(userId: string, id: string, patch: PersonalTodoPatch): Promise<PersonalTodo> {
  if (isLocalOnly()) {
    const list = loadLocalTodos(userId);
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('항목을 찾을 수 없습니다.');
    const updated: PersonalTodo = { ...list[idx], ...patch, updatedAt: nowIso() };
    list[idx] = updated;
    saveLocalTodos(userId, list);
    return updated;
  }
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.rowId !== undefined) row.row_id = patch.rowId;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { data, error } = await supabase!.from('personal_todos').update(row).eq('id', id).select(TODO_COLUMNS).single();
  if (error) throw error;
  return mapTodoRow(data as PersonalTodoDbRow);
}

/** 개인 To-Do 삭제. 본인 항목만 — RLS. */
export async function deletePersonalTodo(userId: string, id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalTodos(
      userId,
      loadLocalTodos(userId).filter((t) => t.id !== id),
    );
    return;
  }
  const { error } = await supabase!.from('personal_todos').delete().eq('id', id);
  if (error) throw error;
}

// ─── 행(스윔레인) CRUD ───
/** 사용자의 행 전체 조회(순서 정렬) */
export async function fetchPersonalTodoRows(userId: string): Promise<PersonalTodoRow[]> {
  if (!userId) return [];
  if (isLocalOnly()) {
    return loadLocalRows(userId).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }
  const { data, error } = await supabase!
    .from('personal_todo_rows')
    .select(ROW_COLUMNS)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PersonalTodoRowDbRow[]).map(mapRowRow);
}

/** 행 추가 */
export async function insertPersonalTodoRow(userId: string, label: string, sortOrder: number): Promise<PersonalTodoRow> {
  if (isLocalOnly()) {
    const ts = nowIso();
    const r: PersonalTodoRow = { id: randomUUID(), userId, label, sortOrder, createdAt: ts, updatedAt: ts };
    const list = loadLocalRows(userId);
    list.push(r);
    saveLocalRows(userId, list);
    return r;
  }
  const { data, error } = await supabase!
    .from('personal_todo_rows')
    .insert({ user_id: userId, label, sort_order: sortOrder })
    .select(ROW_COLUMNS)
    .single();
  if (error) throw error;
  return mapRowRow(data as PersonalTodoRowDbRow);
}

/** 행 수정(이름·순서) */
export async function updatePersonalTodoRow(
  userId: string,
  id: string,
  patch: Partial<{ label: string; sortOrder: number }>,
): Promise<PersonalTodoRow> {
  if (isLocalOnly()) {
    const list = loadLocalRows(userId);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('행을 찾을 수 없습니다.');
    const updated: PersonalTodoRow = { ...list[idx], ...patch, updatedAt: nowIso() };
    list[idx] = updated;
    saveLocalRows(userId, list);
    return updated;
  }
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { data, error } = await supabase!.from('personal_todo_rows').update(row).eq('id', id).select(ROW_COLUMNS).single();
  if (error) throw error;
  return mapRowRow(data as PersonalTodoRowDbRow);
}

/** 행 삭제. 그 행의 카드는 기본 행(row_id = NULL)으로. (Supabase는 FK ON DELETE SET NULL이 처리) */
export async function deletePersonalTodoRow(userId: string, id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalRows(
      userId,
      loadLocalRows(userId).filter((r) => r.id !== id),
    );
    saveLocalTodos(
      userId,
      loadLocalTodos(userId).map((t) => (t.rowId === id ? { ...t, rowId: null } : t)),
    );
    return;
  }
  const { error } = await supabase!.from('personal_todo_rows').delete().eq('id', id);
  if (error) throw error;
}
