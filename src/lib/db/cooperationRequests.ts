import { supabase, isSupabaseConfigured } from '../supabase';
import { isDevAuthBypass } from '../devAuthBypass';
import { randomUUID } from '../utils';

/** 요청구분 — 엑셀의 'Values' 시트 기준(자료/검토/협의/기타) */
export const COOPERATION_REQUEST_TYPES = ['자료', '검토', '협의', '기타'] as const;
export type CooperationRequestType = (typeof COOPERATION_REQUEST_TYPES)[number];

/** 중요도 — 엑셀 기준(상/중/하) */
export const COOPERATION_REQUEST_PRIORITIES = ['상', '중', '하'] as const;
export type CooperationRequestPriority = (typeof COOPERATION_REQUEST_PRIORITIES)[number];

/** 현황(상태) — 엑셀 기준(요청완료/진행중/지연/완료/회신불가) */
export const COOPERATION_REQUEST_STATUSES = ['요청완료', '진행중', '지연', '완료', '회신불가'] as const;
export type CooperationRequestStatus = (typeof COOPERATION_REQUEST_STATUSES)[number];

function normalizeType(v: unknown): CooperationRequestType {
  return (COOPERATION_REQUEST_TYPES as readonly string[]).includes(v as string) ? (v as CooperationRequestType) : '자료';
}
function normalizePriority(v: unknown): CooperationRequestPriority {
  return (COOPERATION_REQUEST_PRIORITIES as readonly string[]).includes(v as string) ? (v as CooperationRequestPriority) : '중';
}
function normalizeStatus(v: unknown): CooperationRequestStatus {
  return (COOPERATION_REQUEST_STATUSES as readonly string[]).includes(v as string) ? (v as CooperationRequestStatus) : '요청완료';
}

/** 담당 종류 — 인원 1명 또는 조직(부서/팀) 1개 */
export const COOPERATION_ASSIGNEE_KINDS = ['person', 'org'] as const;
export type CooperationAssigneeKind = (typeof COOPERATION_ASSIGNEE_KINDS)[number];
function normalizeAssigneeKind(v: unknown): CooperationAssigneeKind {
  return v === 'org' ? 'org' : 'person';
}

/**
 * 조직 대상일 때 멤버별 완료 추적용 1건.
 * - name/department/position: 사람 식별을 위한 표시 정보(스냅샷). 조직도가 바뀌어도 과거 이력은 그대로 보존된다.
 * - status: 협조 요청 전체 상태와 동일한 어휘. 인원 단위로 진척을 다르게 두기 위함.
 * - completedAt: '완료' 처리된 날짜.
 */
export type CooperationMemberProgress = {
  name: string;
  department: string;
  position: string;
  status: CooperationRequestStatus;
  completedAt: string;
};

