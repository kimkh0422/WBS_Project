import { supabase, isSupabaseConfigured } from '../supabase';
import { isDevAuthBypass } from '../devAuthBypass';
import { randomUUID } from '../utils';

/** 요청구분 — 엑셀의 'Values' 시트 기준(자료/검토/협의/기타) */
export const COOPERATION_REQUEST_TYPES = ['자료', '검토', '협의', '기타'] as const;
export type CooperationRequestType = (typeof COOPERATION_REQUEST_TYPES)[number];

/** 중요도 — 엑셀 기준(상/중/하) */
export const COOPERATION_REQUEST_PRIORITIES = ['상', '중', '하'] as const;
export type CooperationRequestPriority = (typeof COOPERATION_REQUEST_PRIORITIES)[number];

/**
 * 현황(상태) — 5단계 워크플로:
 *   요청완료 → 진행중 → 처리완료(담당자 처리 끝) → 확인완료(요청자 최종 확인)
 *   또는 어느 단계에서나 취소됨 으로 종료
 *
 * 과거 어휘(지연·완료·회신불가)는 normalizeStatus 에서 자동 이행한다.
 */
export const COOPERATION_REQUEST_STATUSES = ['요청완료', '진행중', '처리완료', '확인완료', '취소됨'] as const;
export type CooperationRequestStatus = (typeof COOPERATION_REQUEST_STATUSES)[number];

/** 종료 상태(완료/취소). 진척률·자동 완료일·기한초과 알림 판정에 사용. */
export const DONE_STATUSES: ReadonlySet<CooperationRequestStatus> = new Set<CooperationRequestStatus>(['처리완료', '확인완료', '취소됨']);

function normalizeType(v: unknown): CooperationRequestType {
  return (COOPERATION_REQUEST_TYPES as readonly string[]).includes(v as string) ? (v as CooperationRequestType) : '자료';
}
function normalizePriority(v: unknown): CooperationRequestPriority {
  return (COOPERATION_REQUEST_PRIORITIES as readonly string[]).includes(v as string) ? (v as CooperationRequestPriority) : '중';
}
/** 신·구 어휘 통합 매핑: '완료'→'처리완료', '회신불가'→'취소됨', '지연'→'진행중'. 알 수 없는 값은 '요청완료'. */
function normalizeStatus(v: unknown): CooperationRequestStatus {
  if (typeof v !== 'string') return '요청완료';
  if ((COOPERATION_REQUEST_STATUSES as readonly string[]).includes(v)) return v as CooperationRequestStatus;
  if (v === '완료') return '처리완료';
  if (v === '회신불가') return '취소됨';
  if (v === '지연') return '진행중';
  return '요청완료';
}

/**
 * 담당 종류 — 다중 선택 모델:
 * - 'person' = 인원만 선택됨
 * - 'org'    = 조직만 선택됨
 * - 'mixed'  = 조직 + 인원 혼합
 * 표시(아이콘 등) 보조용. 실제 선택 정보는 assigneeOrgIds + memberProgress(direct=true)에 있다.
 */
export const COOPERATION_ASSIGNEE_KINDS = ['person', 'org', 'mixed'] as const;
export type CooperationAssigneeKind = (typeof COOPERATION_ASSIGNEE_KINDS)[number];
function normalizeAssigneeKind(v: unknown): CooperationAssigneeKind {
  return v === 'org' || v === 'mixed' ? v : 'person';
}

/** 조직 ID(들) + 직접 추가 인원 정보에서 kind를 자동 추론. */
export function deriveAssigneeKind(orgIds: string[], directPersonCount: number): CooperationAssigneeKind {
  const hasOrg = orgIds.length > 0;
  const hasPerson = directPersonCount > 0;
  if (hasOrg && hasPerson) return 'mixed';
  if (hasOrg) return 'org';
  return 'person';
}

