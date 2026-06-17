import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  Handshake,
  Plus,
  RefreshCw,
  Search,
  X,
  Pencil,
  Trash2,
  Send,
  ArrowRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  CircleAlert,
  Filter,
  ChevronDown,
  User,
  UserCheck,
  Building2,
  Table2,
  LayoutGrid,
  Coins,
  ListChecks,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { cn, randomUUID } from '../lib/utils';
import { useToast } from './Toast';
import { useErrorStateWithToast } from '../hooks/useErrorStateWithToast';
import { useOrganization, getDirectMembersFromTree } from '../context/OrganizationContext';
import type { OrgNode, OrgMember } from '../data/organization';
import {
  fetchCooperationRequests,
  insertCooperationRequest,
  updateCooperationRequest,
  deleteCooperationRequest,
  broadcastCooperation,
  makeEmptyCooperationRequest,
  nextMgmtId,
  computeOrgProgress,
  computeOrgStatus,
  deriveAssigneeKind,
  COOPERATION_REQUEST_TYPES,
  COOPERATION_REQUEST_PRIORITIES,
  COOPERATION_REQUEST_STATUSES,
  type CooperationRequest,
  type CooperationRequestInput,
  type CooperationRequestStatus,
  type CooperationRequestType,
  type CooperationRequestPriority,
  type CooperationMemberProgress,
  type CooperationMeetingLog,
  type CooperationMeetingAction,
  type CooperationRaci,
  COOPERATION_RACI_KINDS,
  COOPERATION_RACI_LABEL,
} from '../lib/db/cooperationRequests';
import {
  fetchCooperationPoints,
  deriveCooperationPointEntries,
  summarizeCooperationPoints,
  COOPERATION_POINTS_BY_PRIORITY,
  type CooperationPointEntry,
} from '../lib/db/cooperationPoints';

interface CooperationRequestSectionProps {
  /** 대시보드 섹션 헤더(전체현황 등)와 톤을 맞추기 위한 모바일 가독성 모드 */
  mobileReadabilityMode?: boolean;
  /** 표/카드(칸반) 보기 선택. 미지정 시 'table'. */
  layoutMode?: 'table' | 'card';
  /** 보기 모드 변경 콜백. 외부에서 layout 상태를 보존하려면 전달. */
  onChangeLayout?: (mode: 'table' | 'card') => void;
  /** 현재 로그인 사용자 평문 이름(부서·직위 제외). "내 것만 보기" 필터에 사용. */
  currentUserPlainName?: string;
}