/** 업무 협조 요청 1건 */
export type CooperationRequest = {
  id: string;
  /** 관리ID (예: REQ-001 / DRQ-001 등 자유 형식). 비어 있으면 화면에서 자동 채번. */
  mgmtId: string;
  /** 연결된 프로젝트(있을 때만). 운영용 표시·필터링에 사용. */
  projectId: string | null;
  /** 요청일 (YYYY-MM-DD, 비어 있을 수 있음) */
  requestDate: string;
  requestType: CooperationRequestType;
  title: string;
  detail: string;
  requester: string;
  /** 담당자(표시명). person이면 인원 이름, org이면 조직(부서) 이름. */
  assignee: string;
  /** 담당 종류: 인원 또는 조직 */
  assigneeKind: CooperationAssigneeKind;
  /** 조직 대상일 때 org_nodes.id (인원 대상이면 null) */
  assigneeOrgId: string | null;
  /** 조직 대상일 때 멤버별 추적. 인원 대상이면 빈 배열. */
  memberProgress: CooperationMemberProgress[];
  priority: CooperationRequestPriority;
  /** 기한·완료예정일 */
  dueDate: string;
  /** 진척률 (0~1). UI는 %로 표시. */
  progress: number;
  status: CooperationRequestStatus;
  /** 결과·회신 내용(여러 줄/이력) */
  result: string;
  completedDate: string;
  delayReason: string;
  note: string;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 신규 등록 입력 */
export type CooperationRequestInput = Omit<CooperationRequest, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

/** 부분 수정 입력 */
export type CooperationRequestPatch = Partial<Omit<CooperationRequest, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>>;

type CooperationRequestDbRow = {
  id: string;
  mgmt_id: string | null;
  project_id: string | null;
  request_date: string | null;
  request_type: string | null;
  title: string | null;
  detail: string | null;
  requester: string | null;
  assignee: string | null;
  assignee_kind: string | null;
  assignee_org_id: string | null;
  member_progress: unknown;
  priority: string | null;
  due_date: string | null;
  progress: number | null;
  status: string | null;
  result: string | null;
  completed_date: string | null;
  delay_reason: string | null;
  note: string | null;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = 'cooperation_requests';
const COLUMNS =
  'id, mgmt_id, project_id, request_date, request_type, title, detail, requester, assignee, assignee_kind, assignee_org_id, member_progress, priority, due_date, progress, status, result, completed_date, delay_reason, note, sort_order, created_by, created_at, updated_at';

/** 멤버 진행 항목 정규화 — DB/localStorage에서 들어온 값이 어떤 형태든 안전하게 다듬는다. */
function normalizeMemberProgress(raw: unknown): CooperationMemberProgress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): CooperationMemberProgress | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      if (!name) return null;
      return {
        name,
        department: typeof o.department === 'string' ? o.department : '',
        position: typeof o.position === 'string' ? o.position : '',
        status: normalizeStatus(o.status),
        completedAt: typeof o.completedAt === 'string' ? o.completedAt : '',
      };
    })
    .filter((x): x is CooperationMemberProgress => x !== null);
}

/**
 * 조직 대상 요청의 집계 진척률 계산: 완료(상태='완료') 멤버 / 전체 멤버. 분모 0이면 0.
 * 인원 대상이면 호출자가 직접 manage하는 progress를 그대로 사용한다.
 */
export function computeOrgProgress(memberProgress: CooperationMemberProgress[]): number {
  if (memberProgress.length === 0) return 0;
  const done = memberProgress.filter((m) => m.status === '완료').length;
  return done / memberProgress.length;
}

/**
 * 조직 대상 요청의 집계 상태(요청완료/진행중/완료) 추론:
 * - 모두 '완료' → '완료'
 * - 하나라도 '완료' 또는 '진행중' → '진행중'
 * - 그 외(전원 요청완료) → '요청완료'
 * - 멤버가 없으면 '요청완료'
 */