/**
 * 협조요청 상태(현황) 변경 이력 1건. 트리거(서버) 또는 클라이언트가 자동으로 누적.
 * - status: 변경된 후의 새 상태
 * - at: 변경 시각 (ISO 8601 UTC)
 */
export type CooperationStatusHistoryEntry = {
  status: CooperationRequestStatus;
  at: string;
};

/** 멤버 RACI 역할(부서간 협업 프로세스 V1.0 중기 ①). 기본값 'R'. */
export const COOPERATION_RACI_KINDS = ['R', 'A', 'C', 'I'] as const;
export type CooperationRaci = (typeof COOPERATION_RACI_KINDS)[number];
export const COOPERATION_RACI_LABEL: Record<CooperationRaci, string> = {
  R: '실무자',
  A: '의사결정자',
  C: '협의처',
  I: '공유처',
};
function normalizeRaci(v: unknown): CooperationRaci {
  return v === 'A' || v === 'C' || v === 'I' ? v : 'R';
}

/**
 * 회의록 Action Plan 항목 — "회의록 = Action Plan 중심"(단기 ③) 적용.
 * 담당자·내용·완료기한·완료체크.
 */
export type CooperationMeetingAction = {
  id: string;
  assignee: string;
  task: string;
  dueDate: string;
  done: boolean;
};

/**
 * 회의록 1건 — 협조요청에 누적되는 회의 시계열 기록.
 * - id: 행 식별(편집/삭제용)
 * - date: 회의일 (YYYY-MM-DD)
 * - title: 회의 제목·안건(선택)
 * - content: 회의 내용
 * - createdAt: 등록 시각(ISO)
 * - createdBy: 등록자 user.id (없으면 null)
 */
export type CooperationMeetingLog = {
  id: string;
  date: string;
  title: string;
  content: string;
  /** Action Plan 항목들 — 담당자·내용·완료기한·완료체크 */
  actions: CooperationMeetingAction[];
  createdAt: string;
  createdBy: string | null;
};

/**
 * 멤버별 완료 추적용 1건.
 * - name/department/position: 사람 식별을 위한 표시 정보(스냅샷). 조직도가 바뀌어도 과거 이력은 그대로 보존된다.
 * - status: 협조 요청 전체 상태와 동일한 어휘. 인원 단위로 진척을 다르게 두기 위함.
 * - completedAt: '완료' 처리된 날짜.
 * - sourceOrgIds: 이 멤버가 자동 포함된 조직(들)의 id. 다중 조직 선택 시 한 멤버가 둘 이상의 조직에 속해도 1행만 유지.
 * - direct: 인원 picker로 직접 추가한 경우 true. 조직 자동 추가만 있다면 false.
 *   - 조직 선택 해제 시 sourceOrgIds 갱신 후 sourceOrgIds가 비고 direct=false 이면 항목 제거.
 */