const STATUS_STYLE: Record<CooperationRequestStatus, { dot: string; bg: string; text: string; ring: string }> = {
  요청완료: { dot: 'bg-slate-400', bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200' },
  '담당자 지정완료': { dot: 'bg-violet-500', bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200' },
  진행중: { dot: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' },
  처리완료: { dot: 'bg-cyan-500', bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200' },
  확인완료: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  취소됨: { dot: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
};

const STATUS_ICON: Record<CooperationRequestStatus, React.ReactNode> = {
  요청완료: <CircleAlert size={12} />,
  '담당자 지정완료': <UserCheck size={12} />,
  진행중: <Loader2 size={12} />,
  처리완료: <CheckCircle2 size={12} />,
  확인완료: <CheckCircle2 size={12} />,
  취소됨: <AlertCircle size={12} />,
};

/**
 * 6단계 워크플로의 진행 단계번호. 취소됨은 정상 흐름 밖(어느 단계에서나 종료)이라 번호를 부여하지 않는다(null).
 *   1 접수 → 2 담당자 지정 → 3 진행중 → 4 처리완료 → 5 확인완료
 */
const STATUS_STEP: Record<CooperationRequestStatus, number | null> = {
  요청완료: 1,
  '담당자 지정완료': 2,
  진행중: 3,
  처리완료: 4,
  확인완료: 5,
  취소됨: null,
};

/**
 * 화면 표시용 단계 이름 — 저장되는 상태값(요청완료/담당자 지정완료)과 별개의 표시 라벨.
 * '요청완료'→'접수', '담당자 지정완료'→'담당자 지정'. 나머지는 동일.
 */
const STATUS_DISPLAY_NAME: Record<CooperationRequestStatus, string> = {
  요청완료: '접수',
  '담당자 지정완료': '담당자 지정',
  진행중: '진행중',
  처리완료: '처리완료',
  확인완료: '확인완료',
  취소됨: '취소됨',
};

/** 단계번호 + 표시 이름 (예: '1. 접수'). 취소됨은 번호 없이 '취소됨'. */
function statusStepLabel(s: CooperationRequestStatus): string {
  const step = STATUS_STEP[s];
  return step ? `${step}. ${STATUS_DISPLAY_NAME[s]}` : STATUS_DISPLAY_NAME[s];
}

/**
 * 모달 backdrop "outside-click" 핸들러.
 * mousedown 이 backdrop 자체에서 시작된 경우에만 닫는다.
 * 내부 input 에서 마우스 드래그(텍스트 선택)로 mouseup 이 backdrop 위에서 끝나는 경우에도
 * 모달이 사라지지 않도록 보호한다.
 */
function useBackdropCloseHandlers(close: () => void): {
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
} {
  const downOnBackdropRef = useRef(false);
  return useMemo(
    () => ({
      onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
        downOnBackdropRef.current = e.target === e.currentTarget;
      },
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        if (downOnBackdropRef.current && e.target === e.currentTarget) close();
        downOnBackdropRef.current = false;
      },
    }),
    [close],
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s;
}

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

/**
 * 현재 상태로 진입한 시점부터의 경과 표시.
 *   < 1일 → "오늘"
 *   1~6일 → "N일"
 *   7일 이상 → "N주" (소수점 버림)
 */
function formatElapsed(fromIso: string | undefined): string {
  if (!fromIso) return '';
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return '';
  const days = Math.floor((Date.now() - from.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return '오늘';
  if (days < 7) return `${days}일`;
  return `${Math.floor(days / 7)}주`;
}

/**
 * 행의 현재 상태에 진입한 시각을 추정.
 *   1) statusHistory 의 가장 마지막 entry 가 현재 status 와 일치하면 그 at 사용
 *   2) 일치하는 마지막 항목 사용
 *   3) 없으면 createdAt
 */
function currentStatusSince(r: CooperationRequest): string {
  const hist = r.statusHistory ?? [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].status === r.status) return hist[i].at;
  }
  return r.createdAt || '';
}

/**
 * 부서간 협업 프로세스(안) V1.0 의 임계 룰:
 *   - 요청완료 상태에서 24h 경과 → 1차 스크리닝 응답 지연 ('screening')
 *   - 진행중 상태에서 72h(3일) 경과 → 부서장 에스컬레이션 대상 ('escalation')
 *   - 그 외 → null
 */
function escalationFlag(r: CooperationRequest): null | { kind: 'screening' | 'escalation'; hoursOver: number } {
  if (r.status !== '요청완료' && r.status !== '진행중') return null;
  const since = currentStatusSince(r);
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  const hours = (Date.now() - t) / (1000 * 60 * 60);
  if (r.status === '요청완료' && hours >= 24) return { kind: 'screening', hoursOver: Math.floor(hours - 24) };
  if (r.status === '진행중' && hours >= 72) return { kind: 'escalation', hoursOver: Math.floor(hours - 72) };
  return null;
}

/** 행이 '기한 초과' 여부 — 종료 상태(처리완료·확인완료·취소됨)가 아니고 기한이 오늘 이전이면 true */
function isOverdue(r: CooperationRequest, todayIso: string): boolean {
  if (!r.dueDate) return false;
  if (r.status === '처리완료' || r.status === '확인완료' || r.status === '취소됨') return false;
  return r.dueDate < todayIso;
}

/** 종료 상태가 아닌 행이 며칠 지났는지(초과 일수). 기한 없거나 초과 아님이면 0. */
function overdueDaysOf(r: CooperationRequest, todayIso: string): number {
  if (!isOverdue(r, todayIso) || !r.dueDate) return 0;
  return Math.max(0, Math.round((Date.parse(todayIso) - Date.parse(r.dueDate)) / 86400000));
}

/**
 * 요청기한까지 남은 일수. 진행 중(요청완료·진행중)이고 아직 기한 전일 때만 값을 준다.
 *   0 → '오늘 마감', N → 'N일 남음'. 종료 상태·기한 미설정·이미 초과면 null.
 */
function dueRemaining(r: CooperationRequest, todayIso: string): { days: number; label: string } | null {
  if (!r.dueDate) return null;
  if (r.status === '처리완료' || r.status === '확인완료' || r.status === '취소됨') return null;
  const diff = Math.round((Date.parse(r.dueDate) - Date.parse(todayIso)) / 86400000);
  if (diff < 0) return null; // 초과는 별도 표기
  return { days: diff, label: diff === 0 ? '오늘 마감' : `${diff}일 남음` };
}

/** 마감 임박 — 진행 중이고 기한이 오늘 이후 within일 이내(아직 초과 전). 기본 D-3. */
function isDueSoon(r: CooperationRequest, todayIso: string, within = 3): boolean {
  const rem = dueRemaining(r, todayIso);
  return rem !== null && rem.days <= within;
}

/** 상태가 '종료(완료 계열)' 인지 — 완료일·진척률 100% 자동 채우기에 사용 */
function isDoneStatus(s: CooperationRequestStatus): boolean {
  return s === '처리완료' || s === '확인완료';
}

/** 조직 트리를 평탄화: 부모 → 자식 순서, depth(들여쓰기용) 포함. */
function flattenOrgTree(root: OrgNode): Array<{ node: OrgNode; depth: number }> {
  const out: Array<{ node: OrgNode; depth: number }> = [];
  const walk = (n: OrgNode, d: number) => {
    out.push({ node: n, depth: d });
    for (const c of n.children ?? []) walk(c, d + 1);
  };
  walk(root, 0);
  return out;
}

/** 트리에서 id로 노드 찾기 */
function findOrgNode(root: OrgNode, id: string): OrgNode | null {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findOrgNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 조직 노드의 직속 인원 + 자식 노드 인원 전체(deep). 진척 추적은 deep을 기본으로 한다. */
function getDeepMembers(node: OrgNode, allMembers: OrgMember[]): OrgMember[] {
  const direct = getDirectMembersFromTree(node, allMembers);
  const fromChildren = (node.children ?? []).flatMap((c) => getDeepMembers(c, allMembers));
  return [...direct, ...fromChildren];
}

/** 표시용: 담당 인원이 있으면 '완료/전체', 없으면 '담당자 미지정' */
function memberProgressLabel(m: CooperationMemberProgress[]): string {
  if (m.length === 0) return '담당자 미지정';
  const done = m.filter((x) => x.status === '처리완료' || x.status === '확인완료').length;
  return `${done}/${m.length}`;
}

/** 멤버 1명의 상태를 바꾼 새 memberProgress 배열 — 완료 계열이면 완료일 자동 채움(비어 있을 때만). */
function withMemberStatus(
  members: CooperationMemberProgress[],
  idx: number,
  status: CooperationRequestStatus,
  todayIso: string,
): CooperationMemberProgress[] {
  return members.map((m, i) => {
    if (i !== idx) return m;
    const completedAt = isDoneStatus(status) ? m.completedAt || todayIso : '';
    return { ...m, status, completedAt };
  });
}

/**
 * 멤버 진척으로부터 요청 단위 롤업 패치(진척률·현황·완료일) 계산.
 * AssigneePicker.applyMemberUpdate 와 동일 규칙 — 카드/표의 담당자별 진행 패널에서 재사용.
 */
function memberRollupPatch(
  members: CooperationMemberProgress[],
  prevCompletedDate: string,
  todayIso: string,
): Pick<CooperationRequest, 'memberProgress' | 'progress' | 'status' | 'completedDate'> {
  const status = computeOrgStatus(members);
  const completedDate = isDoneStatus(status) ? prevCompletedDate || todayIso : prevCompletedDate;
  return { memberProgress: members, progress: computeOrgProgress(members), status, completedDate };
}

export function CooperationRequestSection({
  mobileReadabilityMode = false,
  layoutMode = 'table',
  onChangeLayout,
  currentUserPlainName,
}: CooperationRequestSectionProps) {
  const [rows, setRows] = useState<CooperationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, setError } = useErrorStateWithToast({ toastId: 'wbs-cooperation-list-error' });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CooperationRequestStatus | 'all' | 'overdue' | 'duesoon' | 'archived'>('all');
  const [typeFilter, setTypeFilter] = useState<CooperationRequestType | 'all'>('all');
  /** "내 것만 보기" — 본인 관련 항목만. localStorage 영구. 사용자 이름이 비면 토글 표시 안 함. */
  const [myOnly, setMyOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('wbs.cooperation.myOnly') === '1';
    } catch {
      return false;
    }
  });
  const setMyOnlyPersist = useCallback((v: boolean) => {
    setMyOnly(v);
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('wbs.cooperation.myOnly', v ? '1' : '0');
    } catch {
      /* quota 등 무시 */
    }
  }, []);
  const [editing, setEditing] = useState<{ row: CooperationRequest | null; draft: CooperationRequestInput } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CooperationRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [broadcastingId, setBroadcastingId] = useState<string | null>(null);
  const [pointsOpen, setPointsOpen] = useState(false);
  /** '담당자별 진행' 빠른 패널 대상 행 id — rows 에서 라이브로 다시 찾아 항상 최신 멤버 상태를 보여준다. */
  const [memberPanelId, setMemberPanelId] = useState<string | null>(null);
  const { push: pushToast } = useToast();
  const { orgTree, orgMembers } = useOrganization();

  /** 조직 트리를 평탄화(부모 → 자식 순서, depth 포함). 모달의 조직 picker에 사용. */
  const orgPickList = useMemo(() => flattenOrgTree(orgTree), [orgTree]);
  /** 직속 인원 + 자식 인원을 합쳐 검색용으로 평탄화. */
  const orgMemberOptions = useMemo(() => orgMembers, [orgMembers]);

  const rowsRef = useRef<CooperationRequest[]>([]);
  rowsRef.current = rows;

  const reload = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchCooperationRequests();
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '협조 요청 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  /** "내 것만" 매칭 — 본인 이름이 requester/assignee/memberProgress 중 하나에라도 잡히면 true */
  const isMine = useCallback(
    (r: CooperationRequest): boolean => {
      const me = (currentUserPlainName ?? '').trim();
      if (!me) return true; // 사용자 이름 모르면 전부 보임
      if (r.requester && r.requester.trim() === me) return true;
      if (r.assignee && r.assignee.includes(me)) return true; // 다중 선택은 "조직, 인원" 합산이라 includes
      if (r.memberProgress.some((m) => m.name.trim() === me)) return true;
      return false;
    },
    [currentUserPlainName],
  );

  /** 필터 + 검색 적용된 결과 */
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const archivedView = statusFilter === 'archived';
    return rows.filter((r) => {
      // 아카이브: '보관함' 필터에서만 archived=true 노출, 그 외 모든 보기에서는 제외.
      if (archivedView ? !r.archived : r.archived) return false;
      if (myOnly && !isMine(r)) return false;
      if (statusFilter === 'overdue') {
        if (!isOverdue(r, todayIso)) return false;
      } else if (statusFilter === 'duesoon') {
        if (!isDueSoon(r, todayIso)) return false;
      } else if (statusFilter !== 'all' && !archivedView && r.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== 'all' && r.requestType !== typeFilter) return false;
      if (q) {
        const blob = `${r.mgmtId} ${r.title} ${r.detail} ${r.requester} ${r.assignee} ${r.result} ${r.note}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, typeFilter, myOnly, isMine, todayIso]);

  /** 상태별 카운트(상단 칩). myOnly 토글에 따라 본인 관련만 집계. */
  const statusCounts = useMemo(() => {
    const c: Record<CooperationRequestStatus, number> = {
      요청완료: 0,
      '담당자 지정완료': 0,
      진행중: 0,
      처리완료: 0,
      확인완료: 0,
      취소됨: 0,
    };
    for (const r of rows) {
      if (r.archived) continue; // 보관 항목은 상태별 카운트에서 제외
      if (myOnly && !isMine(r)) continue;
      c[r.status]++;
    }
    return c;
  }, [rows, myOnly, isMine]);

  const overdueCount = useMemo(() => rows.filter((r) => !r.archived && isOverdue(r, todayIso)).length, [rows, todayIso]);
  /** 마감 임박(D-3 이내, 아직 초과 전·진행 중) — 보관 제외. '마감전 알림' 필터 칩에 사용. */
  const dueSoonCount = useMemo(() => rows.filter((r) => !r.archived && isDueSoon(r, todayIso)).length, [rows, todayIso]);
  const archivedCount = useMemo(() => rows.filter((r) => r.archived).length, [rows]);

  const handleNew = useCallback(() => {
    const draft = makeEmptyCooperationRequest({
      mgmtId: nextMgmtId(rowsRef.current),
      requester: (currentUserPlainName ?? '').trim(),
    });
    setEditing({ row: null, draft });
  }, [currentUserPlainName]);

  const handleEdit = useCallback((row: CooperationRequest) => {
    const { id: _id, createdAt: _ca, updatedAt: _ua, createdBy: _cb, ...rest } = row;
    setEditing({ row, draft: rest });
  }, []);

  /**
   * 저장/상태변경으로 포인트 지급·회수가 일어났는지 예측해 토스트로 알림.
   * 실제 지급·회수는 DB 트리거(reconcile_cooperation_points)가 같은 규칙으로 수행한다.
   */
  const notifyPointChange = useCallback(
    (before: CooperationRequest | null, after: CooperationRequest) => {
      const keyOf = (e: CooperationPointEntry) => `${e.memberName}||${e.memberDepartment}||${e.memberPosition}`;
      const prevKeys = new Set((before ? deriveCooperationPointEntries(before) : []).map(keyOf));
      const next = deriveCooperationPointEntries(after);
      const gained = next.filter((e) => !prevKeys.has(keyOf(e)));
      if (gained.length > 0) {
        const total = gained.reduce((s, e) => s + e.points, 0);
        const names = gained
          .slice(0, 3)
          .map((e) => e.memberName)
          .join(', ');
        const suffix = gained.length > 3 ? ` 외 ${gained.length - 3}명` : '';
        pushToast(`처리완료 — ${names}${suffix}에게 포인트 지급 (+${total}P)`, { variant: 'success', durationMs: 3000 });
        return;
      }
      const nextKeys = new Set(next.map(keyOf));
      const lost = [...prevKeys].filter((k) => !nextKeys.has(k)).length;
      if (lost > 0) pushToast(`처리완료 해제 — ${lost}명 포인트 회수`, { variant: 'info', durationMs: 2400 });
    },
    [pushToast],
  );

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.row) {
        const updated = await updateCooperationRequest(editing.row.id, editing.draft);
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        pushToast('협조 요청을 저장했습니다.', { variant: 'success', durationMs: 1500 });
        notifyPointChange(editing.row, updated);
      } else {
        const created = await insertCooperationRequest(null, editing.draft);
        setRows((prev) => [...prev, created]);
        pushToast('협조 요청을 추가했습니다.', { variant: 'success', durationMs: 1500 });
        notifyPointChange(null, created);
      }
      setEditing(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      pushToast(msg, { variant: 'error', durationMs: 4000 });
    } finally {
      setSaving(false);
    }
  }, [editing, pushToast, notifyPointChange]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    const prev = rowsRef.current;
    setRows((cur) => cur.filter((r) => r.id !== id));
    setConfirmDelete(null);
    try {
      await deleteCooperationRequest(id);
      pushToast('삭제했습니다.', { variant: 'success', durationMs: 1500 });
    } catch (e) {
      setRows(prev);
      pushToast(e instanceof Error ? e.message : '삭제에 실패했습니다.', { variant: 'error', durationMs: 4000 });
    }
  }, [confirmDelete, pushToast]);

  /** 협조 요청을 즉시 전파(수동) — 텔레그램·메일 동시. 자동 발송 토글과 무관하게 동작. */
  const handleBroadcast = useCallback(
    async (row: CooperationRequest) => {
      setBroadcastingId(row.id);
      try {
        const res = await broadcastCooperation(row.id);
        const fmt = (label: string, r: { ok: boolean; sent?: number; skipped?: string; error?: string }) =>
          r.ok ? `${label} ✓ ${r.sent}곳` : `${label} ✗ ${r.error ?? r.skipped ?? '실패'}`;
        const anyOk = res.telegram.ok || res.email.ok;
        pushToast(`${fmt('텔레그램', res.telegram)}  /  ${fmt('메일', res.email)}`, {
          variant: anyOk ? 'success' : 'error',
          durationMs: 6000,
        });
      } finally {
        setBroadcastingId(null);
      }
    },
    [pushToast],
  );

  /** 표 내 빠른 상태 변경(셀 토글 없이 드롭다운으로) */
  const handleQuickStatus = useCallback(
    async (row: CooperationRequest, next: CooperationRequestStatus) => {
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
      try {
        const patch: Partial<CooperationRequest> = { status: next };
        if (isDoneStatus(next) && !row.completedDate) patch.completedDate = todayIso;
        if (isDoneStatus(next) && row.progress < 1) patch.progress = 1;
        const updated = await updateCooperationRequest(row.id, patch);
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
        notifyPointChange(row, updated);
      } catch (e) {
        setRows(prev);
        pushToast(e instanceof Error ? e.message : '상태 변경에 실패했습니다.', { variant: 'error', durationMs: 4000 });
      }
    },
    [pushToast, todayIso, notifyPointChange],
  );

  /** 항목 보관(아카이브)/복원 — 기본 목록·카운트·기한 알림에서 숨기되 이력은 보존. 낙관적 업데이트. */
  const handleArchive = useCallback(
    async (row: CooperationRequest, archived: boolean) => {
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, archived } : r)));
      try {
        const updated = await updateCooperationRequest(row.id, { archived });
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
        pushToast(archived ? '보관함으로 옮겼습니다.' : '보관을 해제했습니다.', { variant: 'success', durationMs: 3000 });
      } catch (e) {
        setRows(prev);
        pushToast(e instanceof Error ? e.message : '보관 처리에 실패했습니다.', { variant: 'error', durationMs: 4000 });
      }
    },
    [pushToast],
  );

  /** '담당자별 진행' 패널 대상 행 — rows 변경 시 자동으로 최신 상태 반영(삭제되면 null로 닫힘). */
  const memberPanelRow = useMemo(() => rows.find((r) => r.id === memberPanelId) ?? null, [rows, memberPanelId]);

  /**
   * 담당자(멤버) 1명 상태 변경 — 카드/표의 담당자별 진행 패널에서 호출.
   * 멤버 상태 → 요청 현황·진척률 자동 롤업 후 저장. 처리완료 전환 시 포인트 토스트.
   */
  const handleMemberStatus = useCallback(
    async (row: CooperationRequest, idx: number, status: CooperationRequestStatus) => {
      const nextMembers = withMemberStatus(row.memberProgress, idx, status, todayIso);
      const patch = memberRollupPatch(nextMembers, row.completedDate, todayIso);
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
      try {
        const updated = await updateCooperationRequest(row.id, patch);
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
        notifyPointChange(row, updated);
      } catch (e) {
        setRows(prev);
        pushToast(e instanceof Error ? e.message : '담당자 진행 변경에 실패했습니다.', { variant: 'error', durationMs: 4000 });
      }
    },
    [pushToast, todayIso, notifyPointChange],
  );

  /** 담당자(멤버) 1명 RACI 변경 — 진척 집계엔 영향 없음, memberProgress 만 저장. */
  const handleMemberRaci = useCallback(
    async (row: CooperationRequest, idx: number, raci: CooperationRaci) => {
      const nextMembers = row.memberProgress.map((m, i): CooperationMemberProgress => (i === idx ? { ...m, raci } : m));
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, memberProgress: nextMembers } : r)));
      try {
        const updated = await updateCooperationRequest(row.id, { memberProgress: nextMembers });
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
      } catch (e) {
        setRows(prev);
        pushToast(e instanceof Error ? e.message : 'RACI 변경에 실패했습니다.', { variant: 'error', durationMs: 4000 });
      }
    },
    [pushToast],
  );

  return (
    <section className="space-y-3">
      {/* 섹션 헤더 — 대시보드의 '전체현황' 등과 같은 스타일 */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2 mb-3', mobileReadabilityMode && 'mb-2.5')}>
        <h2
          className={cn(
            'font-bold text-[var(--color-ink)] flex items-center gap-2.5 m-0',
            mobileReadabilityMode ? 'text-lg' : 'text-lg md:text-xl',
          )}
        >
          <span className="inline-flex items-center justify-center size-8 rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 shadow-sm shrink-0">
            <Handshake size={mobileReadabilityMode ? 20 : 18} />
          </span>
          업무 협조 요청
          <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">발주처·외주·사내 간 자료·검토·협의 요청 이력</span>
        </h2>
        {/* 모바일에서는 조작·필터·새 등록 버튼 모두 숨김 — 정보만 보여줌 */}
        <div className={cn('flex items-center gap-2', mobileReadabilityMode && 'hidden')}>
          {/* "내 것만 보기" 토글 — 현재 사용자 이름을 알고 있을 때만 노출 */}
          {currentUserPlainName && currentUserPlainName.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setMyOnlyPersist(!myOnly)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold ring-1 transition',
                myOnly
                  ? 'bg-indigo-600 text-white ring-indigo-600 shadow-sm'
                  : 'bg-[var(--color-surface)] text-[var(--color-ink)] ring-[var(--color-line)] hover:bg-[var(--color-surface-2)]',
              )}
              title={myOnly ? '전체 보기로 전환' : '나와 관련된 항목만 보기 — 요청자·담당자·멤버에 내 이름이 포함된 항목'}
            >
              <User size={12} />
              {myOnly ? '내 것만' : '내 것만 보기'}
            </button>
          )}
          {/* 표/카드 보기 토글 — 대시보드 다른 섹션과 같은 톤 */}
          {onChangeLayout && (
            <div
              className="inline-flex gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0"
              role="group"
              aria-label="협조 요청 표 또는 카드 보기"
            >
              <button
                type="button"
                onClick={() => onChangeLayout('table')}
                className={cn(
                  'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                  layoutMode === 'table' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
                title="표로 보기"
              >
                <Table2 size={12} aria-hidden />표
              </button>
              <button
                type="button"
                onClick={() => onChangeLayout('card')}
                className={cn(
                  'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                  layoutMode === 'card' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}
                title="카드(칸반)로 보기"
              >
                <LayoutGrid size={12} aria-hidden />
                카드
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setPointsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition"
            title="처리완료 포인트 지급 현황 — 인원별 누적·최근 지급 내역"
          >
            <Coins size={13} /> 포인트 현황
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] transition"
            title="다시 불러오기"
          >
            <RefreshCw size={13} /> 새로고침
          </button>
          <button
            type="button"
            onClick={handleNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 active:translate-y-px transition"
          >
            <Plus size={13} /> 새 협조 요청
          </button>
        </div>
      </div>

      {/* 상태 요약 칩 — 모바일에서는 필터링용이라 숨김(정보만 표시) */}
      <div className={cn('flex flex-wrap items-center gap-1.5', mobileReadabilityMode && 'hidden')}>
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition',
            statusFilter === 'all'
              ? 'bg-indigo-600 text-white ring-indigo-600'
              : 'bg-[var(--color-surface)] text-[var(--color-ink)] ring-[var(--color-line)] hover:bg-[var(--color-surface-2)]',
          )}
        >
          전체 <span className="opacity-80">{rows.length - archivedCount}</span>
        </button>
        {COOPERATION_REQUEST_STATUSES.map((s) => {
          const sty = STATUS_STYLE[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(active ? 'all' : s)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition',
                active ? `${sty.bg} ${sty.text} ${sty.ring} ring-2` : `${sty.bg} ${sty.text} ${sty.ring} hover:ring-2`,
              )}
            >
              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sty.dot)} />
              {statusStepLabel(s)} <span className="opacity-80">{statusCounts[s]}</span>
            </button>
          );
        })}
        {dueSoonCount > 0 &&
          (() => {
            const active = statusFilter === 'duesoon';
            return (
              <button
                type="button"
                onClick={() => setStatusFilter(active ? 'all' : 'duesoon')}
                className={cn(
                  'ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition',
                  'bg-orange-50 text-orange-700 ring-1 ring-orange-200 hover:ring-2',
                  active && 'ring-2',
                )}
                title={active ? '마감 임박 필터 해제 (전체 보기)' : '기한이 3일 이내로 임박한(아직 초과 전) 항목만 보기'}
              >
                <AlertCircle size={11} /> 마감 임박 {dueSoonCount}건
              </button>
            );
          })()}
        {overdueCount > 0 &&
          (() => {
            const active = statusFilter === 'overdue';
            return (
              <button
                type="button"
                onClick={() => setStatusFilter(active ? 'all' : 'overdue')}
                className={cn(
                  'ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition',
                  'bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:ring-2',
                  active && 'ring-2',
                )}
                title={active ? '기한 초과 필터 해제 (전체 보기)' : '기한이 지났지만 완료/회신불가가 아닌 항목만 보기'}
              >
                <Clock size={11} /> 기한 초과 {overdueCount}건
              </button>
            );
          })()}
        {archivedCount > 0 &&
          (() => {
            const active = statusFilter === 'archived';
            return (
              <button
                type="button"
                onClick={() => setStatusFilter(active ? 'all' : 'archived')}
                className={cn(
                  'ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition',
                  'bg-slate-100 text-slate-600 ring-1 ring-slate-300 hover:ring-2',
                  active && 'bg-slate-200 ring-2',
                )}
                title={active ? '보관함 닫기 (전체 보기)' : '보관(아카이브)한 항목 보기'}
              >
                <Archive size={11} /> 보관함 {archivedCount}건
              </button>
            );
          })()}
      </div>

      {/* 검색 + 구분 필터 — 모바일에서는 숨김 */}
      <div className={cn('flex flex-col sm:flex-row sm:items-center gap-2', mobileReadabilityMode && 'hidden')}>
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="관리ID·제목·내용·요청자·담당자 검색"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-1.5 pl-7 pr-2.5 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
              title="검색어 지우기"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 text-xs">
          <Filter size={12} className="text-[var(--color-ink-muted)]" />
          <span className="text-[var(--color-ink-muted)]">구분</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CooperationRequestType | 'all')}
            className="bg-transparent text-xs text-[var(--color-ink)] focus:outline-none"
          >
            <option value="all">전체</option>
            {COOPERATION_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

      {/* 표 또는 카드(칸반) */}
      {layoutMode === 'card' ? (
        <CooperationKanbanBoard
          rows={visibleRows}
          totalCount={rows.length}
          todayIso={todayIso}
          onEdit={handleEdit}
          onDelete={(r) => setConfirmDelete(r)}
          onQuickStatus={(r, next) => void handleQuickStatus(r, next)}
          onBroadcast={(r) => void handleBroadcast(r)}
          onOpenMembers={(r) => setMemberPanelId(r.id)}
          onArchive={(r, archived) => void handleArchive(r, archived)}
          broadcastingId={broadcastingId}
        />
      ) : (
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
                <tr className="text-left">
                  <th className="px-2 py-2 font-semibold w-10 text-right">#</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">관리ID</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">요청일</th>
                  <th className="px-2 py-2 font-semibold min-w-[180px]">제목</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">요청자</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">담당자</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">요청기한</th>
                  <th className="px-2 py-2 font-semibold whitespace-nowrap">현황</th>
                  <th className="px-2 py-2 font-semibold w-14"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                      <Loader2 size={16} className="inline animate-spin mr-2" />
                      불러오는 중…
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                      {rows.length === 0 ? (
                        <div className="space-y-2">
                          <div>등록된 협조 요청이 없습니다.</div>
                          <button
                            type="button"
                            onClick={handleNew}
                            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                          >
                            <Plus size={13} /> 첫 항목 추가
                          </button>
                        </div>
                      ) : (
                        <span>조건에 맞는 항목이 없습니다.</span>
                      )}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((r, i) => {
                    const overdue = isOverdue(r, todayIso);
                    const sty = STATUS_STYLE[r.status];
                    return (
                      <tr key={r.id} className="group hover:bg-indigo-50/40 cursor-pointer" onClick={() => handleEdit(r)}>
                        <td className="px-2 py-1.5 text-right text-[var(--color-ink-muted)] tabular-nums">{i + 1}</td>
                        <td className="px-2 py-1.5 font-mono text-[11.5px] text-[var(--color-ink)] whitespace-nowrap">
                          {r.mgmtId || <span className="text-[var(--color-ink-muted)]">—</span>}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                          <div className="text-[var(--color-ink)]">{fmtDate(r.requestDate)}</div>
                          {(() => {
                            const el = formatElapsed(r.requestDate || r.createdAt);
                            if (!el) return null;
                            return <div className="text-[10px] text-[var(--color-ink-muted)]">{el === '오늘' ? '오늘' : `${el} 경과`}</div>;
                          })()}
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-ink)] min-w-[180px] max-w-[420px]">
                          <div className="font-medium truncate">
                            {r.title || <span className="text-[var(--color-ink-muted)]">(제목 없음)</span>}
                          </div>
                          {r.detail && (
                            <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)] line-clamp-1 whitespace-pre-line">
                              {r.detail}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-ink)] whitespace-nowrap">
                          {r.requester || <span className="text-[var(--color-ink-muted)]">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-[var(--color-ink)] whitespace-nowrap">
                          {r.assignee || r.memberProgress.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              {r.assigneeKind === 'org' ? (
                                <Building2 size={12} className="text-violet-600" />
                              ) : r.assigneeKind === 'mixed' ? (
                                <span className="inline-flex">
                                  <Building2 size={12} className="text-violet-600" />
                                  <User size={12} className="-ml-1 text-slate-500" />
                                </span>
                              ) : (
                                <User size={12} className="text-slate-500" />
                              )}
                              <span className="truncate max-w-[200px]" title={r.assignee}>
                                {r.assignee || '담당'}
                              </span>
                              {r.memberProgress.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMemberPanelId(r.id);
                                  }}
                                  className="ml-1 inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200 tabular-nums transition hover:bg-violet-100 hover:ring-violet-300"
                                  title="담당자별 진행 관리 — 클릭"
                                >
                                  <ListChecks size={10} />
                                  {memberProgressLabel(r.memberProgress)}
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="text-[var(--color-ink-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums" title={overdue ? '기한이 지났습니다' : undefined}>
                          <div className={cn(overdue ? 'text-amber-700 font-semibold' : 'text-[var(--color-ink)]')}>
                            {fmtDate(r.dueDate) || '—'}
                          </div>
                          {overdue
                            ? (() => {
                                const d = overdueDaysOf(r, todayIso);
                                return (
                                  <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-amber-500 px-1 py-0.5 text-[9.5px] font-bold text-white">
                                    <AlertTriangle size={9} />
                                    {d > 0 ? `${d}일 초과` : '기한 초과'}
                                  </span>
                                );
                              })()
                            : (() => {
                                const rem = dueRemaining(r, todayIso);
                                if (!rem) return null;
                                return (
                                  <div className={cn('text-[10px] font-semibold', rem.days <= 2 ? 'text-amber-600' : 'text-emerald-600')}>
                                    {rem.label}
                                  </div>
                                );
                              })()}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex flex-col items-start gap-0.5">
                            <label
                              className={cn(
                                'relative inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 text-[11px] font-medium cursor-pointer',
                                sty.bg,
                                sty.text,
                                sty.ring,
                              )}
                            >
                              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sty.dot)} />
                              <span>{statusStepLabel(r.status)}</span>
                              <ChevronDown size={10} className="opacity-60" />
                              <span aria-hidden className="absolute inset-0">
                                {STATUS_ICON[r.status]}
                              </span>
                              <select
                                value={r.status}
                                onChange={(e) => void handleQuickStatus(r, e.target.value as CooperationRequestStatus)}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                title="현황 변경"
                              >
                                {COOPERATION_REQUEST_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {statusStepLabel(s)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {(() => {
                              const flag = escalationFlag(r);
                              if (!flag) return null;
                              const isScreening = flag.kind === 'screening';
                              const label = isScreening ? '1차 응답 지연' : '에스컬레이션';
                              const title = isScreening
                                ? '요청완료 상태에서 24시간 내 1차 수락/거부 응답이 없어 지연 상태입니다 (협업 프로세스 V1.0)'
                                : '진행중 상태에서 3일 이상 정체 — 부서장 에스컬레이션 대상 (협업 프로세스 V1.0)';
                              return (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 py-0.5 text-[9.5px] font-bold text-rose-700 ring-1 ring-rose-200"
                                  title={title}
                                >
                                  <AlertCircle size={9} />
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                            <button
                              type="button"
                              onClick={() => void handleBroadcast(r)}
                              disabled={broadcastingId === r.id}
                              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-sky-100 hover:text-sky-700 disabled:opacity-50"
                              title="텔레그램·메일로 전파"
                            >
                              {broadcastingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEdit(r)}
                              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-indigo-100 hover:text-indigo-700"
                              title="편집"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleArchive(r, !r.archived)}
                              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-slate-200 hover:text-slate-700"
                              title={r.archived ? '보관 해제(복원)' : '보관함으로 이동'}
                            >
                              {r.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(r)}
                              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-rose-100 hover:text-rose-700"
                              title="삭제"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[var(--color-ink-muted)] bg-[var(--color-surface-2)]">
            <span>
              표시 {visibleRows.length} / 전체 {rows.length}
            </span>
            <span>요청일 기준 경과일 표시 · 기한 초과 시 강조 배지</span>
          </div>
        </div>
      )}

      {/* 편집 모달 */}
      {editing && (
        <EditModal
          draft={editing.draft}
          isNew={!editing.row}
          saving={saving}
          orgTree={orgTree}
          orgMembers={orgMemberOptions}
          orgPickList={orgPickList}
          onChange={(patch) => setEditing((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur))}
          onSave={() => void handleSave()}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* 삭제 확인 */}
      {confirmDelete && (
        <ConfirmDeleteModal row={confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={() => void handleDelete()} />
      )}

      {/* 담당자별 진행 빠른 패널 — 카드/표에서 바로 멤버 상태 관리 */}
      {memberPanelRow && (
        <MemberProgressModal
          row={memberPanelRow}
          onChangeStatus={(idx, status) => void handleMemberStatus(memberPanelRow, idx, status)}
          onChangeRaci={(idx, raci) => void handleMemberRaci(memberPanelRow, idx, raci)}
          onEditFull={() => {
            setMemberPanelId(null);
            handleEdit(memberPanelRow);
          }}
          onClose={() => setMemberPanelId(null)}
        />
      )}

      {/* 포인트 현황 */}
      {pointsOpen && <CooperationPointsModal onClose={() => setPointsOpen(false)} />}
    </section>
  );
}

interface EditModalProps {
  draft: CooperationRequestInput;
  isNew: boolean;
  saving: boolean;
  orgTree: OrgNode;
  orgMembers: OrgMember[];
  orgPickList: Array<{ node: OrgNode; depth: number }>;
  onChange: (patch: Partial<CooperationRequestInput>) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditModal({ draft, isNew, saving, orgTree, orgMembers, orgPickList, onChange, onSave, onCancel }: EditModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const backdropHandlers = useBackdropCloseHandlers(onCancel);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3" {...backdropHandlers}>
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl border border-[var(--color-line)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <h2 className="text-sm font-bold text-[var(--color-ink)]">{isNew ? '새 협조 요청 등록' : '협조 요청 편집'}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]"
            title="닫기 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="관리ID">
              <input
                type="text"
                value={draft.mgmtId}
                onChange={(e) => onChange({ mgmtId: e.target.value })}
                placeholder="REQ-001"
                className={inputCls}
              />
            </Field>
            <Field label="요청일">
              <input
                type="date"
                value={draft.requestDate}
                onChange={(e) => onChange({ requestDate: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="요청구분">
              <select
                value={draft.requestType}
                onChange={(e) => onChange({ requestType: e.target.value as CooperationRequestType })}
                className={inputCls}
              >
                {COOPERATION_REQUEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="제목">
            <input
              type="text"
              value={draft.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="예) 상세설계서 자료 요청"
              className={inputCls}
              autoFocus={isNew}
            />
          </Field>

          <Field label="상세내용">
            <textarea
              value={draft.detail}
              onChange={(e) => onChange({ detail: e.target.value })}
              rows={6}
              placeholder="협조가 필요한 업무·자료·검토 항목의 구체 내용을 적습니다."
              className={cn(inputCls, 'resize-y min-h-[140px]')}
            />
          </Field>

          {/* 산출물 — 표준 요청서(부서간 협업 프로세스 V1.0) 4요소 중 "구체적 산출물" */}
          <Field label="구체적 산출물 (Deliverables)">
            <textarea
              value={draft.deliverables}
              onChange={(e) => onChange({ deliverables: e.target.value })}
              rows={3}
              placeholder="요청의 결과로 받아야 할 산출물을 명시합니다. 예) ‘TSS+ 상세설계서 PDF 1부’, ‘Q3 매출 분석 시트’."
              className={cn(inputCls, 'resize-y min-h-[72px]')}
            />
          </Field>

          {/* 참조자 — 메일 CC로 자동 반영. 쉼표·세미콜론·공백 구분 */}
          <Field label="참조자 / 공유처 (Informed)">
            <input
              type="text"
              value={draft.informees}
              onChange={(e) => onChange({ informees: e.target.value })}
              placeholder="이름 또는 이메일을 쉼표·세미콜론·공백으로 구분. 예) 김지영, 이상재, jeyoung@gmtc.kr"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="요청자">
              <input
                type="text"
                value={draft.requester}
                onChange={(e) => onChange({ requester: e.target.value })}
                className={inputCls}
                placeholder="예) 지엠티"
              />
            </Field>
            <Field label="중요도">
              <select
                value={draft.priority}
                onChange={(e) => onChange({ priority: e.target.value as CooperationRequestPriority })}
                className={inputCls}
              >
                {COOPERATION_REQUEST_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="요청기한">
              <input type="date" value={draft.dueDate} onChange={(e) => onChange({ dueDate: e.target.value })} className={inputCls} />
            </Field>
          </div>

          {/* 담당 — 인원/조직 토글 + picker */}
          <AssigneePicker draft={draft} orgTree={orgTree} orgMembers={orgMembers} orgPickList={orgPickList} onChange={onChange} />

          {/* 진척률·현황(·완료일) — 최초 등록 시엔 완료일 숨겨 2칸 그리드 */}
          <div className={cn('grid gap-3', isNew ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
            <Field label="진척률 (%)">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={pct(draft.progress)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  onChange({ progress: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0 });
                }}
                className={inputCls}
              />
            </Field>
            <Field label="현황">
              <select
                value={draft.status}
                onChange={(e) => {
                  const next = e.target.value as CooperationRequestStatus;
                  const patch: Partial<CooperationRequestInput> = { status: next };
                  if (isDoneStatus(next) && !draft.completedDate) patch.completedDate = new Date().toISOString().slice(0, 10);
                  if (isDoneStatus(next) && draft.progress < 1) patch.progress = 1;
                  onChange(patch);
                }}
                className={inputCls}
              >
                {COOPERATION_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusStepLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
            {!isNew && (
              <Field label="완료일">
                <input
                  type="date"
                  value={draft.completedDate}
                  onChange={(e) => onChange({ completedDate: e.target.value })}
                  className={inputCls}
                />
              </Field>
            )}
          </div>

          {/* 회의록 — 진행 중 회의 기록을 시계열로 누적. 최초 등록 시엔 숨김. */}
          {!isNew && <MeetingLogList logs={draft.meetingLogs} onChange={(next) => onChange({ meetingLogs: next })} />}

          {/* 결과·회신 — 최종 회신/결과 요약. 최초 등록 시엔 숨김. */}
          {!isNew && (
            <Field label="결과·회신 (최종 요약)">
              <textarea
                value={draft.result}
                onChange={(e) => onChange({ result: e.target.value })}
                rows={4}
                placeholder="회신 내용·최종 결과를 요약해 적습니다."
                className={cn(inputCls, 'resize-y min-h-[100px]')}
              />
            </Field>
          )}

          {/* 지연사유는 최초 등록 시엔 숨김(아직 지연이 발생하지 않음). 비고는 항상 노출. */}
          <div className={cn('grid gap-3', isNew ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
            {!isNew && (
              <Field label="지연사유">
                <input
                  type="text"
                  value={draft.delayReason}
                  onChange={(e) => onChange({ delayReason: e.target.value })}
                  className={inputCls}
                  placeholder="(필요 시)"
                />
              </Field>
            )}
            <Field label="비고">
              <input
                type="text"
                value={draft.note}
                onChange={(e) => onChange({ note: e.target.value })}
                className={inputCls}
                placeholder="(필요 시)"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {isNew ? '등록' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
      {children}
    </label>
  );
}

/**
 * 담당(조직·인원 다중 선택) + 멤버별 진행 추적.
 *
 * 선택 모델:
 *   - 조직: 0..N개 (assigneeOrgIds). 각 조직 선택 시 deep 멤버를 memberProgress에 자동 병합(기존 상태 보존).
 *   - 인원: 0..N명. picker로 직접 추가하면 memberProgress 항목에 direct=true 마킹.
 *   - 조직 1개를 제거하면 그 조직 출처(sourceOrgIds)에서 빠지고, 출처가 비고 direct=false 면 항목 자체도 제거.
 *
 * 표시명(assignee): "조직1, 조직2 + 김길용, 홍길동" 식으로 자동 합산.
 */
function AssigneePicker({
  draft,
  orgTree,
  orgMembers,
  orgPickList,
  onChange,
}: {
  draft: CooperationRequestInput;
  orgTree: OrgNode;
  orgMembers: OrgMember[];
  orgPickList: Array<{ node: OrgNode; depth: number }>;
  onChange: (patch: Partial<CooperationRequestInput>) => void;
}) {
  const [personInput, setPersonInput] = useState('');

  const memberKey = (name: string, dept: string, pos: string) => `${name}||${dept}||${pos}`;

  /**
   * 부서 검토 → 담당자 지정 워크플로:
   *   조직 선택은 알림 라우팅(부서/그룹 채팅으로 통보)에만 쓰고, memberProgress에는
   *   부서가 검토 후 인원 picker로 직접 지정한 사람들만 들어간다(직접 추가만 누적).
   *   조직 자동 멤버 추가는 더 이상 하지 않는다(기존 데이터는 호환 — 다른 조직 자동 멤버는
   *   sourceOrgIds 클린업을 통해 유지/제거 결정).
   */
  const recalcMembers = (_orgIds: string[], directPersons: OrgMember[]): CooperationMemberProgress[] => {
    const existing = new Map(draft.memberProgress.map((m) => [memberKey(m.name, m.department, m.position), m] as const));
    const collected = new Map<string, CooperationMemberProgress>();
    // 직접 추가 인원만 누적
    for (const p of directPersons) {
      const k = memberKey(p.name, p.department, p.position);
      const prev = collected.get(k) ??
        existing.get(k) ?? {
          name: p.name,
          department: p.department,
          position: p.position,
          status: '요청완료' as CooperationRequestStatus,
          completedAt: '',
          sourceOrgIds: [],
          direct: false,
          raci: 'R' as CooperationRaci,
        };
      collected.set(k, { ...prev, direct: true });
    }
    return Array.from(collected.values());
  };

  /** 표시명 합산: 조직 이름들 + 직접 인원 이름들. */
  const buildAssigneeLabel = (orgIds: string[], directPersons: OrgMember[]): string => {
    const orgNames = orgIds.map((id) => findOrgNode(orgTree, id)?.name).filter((n): n is string => !!n);
    const personNames = directPersons.map((p) => p.name);
    if (orgNames.length === 0 && personNames.length === 0) return '';
    if (orgNames.length === 0) return personNames.join(', ');
    if (personNames.length === 0) return orgNames.join(', ');
    return `${orgNames.join(', ')} + ${personNames.join(', ')}`;
  };

  const applyMemberUpdate = (nextMembers: CooperationMemberProgress[], orgIds: string[], directPersons: OrgMember[]) => {
    const kind = deriveAssigneeKind(orgIds, directPersons.length);
    const progress = computeOrgProgress(nextMembers);
    const status = computeOrgStatus(nextMembers);
    const completedDate = isDoneStatus(status) ? draft.completedDate || new Date().toISOString().slice(0, 10) : draft.completedDate;
    onChange({
      assigneeOrgIds: orgIds,
      memberProgress: nextMembers,
      assignee: buildAssigneeLabel(orgIds, directPersons),
      assigneeKind: kind,
      progress,
      status,
      completedDate,
    });
  };

  const currentDirectPersons: OrgMember[] = draft.memberProgress
    .filter((m) => m.direct)
    .map((m) => ({ name: m.name, department: m.department, position: m.position, gender: '' }));

  const addOrg = (orgId: string) => {
    if (!orgId || draft.assigneeOrgIds.includes(orgId)) return;
    const orgIds = [...draft.assigneeOrgIds, orgId];
    applyMemberUpdate(recalcMembers(orgIds, currentDirectPersons), orgIds, currentDirectPersons);
  };

  const removeOrg = (orgId: string) => {
    const orgIds = draft.assigneeOrgIds.filter((id) => id !== orgId);
    const next = draft.memberProgress
      .map((m): CooperationMemberProgress => ({ ...m, sourceOrgIds: m.sourceOrgIds.filter((s) => s !== orgId) }))
      .filter((m) => m.direct || m.sourceOrgIds.length > 0);
    applyMemberUpdate(next, orgIds, currentDirectPersons);
  };

  const addPerson = () => {
    const name = personInput.trim();
    if (!name) return;
    const match = orgMembers.find((m) => m.name === name);
    const person: OrgMember = match ?? { name, department: '', position: '', gender: '' };
    const exists = draft.memberProgress.some(
      (m) => m.direct && m.name === person.name && m.department === person.department && m.position === person.position,
    );
    if (exists) {
      setPersonInput('');
      return;
    }
    const directPersons = [...currentDirectPersons, person];
    applyMemberUpdate(recalcMembers(draft.assigneeOrgIds, directPersons), draft.assigneeOrgIds, directPersons);
    setPersonInput('');
  };

  const removePerson = (name: string, dept: string, pos: string) => {
    const directPersons = currentDirectPersons.filter((p) => !(p.name === name && p.department === dept && p.position === pos));
    const next = draft.memberProgress
      .map((m): CooperationMemberProgress => {
        if (m.name === name && m.department === dept && m.position === pos) return { ...m, direct: false };
        return m;
      })
      .filter((m) => m.direct || m.sourceOrgIds.length > 0);
    applyMemberUpdate(next, draft.assigneeOrgIds, directPersons);
  };

  /** 멤버 1명 상태 변경. */
  const setMemberStatus = (idx: number, status: CooperationRequestStatus) => {
    const next = draft.memberProgress.map((m, i): CooperationMemberProgress => {
      if (i !== idx) return m;
      const completedAt = isDoneStatus(status) ? m.completedAt || new Date().toISOString().slice(0, 10) : '';
      return { ...m, status, completedAt };
    });
    applyMemberUpdate(next, draft.assigneeOrgIds, currentDirectPersons);
  };

  /** 멤버 1명 RACI 변경 — 진척 집계에 영향 없음, 표시·알림에만 사용 */
  const setMemberRaci = (idx: number, raci: CooperationRaci) => {
    const next = draft.memberProgress.map((m, i): CooperationMemberProgress => (i === idx ? { ...m, raci } : m));
    applyMemberUpdate(next, draft.assigneeOrgIds, currentDirectPersons);
  };

  const availableOrgs = orgPickList.filter(({ node }) => !draft.assigneeOrgIds.includes(node.id));

  /**
   * 지정한 조직(들)의 소속 인원(하위 부서 포함) 중 아직 담당자로 추가되지 않은 사람 — 빠른 지정 후보.
   * 워크플로: 조직에 요청 → 그 조직에서 담당자(개인)를 지정 → 그 담당자에게만 포인트가 간다.
   */
  const alreadyMemberKeys = new Set(draft.memberProgress.map((m) => memberKey(m.name, m.department, m.position)));
  const orgCandidateMembers: OrgMember[] = (() => {
    const seen = new Set<string>();
    const out: OrgMember[] = [];
    for (const id of draft.assigneeOrgIds) {
      const node = findOrgNode(orgTree, id);
      if (!node) continue;
      for (const m of getDeepMembers(node, orgMembers)) {
        const k = memberKey(m.name, m.department, m.position);
        if (alreadyMemberKeys.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push(m);
      }
    }
    return out;
  })();

  /** 빠른 지정: 조직 후보 인원 1명을 담당자(member_progress, direct)로 추가. */
  const designatePerson = (m: OrgMember) => {
    const directPersons = [...currentDirectPersons, m];
    applyMemberUpdate(recalcMembers(draft.assigneeOrgIds, directPersons), draft.assigneeOrgIds, directPersons);
  };

  return (
    <div className="space-y-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">담당 (다중 선택)</span>
        <span className="text-[10.5px] text-[var(--color-ink-muted)]">조직·인원을 자유롭게 추가/제거</span>
      </div>

      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700">
          <Building2 size={12} /> 조직
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.assigneeOrgIds.map((id) => {
            const node = findOrgNode(orgTree, id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200"
              >
                <Building2 size={10} />
                {node?.name ?? id}
                <button
                  type="button"
                  onClick={() => removeOrg(id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-violet-100"
                  title="조직 제거"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
          {draft.assigneeOrgIds.length === 0 && <span className="text-[11px] text-[var(--color-ink-muted)]">(선택된 조직 없음)</span>}
        </div>
        <select
          value=""
          onChange={(e) => {
            addOrg(e.target.value);
            e.currentTarget.value = '';
          }}
          className={inputCls}
        >
          <option value="">+ 조직 추가…</option>
          {availableOrgs.map(({ node, depth }) => (
            <option key={node.id} value={node.id}>
              {' '.repeat(depth * 2)}
              {node.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700">
          <User size={12} /> 인원
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {currentDirectPersons.map((p) => (
            <span
              key={`p|${p.name}|${p.department}|${p.position}`}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200"
              title={p.department + (p.position ? ` · ${p.position}` : '')}
            >
              <User size={10} />
              {p.name}
              <button
                type="button"
                onClick={() => removePerson(p.name, p.department, p.position)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                title="인원 제거"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {currentDirectPersons.length === 0 && <span className="text-[11px] text-[var(--color-ink-muted)]">(추가된 인원 없음)</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            list="cooperation-org-members"
            value={personInput}
            onChange={(e) => setPersonInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPerson();
              }
            }}
            placeholder="인원 이름 입력 후 Enter — 조직 인원 자동완성"
            className={cn(inputCls, 'flex-1')}
          />
          <button
            type="button"
            onClick={addPerson}
            disabled={!personInput.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={12} /> 추가
          </button>
        </div>
        <datalist id="cooperation-org-members">
          {orgMembers.map((m) => (
            <option key={`${m.name}|${m.department}|${m.position}`} value={m.name}>
              {m.department}
              {m.position ? ` · ${m.position}` : ''}
            </option>
          ))}
        </datalist>

        {/* 지정한 조직의 담당자 빠른 선택 — "조직에 요청 → 조직이 담당자 지정" 워크플로 지원 */}
        {draft.assigneeOrgIds.length > 0 && (
          <div className="rounded-md border border-violet-200/70 bg-violet-50/50 px-2 py-1.5">
            <div className="mb-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-violet-700">
              <User size={11} /> 지정한 조직의 담당자 선택 — 클릭하면 담당자로 지정됩니다
            </div>
            {orgCandidateMembers.length === 0 ? (
              <div className="text-[10.5px] text-[var(--color-ink-muted)]">
                {draft.memberProgress.length > 0 ? '조직 인원을 모두 담당자로 지정했습니다.' : '선택한 조직에 등록된 인원이 없습니다.'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1 max-h-28 overflow-auto">
                {orgCandidateMembers.map((m) => (
                  <button
                    key={`cand|${m.name}|${m.department}|${m.position}`}
                    type="button"
                    onClick={() => designatePerson(m)}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-ink)] ring-1 ring-violet-200 hover:bg-violet-100"
                    title={`${m.department}${m.position ? ' · ' + m.position : ''} — 담당자로 지정`}
                  >
                    <Plus size={10} className="text-violet-600" />
                    {m.name}
                    {m.position && <span className="text-[9.5px] text-[var(--color-ink-muted)]">{m.position}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {draft.memberProgress.length > 0 && (
        <MemberChecklist memberProgress={draft.memberProgress} onChange={setMemberStatus} onRaciChange={setMemberRaci} />
      )}
    </div>
  );
}

/** 조직 대상 시 멤버별 현황 체크리스트. 각 행: 이름·부서·직위 + 상태 셀렉트. */
function MemberChecklist({
  memberProgress,
  onChange,
  onRaciChange,
}: {
  memberProgress: CooperationMemberProgress[];
  onChange: (idx: number, status: CooperationRequestStatus) => void;
  onRaciChange?: (idx: number, raci: CooperationRaci) => void;
}) {
  if (memberProgress.length === 0) {
    return <p className="text-[11px] text-[var(--color-ink-muted)]">선택한 조직에 등록된 인원이 없습니다.</p>;
  }
  const doneCount = memberProgress.filter((m) => m.status === '처리완료' || m.status === '확인완료').length;
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px]">
        <span className="font-medium text-[var(--color-ink)]">
          멤버 진척 ({doneCount}/{memberProgress.length} 완료)
        </span>
        <span className="text-[var(--color-ink-muted)]">상태를 바꾸면 전체 진척률·현황이 자동 갱신됩니다</span>
      </div>
      <div className="max-h-56 overflow-auto divide-y divide-[var(--color-line)]">
        {memberProgress.map((m, idx) => (
          <div key={`${m.name}|${m.department}|${idx}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
            <div className="min-w-0">
              <div className="font-medium text-[var(--color-ink)] truncate">
                {m.name}
                {m.position && <span className="ml-1 text-[10px] text-[var(--color-ink-muted)]">{m.position}</span>}
              </div>
              <div className="text-[10.5px] text-[var(--color-ink-muted)] truncate">{m.department}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {(m.status === '처리완료' || m.status === '확인완료') && m.completedAt && (
                <span className="text-[10px] tabular-nums text-emerald-700">{m.completedAt.replaceAll('-', '.')}</span>
              )}
              {onRaciChange && (
                <select
                  value={m.raci}
                  onChange={(e) => onRaciChange(idx, e.target.value as CooperationRaci)}
                  title={`RACI 역할 — ${COOPERATION_RACI_LABEL[m.raci]}`}
                  className={cn(
                    'rounded border px-1 py-0.5 text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-200',
                    m.raci === 'R' && 'border-blue-200 bg-blue-50 text-blue-700',
                    m.raci === 'A' && 'border-violet-200 bg-violet-50 text-violet-700',
                    m.raci === 'C' && 'border-amber-200 bg-amber-50 text-amber-700',
                    m.raci === 'I' && 'border-slate-200 bg-slate-50 text-slate-700',
                  )}
                >
                  {COOPERATION_RACI_KINDS.map((r) => (
                    <option key={r} value={r}>
                      {r} — {COOPERATION_RACI_LABEL[r]}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={m.status}
                onChange={(e) => onChange(idx, e.target.value as CooperationRequestStatus)}
                className={cn(
                  'rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-200',
                  m.status === '확인완료' && 'text-emerald-700 font-medium',
                  m.status === '처리완료' && 'text-cyan-700 font-medium',
                  m.status === '진행중' && 'text-blue-700',
                  m.status === '취소됨' && 'text-rose-700',
                )}
              >
                {/* '담당자 지정완료'는 요청 단위 집계 단계라 개별 멤버 상태에는 노출하지 않는다 */}
                {COOPERATION_REQUEST_STATUSES.filter((s) => s !== '담당자 지정완료').map((s) => (
                  <option key={s} value={s}>
                    {statusStepLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 담당자별 진행 빠른 패널 — 카드/표의 멤버 배지에서 바로 열어, 지정된 담당자 각각의 상태를 관리.
 * 전체 편집 모달을 거치지 않는 경량 모달. 변경은 즉시 저장되고 요청 현황·진척률이 자동 롤업된다.
 * 멤버 행 UI는 편집 모달과 동일한 MemberChecklist 를 재사용해 일관성을 맞춘다.
 */
function MemberProgressModal({
  row,
  onChangeStatus,
  onChangeRaci,
  onEditFull,
  onClose,
}: {
  row: CooperationRequest;
  onChangeStatus: (idx: number, status: CooperationRequestStatus) => void;
  onChangeRaci: (idx: number, raci: CooperationRaci) => void;
  onEditFull: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const backdropHandlers = useBackdropCloseHandlers(onClose);
  const sty = STATUS_STYLE[row.status];
  const total = row.memberProgress.length;
  const done = row.memberProgress.filter((m) => m.status === '처리완료' || m.status === '확인완료').length;

  return (
    <div className="fixed inset-0 z-[65] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3" {...backdropHandlers}>
      <div
        className="w-full max-w-lg max-h-[88vh] overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl border border-[var(--color-line)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center size-6 rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                <ListChecks size={14} />
              </span>
              <h2 className="text-sm font-bold text-[var(--color-ink)] m-0">담당자별 진행</h2>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1',
                  sty.bg,
                  sty.text,
                  sty.ring,
                )}
              >
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sty.dot)} />
                {statusStepLabel(row.status)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] min-w-0">
              {row.mgmtId && <span className="font-mono text-[var(--color-ink-muted)] shrink-0">{row.mgmtId}</span>}
              <span className="truncate text-[var(--color-ink)]">{row.title || '(제목 없음)'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] shrink-0"
            title="닫기 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-auto px-4 py-3">
          <p className="mb-2 text-[11px] text-[var(--color-ink-muted)]">
            각 담당자의 상태를 바꾸면 요청 전체 현황·진척률이 자동으로 갱신됩니다. ‘처리완료’ 시 해당 담당자에게 포인트가 지급됩니다.
          </p>
          {total === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">
              지정된 담당자가 없습니다. ‘담당자 추가·변경’에서 담당자를 지정하세요.
            </p>
          ) : (
            <MemberChecklist memberProgress={row.memberProgress} onChange={onChangeStatus} onRaciChange={onChangeRaci} />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <span className="text-[11px] tabular-nums text-[var(--color-ink-muted)]">
            완료 {done}/{total} · 진척률 {pct(row.progress)}%
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEditFull}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              <Pencil size={12} /> 담당자 추가·변경
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 회의록 리스트 — 등록·편집·삭제. 시계열로 누적(최신순).
 *
 * 각 회의록:
 *   - date (YYYY-MM-DD, 기본 오늘)
 *   - title (안건, 선택)
 *   - content (내용, 필수)
 *
 * 새 항목 폼은 컴포넌트 내부 상태로 관리. 추가 후 입력은 초기화.
 */
function MeetingLogList({ logs, onChange }: { logs: CooperationMeetingLog[]; onChange: (next: CooperationMeetingLog[]) => void }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ date: string; title: string; content: string; actions: CooperationMeetingAction[] }>({
    date: todayIso,
    title: '',
    content: '',
    actions: [],
  });
  // 시계열: 최신순 정렬(같은 날짜면 createdAt 역순).
  const sorted = useMemo(
    () =>
      [...logs].sort((a, b) => {
        const ad = a.date || a.createdAt || '';
        const bd = b.date || b.createdAt || '';
        if (ad !== bd) return bd.localeCompare(ad);
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }),
    [logs],
  );

  const startAdd = () => {
    setEditingId('__new__');
    setDraft({ date: todayIso, title: '', content: '', actions: [] });
  };
  const startEdit = (m: CooperationMeetingLog) => {
    setEditingId(m.id);
    setDraft({ date: m.date || todayIso, title: m.title, content: m.content, actions: m.actions });
  };
  const cancel = () => {
    setEditingId(null);
    setDraft({ date: todayIso, title: '', content: '', actions: [] });
  };
  const cleanActions = (arr: CooperationMeetingAction[]): CooperationMeetingAction[] =>
    arr.filter((a) => a.task.trim() || a.assignee.trim());
  const save = () => {
    const content = draft.content.trim();
    const actions = cleanActions(draft.actions);
    if (!content && !draft.title.trim() && actions.length === 0) return; // 빈 항목 등록 차단
    if (editingId === '__new__') {
      const entry: CooperationMeetingLog = {
        id: randomUUID(),
        date: draft.date || todayIso,
        title: draft.title.trim(),
        content,
        actions,
        createdAt: new Date().toISOString(),
        createdBy: null,
      };
      onChange([...logs, entry]);
    } else if (editingId) {
      onChange(
        logs.map((m) => (m.id === editingId ? { ...m, date: draft.date || todayIso, title: draft.title.trim(), content, actions } : m)),
      );
    }
    cancel();
  };
  const remove = (id: string) => {
    onChange(logs.filter((m) => m.id !== id));
    if (editingId === id) cancel();
  };
  /** 표시 영역에서 액션 완료를 즉시 토글 — 편집 모드 진입 없이도 처리 가능. */
  const toggleActionDone = (meetingId: string, actionId: string) => {
    onChange(
      logs.map((m) =>
        m.id !== meetingId ? m : { ...m, actions: m.actions.map((a) => (a.id !== actionId ? a : { ...a, done: !a.done })) },
      ),
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">회의록 ({logs.length}건)</span>
        {editingId !== '__new__' && (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus size={12} /> 회의록 추가
          </button>
        )}
      </div>

      {/* 신규 입력 폼 */}
      {editingId === '__new__' && (
        <div className="rounded-md border border-indigo-200 bg-white p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
              className={cn(inputCls, 'w-36')}
            />
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="회의 안건 (선택)"
              className={cn(inputCls, 'flex-1')}
            />
          </div>
          <textarea
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            placeholder="회의 내용·결정사항·후속조치 등"
            rows={3}
            className={cn(inputCls, 'resize-y min-h-[80px]')}
            autoFocus
          />
          <ActionPlanEditor actions={draft.actions} onChange={(actions) => setDraft((d) => ({ ...d, actions }))} />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-[var(--color-line)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!draft.content.trim() && !draft.title.trim() && cleanActions(draft.actions).length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {/* 기존 회의록 목록 */}
      {sorted.length === 0 && editingId !== '__new__' && (
        <p className="text-[11px] text-[var(--color-ink-muted)]">
          등록된 회의록이 없습니다. <strong>회의록 추가</strong>를 눌러 첫 회의 기록을 남기세요.
        </p>
      )}
      <div className="space-y-1.5">
        {sorted.map((m) => {
          const isEditing = editingId === m.id;
          if (isEditing) {
            return (
              <div key={m.id} className="rounded-md border border-indigo-200 bg-white p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                    className={cn(inputCls, 'w-36')}
                  />
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="회의 안건 (선택)"
                    className={cn(inputCls, 'flex-1')}
                  />
                </div>
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                  rows={3}
                  className={cn(inputCls, 'resize-y min-h-[80px]')}
                />
                <ActionPlanEditor actions={draft.actions} onChange={(actions) => setDraft((d) => ({ ...d, actions }))} />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-md border border-[var(--color-line)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700"
                  >
                    저장
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="group rounded-md border border-[var(--color-line)] bg-white p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-muted)]">
                    <span className="font-mono tabular-nums">{(m.date || '').replaceAll('-', '.')}</span>
                    {m.title && <span className="font-semibold text-[var(--color-ink)] truncate">{m.title}</span>}
                  </div>
                  {m.content && <div className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--color-ink)]">{m.content}</div>}
                  {m.actions.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Action Plan ({m.actions.filter((a) => a.done).length}/{m.actions.length} 완료)
                      </div>
                      <ul className="space-y-0.5">
                        {m.actions.map((a) => (
                          <li
                            key={a.id}
                            className={cn('flex items-center gap-1.5 text-[11px]', a.done && 'text-[var(--color-ink-muted)] line-through')}
                          >
                            <input
                              type="checkbox"
                              checked={a.done}
                              onChange={() => toggleActionDone(m.id, a.id)}
                              className="size-3 accent-indigo-600"
                            />
                            {a.assignee && <span className="font-semibold text-[var(--color-ink)]">{a.assignee}</span>}
                            <span>{a.task || '(내용 미지정)'}</span>
                            {a.dueDate && (
                              <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums">
                                ~{a.dueDate.replaceAll('-', '.')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-indigo-100 hover:text-indigo-700"
                    title="편집"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-rose-100 hover:text-rose-700"
                    title="삭제"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 회의록 1건의 Action Plan 편집기 — 행 단위로 담당자·내용·기한·완료체크 입력.
 * "회의록 = Action Plan 중심" (부서간 협업 프로세스 V1.0 단기 ③) 적용.
 */
function ActionPlanEditor({
  actions,
  onChange,
}: {
  actions: CooperationMeetingAction[];
  onChange: (next: CooperationMeetingAction[]) => void;
}) {
  const update = (id: string, patch: Partial<CooperationMeetingAction>) =>
    onChange(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const remove = (id: string) => onChange(actions.filter((a) => a.id !== id));
  const add = () => onChange([...actions, { id: randomUUID(), assignee: '', task: '', dueDate: '', done: false }]);
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]/40 p-1.5 space-y-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Action Plan (담당자·완료기한 명시)
        </span>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-0.5 rounded text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
        >
          <Plus size={10} /> Action 추가
        </button>
      </div>
      {actions.length === 0 ? (
        <p className="px-1 text-[10.5px] text-[var(--color-ink-muted)]">
          (없음) — 회의에서 결정된 후속조치를 담당자·완료기한과 함께 적어두세요.
        </p>
      ) : (
        actions.map((a) => (
          <div key={a.id} className="flex items-center gap-1 rounded bg-white px-1 py-1">
            <input
              type="checkbox"
              checked={a.done}
              onChange={(e) => update(a.id, { done: e.target.checked })}
              className="size-3 accent-indigo-600 shrink-0"
              title="완료"
            />
            <input
              type="text"
              value={a.assignee}
              onChange={(e) => update(a.id, { assignee: e.target.value })}
              placeholder="담당자"
              className={cn(inputCls, 'w-28 text-[11px]')}
            />
            <input
              type="text"
              value={a.task}
              onChange={(e) => update(a.id, { task: e.target.value })}
              placeholder="할 일"
              className={cn(inputCls, 'flex-1 text-[11px]')}
            />
            <input
              type="date"
              value={a.dueDate}
              onChange={(e) => update(a.id, { dueDate: e.target.value })}
              className={cn(inputCls, 'w-32 text-[11px]')}
              title="완료기한"
            />
            <button
              type="button"
              onClick={() => remove(a.id)}
              className="rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-rose-100 hover:text-rose-700 shrink-0"
              title="삭제"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function ConfirmDeleteModal({ row, onCancel, onConfirm }: { row: CooperationRequest; onCancel: () => void; onConfirm: () => void }) {
  const backdropHandlers = useBackdropCloseHandlers(onCancel);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-3" {...backdropHandlers}>
      <div
        className="w-full max-w-sm rounded-xl bg-[var(--color-surface)] shadow-2xl border border-[var(--color-line)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--color-line)]">
          <h2 className="text-sm font-bold text-[var(--color-ink)]">협조 요청 삭제</h2>
        </div>
        <div className="px-4 py-3 text-xs text-[var(--color-ink)] space-y-1">
          <p>아래 항목을 삭제할까요? 되돌릴 수 없습니다.</p>
          <p className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-1.5 font-mono text-[11px]">
            {row.mgmtId || '(관리ID 없음)'} · {row.title || '(제목 없음)'}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 포인트 현황 모달 — 협조 요청 '처리완료' 자동 지급 포인트의 인원별 누적 랭킹 + 최근 지급 내역.
 * 데이터는 cooperation_points ledger(DB 트리거 관리)에서 읽고, 로컬(dev 우회) 모드에서는 즉석 계산.
 */
function CooperationPointsModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CooperationPointEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { error, setError } = useErrorStateWithToast({ toastId: 'wbs-cooperation-points-error' });
  /** 랭킹에서 클릭한 사람 이름 — 선택 시 지급 내역이 그 사람 것만으로 바뀐다. */
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setEntries(await fetchCooperationPoints());
    } catch (e) {
      setError(e instanceof Error ? e.message : '포인트 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const summaries = useMemo(() => summarizeCooperationPoints(entries), [entries]);
  const totalPoints = useMemo(() => entries.reduce((s, e) => s + e.points, 0), [entries]);
  /** 선택된 사람의 지급 내역(전체) — 미선택이면 null. */
  const personEntries = useMemo(
    () => (selectedPerson ? entries.filter((e) => e.memberName.trim() === selectedPerson) : null),
    [entries, selectedPerson],
  );

  /** 1~3위는 금·은·동 톤으로 강조 */
  const rankStyle = (rank: number): string =>
    rank === 1
      ? 'bg-amber-100 text-amber-700 ring-amber-300'
      : rank === 2
        ? 'bg-slate-200 text-slate-700 ring-slate-300'
        : rank === 3
          ? 'bg-orange-100 text-orange-700 ring-orange-200'
          : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] ring-[var(--color-line)]';
  const backdropHandlers = useBackdropCloseHandlers(onClose);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3" {...backdropHandlers}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl border border-[var(--color-line)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]">
          <h2 className="text-sm font-bold text-[var(--color-ink)] inline-flex items-center gap-2">
            <span className="inline-flex items-center justify-center size-6 rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <Coins size={14} />
            </span>
            협조 요청 포인트 현황
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]"
              title="다시 불러오기"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)]"
              title="닫기 (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-4 py-3 space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 m-0">
            담당자가 <b>처리완료</b>하면 그 담당자에게 포인트가 자동 지급되고, 처리완료가 풀리면 자동 회수됩니다. 지급량은 중요도 기준 — 상
            +{COOPERATION_POINTS_BY_PRIORITY.상}P · 중 +{COOPERATION_POINTS_BY_PRIORITY.중}P · 하 +{COOPERATION_POINTS_BY_PRIORITY.하}P
            <br />
            <span className="text-[10.5px]">
              포인트는 항상 <b>개인</b>에게 지급됩니다. 조직(부서)을 담당으로 지정한 경우, 담당자로 지정된 인원에게만 지급되며 조직 자체에는
              지급되지 않습니다.
            </span>
          </p>

          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

          {loading ? (
            <div className="py-10 text-center text-xs text-[var(--color-ink-muted)]">
              <Loader2 size={16} className="inline animate-spin mr-2" />
              불러오는 중…
            </div>
          ) : entries.length === 0 ? (
            !error && (
              <div className="py-10 text-center text-xs text-[var(--color-ink-muted)]">
                아직 지급된 포인트가 없습니다. 담당자가 '처리완료'하면 자동으로 지급됩니다.
              </div>
            )
          ) : (
            <>
              {/* 합계 카드 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">총 지급 포인트</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-amber-600">{totalPoints.toLocaleString()}P</div>
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">수령 인원</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-[var(--color-ink)]">{summaries.length}명</div>
                </div>
                <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">지급 건수</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-[var(--color-ink)]">{entries.length}건</div>
                </div>
              </div>

              {/* 인원별 누적 랭킹 — 이름 클릭 시 아래 지급 내역이 그 사람 것만으로 필터링 */}
              <div className="rounded-md border border-[var(--color-line)] overflow-hidden">
                <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink)]">
                  인원별 누적 포인트
                  <span className="ml-1.5 font-normal text-[10px] text-[var(--color-ink-muted)]">이름을 클릭하면 개인별 내역을 봅니다</span>
                </div>
                <div className="max-h-64 overflow-auto divide-y divide-[var(--color-line)]">
                  {summaries.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSelectedPerson((prev) => (prev === s.name ? null : s.name))}
                      aria-pressed={selectedPerson === s.name}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                        selectedPerson === s.name ? 'bg-amber-50' : 'hover:bg-[var(--color-surface-2)]',
                      )}
                      title={`${s.name} 지급 내역 보기`}
                    >
                      <span
                        className={cn(
                          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1 tabular-nums',
                          rankStyle(i + 1),
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-[var(--color-ink)]">{s.name}</span>
                        {(s.department || s.position) && (
                          <span className="ml-1.5 text-[10.5px] text-[var(--color-ink-muted)]">
                            {[s.department, s.position].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[10.5px] text-[var(--color-ink-muted)] tabular-nums">{s.awardCount}건</span>
                      <span className="w-16 shrink-0 text-right font-bold tabular-nums text-amber-600">
                        {s.totalPoints.toLocaleString()}P
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 지급 내역 — 기본은 전체 최근 30건, 위 랭킹에서 사람을 선택하면 그 사람의 전체 내역 */}
              <div className="rounded-md border border-[var(--color-line)] overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink)]">
                  {personEntries ? (
                    <>
                      <span className="truncate">
                        {selectedPerson} 지급 내역 ({personEntries.length}건 ·{' '}
                        <span className="text-amber-600">{personEntries.reduce((s, e) => s + e.points, 0).toLocaleString()}P</span>)
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedPerson(null)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:bg-[var(--color-surface)]"
                      >
                        전체 보기
                      </button>
                    </>
                  ) : (
                    <span>최근 지급 내역{entries.length > 30 ? ' (최근 30건)' : ''}</span>
                  )}
                </div>
                <div className="max-h-56 overflow-auto divide-y divide-[var(--color-line)]">
                  {personEntries && personEntries.length === 0 && (
                    <div className="px-2.5 py-3 text-center text-[11px] text-[var(--color-ink-muted)]">지급 내역이 없습니다.</div>
                  )}
                  {(personEntries ?? entries.slice(0, 30)).map((e) => (
                    <div key={e.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                      <span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">{fmtDate(e.awardedAt) || '—'}</span>
                      <div className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                        {e.requestMgmtId && (
                          <span className="mr-1 font-mono text-[10px] text-[var(--color-ink-muted)]">{e.requestMgmtId}</span>
                        )}
                        {e.requestTitle || '(제목 없음)'}
                      </div>
                      <span className="shrink-0 font-medium text-[var(--color-ink)]">{e.memberName}</span>
                      <span className="w-12 shrink-0 text-right font-bold tabular-nums text-emerald-600">+{e.points}P</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 칸반 카드 보기 — 현황(요청완료/진행중/지연/완료/회신불가)을 컬럼으로 둔다.
 * 카드 클릭 → 편집 모달 열림.
 * 컬럼 헤더의 색은 STATUS_STYLE 과 동일한 톤.
 */
function CooperationKanbanBoard({
  rows,
  totalCount,
  todayIso,
  onEdit,
  onDelete,
  onQuickStatus,
  onBroadcast,
  onOpenMembers,
  onArchive,
  broadcastingId,
}: {
  rows: CooperationRequest[];
  totalCount: number;
  todayIso: string;
  onEdit: (r: CooperationRequest) => void;
  onDelete: (r: CooperationRequest) => void;
  onQuickStatus: (r: CooperationRequest, next: CooperationRequestStatus) => void;
  onBroadcast: (r: CooperationRequest) => void;
  onOpenMembers: (r: CooperationRequest) => void;
  onArchive: (r: CooperationRequest, archived: boolean) => void;
  broadcastingId: string | null;
}) {
  // 컬럼별 그룹핑(요청완료 → 담당자 지정완료 → 진행중 → 처리완료 → 확인완료 → 취소됨)
  const byStatus = useMemo(() => {
    const m: Record<CooperationRequestStatus, CooperationRequest[]> = {
      요청완료: [],
      '담당자 지정완료': [],
      진행중: [],
      처리완료: [],
      확인완료: [],
      취소됨: [],
    };
    for (const r of rows) m[r.status].push(r);
    return m;
  }, [rows]);

  // 드래그 중인 카드 id (DragOverlay 표시용)
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const cardId = String(active.id).replace(/^card:/, '');
    const overId = String(over.id);
    const targetStatus = overId.startsWith('col:') ? (overId.replace(/^col:/, '') as CooperationRequestStatus) : null;
    if (!targetStatus) return;
    const row = rows.find((r) => r.id === cardId);
    if (!row || row.status === targetStatus) return;
    onQuickStatus(row, targetStatus);
  };

  const activeRow = activeId ? (rows.find((r) => `card:${r.id}` === activeId) ?? null) : null;

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-10 text-center text-xs text-[var(--color-ink-muted)]">
        조건에 맞는 항목이 없습니다. (전체 {totalCount}건)
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-sm">
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-flow-col auto-cols-[minmax(220px,1fr)] gap-2 overflow-x-auto">
          {COOPERATION_REQUEST_STATUSES.map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              items={byStatus[s]}
              todayIso={todayIso}
              onEdit={onEdit}
              onDelete={onDelete}
              onQuickStatus={onQuickStatus}
              onBroadcast={onBroadcast}
              onOpenMembers={onOpenMembers}
              onArchive={onArchive}
              broadcastingId={broadcastingId}
              activeCardId={activeRow?.id ?? null}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="opacity-90 rotate-1 scale-[1.02] shadow-xl">
              <KanbanCard
                row={activeRow}
                todayIso={todayIso}
                onEdit={() => {}}
                onDelete={() => {}}
                onQuickStatus={() => {}}
                onBroadcast={() => {}}
                onOpenMembers={() => {}}
                onArchive={() => {}}
                broadcasting={false}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="mt-2 flex items-center justify-between px-1 text-[10.5px] text-[var(--color-ink-muted)]">
        <span>
          표시 {rows.length} / 전체 {totalCount}
        </span>
        <span>카드를 다른 칸으로 끌어 놓으면 현황이 바로 바뀝니다 · 클릭하면 상세 편집</span>
      </div>
    </div>
  );
}

/** Droppable 컬럼 — drop 시 useDroppable이 over로 감지 → 상위에서 onQuickStatus 호출 */
function KanbanColumn({
  status,
  items,
  todayIso,
  onEdit,
  onDelete,
  onQuickStatus,
  onBroadcast,
  onOpenMembers,
  onArchive,
  broadcastingId,
  activeCardId,
}: {
  status: CooperationRequestStatus;
  items: CooperationRequest[];
  todayIso: string;
  onEdit: (r: CooperationRequest) => void;
  onDelete: (r: CooperationRequest) => void;
  onQuickStatus: (r: CooperationRequest, next: CooperationRequestStatus) => void;
  onBroadcast: (r: CooperationRequest) => void;
  onOpenMembers: (r: CooperationRequest) => void;
  onArchive: (r: CooperationRequest, archived: boolean) => void;
  broadcastingId: string | null;
  activeCardId: string | null;
}) {
  const sty = STATUS_STYLE[status];
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-md border min-h-[200px] transition-colors',
        sty.bg,
        isOver ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-[var(--color-line)]',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[var(--color-line)]">
        <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-bold', sty.text)}>
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sty.dot)} />
          {statusStepLabel(status)}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', sty.text, sty.ring, 'bg-white/60')}>
          {items.length}
        </span>
      </div>
      <div className="flex-1 space-y-1.5 p-1.5">
        {items.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-line)] bg-white/40 px-2 py-3 text-center text-[10.5px] text-[var(--color-ink-muted)]">
            {isOver ? '여기에 놓기' : '(없음)'}
          </div>
        ) : (
          items.map((r) => (
            <DraggableKanbanCard
              key={r.id}
              row={r}
              isDragging={activeCardId === r.id}
              todayIso={todayIso}
              onEdit={() => onEdit(r)}
              onDelete={() => onDelete(r)}
              onQuickStatus={(next) => onQuickStatus(r, next)}
              onBroadcast={() => onBroadcast(r)}
              onOpenMembers={() => onOpenMembers(r)}
              onArchive={(archived) => onArchive(r, archived)}
              broadcasting={broadcastingId === r.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Draggable 카드 래퍼 — 카드 외곽에 useDraggable 부착. 클릭은 distance 임계로 보존됨. */
function DraggableKanbanCard({
  row,
  isDragging,
  todayIso,
  onEdit,
  onDelete,
  onQuickStatus,
  onBroadcast,
  onOpenMembers,
  onArchive,
  broadcasting,
}: {
  row: CooperationRequest;
  isDragging: boolean;
  todayIso: string;
  onEdit: () => void;
  onDelete: () => void;
  onQuickStatus: (next: CooperationRequestStatus) => void;
  onBroadcast: () => void;
  onOpenMembers: () => void;
  onArchive: (archived: boolean) => void;
  broadcasting: boolean;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: `card:${row.id}` });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && 'opacity-30')}>
      <KanbanCard
        row={row}
        todayIso={todayIso}
        onEdit={onEdit}
        onDelete={onDelete}
        onQuickStatus={onQuickStatus}
        onBroadcast={onBroadcast}
        onOpenMembers={onOpenMembers}
        onArchive={onArchive}
        broadcasting={broadcasting}
      />
    </div>
  );
}

function KanbanCard({
  row,
  todayIso,
  onEdit,
  onDelete,
  onBroadcast,
  onOpenMembers,
  onArchive,
  broadcasting,
}: {
  row: CooperationRequest;
  todayIso: string;
  onEdit: () => void;
  onDelete: () => void;
  /** 칸반에서는 컬럼=현황이라 카드 내 직접 변경은 두지 않는다(드래그로 변경). 시그니처 유지용. */
  onQuickStatus: (next: CooperationRequestStatus) => void;
  onBroadcast: () => void;
  /** 담당자별 진행 패널 열기 — 멤버 배지 클릭. */
  onOpenMembers: () => void;
  onArchive: (archived: boolean) => void;
  broadcasting: boolean;
}) {
  const overdue = isOverdue(row, todayIso);
  const escalation = escalationFlag(row);
  // "요청 후 경과" — 요청일(없으면 생성일) 기준
  const reqElapsed = formatElapsed(row.requestDate || row.createdAt);
  // 기한 초과 일수 / 남은 일수
  const overdueDays = overdueDaysOf(row, todayIso);
  const remaining = dueRemaining(row, todayIso);
  const memberDone = row.memberProgress.filter((m) => m.status === '처리완료' || m.status === '확인완료').length;

  // 담당자 종류 아이콘(조직/혼합/인원)
  const assigneeIcon =
    row.assigneeKind === 'org' ? (
      <Building2 size={11} className="text-violet-600 shrink-0" />
    ) : row.assigneeKind === 'mixed' ? (
      <span className="inline-flex shrink-0">
        <Building2 size={11} className="text-violet-600" />
        <User size={11} className="-ml-0.5 text-slate-500" />
      </span>
    ) : (
      <User size={11} className="text-slate-500 shrink-0" />
    );

  return (
    <div
      onClick={onEdit}
      className={cn(
        'group relative rounded-lg border bg-white p-2.5 shadow-sm hover:shadow-md cursor-pointer transition',
        escalation
          ? 'border-rose-300 ring-1 ring-rose-200'
          : overdue
            ? 'border-amber-300'
            : 'border-[var(--color-line)] hover:border-indigo-300',
      )}
    >
      {/* 헤더: (좌) 응답지연/에스컬 플래그 강조 / (우) 기한초과 배지 ↔ hover 액션. 구분·중요도 칩은 표시하지 않음. */}
      <div className="flex items-center justify-between gap-1.5 min-h-[20px]">
        <div className="flex items-center gap-1 min-w-0">
          {escalation && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm shrink-0"
              title={
                escalation.kind === 'screening'
                  ? '요청완료 24시간 초과 — 1차 응답 지연 (협업 프로세스 V1.0)'
                  : '진행중 72시간 초과 — 부서장 에스컬레이션 대상 (협업 프로세스 V1.0)'
              }
            >
              <AlertCircle size={11} />
              {escalation.kind === 'screening' ? '응답지연' : '에스컬'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* 기한 초과 배지(강조) — hover 시 액션 버튼으로 대체 */}
          {overdue && (
            <span
              className="group-hover:hidden inline-flex items-center gap-1 rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
              title={overdueDays > 0 ? `기한이 ${overdueDays}일 지났습니다` : '기한이 지났습니다'}
            >
              <AlertTriangle size={11} />
              {overdueDays > 0 ? `${overdueDays}일 초과` : '기한 초과'}
            </span>
          )}
          <div
            className={cn(
              'items-center gap-0.5 transition',
              overdue ? 'hidden group-hover:flex' : 'flex opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onBroadcast}
              disabled={broadcasting}
              className="rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-sky-100 hover:text-sky-700 disabled:opacity-50"
              title="텔레그램·메일로 전파"
            >
              {broadcasting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-indigo-100 hover:text-indigo-700"
              title="편집"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => onArchive(!row.archived)}
              className="rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-slate-200 hover:text-slate-700"
              title={row.archived ? '보관 해제(복원)' : '보관함으로 이동'}
            >
              {row.archived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-0.5 text-[var(--color-ink-muted)] hover:bg-rose-100 hover:text-rose-700"
              title="삭제"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* 제목 */}
      <div className="mt-1.5 text-[12.5px] font-semibold leading-snug text-[var(--color-ink)] line-clamp-2">
        {row.title || <span className="text-[var(--color-ink-muted)]">(제목 없음)</span>}
      </div>

      {/* 요청자 → 담당자 */}
      <div className="mt-2 flex items-center gap-1 text-[10.5px]">
        <span
          className="inline-flex items-center gap-0.5 min-w-0 max-w-[45%] text-[var(--color-ink-muted)]"
          title={`요청자: ${row.requester || '미지정'}`}
        >
          <User size={11} className="text-slate-400 shrink-0" />
          <span className="truncate">{row.requester || '미지정'}</span>
        </span>
        <ArrowRight size={11} className="text-slate-300 shrink-0" />
        <span
          className="inline-flex items-center gap-0.5 min-w-0 flex-1 font-medium text-[var(--color-ink)]"
          title={`담당자: ${row.assignee || '미지정'}`}
        >
          {assigneeIcon}
          <span className="truncate">{row.assignee || '미지정'}</span>
          {row.memberProgress.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenMembers();
              }}
              className="ml-0.5 inline-flex items-center gap-0.5 rounded bg-violet-50 px-1 py-0.5 text-[9px] font-medium text-violet-700 ring-1 ring-violet-200 tabular-nums shrink-0 transition hover:bg-violet-100 hover:ring-violet-300"
              title="담당자별 진행 관리 — 클릭"
            >
              <ListChecks size={9} />
              {memberDone}/{row.memberProgress.length}
            </button>
          )}
        </span>
      </div>

      {/* 푸터: 요청 후 경과(강조) / 기한 */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px]">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold tabular-nums shrink-0',
            reqElapsed === '오늘' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-600',
          )}
          title={`요청일: ${fmtDate(row.requestDate) || '—'}`}
        >
          <Clock size={11} className="shrink-0" />
          {reqElapsed ? (reqElapsed === '오늘' ? '오늘 요청' : `요청 후 ${reqElapsed} 경과`) : '요청일 미상'}
        </span>
        {row.dueDate && (
          <span className={cn('tabular-nums shrink-0', overdue ? 'font-bold text-amber-600' : 'text-[var(--color-ink-muted)]')}>
            기한 {fmtDate(row.dueDate)}
            {remaining && (
              <span className={cn('ml-1 font-semibold', remaining.days <= 2 ? 'text-amber-600' : 'text-emerald-600')}>
                · {remaining.label}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