export function computeOrgStatus(memberProgress: CooperationMemberProgress[]): CooperationRequestStatus {
  if (memberProgress.length === 0) return '요청완료';
  const allDone = memberProgress.every((m) => m.status === '완료');
  if (allDone) return '완료';
  const anyActive = memberProgress.some((m) => m.status === '완료' || m.status === '진행중');
  return anyActive ? '진행중' : '요청완료';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function mapRow(r: CooperationRequestDbRow): CooperationRequest {
  return {
    id: r.id,
    mgmtId: str(r.mgmt_id),
    projectId: r.project_id ?? null,
    requestDate: str(r.request_date),
    requestType: normalizeType(r.request_type),
    title: str(r.title),
    detail: str(r.detail),
    requester: str(r.requester),
    assignee: str(r.assignee),
    assigneeKind: normalizeAssigneeKind(r.assignee_kind),
    assigneeOrgId: r.assignee_org_id ?? null,
    memberProgress: normalizeMemberProgress(r.member_progress),
    priority: normalizePriority(r.priority),
    dueDate: str(r.due_date),
    progress: clampProgress(num(r.progress)),
    status: normalizeStatus(r.status),
    result: str(r.result),
    completedDate: str(r.completed_date),
    delayReason: str(r.delay_reason),
    note: str(r.note),
    sortOrder: num(r.sort_order),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 진척률은 항상 0~1 범위로 저장(엑셀 형식과 동일). UI는 %로 변환. */
export function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ── 로컬 전용(dev 우회) 폴백: localStorage ──
function isLocalOnly(): boolean {
  return isDevAuthBypass() || !isSupabaseConfigured || !supabase;
}
const LOCAL_KEY = 'wbs.cooperationRequests.v1';
const nowIso = () => new Date().toISOString();

function loadLocal(): CooperationRequest[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map(
      (r: Record<string, unknown>): CooperationRequest => ({
        id: str(r.id) || randomUUID(),
        mgmtId: str(r.mgmtId),
        projectId: (r.projectId as string | null) ?? null,
        requestDate: str(r.requestDate),
        requestType: normalizeType(r.requestType),
        title: str(r.title),
        detail: str(r.detail),
        requester: str(r.requester),
        assignee: str(r.assignee),
        assigneeKind: normalizeAssigneeKind(r.assigneeKind),
        assigneeOrgId: typeof r.assigneeOrgId === 'string' ? r.assigneeOrgId : null,
        memberProgress: normalizeMemberProgress(r.memberProgress),
        priority: normalizePriority(r.priority),
        dueDate: str(r.dueDate),
        progress: clampProgress(num(r.progress)),
        status: normalizeStatus(r.status),
        result: str(r.result),
        completedDate: str(r.completedDate),
        delayReason: str(r.delayReason),
        note: str(r.note),
        sortOrder: num(r.sortOrder),
        createdBy: (r.createdBy as string | null) ?? null,
        createdAt: str(r.createdAt) || nowIso(),
        updatedAt: str(r.updatedAt) || nowIso(),
      }),
    );
  } catch {
    return [];
  }
}

function saveLocal(rows: CooperationRequest[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  } catch {
    /* quota 등 무시 */
  }
}

/** 화면 정렬: 정렬값(작을수록 위) → 관리ID 역순 → 요청일 역순(없으면 생성일). */
function sortRows(rows: CooperationRequest[]): CooperationRequest[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const am = a.mgmtId || '';
    const bm = b.mgmtId || '';
    if (am !== bm) return bm.localeCompare(am, 'en');
    const ad = a.requestDate || a.createdAt || '';
    const bd = b.requestDate || b.createdAt || '';
    return bd.localeCompare(ad);
  });
}

/** 전체 조회(공유) */
export async function fetchCooperationRequests(): Promise<CooperationRequest[]> {
  if (isLocalOnly()) return sortRows(loadLocal());
  const { data, error } = await supabase!.from(TABLE).select(COLUMNS).order('sort_order', { ascending: true });
  if (error) throw error;
  return sortRows(((data ?? []) as CooperationRequestDbRow[]).map(mapRow));
}

/**
 * 새 관리ID(prefix-###) 자동 생성: 기존 목록의 같은 prefix 최대 번호 + 1, 3자리 zero-pad.
 * 엑셀에서 가져온 기존 데이터의 prefix(예: DRQ)를 유지하려면 prefix 인자에 그 값을 넘긴다.
 */
