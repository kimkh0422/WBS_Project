import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Handshake,
  Plus,
  RefreshCw,
  Search,
  X,
  Pencil,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  CircleAlert,
  Filter,
  ChevronDown,
  User,
  Building2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from './Toast';
import { useOrganization, getDirectMembersFromTree } from '../context/OrganizationContext';
import type { OrgNode, OrgMember } from '../data/organization';
import {
  fetchCooperationRequests,
  insertCooperationRequest,
  updateCooperationRequest,
  deleteCooperationRequest,
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
} from '../lib/db/cooperationRequests';

interface CooperationRequestSectionProps {
  /** 대시보드 섹션 헤더(전체현황 등)와 톤을 맞추기 위한 모바일 가독성 모드 */
  mobileReadabilityMode?: boolean;
}

const STATUS_STYLE: Record<CooperationRequestStatus, { dot: string; bg: string; text: string; ring: string }> = {
  요청완료: { dot: 'bg-slate-400', bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200' },
  진행중: { dot: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' },
  지연: { dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200' },
  완료: { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  회신불가: { dot: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
};

const STATUS_ICON: Record<CooperationRequestStatus, React.ReactNode> = {
  요청완료: <CircleAlert size={12} />,
  진행중: <Loader2 size={12} />,
  지연: <Clock size={12} />,
  완료: <CheckCircle2 size={12} />,
  회신불가: <AlertCircle size={12} />,
};

const PRIORITY_STYLE: Record<CooperationRequestPriority, string> = {
  상: 'bg-rose-100 text-rose-700 ring-rose-200',
  중: 'bg-amber-100 text-amber-700 ring-amber-200',
  하: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const TYPE_STYLE: Record<CooperationRequestType, string> = {
  자료: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  검토: 'bg-violet-50 text-violet-700 ring-violet-200',
  협의: 'bg-sky-50 text-sky-700 ring-sky-200',
  기타: 'bg-slate-50 text-slate-600 ring-slate-200',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s;
}

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

/** 행이 '지연' 여부 추론: 상태가 '완료/회신불가'가 아니고, 기한이 오늘 이전이면 true */
function isOverdue(r: CooperationRequest, todayIso: string): boolean {
  if (!r.dueDate) return false;
  if (r.status === '완료' || r.status === '회신불가') return false;
  return r.dueDate < todayIso;
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

/** OrgMember[] → 기본 CooperationMemberProgress[](상태=요청완료) */
function initMemberProgress(members: OrgMember[]): CooperationMemberProgress[] {
  return members.map((m) => ({
    name: m.name,
    department: m.department,
    position: m.position,
    status: '요청완료',
    completedAt: '',
  }));
}

/** 표시용: 조직 대상 행에 보여줄 '완료수/전체수' 텍스트 */
function memberProgressLabel(m: CooperationMemberProgress[]): string {
  if (m.length === 0) return '인원 없음';
  const done = m.filter((x) => x.status === '완료').length;
  return `${done}/${m.length}`;
}

export function CooperationRequestSection({ mobileReadabilityMode = false }: CooperationRequestSectionProps) {
  const [rows, setRows] = useState<CooperationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CooperationRequestStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<CooperationRequestType | 'all'>('all');
  const [editing, setEditing] = useState<{ row: CooperationRequest | null; draft: CooperationRequestInput } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CooperationRequest | null>(null);
  const [saving, setSaving] = useState(false);
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

  /** 필터 + 검색 적용된 결과 */
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && r.requestType !== typeFilter) return false;
      if (q) {
        const blob = `${r.mgmtId} ${r.title} ${r.detail} ${r.requester} ${r.assignee} ${r.result} ${r.note}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, typeFilter]);

  /** 상태별 카운트(상단 칩) */
  const statusCounts = useMemo(() => {
    const c: Record<CooperationRequestStatus, number> = { 요청완료: 0, 진행중: 0, 지연: 0, 완료: 0, 회신불가: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const overdueCount = useMemo(() => rows.filter((r) => isOverdue(r, todayIso)).length, [rows, todayIso]);

  const handleNew = useCallback(() => {
    const draft = makeEmptyCooperationRequest({ mgmtId: nextMgmtId(rowsRef.current) });
    setEditing({ row: null, draft });
  }, []);

  const handleEdit = useCallback((row: CooperationRequest) => {
    const { id: _id, createdAt: _ca, updatedAt: _ua, createdBy: _cb, ...rest } = row;
    setEditing({ row, draft: rest });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.row) {
        const updated = await updateCooperationRequest(editing.row.id, editing.draft);
        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        pushToast('협조 요청을 저장했습니다.', { variant: 'success', durationMs: 1500 });
      } else {
        const created = await insertCooperationRequest(null, editing.draft);
        setRows((prev) => [...prev, created]);
        pushToast('협조 요청을 추가했습니다.', { variant: 'success', durationMs: 1500 });
      }
      setEditing(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      pushToast(msg, { variant: 'error', durationMs: 4000 });
    } finally {
      setSaving(false);
    }
  }, [editing, pushToast]);

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

  /** 표 내 빠른 상태 변경(셀 토글 없이 드롭다운으로) */
  const handleQuickStatus = useCallback(
    async (row: CooperationRequest, next: CooperationRequestStatus) => {
      const prev = rowsRef.current;
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
      try {
        const patch: Partial<CooperationRequest> = { status: next };
        if (next === '완료' && !row.completedDate) patch.completedDate = todayIso;
        if (next === '완료' && row.progress < 1) patch.progress = 1;
        const updated = await updateCooperationRequest(row.id, patch);
        setRows((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
      } catch (e) {
        setRows(prev);
        pushToast(e instanceof Error ? e.message : '상태 변경에 실패했습니다.', { variant: 'error', durationMs: 4000 });
      }
    },
    [pushToast, todayIso],
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
        <div className="flex items-center gap-2">
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

      {/* 상태 요약 칩 */}
      <div className="flex flex-wrap items-center gap-1.5">
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
          전체 <span className="opacity-80">{rows.length}</span>
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
              {s} <span className="opacity-80">{statusCounts[s]}</span>
            </button>
          );
        })}
        {overdueCount > 0 && (
          <span
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
            title="기한이 지났지만 완료/회신불가가 아닌 항목"
          >
            <Clock size={11} /> 기한 초과 {overdueCount}건
          </span>
        )}
      </div>

      {/* 검색 + 구분 필터 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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

      {/* 표 */}
      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]">
              <tr className="text-left">
                <th className="px-2 py-2 font-semibold w-10 text-right">#</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">관리ID</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">요청일</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">구분</th>
                <th className="px-2 py-2 font-semibold min-w-[180px]">제목</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">요청자</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">담당자</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">중요도</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">기한</th>
                <th className="px-2 py-2 font-semibold w-[130px]">진척률</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">현황</th>
                <th className="px-2 py-2 font-semibold whitespace-nowrap">완료일</th>
                <th className="px-2 py-2 font-semibold w-14"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                    <Loader2 size={16} className="inline animate-spin mr-2" />
                    불러오는 중…
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
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
                      <td className="px-2 py-1.5 text-[var(--color-ink-muted)] whitespace-nowrap tabular-nums">{fmtDate(r.requestDate)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={cn('inline-flex rounded px-1.5 py-0.5 ring-1 text-[11px] font-medium', TYPE_STYLE[r.requestType])}>
                          {r.requestType}
                        </span>
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
                              <span className="ml-1 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-violet-200 tabular-nums">
                                {memberProgressLabel(r.memberProgress)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[var(--color-ink-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span
                          className={cn('inline-flex rounded px-1.5 py-0.5 ring-1 text-[11px] font-semibold', PRIORITY_STYLE[r.priority])}
                        >
                          {r.priority}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1.5 whitespace-nowrap tabular-nums',
                          overdue ? 'text-amber-700 font-semibold' : 'text-[var(--color-ink-muted)]',
                        )}
                        title={overdue ? '기한이 지났습니다' : undefined}
                      >
                        {fmtDate(r.dueDate) || '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                r.status === '완료' ? 'bg-emerald-500' : r.status === '회신불가' ? 'bg-rose-400' : 'bg-indigo-500',
                              )}
                              style={{ width: `${pct(r.progress)}%` }}
                            />
                          </div>
                          <span className="w-9 text-right tabular-nums text-[10.5px] text-[var(--color-ink-muted)]">
                            {pct(r.progress)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <label
                          className={cn(
                            'relative inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 text-[11px] font-medium cursor-pointer',
                            sty.bg,
                            sty.text,
                            sty.ring,
                          )}
                        >
                          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', sty.dot)} />
                          <span>{r.status}</span>
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
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>
                      </td>
                      <td className="px-2 py-1.5 text-[var(--color-ink-muted)] whitespace-nowrap tabular-nums">
                        {fmtDate(r.completedDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
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
          <span>진척률 0~100%, 기한 초과는 노란색으로 표시</span>
        </div>
      </div>

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

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3" onClick={onCancel}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl border border-[var(--color-line)] flex flex-col"
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
              rows={3}
              placeholder="협조가 필요한 업무·자료·검토 항목의 구체 내용을 적습니다."
              className={cn(inputCls, 'resize-y min-h-[60px]')}
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
            <Field label="기한(완료예정)">
              <input type="date" value={draft.dueDate} onChange={(e) => onChange({ dueDate: e.target.value })} className={inputCls} />
            </Field>
          </div>

          {/* 담당 — 인원/조직 토글 + picker */}
          <AssigneePicker draft={draft} orgTree={orgTree} orgMembers={orgMembers} orgPickList={orgPickList} onChange={onChange} />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                  if (next === '완료' && !draft.completedDate) patch.completedDate = new Date().toISOString().slice(0, 10);
                  if (next === '완료' && draft.progress < 1) patch.progress = 1;
                  onChange(patch);
                }}
                className={inputCls}
              >
                {COOPERATION_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="완료일">
              <input
                type="date"
                value={draft.completedDate}
                onChange={(e) => onChange({ completedDate: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="결과·회신">
            <textarea
              value={draft.result}
              onChange={(e) => onChange({ result: e.target.value })}
              rows={4}
              placeholder="회신 내용 / 결과를 적습니다. 새로운 회신은 '[11/3 회신내용] ...' 형태로 누적해 기록할 수 있습니다."
              className={cn(inputCls, 'resize-y min-h-[72px]')}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="지연사유">
              <input
                type="text"
                value={draft.delayReason}
                onChange={(e) => onChange({ delayReason: e.target.value })}
                className={inputCls}
                placeholder="(필요 시)"
              />
            </Field>
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

  /** 현재 선택된 멤버 진척에 (orgIds, directPersons) 조합을 반영해 새 배열 생성. 기존 상태 보존. */
  const recalcMembers = (orgIds: string[], directPersons: OrgMember[]): CooperationMemberProgress[] => {
    const existing = new Map(draft.memberProgress.map((m) => [memberKey(m.name, m.department, m.position), m] as const));
    const collected = new Map<string, CooperationMemberProgress>();
    for (const orgId of orgIds) {
      const node = findOrgNode(orgTree, orgId);
      if (!node) continue;
      for (const m of getDeepMembers(node, orgMembers)) {
        const k = memberKey(m.name, m.department, m.position);
        const prev = collected.get(k) ??
          existing.get(k) ?? {
            name: m.name,
            department: m.department,
            position: m.position,
            status: '요청완료' as CooperationRequestStatus,
            completedAt: '',
            sourceOrgIds: [],
            direct: false,
          };
        const nextSrc = prev.sourceOrgIds.includes(orgId)
          ? prev.sourceOrgIds.filter((s) => orgIds.includes(s))
          : [...prev.sourceOrgIds.filter((s) => orgIds.includes(s)), orgId];
        collected.set(k, { ...prev, sourceOrgIds: nextSrc });
      }
    }
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
    const completedDate = status === '완료' ? draft.completedDate || new Date().toISOString().slice(0, 10) : draft.completedDate;
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
      const completedAt = status === '완료' ? m.completedAt || new Date().toISOString().slice(0, 10) : '';
      return { ...m, status, completedAt };
    });
    applyMemberUpdate(next, draft.assigneeOrgIds, currentDirectPersons);
  };

  const availableOrgs = orgPickList.filter(({ node }) => !draft.assigneeOrgIds.includes(node.id));

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
      </div>

      {draft.memberProgress.length > 0 && <MemberChecklist memberProgress={draft.memberProgress} onChange={setMemberStatus} />}
    </div>
  );
}

/** 조직 대상 시 멤버별 현황 체크리스트. 각 행: 이름·부서·직위 + 상태 셀렉트. */
function MemberChecklist({
  memberProgress,
  onChange,
}: {
  memberProgress: CooperationMemberProgress[];
  onChange: (idx: number, status: CooperationRequestStatus) => void;
}) {
  if (memberProgress.length === 0) {
    return <p className="text-[11px] text-[var(--color-ink-muted)]">선택한 조직에 등록된 인원이 없습니다.</p>;
  }
  const doneCount = memberProgress.filter((m) => m.status === '완료').length;
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
              {m.status === '완료' && m.completedAt && (
                <span className="text-[10px] tabular-nums text-emerald-700">{m.completedAt.replaceAll('-', '.')}</span>
              )}
              <select
                value={m.status}
                onChange={(e) => onChange(idx, e.target.value as CooperationRequestStatus)}
                className={cn(
                  'rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-200',
                  m.status === '완료' && 'text-emerald-700 font-medium',
                  m.status === '진행중' && 'text-blue-700',
                  m.status === '지연' && 'text-amber-700',
                  m.status === '회신불가' && 'text-rose-700',
                )}
              >
                {COOPERATION_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
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

function ConfirmDeleteModal({ row, onCancel, onConfirm }: { row: CooperationRequest; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-3" onClick={onCancel}>
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