export type CooperationMemberProgress = {
  name: string;
  department: string;
  position: string;
  status: CooperationRequestStatus;
  completedAt: string;
  sourceOrgIds: string[];
  direct: boolean;
  /** RACI 역할 (기본 'R'). UI에서 라벨 변경 가능. */
  raci: CooperationRaci;
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
  /** 구체적 산출물(deliverable) — 표준 요청서의 핵심 4요소 중 하나. 비어 있을 수 있음. */
  deliverables: string;
  /** 공유처/참조자 — 쉼표·세미콜론·공백 구분, 이름 또는 이메일. 알림 메일 CC로 자동 반영. */
  informees: string;
  requester: string;
  /** 담당자(표시명). 다중 선택 시 "운영기술개발실, 김길용 외 2명" 같이 합산해 표시. */
  assignee: string;
  /** 담당 종류 자동 추론값(person/org/mixed). 표시·필터링 보조용. */
  assigneeKind: CooperationAssigneeKind;
  /** 선택된 조직(부서/팀) ID 0..N개. */
  assigneeOrgIds: string[];
  /** 호환용 단일 컬럼(첫 번째 org id). 신규 로직은 assigneeOrgIds 사용. */
  assigneeOrgId: string | null;
  /** 인원 단위 진행 추적. 조직 자동 멤버 + direct로 추가한 인원 모두 포함. */
  memberProgress: CooperationMemberProgress[];
  /** 회의록 누적 기록 — 진행 중 회의 결과 시계열. */
  meetingLogs: CooperationMeetingLog[];
  /** 현황 변경 이력 — 단계별 진입 시각 추적용. 트리거가 자동 누적. */
  statusHistory: CooperationStatusHistoryEntry[];
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
  deliverables: string | null;
  informees: string | null;
  requester: string | null;
  assignee: string | null;
  assignee_kind: string | null;
  assignee_org_id: string | null;
  assignee_org_ids: string[] | null;
  member_progress: unknown;
  meeting_logs: unknown;
  status_history: unknown;
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
  'id, mgmt_id, project_id, request_date, request_type, title, detail, deliverables, informees, requester, assignee, assignee_kind, assignee_org_id, assignee_org_ids, member_progress, meeting_logs, status_history, priority, due_date, progress, status, result, completed_date, delay_reason, note, sort_order, created_by, created_at, updated_at';

/** 멤버 진행 항목 정규화 — DB/localStorage에서 들어온 값이 어떤 형태든 안전하게 다듬는다.
 *  과거에 sourceOrgIds/direct 없이 저장된 행도 안전하게 호환:
 *  - sourceOrgIds 누락 → 빈 배열
 *  - direct 누락 → false (단, sourceOrgIds도 비어 있으면 legacy 단일 조직 데이터로 간주해 direct=true로 보정) */
function normalizeMemberProgress(raw: unknown): CooperationMemberProgress[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): CooperationMemberProgress | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name : '';
      if (!name) return null;
      const sourceOrgIds = Array.isArray(o.sourceOrgIds) ? o.sourceOrgIds.filter((x): x is string => typeof x === 'string') : [];
      const directRaw = o.direct;
      const direct = typeof directRaw === 'boolean' ? directRaw : sourceOrgIds.length === 0;
      return {
        name,
        department: typeof o.department === 'string' ? o.department : '',
        position: typeof o.position === 'string' ? o.position : '',
        status: normalizeStatus(o.status),
        completedAt: typeof o.completedAt === 'string' ? o.completedAt : '',
        sourceOrgIds,
        direct,
        raci: normalizeRaci(o.raci),
      };
    })
    .filter((x): x is CooperationMemberProgress => x !== null);
}

/** 회의록 Action Plan 항목 1건 정규화. */
function normalizeMeetingAction(raw: unknown): CooperationMeetingAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const task = typeof o.task === 'string' ? o.task : '';
  const assignee = typeof o.assignee === 'string' ? o.assignee : '';
  if (!task && !assignee) return null;
  return {
    id: typeof o.id === 'string' && o.id ? o.id : randomUUID(),
    assignee,
    task,
    dueDate: typeof o.dueDate === 'string' ? o.dueDate : '',
    done: o.done === true,
  };
}

/** orgIds 문자열 배열 정규화. */
function normalizeOrgIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** 상태 변경 이력 배열 정규화 */
function normalizeStatusHistory(raw: unknown): CooperationStatusHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): CooperationStatusHistoryEntry | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const status = normalizeStatus(o.status);
      const at = typeof o.at === 'string' ? o.at : '';
      if (!at) return null;
      return { status, at };
    })
    .filter((x): x is CooperationStatusHistoryEntry => x !== null);
}