export function nextMgmtId(rows: CooperationRequest[], prefix = 'REQ'): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const max = rows.reduce((acc, r) => {
    const m = re.exec(r.mgmtId || '');
    if (!m) return acc;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  const next = max + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

export async function insertCooperationRequest(userId: string | null, input: CooperationRequestInput): Promise<CooperationRequest> {
  if (isLocalOnly()) {
    const ts = nowIso();
    const row: CooperationRequest = {
      ...input,
      progress: clampProgress(input.progress),
      requestType: normalizeType(input.requestType),
      priority: normalizePriority(input.priority),
      status: normalizeStatus(input.status),
      assigneeKind: normalizeAssigneeKind(input.assigneeKind),
      memberProgress: normalizeMemberProgress(input.memberProgress),
      id: randomUUID(),
      createdBy: userId,
      createdAt: ts,
      updatedAt: ts,
    };
    const list = loadLocal();
    list.push(row);
    saveLocal(list);
    return row;
  }
  const payload: Record<string, unknown> = {
    mgmt_id: input.mgmtId,
    project_id: input.projectId,
    request_date: input.requestDate || null,
    request_type: normalizeType(input.requestType),
    title: input.title,
    detail: input.detail,
    requester: input.requester,
    assignee: input.assignee,
    assignee_kind: normalizeAssigneeKind(input.assigneeKind),
    assignee_org_id: input.assigneeOrgId,
    member_progress: normalizeMemberProgress(input.memberProgress),
    priority: normalizePriority(input.priority),
    due_date: input.dueDate || null,
    progress: clampProgress(input.progress),
    status: normalizeStatus(input.status),
    result: input.result,
    completed_date: input.completedDate || null,
    delay_reason: input.delayReason,
    note: input.note,
    sort_order: input.sortOrder,
    created_by: userId,
  };
  const { data, error } = await supabase!.from(TABLE).insert(payload).select(COLUMNS).single();
  if (error) throw error;
  return mapRow(data as CooperationRequestDbRow);
}

export async function updateCooperationRequest(id: string, patch: CooperationRequestPatch): Promise<CooperationRequest> {
  if (isLocalOnly()) {
    const list = loadLocal();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('항목을 찾을 수 없습니다.');
    const merged: CooperationRequest = {
      ...list[idx],
      ...patch,
      progress: patch.progress !== undefined ? clampProgress(patch.progress) : list[idx].progress,
      requestType: patch.requestType !== undefined ? normalizeType(patch.requestType) : list[idx].requestType,
      priority: patch.priority !== undefined ? normalizePriority(patch.priority) : list[idx].priority,
      status: patch.status !== undefined ? normalizeStatus(patch.status) : list[idx].status,
      assigneeKind: patch.assigneeKind !== undefined ? normalizeAssigneeKind(patch.assigneeKind) : list[idx].assigneeKind,
      memberProgress: patch.memberProgress !== undefined ? normalizeMemberProgress(patch.memberProgress) : list[idx].memberProgress,
      updatedAt: nowIso(),
    };
    list[idx] = merged;
    saveLocal(list);
    return merged;
  }
  const payload: Record<string, unknown> = {};
  if (patch.mgmtId !== undefined) payload.mgmt_id = patch.mgmtId;
  if (patch.projectId !== undefined) payload.project_id = patch.projectId;
  if (patch.requestDate !== undefined) payload.request_date = patch.requestDate || null;
  if (patch.requestType !== undefined) payload.request_type = normalizeType(patch.requestType);
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.detail !== undefined) payload.detail = patch.detail;
  if (patch.requester !== undefined) payload.requester = patch.requester;
  if (patch.assignee !== undefined) payload.assignee = patch.assignee;
  if (patch.assigneeKind !== undefined) payload.assignee_kind = normalizeAssigneeKind(patch.assigneeKind);
  if (patch.assigneeOrgId !== undefined) payload.assignee_org_id = patch.assigneeOrgId;
  if (patch.memberProgress !== undefined) payload.member_progress = normalizeMemberProgress(patch.memberProgress);
  if (patch.priority !== undefined) payload.priority = normalizePriority(patch.priority);
  if (patch.dueDate !== undefined) payload.due_date = patch.dueDate || null;
  if (patch.progress !== undefined) payload.progress = clampProgress(patch.progress);
  if (patch.status !== undefined) payload.status = normalizeStatus(patch.status);
  if (patch.result !== undefined) payload.result = patch.result;
  if (patch.completedDate !== undefined) payload.completed_date = patch.completedDate || null;
  if (patch.delayReason !== undefined) payload.delay_reason = patch.delayReason;
  if (patch.note !== undefined) payload.note = patch.note;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  const { data, error } = await supabase!.from(TABLE).update(payload).eq('id', id).select(COLUMNS).single();
  if (error) throw error;
  return mapRow(data as CooperationRequestDbRow);
}

export async function deleteCooperationRequest(id: string): Promise<void> {
  if (isLocalOnly()) {
    saveLocal(loadLocal().filter((r) => r.id !== id));
    return;
  }
  const { error } = await supabase!.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

/** 빈 항목 기본값(폼 초기값). 요청일은 오늘로. */
export function makeEmptyCooperationRequest(overrides?: Partial<CooperationRequestInput>): CooperationRequestInput {
  const today = new Date().toISOString().slice(0, 10);
  return {
    mgmtId: '',
    projectId: null,
    requestDate: today,
    requestType: '자료',
    title: '',
    detail: '',
    requester: '',
    assignee: '',
    assigneeKind: 'person',
    assigneeOrgId: null,
    memberProgress: [],
    priority: '중',
    dueDate: '',
    progress: 0,
    status: '요청완료',
    result: '',
    completedDate: '',
    delayReason: '',
    note: '',
    sortOrder: 0,
    ...overrides,
  };
}
