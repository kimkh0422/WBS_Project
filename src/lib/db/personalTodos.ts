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

/** 라벨 색상 팔레트 키. UI 측에서 실제 색상 클래스로 매핑한다. */
export type PersonalTodoLabelColor = 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'pink' | 'gray';

export const PERSONAL_TODO_LABEL_COLORS: PersonalTodoLabelColor[] = [
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
  'blue',
  'sky',
  'pink',
  'gray',
];

const COLOR_SET = new Set<PersonalTodoLabelColor>(PERSONAL_TODO_LABEL_COLORS);
export function normalizePersonalTodoLabelColor(v: unknown): PersonalTodoLabelColor {
  return COLOR_SET.has(v as PersonalTodoLabelColor) ? (v as PersonalTodoLabelColor) : 'gray';
}

/** 사용자가 정의한 라벨(트렐로 스타일 색상 태그). 카드와 N:M으로 연결. */
export type PersonalTodoLabel = {
  id: string;
  userId: string;
  title: string;
  color: PersonalTodoLabelColor;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** 카드에 속한 체크리스트 항목 1건. */
export type PersonalTodoChecklistItem = {
  id: string;
  todoId: string;
  userId: string;
  text: string;
  done: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** 등록된 개인 To-Do 1건 */
export type PersonalTodo = {
  id: string;
  userId: string;
  title: string;
  /** 트렐로 카드의 'description' 역할(여러 줄 메모). 카드 요약에는 첫 줄·아이콘만 표시. */
  note: string;
  status: PersonalTodoStatus;
  /** 행(스윔레인) id. null = 기본/미분류 행 */
  rowId: string | null;
  sortOrder: number;
  /** 마감일. ISO 문자열(timestamptz). null = 미지정. */
  dueDate: string | null;
  /** 이 카드에 부착된 라벨 id 목록(라벨 정의는 fetchPersonalTodoLabels로 별도 조회). */
  labelIds: string[];
  /** 이 카드의 체크리스트 항목들(sortOrder 오름차순). */
  checklist: PersonalTodoChecklistItem[];
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
  dueDate: string | null;
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
  due_date: string | null;
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

type PersonalTodoLabelDbRow = {
  id: string;
  user_id: string;
  title: string | null;
  color: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

type PersonalTodoCardLabelDbRow = {
  todo_id: string;
  label_id: string;
  user_id: string;
};

type PersonalTodoChecklistItemDbRow = {
  id: string;
  todo_id: string;
  user_id: string;
  text: string | null;
  done: boolean | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

const TODO_COLUMNS = 'id, user_id, title, note, status, row_id, sort_order, due_date, created_at, updated_at';
const ROW_COLUMNS = 'id, user_id, label, sort_order, created_at, updated_at';
const LABEL_COLUMNS = 'id, user_id, title, color, sort_order, created_at, updated_at';
const CARD_LABEL_COLUMNS = 'todo_id, label_id, user_id';
const CHECKLIST_COLUMNS = 'id, todo_id, user_id, text, done, sort_order, created_at, updated_at';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown): boolean => v === true;

function mapTodoRow(r: PersonalTodoDbRow): PersonalTodo {
  return {
    id: r.id,
    userId: r.user_id,
    title: str(r.title),
    note: str(r.note),
    status: normalizePersonalTodoStatus(r.status),
    rowId: r.row_id ?? null,
    sortOrder: num(r.sort_order),
    dueDate: r.due_date ?? null,
    labelIds: [],
    checklist: [],
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

function mapLabelRow(r: PersonalTodoLabelDbRow): PersonalTodoLabel {
  return {
    id: r.id,
    userId: r.user_id,
    title: str(r.title),
    color: normalizePersonalTodoLabelColor(r.color),
    sortOrder: num(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapChecklistRow(r: PersonalTodoChecklistItemDbRow): PersonalTodoChecklistItem {
  return {
    id: r.id,
    todoId: r.todo_id,
    userId: r.user_id,
    text: str(r.text),
    done: bool(r.done),
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
function labelKey(userId: string): string {
  return `wbs.personalTodoLabels.${userId || 'anon'}`;
}
function cardLabelKey(userId: string): string {
  return `wbs.personalTodoCardLabels.${userId || 'anon'}`;
}
function checklistKey(userId: string): string {
  return `wbs.personalTodoChecklist.${userId || 'anon'}`;
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
      dueDate: strOrNull(r.dueDate),
      labelIds: [],
      checklist: [],
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveLocalTodos(userId: string, todos: PersonalTodo[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      // 라벨/체크리스트는 별도 키에 저장. 본 키에는 카드 원형만 둠.
      const slim = todos.map(({ labelIds: _l, checklist: _c, ...rest }) => rest);
      localStorage.setItem(todoKey(userId), JSON.stringify(slim));
    }
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

function loadLocalLabels(userId: string): PersonalTodoLabel[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(labelKey(userId)) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      id: str(r.id) || randomUUID(),
      userId: str(r.userId) || userId,
      title: str(r.title),
      color: normalizePersonalTodoLabelColor(r.color),
      sortOrder: num(r.sortOrder),
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveLocalLabels(userId: string, labels: PersonalTodoLabel[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(labelKey(userId), JSON.stringify(labels));
  } catch {
    /* 무시 */
  }
}

type LocalCardLabel = { todoId: string; labelId: string };
function loadLocalCardLabels(userId: string): LocalCardLabel[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(cardLabelKey(userId)) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r: Record<string, unknown>) => ({ todoId: str(r.todoId), labelId: str(r.labelId) }))
      .filter((r: LocalCardLabel) => r.todoId && r.labelId);
  } catch {
    return [];
  }
}

function saveLocalCardLabels(userId: string, links: LocalCardLabel[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(cardLabelKey(userId), JSON.stringify(links));
  } catch {
    /* 무시 */
  }
}

function loadLocalChecklist(userId: string): PersonalTodoChecklistItem[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(checklistKey(userId)) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      id: str(r.id) || randomUUID(),
      todoId: str(r.todoId),
      userId: str(r.userId) || userId,
      text: str(r.text),
      done: bool(r.done),
      sortOrder: num(r.sortOrder),
      createdAt: str(r.createdAt),
      updatedAt: str(r.updatedAt),
    }));
  } catch {
    return [];
  }
}

function saveLocalChecklist(userId: string, items: PersonalTodoChecklistItem[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(checklistKey(userId), JSON.stringify(items));
  } catch {
    /* 무시 */
  }
}

// ─── To-Do CRUD ───
/** 사용자의 개인 To-Do 전체 조회. 라벨/체크리스트도 함께 묶어 카드 객체에 채워준다. */
export async function fetchPersonalTodos(userId: string): Promise<PersonalTodo[]> {
  if (!userId) return [];
  if (isLocalOnly()) {
    const todos = loadLocalTodos(userId).sort((a, b) => a.status.localeCompare(b.status) || a.sortOrder - b.sortOrder);
    const links = loadLocalCardLabels(userId);
    const checklist = loadLocalChecklist(userId);
    const labelsByTodo = new Map<string, string[]>();
    for (const l of links) {
      const arr = labelsByTodo.get(l.todoId) ?? [];
      arr.push(l.labelId);
      labelsByTodo.set(l.todoId, arr);
    }
    const checklistByTodo = new Map<string, PersonalTodoChecklistItem[]>();
    for (const c of [...checklist].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))) {
      const arr = checklistByTodo.get(c.todoId) ?? [];
      arr.push(c);
      checklistByTodo.set(c.todoId, arr);
    }
    return todos.map((t) => ({
      ...t,
      labelIds: labelsByTodo.get(t.id) ?? [],
      checklist: checklistByTodo.get(t.id) ?? [],
    }));
  }
  const [{ data: todoData, error: todoErr }, { data: linkData, error: linkErr }, { data: chkData, error: chkErr }] = await Promise.all([
    supabase!
      .from('personal_todos')
      .select(TODO_COLUMNS)
      .eq('user_id', userId)
      .order('status', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase!.from('personal_todo_card_labels').select(CARD_LABEL_COLUMNS).eq('user_id', userId),
    supabase!
      .from('personal_todo_checklist_items')
      .select(CHECKLIST_COLUMNS)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true }),
  ]);
  if (todoErr) throw todoErr;
  if (linkErr) throw linkErr;
  if (chkErr) throw chkErr;

  const labelsByTodo = new Map<string, string[]>();
  for (const l of (linkData ?? []) as PersonalTodoCardLabelDbRow[]) {
    const arr = labelsByTodo.get(l.todo_id) ?? [];
    arr.push(l.label_id);
    labelsByTodo.set(l.todo_id, arr);
  }
  const checklistByTodo = new Map<string, PersonalTodoChecklistItem[]>();
  for (const c of (chkData ?? []) as PersonalTodoChecklistItemDbRow[]) {
    const item = mapChecklistRow(c);
    const arr = checklistByTodo.get(item.todoId) ?? [];
    arr.push(item);
    checklistByTodo.set(item.todoId, arr);
  }
  return ((todoData ?? []) as PersonalTodoDbRow[]).map((r) => {
    const base = mapTodoRow(r);
    return { ...base, labelIds: labelsByTodo.get(base.id) ?? [], checklist: checklistByTodo.get(base.id) ?? [] };
  });
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
      dueDate: null,
      labelIds: [],
      checklist: [],
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

/** 개인 To-Do 수정(제목·메모·상태·행·순서·마감일 일부). 본인 항목만 — RLS. */
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
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  const { data, error } = await supabase!.from('personal_todos').update(row).eq('id', id).select(TODO_COLUMNS).single();
  if (error) throw error;
  return mapTodoRow(data as PersonalTodoDbRow);
}

/** 개인 To-Do 삭제. 본인 항목만 — RLS. 라벨 매핑/체크리스트는 FK CASCADE로 함께 정리. */
export async function deletePersonalTodo(userId: string, id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalTodos(
      userId,
      loadLocalTodos(userId).filter((t) => t.id !== id),
    );
    saveLocalCardLabels(
      userId,
      loadLocalCardLabels(userId).filter((l) => l.todoId !== id),
    );
    saveLocalChecklist(
      userId,
      loadLocalChecklist(userId).filter((c) => c.todoId !== id),
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

// ─── 라벨 CRUD ───
/** 사용자가 정의한 라벨 전체 조회. */
export async function fetchPersonalTodoLabels(userId: string): Promise<PersonalTodoLabel[]> {
  if (!userId) return [];
  if (isLocalOnly()) {
    return loadLocalLabels(userId).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  }
  const { data, error } = await supabase!
    .from('personal_todo_labels')
    .select(LABEL_COLUMNS)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PersonalTodoLabelDbRow[]).map(mapLabelRow);
}

/** 라벨 추가. 색상은 팔레트 키. */
export async function insertPersonalTodoLabel(
  userId: string,
  input: { title: string; color: PersonalTodoLabelColor; sortOrder: number },
): Promise<PersonalTodoLabel> {
  if (isLocalOnly()) {
    const ts = nowIso();
    const created: PersonalTodoLabel = {
      id: randomUUID(),
      userId,
      title: input.title,
      color: input.color,
      sortOrder: input.sortOrder,
      createdAt: ts,
      updatedAt: ts,
    };
    const list = loadLocalLabels(userId);
    list.push(created);
    saveLocalLabels(userId, list);
    return created;
  }
  const { data, error } = await supabase!
    .from('personal_todo_labels')
    .insert({ user_id: userId, title: input.title, color: input.color, sort_order: input.sortOrder })
    .select(LABEL_COLUMNS)
    .single();
  if (error) throw error;
  return mapLabelRow(data as PersonalTodoLabelDbRow);
}

/** 라벨 수정(이름·색·순서). */
export async function updatePersonalTodoLabel(
  userId: string,
  id: string,
  patch: Partial<{ title: string; color: PersonalTodoLabelColor; sortOrder: number }>,
): Promise<PersonalTodoLabel> {
  if (isLocalOnly()) {
    const list = loadLocalLabels(userId);
    const idx = list.findIndex((l) => l.id === id);
    if (idx < 0) throw new Error('라벨을 찾을 수 없습니다.');
    const updated: PersonalTodoLabel = { ...list[idx], ...patch, updatedAt: nowIso() };
    list[idx] = updated;
    saveLocalLabels(userId, list);
    return updated;
  }
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { data, error } = await supabase!.from('personal_todo_labels').update(row).eq('id', id).select(LABEL_COLUMNS).single();
  if (error) throw error;
  return mapLabelRow(data as PersonalTodoLabelDbRow);
}

/** 라벨 삭제. (FK CASCADE로 personal_todo_card_labels에서도 함께 정리) */
export async function deletePersonalTodoLabel(userId: string, id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalLabels(
      userId,
      loadLocalLabels(userId).filter((l) => l.id !== id),
    );
    saveLocalCardLabels(
      userId,
      loadLocalCardLabels(userId).filter((l) => l.labelId !== id),
    );
    return;
  }
  const { error } = await supabase!.from('personal_todo_labels').delete().eq('id', id);
  if (error) throw error;
}

// ─── 카드 ↔ 라벨 매핑 ───
/** 카드에 라벨 부착(이미 있으면 무시). */
export async function attachPersonalTodoLabel(userId: string, todoId: string, labelId: string): Promise<void> {
  if (isLocalOnly()) {
    const list = loadLocalCardLabels(userId);
    if (list.some((l) => l.todoId === todoId && l.labelId === labelId)) return;
    list.push({ todoId, labelId });
    saveLocalCardLabels(userId, list);
    return;
  }
  const { error } = await supabase!
    .from('personal_todo_card_labels')
    .upsert({ todo_id: todoId, label_id: labelId, user_id: userId }, { onConflict: 'todo_id,label_id' });
  if (error) throw error;
}

/** 카드에서 라벨 분리. */
export async function detachPersonalTodoLabel(userId: string, todoId: string, labelId: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalCardLabels(
      userId,
      loadLocalCardLabels(userId).filter((l) => !(l.todoId === todoId && l.labelId === labelId)),
    );
    return;
  }
  const { error } = await supabase!.from('personal_todo_card_labels').delete().eq('todo_id', todoId).eq('label_id', labelId);
  if (error) throw error;
}

// ─── 체크리스트 CRUD ───
/** 체크리스트 항목 추가. */
export async function insertPersonalTodoChecklistItem(
  userId: string,
  input: { todoId: string; text: string; sortOrder: number },
): Promise<PersonalTodoChecklistItem> {
  if (isLocalOnly()) {
    const ts = nowIso();
    const item: PersonalTodoChecklistItem = {
      id: randomUUID(),
      todoId: input.todoId,
      userId,
      text: input.text,
      done: false,
      sortOrder: input.sortOrder,
      createdAt: ts,
      updatedAt: ts,
    };
    const list = loadLocalChecklist(userId);
    list.push(item);
    saveLocalChecklist(userId, list);
    return item;
  }
  const { data, error } = await supabase!
    .from('personal_todo_checklist_items')
    .insert({ todo_id: input.todoId, user_id: userId, text: input.text, sort_order: input.sortOrder })
    .select(CHECKLIST_COLUMNS)
    .single();
  if (error) throw error;
  return mapChecklistRow(data as PersonalTodoChecklistItemDbRow);
}

/** 체크리스트 항목 수정(텍스트·체크·순서). */
export async function updatePersonalTodoChecklistItem(
  userId: string,
  id: string,
  patch: Partial<{ text: string; done: boolean; sortOrder: number }>,
): Promise<PersonalTodoChecklistItem> {
  if (isLocalOnly()) {
    const list = loadLocalChecklist(userId);
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('체크리스트 항목을 찾을 수 없습니다.');
    const updated: PersonalTodoChecklistItem = { ...list[idx], ...patch, updatedAt: nowIso() };
    list[idx] = updated;
    saveLocalChecklist(userId, list);
    return updated;
  }
  const row: Record<string, unknown> = {};
  if (patch.text !== undefined) row.text = patch.text;
  if (patch.done !== undefined) row.done = patch.done;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { data, error } = await supabase!.from('personal_todo_checklist_items').update(row).eq('id', id).select(CHECKLIST_COLUMNS).single();
  if (error) throw error;
  return mapChecklistRow(data as PersonalTodoChecklistItemDbRow);
}

/** 체크리스트 항목 삭제. */
export async function deletePersonalTodoChecklistItem(userId: string, id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocalChecklist(
      userId,
      loadLocalChecklist(userId).filter((c) => c.id !== id),
    );
    return;
  }
  const { error } = await supabase!.from('personal_todo_checklist_items').delete().eq('id', id);
  if (error) throw error;
}