/** 회의록 배열 정규화 — DB/localStorage 어떤 형태든 안전하게 다듬음. */
function normalizeMeetingLogs(raw: unknown): CooperationMeetingLog[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): CooperationMeetingLog | null => {
      if (!r || typeof r !== 'object') return null;
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' && o.id ? o.id : randomUUID();
      const date = typeof o.date === 'string' ? o.date : '';
      const title = typeof o.title === 'string' ? o.title : '';
      const content = typeof o.content === 'string' ? o.content : '';
      if (!date && !title && !content) return null;
      const actions: CooperationMeetingAction[] = Array.isArray(o.actions)
        ? o.actions.map(normalizeMeetingAction).filter((x): x is CooperationMeetingAction => x !== null)
        : [];
      return {
        id,
        date,
        title,
        content,
        actions,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
        createdBy: typeof o.createdBy === 'string' ? o.createdBy : null,
      };
    })
    .filter((x): x is CooperationMeetingLog => x !== null);
}

/**
 * 조직 대상 요청의 집계 진척률 계산.
 * - 분모: 취소되지 않은 멤버 수(취소됨 제외)
 * - 분자: 처리완료 또는 확인완료 멤버 수
 * - 분모 0이면 0
 */
export function computeOrgProgress(memberProgress: CooperationMemberProgress[]): number {
  if (memberProgress.length === 0) return 0;
  const active = memberProgress.filter((m) => m.status !== '취소됨');
  if (active.length === 0) return 0;
  const done = active.filter((m) => m.status === '처리완료' || m.status === '확인완료').length;
  return done / active.length;
}

/**
 * 조직 대상 요청의 집계 상태 추론(취소됨 멤버는 분모 제외):
 * - 멤버 0명 → 요청완료
 * - 전원 취소됨 → 취소됨
 * - 활성 전원 확인완료 → 확인완료
 * - 활성 전원 처리완료/확인완료 → 처리완료
 * - 활성 중 진행중·처리완료·확인완료 1명이라도 → 진행중
 * - 그 외(활성 전원 요청완료) → 요청완료
 */
export function computeOrgStatus(memberProgress: CooperationMemberProgress[]): CooperationRequestStatus {
  if (memberProgress.length === 0) return '요청완료';
  const active = memberProgress.filter((m) => m.status !== '취소됨');
  if (active.length === 0) return '취소됨';
  if (active.every((m) => m.status === '확인완료')) return '확인완료';
  if (active.every((m) => m.status === '처리완료' || m.status === '확인완료')) return '처리완료';
  const anyActive = active.some((m) => m.status === '진행중' || m.status === '처리완료' || m.status === '확인완료');
  if (anyActive) return '진행중';
  return '요청완료';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function mapRow(r: CooperationRequestDbRow): CooperationRequest {
  // 마이그레이션 직후 일부 행에 assignee_org_ids 가 비어 있을 수 있어 단일 assignee_org_id 로 폴백.
  const orgIds = normalizeOrgIds(r.assignee_org_ids);
  const orgIdsResolved = orgIds.length > 0 ? orgIds : r.assignee_org_id ? [r.assignee_org_id] : [];
  return {
    id: r.id,
    mgmtId: str(r.mgmt_id),
    projectId: r.project_id ?? null,
    requestDate: str(r.request_date),
    requestType: normalizeType(r.request_type),
    title: str(r.title),
    detail: str(r.detail),
    deliverables: str(r.deliverables),
    informees: str(r.informees),
    requester: str(r.requester),
    assignee: str(r.assignee),
    assigneeKind: normalizeAssigneeKind(r.assignee_kind),
    assigneeOrgIds: orgIdsResolved,
    assigneeOrgId: r.assignee_org_id ?? orgIdsResolved[0] ?? null,
    memberProgress: normalizeMemberProgress(r.member_progress),
    meetingLogs: normalizeMeetingLogs(r.meeting_logs),
    statusHistory: normalizeStatusHistory(r.status_history),
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
        deliverables: str(r.deliverables),
        informees: str(r.informees),
        requester: str(r.requester),
        assignee: str(r.assignee),
        assigneeKind: normalizeAssigneeKind(r.assigneeKind),
        assigneeOrgIds: (() => {
          const arr = normalizeOrgIds(r.assigneeOrgIds);
          if (arr.length > 0) return arr;
          const single = typeof r.assigneeOrgId === 'string' ? r.assigneeOrgId : '';
          return single ? [single] : [];
        })(),
        assigneeOrgId: typeof r.assigneeOrgId === 'string' ? r.assigneeOrgId : null,
        memberProgress: normalizeMemberProgress(r.memberProgress),
        meetingLogs: normalizeMeetingLogs(r.meetingLogs),
        statusHistory: normalizeStatusHistory(r.statusHistory),
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
    const orgIds = normalizeOrgIds(input.assigneeOrgIds);
    const row: CooperationRequest = {
      ...input,
      progress: clampProgress(input.progress),
      requestType: normalizeType(input.requestType),
      priority: normalizePriority(input.priority),
      status: normalizeStatus(input.status),
      assigneeKind: normalizeAssigneeKind(input.assigneeKind),
      assigneeOrgIds: orgIds,
      assigneeOrgId: orgIds[0] ?? input.assigneeOrgId ?? null,
      memberProgress: normalizeMemberProgress(input.memberProgress),
      meetingLogs: normalizeMeetingLogs(input.meetingLogs),
      // localStorage 모드: 첫 상태로 history 초기화 (서버 모드는 DB 트리거가 처리)
      statusHistory: [{ status: normalizeStatus(input.status), at: ts }],
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
  const orgIds = normalizeOrgIds(input.assigneeOrgIds);
  const payload: Record<string, unknown> = {
    mgmt_id: input.mgmtId,
    project_id: input.projectId,
    request_date: input.requestDate || null,
    request_type: normalizeType(input.requestType),
    title: input.title,
    detail: input.detail,
    deliverables: input.deliverables,
    informees: input.informees,
    requester: input.requester,
    assignee: input.assignee,
    assignee_kind: normalizeAssigneeKind(input.assigneeKind),
    assignee_org_id: orgIds[0] ?? input.assigneeOrgId ?? null,
    assignee_org_ids: orgIds,
    member_progress: normalizeMemberProgress(input.memberProgress),
    meeting_logs: normalizeMeetingLogs(input.meetingLogs),
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
  const mapped = mapRow(data as CooperationRequestDbRow);
  // 알림 발송(메일·텔레그램) — 실패해도 등록 자체는 성공으로 처리(채널 미설정 환경에서도 동작).
  void notifyCooperation(mapped.id, 'created');
  return mapped;
}

/** Edge Function 배포·발송 채널 설정이 끝났는지 여부. 활성 조건(둘 중 하나):
 *  - 빌드 시 환경변수(envKey)=1 설정 (예: VITE_COOPERATION_EMAIL_ENABLED)
 *  - 런타임에 localStorage(storageKey)='1' 로 토글
 *  기본값은 OFF — 배포 전 fetch 가 일어나 콘솔에 CORS/네트워크 에러가 찍히는 것을 막는다. */
function isCooperationChannelEnabled(envKey: string, storageKey: string): boolean {
  try {
    const env = (import.meta.env as Record<string, unknown>)[envKey];
    if (env === '1' || env === 'true' || env === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1') return true;
  } catch {
    /* 안전한 기본값 OFF */
  }
  return false;
}

type CooperationNotifyMode = 'created' | 'updated' | 'status-change';

/** 채널 1개(Edge Function 1개) 호출. 실패는 조용히 무시 — 알림은 협조요청 동작을 막지 않는다. */
async function invokeCooperationNotify(fn: string, requestId: string, mode: CooperationNotifyMode): Promise<void> {
  try {
    await supabase!.functions.invoke(fn, { body: { requestId, mode } });
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn(`[cooperation] ${fn} 호출 실패:`, e);
  }
}

/**
 * 협조 요청 알림 — 활성화된 채널(메일·텔레그램)별 Supabase Edge Function 호출.
 * - 메일:     send-cooperation-email     (VITE_COOPERATION_EMAIL_ENABLED / wbs.cooperationEmail.enabled)
 * - 텔레그램: send-cooperation-telegram  (VITE_COOPERATION_TELEGRAM_ENABLED / wbs.cooperationTelegram.enabled)
 * 채널 토글은 서로 독립. 활성화 토글 OFF 또는 로컬 dev 우회 모드면 fetch 시도 자체를 건너뛴다.
 */
async function notifyCooperation(requestId: string, mode: CooperationNotifyMode): Promise<void> {
  if (isLocalOnly()) return;
  const calls: Array<Promise<void>> = [];
  if (isCooperationChannelEnabled('VITE_COOPERATION_EMAIL_ENABLED', 'wbs.cooperationEmail.enabled')) {
    calls.push(invokeCooperationNotify('send-cooperation-email', requestId, mode));
  }
  if (isCooperationChannelEnabled('VITE_COOPERATION_TELEGRAM_ENABLED', 'wbs.cooperationTelegram.enabled')) {
    calls.push(invokeCooperationNotify('send-cooperation-telegram', requestId, mode));
  }
  if (calls.length > 0) await Promise.all(calls);
}

/** 채널 1개(Edge Function 1개) 수동 전파 결과. ok=true 면 sent(발송 건수), 아니면 skipped(미발송 사유) 또는 error. */
export type ChannelBroadcastResult = { ok: boolean; sent?: number; skipped?: string; error?: string };

/** 텔레그램·메일 두 채널 동시 전파 결과. */
export type CooperationBroadcastResult = { telegram: ChannelBroadcastResult; email: ChannelBroadcastResult };

/** 단일 채널(Edge Function) 수동 호출 → sent/skipped/error 를 표준 결과로 정규화. throw 하지 않는다. */
async function invokeBroadcastChannel(fn: string, requestId: string): Promise<ChannelBroadcastResult> {
  try {
    const { data, error } = await supabase!.functions.invoke(fn, { body: { requestId, mode: 'created' } });
    if (error) {
      // FunctionsHttpError(비2xx) 등 — 가능하면 본문의 사유를 꺼내 보여준다.
      const ctx = (error as { context?: { error?: string; reason?: string } }).context;
      return { ok: false, error: ctx?.error ?? ctx?.reason ?? error.message };
    }
    const d = (data ?? {}) as { sent?: number; skipped?: string | boolean; reason?: string; error?: string };
    if (typeof d.sent === 'number' && d.sent > 0) return { ok: true, sent: d.sent };
    if (d.error) return { ok: false, error: String(d.error) };
    if (d.skipped) return { ok: false, skipped: typeof d.skipped === 'string' ? d.skipped : (d.reason ?? '수신 대상 없음') };
    return { ok: false, skipped: '수신 대상 없음' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '전파 호출에 실패했습니다.' };
  }
}

/**
 * 협조 요청을 **수동으로 즉시 전파**한다 — 텔레그램·메일 두 채널 동시(자동 토글과 무관, 명시적 사용자 액션).
 * - 대상 행은 이미 DB에 저장돼 있어야 한다(Edge Function 이 requestId 로 행을 읽음). 새 미저장 항목은 먼저 저장 필요.
 * - 로컬 dev 우회 모드면 호출 불가 → 양쪽 skipped 반환.
 * - 각 채널의 미배포/미설정·수신자 없음 등은 throw 하지 않고 채널별 결과로 돌려준다(호출부에서 토스트 안내).
 */
export async function broadcastCooperation(requestId: string): Promise<CooperationBroadcastResult> {
  if (isLocalOnly()) {
    const skipped: ChannelBroadcastResult = { ok: false, skipped: '로컬 모드에서는 전파가 불가합니다(실서버 로그인 필요).' };
    return { telegram: skipped, email: skipped };
  }
  const [telegram, email] = await Promise.all([
    invokeBroadcastChannel('send-cooperation-telegram', requestId),
    invokeBroadcastChannel('send-cooperation-email', requestId),
  ]);
  return { telegram, email };
}

export async function updateCooperationRequest(id: string, patch: CooperationRequestPatch): Promise<CooperationRequest> {
  if (isLocalOnly()) {
    const list = loadLocal();
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error('항목을 찾을 수 없습니다.');
    const mergedOrgIds = patch.assigneeOrgIds !== undefined ? normalizeOrgIds(patch.assigneeOrgIds) : list[idx].assigneeOrgIds;
    const merged: CooperationRequest = {
      ...list[idx],
      ...patch,
      progress: patch.progress !== undefined ? clampProgress(patch.progress) : list[idx].progress,
      requestType: patch.requestType !== undefined ? normalizeType(patch.requestType) : list[idx].requestType,
      priority: patch.priority !== undefined ? normalizePriority(patch.priority) : list[idx].priority,
      status: patch.status !== undefined ? normalizeStatus(patch.status) : list[idx].status,
      assigneeKind: patch.assigneeKind !== undefined ? normalizeAssigneeKind(patch.assigneeKind) : list[idx].assigneeKind,
      assigneeOrgIds: mergedOrgIds,
      assigneeOrgId: mergedOrgIds[0] ?? null,
      memberProgress: patch.memberProgress !== undefined ? normalizeMemberProgress(patch.memberProgress) : list[idx].memberProgress,
      meetingLogs: patch.meetingLogs !== undefined ? normalizeMeetingLogs(patch.meetingLogs) : list[idx].meetingLogs,
      // localStorage 모드: status가 실제로 바뀌었을 때만 history 에 한 줄 추가 (서버는 트리거가 처리)
      statusHistory: (() => {
        const prevHistory = list[idx].statusHistory ?? [];
        if (patch.status === undefined || patch.status === list[idx].status) return prevHistory;
        return [...prevHistory, { status: normalizeStatus(patch.status), at: nowIso() }];
      })(),
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
  if (patch.deliverables !== undefined) payload.deliverables = patch.deliverables;
  if (patch.informees !== undefined) payload.informees = patch.informees;
  if (patch.requester !== undefined) payload.requester = patch.requester;
  if (patch.assignee !== undefined) payload.assignee = patch.assignee;
  if (patch.assigneeKind !== undefined) payload.assignee_kind = normalizeAssigneeKind(patch.assigneeKind);
  if (patch.assigneeOrgIds !== undefined) {
    const arr = normalizeOrgIds(patch.assigneeOrgIds);
    payload.assignee_org_ids = arr;
    // 호환을 위한 단일 컬럼도 같이 갱신(첫 번째 값).
    payload.assignee_org_id = arr[0] ?? null;
  } else if (patch.assigneeOrgId !== undefined) {
    payload.assignee_org_id = patch.assigneeOrgId;
    payload.assignee_org_ids = patch.assigneeOrgId ? [patch.assigneeOrgId] : [];
  }
  if (patch.memberProgress !== undefined) payload.member_progress = normalizeMemberProgress(patch.memberProgress);
  if (patch.meetingLogs !== undefined) payload.meeting_logs = normalizeMeetingLogs(patch.meetingLogs);
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
  const mapped = mapRow(data as CooperationRequestDbRow);
  // 현황(status) 변경 또는 멤버/제목 등 주요 필드 변경 시에만 알림 발송 — 사소한 편집은 스팸 방지로 미발송.
  const isStatusChange = patch.status !== undefined || patch.memberProgress !== undefined;
  const isContentChange = patch.title !== undefined || patch.detail !== undefined || patch.dueDate !== undefined;
  if (isStatusChange || isContentChange) {
    void notifyCooperation(mapped.id, isStatusChange && !isContentChange ? 'status-change' : 'updated');
  }
  return mapped;
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
    deliverables: '',
    informees: '',
    requester: '',
    assignee: '',
    assigneeKind: 'person',
    assigneeOrgIds: [],
    assigneeOrgId: null,
    memberProgress: [],
    meetingLogs: [],
    statusHistory: [],
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
