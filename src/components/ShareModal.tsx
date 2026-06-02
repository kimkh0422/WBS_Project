import React, { useState, useEffect, useMemo } from 'react';
import { X, Copy, Check, Link2, Users, Loader2, UserPlus, Building2, UserCheck, Clock, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import {
  fetchProjectMembers,
  createProjectInvite,
  removeProjectMember,
  upsertProjectMember,
  setProjectMemberRole,
  fetchPendingProjectInvitations,
  addPendingProjectInvitation,
  removePendingProjectInvitation,
} from '../lib/db';
import { ProjectMemberRow, PendingProjectInvitationRow } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOrganization } from '../context/OrganizationContext';
import type { OrgNode } from '../data/organization';
import { buildOrgMemberLabelMap } from '../lib/assigneeOptions';

export interface ShareModalProfile {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  projectName?: string;
  isOwner?: boolean;
  /** 관리자 여부. true면 소유자가 아니어도 프로젝트 멤버 권한(보기/편집) 부여·변경 가능 */
  isAdmin?: boolean;
  /** 멤버 표시명 및 멤버 추가 시 사용. 관리자/소유자 권한 관리 시 필요 */
  profileMap?: Record<string, string>;
  /** 화면 표시 전용(소속·이름·직급). 없으면 profileMap */
  profileDisplayById?: Record<string, string>;
  profiles?: ShareModalProfile[];
  /** 프로젝트 소유자 ID. 멤버 추가 시 소유자는 제외 */
  ownerId?: string;
}

export function ShareModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  isOwner,
  isAdmin,
  profileMap = {},
  profileDisplayById = {},
  profiles = [],
  ownerId,
}: ShareModalProps) {
  const { user } = useAuth();
  const labelForProfileId = (id: string, fallback?: string) => profileDisplayById[id] ?? profileMap[id] ?? fallback ?? id;
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const [selectedAddUserIds, setSelectedAddUserIds] = useState<Set<string>>(new Set());
  const [addRole, setAddRole] = useState<'editor' | 'viewer'>('editor');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState('');
  /** 'all' = 조직 필터 없음. 그 외에는 OrgNode.id */
  const [orgFilterId, setOrgFilterId] = useState<string>('all');

  // ─── 사전 초대(미가입자) 관련 상태 ─────────────────────────────────────
  const [pendingInvitations, setPendingInvitations] = useState<PendingProjectInvitationRow[]>([]);
  const [pendingName, setPendingName] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingRole, setPendingRole] = useState<'editor' | 'viewer'>('editor');
  const [pendingSubmitting, setPendingSubmitting] = useState(false);

  const canManage = (isOwner ?? false) || (isAdmin ?? false);

  const { orgTree, orgMembers } = useOrganization();
  const orgMemberLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);

  /** 조직 트리를 들여쓰기된 평면 옵션 목록으로 변환 (드롭다운용) */
  const orgOptions = useMemo(() => {
    const list: { id: string; label: string; depth: number }[] = [];
    const walk = (node: OrgNode, depth: number) => {
      list.push({ id: node.id, label: node.name, depth });
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(orgTree, 0);
    return list;
  }, [orgTree]);

  /** 선택된 조직(자식 부서 포함)에 속한 인원 이름 집합. null이면 전체 표시. */
  const namesInSelectedOrg = useMemo<Set<string> | null>(() => {
    if (orgFilterId === 'all') return null;
    const findNode = (node: OrgNode, id: string): OrgNode | null => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const r = findNode(child, id);
        if (r) return r;
      }
      return null;
    };
    const node = findNode(orgTree, orgFilterId);
    if (!node) return new Set();
    const departments = new Set<string>();
    const collectDepts = (n: OrgNode) => {
      for (const d of n.departments ?? []) departments.add(d);
      for (const c of n.children ?? []) collectDepts(c);
    };
    collectDepts(node);
    const names = new Set<string>();
    for (const m of orgMembers) {
      if (departments.has(m.department)) names.add(m.name);
    }
    return names;
  }, [orgFilterId, orgTree, orgMembers]);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchProjectMembers(projectId).catch(() => [] as ProjectMemberRow[]),
      // 사전 초대는 관리자/소유자에게만 RLS로 보이므로 실패 시 빈 배열
      canManage ? fetchPendingProjectInvitations(projectId).catch(() => [] as PendingProjectInvitationRow[]) : Promise.resolve([]),
    ])
      .then(([m, p]) => {
        setMembers(m);
        setPendingInvitations(p);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '멤버 목록 로딩 실패');
        setMembers([]);
        setPendingInvitations([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, projectId, canManage]);

  const handleCreateInvite = async () => {
    if (!projectId || !canManage) return;
    setInviteCreating(true);
    setError(null);
    try {
      const result = await createProjectInvite(projectId);
      if (result) {
        setInviteLink(result.url);
      } else {
        setError('초대 링크 생성에 실패했습니다.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '초대 링크 생성 실패');
    } finally {
      setInviteCreating(false);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!projectId || !canManage) return;
    try {
      await removeProjectMember(projectId, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : '멤버 제거 실패');
    }
  };

  const handleRoleChange = async (userId: string, role: 'editor' | 'viewer') => {
    if (!projectId || !canManage) return;
    setRoleChangingId(userId);
    setError(null);
    const result = await setProjectMemberRole(projectId, userId, role);
    setRoleChangingId(null);
    if (result.success) {
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    } else {
      setError(result.error || '역할 변경 실패');
    }
  };

  /** 입력된 이름/이메일을 가입한 profiles에서 매칭 시도. 둘 다 비어 있으면 null. */
  const resolveProfileByNameOrEmail = (name: string, email: string): { id: string; label: string } | null => {
    const nameNorm = name.trim();
    const emailNorm = email.trim().toLowerCase();
    if (!nameNorm && !emailNorm) return null;
    // 이메일 우선 매칭 (더 정확)
    if (emailNorm) {
      const byEmail = profiles.find((p) => (p.email ?? '').trim().toLowerCase() === emailNorm);
      if (byEmail) return { id: byEmail.id, label: labelForProfileId(byEmail.id, byEmail.full_name ?? byEmail.email ?? byEmail.id) };
    }
    if (nameNorm) {
      const byName = profiles.find((p) => {
        const candidate = (labelForProfileId(p.id, p.full_name ?? '') ?? '').trim();
        return candidate === nameNorm;
      });
      if (byName) return { id: byName.id, label: labelForProfileId(byName.id, byName.full_name ?? byName.email ?? byName.id) };
    }
    return null;
  };

  /** 미가입자 사전 등록 (이름/이메일 + 역할). 매칭되는 가입자가 있으면 즉시 project_members에 추가. */
  const handleAddPendingInvitation = async () => {
    if (!projectId || !canManage) return;
    const name = pendingName.trim();
    const email = pendingEmail.trim();
    if (!name && !email) {
      setError('이름 또는 이메일을 입력하세요.');
      return;
    }
    setPendingSubmitting(true);
    setError(null);
    try {
      // 이미 가입한 사용자라면 사전 초대를 거치지 않고 바로 멤버로 추가
      const existing = resolveProfileByNameOrEmail(name, email);
      if (existing) {
        if (memberUserIds.has(existing.id)) {
          setError(`${existing.label} 님은 이미 멤버입니다.`);
        } else {
          const r = await upsertProjectMember(projectId, existing.id, pendingRole);
          if (!r.success) setError(r.error || '멤버 추가 실패');
          else {
            const list = await fetchProjectMembers(projectId);
            setMembers(list);
            setPendingName('');
            setPendingEmail('');
          }
        }
        return;
      }
      // 미가입 → 사전 초대 INSERT
      const r = await addPendingProjectInvitation(projectId, { full_name: name || null, email: email || null }, pendingRole);
      if (!r.success) {
        setError(r.error || '사전 등록 실패');
        return;
      }
      // INSERT 성공 → 즉시 로컬에 추가 (재조회가 RLS로 빈 배열을 돌려줘도 카드가 보이도록).
      // 이후 fetch로 정합화 시도. 성공·결과 있으면 서버 결과로 교체, 빈 배열이면 낙관적 추가 유지.
      if (r.row) {
        setPendingInvitations((prev) => (prev.some((p) => p.id === r.row!.id) ? prev : [r.row!, ...prev]));
      }
      try {
        const list = await fetchPendingProjectInvitations(projectId);
        if (list.length > 0) setPendingInvitations(list);
      } catch {
        /* fetch 실패는 무시 — 낙관적 추가가 이미 반영됨 */
      }
      setPendingName('');
      setPendingEmail('');
    } finally {
      setPendingSubmitting(false);
    }
  };

  const handleRemovePendingInvitation = async (invitationId: string) => {
    if (!projectId || !canManage) return;
    setError(null);
    const r = await removePendingProjectInvitation(invitationId);
    if (!r.success) {
      setError(r.error || '사전 등록 제거 실패');
      return;
    }
    setPendingInvitations((prev) => prev.filter((p) => p.id !== invitationId));
  };

  const handleAddMembersBulk = async () => {
    if (!projectId || selectedAddUserIds.size === 0 || adding) return;
    setAdding(true);
    setError(null);
    try {
      const ids = [...selectedAddUserIds];
      const results = await Promise.all(ids.map((id) => upsertProjectMember(projectId, id, addRole)));
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setError(failed[0]?.error || '멤버 추가 실패');
      } else {
        setSelectedAddUserIds(new Set());
        setAddSearch('');
      }
      const list = await fetchProjectMembers(projectId);
      setMembers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '멤버 추가 실패');
    } finally {
      setAdding(false);
    }
  };

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const addableProfiles = profiles.filter((p) => !memberUserIds.has(p.id) && p.id !== ownerId);
  /** 검색 중에는 조직 드롭다운 범위를 쓰지 않고, 조직도 전체(가입 회원)에서 이름·이메일로 찾는다. */
  const addSearchActive = addSearch.trim().length > 0;
  const filteredAddableProfiles = addableProfiles.filter((p) => {
    if (!addSearchActive && namesInSelectedOrg) {
      const name = labelForProfileId(p.id, p.full_name ?? '');
      if (!namesInSelectedOrg.has(name)) return false;
    }
    if (!addSearchActive) return true;
    const q = addSearch.trim().toLowerCase();
    const label = (labelForProfileId(p.id, p.full_name ?? p.email ?? p.id) ?? '').toLowerCase();
    return label.includes(q);
  });
  const toggleAddSelection = (id: string) => {
    setSelectedAddUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAddSelectAll = () => {
    const list = filteredAddableProfiles.map((p) => p.id);
    setSelectedAddUserIds((prev) => {
      const allSelected = list.length > 0 && list.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        list.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      list.forEach((id) => next.add(id));
      return next;
    });
  };

  if (!isOpen) return null;

  const sectionShell = 'rounded-xl border border-[var(--color-line)] bg-[var(--color-line-soft)]/40 p-4 shadow-[var(--shadow-xs)]';
  const sectionTitle = 'flex items-center gap-2.5 text-sm font-semibold text-[var(--color-ink)] mb-3';
  const iconBadge = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]';

  return (
    <div className={MODAL_BACKDROP_CLASS} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        className={cn(MODAL_PANEL_BASE_CLASS, 'flex w-full max-w-lg max-h-[min(90vh,720px)] flex-col overflow-hidden')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[var(--color-line)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="share-modal-title" className="text-lg font-bold tracking-tight text-[var(--color-ink)]">
                공유
              </h2>
              {projectName && (
                <p className="mt-1 text-sm font-medium leading-snug text-[var(--color-ink-muted)] line-clamp-2" title={projectName}>
                  {projectName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="닫기"
            >
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            소유자·관리자가 멤버를 초대하고 권한을 줄 수 있습니다. 승인된 멤버는 <strong className="text-[var(--color-ink)]">보기</strong>·
            <strong className="text-[var(--color-ink)]">편집</strong> 모두 동일하게 작업·일정을 수정할 수 있으며, 라벨은 구분용입니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {canManage && (
            <section className={sectionShell}>
              <h3 className={sectionTitle}>
                <span className={iconBadge} aria-hidden>
                  <Link2 size={18} strokeWidth={2} />
                </span>
                초대 링크
              </h3>
              {!inviteLink ? (
                <button
                  type="button"
                  onClick={handleCreateInvite}
                  disabled={inviteCreating}
                  className={cn(
                    'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors sm:w-auto',
                    inviteCreating
                      ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                      : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]',
                  )}
                >
                  {inviteCreating ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  {inviteCreating ? '생성 중...' : '초대 링크 생성'}
                </button>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:bg-slate-900/50"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyLink(inviteLink)}
                    className={cn(
                      'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors',
                      copied
                        ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
                        : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]',
                    )}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? '복사됨' : '복사'}
                  </button>
                </div>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                링크로 들어온 팀원은 로그인 후 이 프로젝트에 <span className="font-medium text-[var(--color-ink)]">편집</span> 권한으로
                추가됩니다.
              </p>
            </section>
          )}

          <section className={sectionShell}>
            <h3 className={sectionTitle}>
              <span className={iconBadge} aria-hidden>
                <Users size={18} strokeWidth={2} />
              </span>
              멤버
            </h3>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-[var(--color-ink-muted)]">
                <Loader2 size={16} className="animate-spin" />
                불러오는 중…
              </div>
            ) : members.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-8 text-center">
                <Users className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" strokeWidth={1.25} aria-hidden />
                <p className="text-sm font-medium text-[var(--color-ink)]">아직 공유된 멤버가 없습니다</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                  초대 링크로 초대하거나, 아래에서 이름·이메일 또는 조직 회원을 추가해 보세요.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => {
                  const displayName = m.user_id === user?.id ? '나' : labelForProfileId(m.user_id, `멤버 (${m.user_id.slice(0, 8)}...)`);
                  const canChangeRole = canManage && m.role !== 'owner' && (m.role === 'editor' || m.role === 'viewer');
                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 shadow-[var(--shadow-xs)]"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--color-ink)]">{displayName}</span>
                        {canChangeRole ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.user_id, e.target.value as 'editor' | 'viewer')}
                            disabled={roleChangingId === m.user_id}
                            className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                          >
                            <option value="viewer">보기</option>
                            <option value="editor">편집</option>
                          </select>
                        ) : (
                          <span className="shrink-0 rounded-md bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {m.role === 'owner' ? '소유자' : m.role === 'editor' ? '편집' : '보기'}
                          </span>
                        )}
                        {roleChangingId === m.user_id && <Loader2 size={12} className="shrink-0 animate-spin text-slate-400" />}
                      </div>
                      {canManage && m.user_id !== user?.id && m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                        >
                          제거
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {canManage && pendingInvitations.length > 0 && (
            <section className={cn(sectionShell, 'border-amber-200/70 bg-[var(--color-warning-soft)]/50 dark:border-amber-900/40')}>
              <h3 className={cn(sectionTitle, 'mb-2')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <Clock size={18} strokeWidth={2} />
                </span>
                가입 대기
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                아래 인원은 가입 완료 시 자동으로 권한이 부여됩니다.
              </p>
              <ul className="space-y-2">
                {pendingInvitations.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-amber-200/80 bg-[var(--color-surface)] px-3 py-2 dark:border-amber-900/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--color-ink)]">
                        {p.full_name || p.email || '(이름 미지정)'}
                      </span>
                      {p.full_name && p.email && <span className="truncate text-[10px] text-[var(--color-ink-muted)]">({p.email})</span>}
                      <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        미가입
                      </span>
                      <span className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {p.role === 'editor' ? '편집' : '보기'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePendingInvitation(p.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canManage && (
            <section className={sectionShell}>
              <h3 className={sectionTitle}>
                <span className={iconBadge} aria-hidden>
                  <UserCheck size={18} strokeWidth={2} />
                </span>
                이름·이메일로 추가
              </h3>
              <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                조직 회원 이름을 선택하거나 직접 입력하세요. 이미 가입한 사용자는 즉시 멤버로 추가되고, 미가입자는 가입 후 자동 부여됩니다.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-5">
                  <label htmlFor="share-pending-name" className="mb-1 block text-[11px] font-medium text-[var(--color-ink-muted)]">
                    이름
                  </label>
                  <input
                    id="share-pending-name"
                    type="text"
                    list="share-modal-org-members"
                    value={pendingName}
                    onChange={(e) => setPendingName(e.target.value)}
                    placeholder="조직 회원 또는 직접 입력"
                    className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  />
                  <datalist id="share-modal-org-members">
                    {orgMembers.map((m) => {
                      const label = orgMemberLabelByName.get(m.name);
                      return label ? <option key={m.name} value={m.name} label={label} /> : <option key={m.name} value={m.name} />;
                    })}
                  </datalist>
                </div>
                <div className="sm:col-span-4">
                  <label htmlFor="share-pending-email" className="mb-1 block text-[11px] font-medium text-[var(--color-ink-muted)]">
                    이메일 <span className="font-normal opacity-80">(선택)</span>
                  </label>
                  <input
                    id="share-pending-email"
                    type="email"
                    value={pendingEmail}
                    onChange={(e) => setPendingEmail(e.target.value)}
                    placeholder="가입 시 매칭에 권장"
                    title="이메일을 알면 가입 매칭 정확도가 더 높습니다."
                    className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="share-pending-role" className="mb-1 block text-[11px] font-medium text-[var(--color-ink-muted)]">
                    권한
                  </label>
                  <select
                    id="share-pending-role"
                    value={pendingRole}
                    onChange={(e) => setPendingRole(e.target.value as 'editor' | 'viewer')}
                    title="부여할 권한"
                    className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  >
                    <option value="viewer">보기</option>
                    <option value="editor">편집</option>
                  </select>
                </div>
                <div className="sm:col-span-1 flex sm:justify-end">
                  <button
                    type="button"
                    onClick={handleAddPendingInvitation}
                    disabled={pendingSubmitting || (!pendingName.trim() && !pendingEmail.trim())}
                    className={cn(
                      'flex w-full min-h-[42px] items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors sm:w-auto sm:min-w-[3.25rem]',
                      !pendingSubmitting && (pendingName.trim() || pendingEmail.trim())
                        ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
                        : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800',
                    )}
                  >
                    {pendingSubmitting ? <Loader2 size={16} className="animate-spin" /> : '추가'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {canManage && addableProfiles.length > 0 && (
            <section className={sectionShell}>
              <h3 className={sectionTitle}>
                <span className={iconBadge} aria-hidden>
                  <UserPlus size={18} strokeWidth={2} />
                </span>
                가입 회원 일괄 추가
              </h3>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--color-ink-muted)]">체크 후 권한을 정하고 추가하세요.</span>
                  <button
                    type="button"
                    onClick={toggleAddSelectAll}
                    className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                    title="현재 목록 전체 선택/해제"
                  >
                    {filteredAddableProfiles.length > 0 && filteredAddableProfiles.every((p) => selectedAddUserIds.has(p.id))
                      ? '전체 해제'
                      : '전체 선택'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="shrink-0 text-[var(--color-ink-muted)]" aria-hidden />
                  <select
                    value={orgFilterId}
                    onChange={(e) => setOrgFilterId(e.target.value)}
                    className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25"
                    title="조직(부서)을 선택하면 검색어가 없을 때만 해당 조직(하위 부서 포함) 인원으로 목록을 제한합니다. 이름·이메일 검색 시에는 전체 조직(가입 회원)에서 찾습니다."
                  >
                    <option value="all">전체 조직</option>
                    {orgOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {`${'  '.repeat(o.depth)}${o.label}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]"
                    aria-hidden
                  />
                  <input
                    type="text"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="이름 또는 이메일 검색…"
                    className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2">
                  {filteredAddableProfiles.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-[var(--color-ink-muted)]">
                      {addSearchActive
                        ? '검색과 일치하는 가입 사용자가 없습니다.'
                        : orgFilterId !== 'all'
                          ? '선택한 조직의 가입 사용자가 없습니다.'
                          : '선택 가능한 사용자가 없습니다.'}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {filteredAddableProfiles.map((p) => {
                        const label = labelForProfileId(p.id, p.full_name ?? p.email ?? p.id.slice(0, 8));
                        const checked = selectedAddUserIds.has(p.id);
                        return (
                          <li key={p.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-line-soft)]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAddSelection(p.id)}
                                className="rounded border-slate-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                              />
                              <span className="truncate text-sm text-[var(--color-ink)]" title={label}>
                                {label}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] text-[var(--color-ink-muted)]">
                    {selectedAddUserIds.size > 0 ? (
                      <span className="font-semibold text-[var(--color-ink)]">{selectedAddUserIds.size}명</span>
                    ) : (
                      '선택된 사용자가 없습니다'
                    )}
                    {selectedAddUserIds.size > 0 ? ' 선택됨' : '.'}
                  </p>
                  <div className="flex flex-wrap items-stretch gap-2 sm:justify-end">
                    <select
                      value={addRole}
                      onChange={(e) => setAddRole(e.target.value as 'editor' | 'viewer')}
                      className="min-w-[10rem] flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25 sm:flex-initial"
                      title="승인된 멤버는 '보기'·'편집' 모두 동일하게 작업을 수정할 수 있습니다. 라벨은 관리 기록용입니다."
                    >
                      <option value="viewer">보기</option>
                      <option value="editor">편집</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleAddMembersBulk}
                      disabled={selectedAddUserIds.size === 0 || adding}
                      className={cn(
                        'inline-flex min-h-[42px] min-w-[7.5rem] flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors sm:flex-initial',
                        selectedAddUserIds.size > 0 && !adding
                          ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
                          : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800',
                      )}
                      title="체크한 사용자에게 권한을 일괄 부여"
                    >
                      {adding ? <Loader2 size={16} className="animate-spin" /> : '선택 추가'}
                    </button>
                  </div>
                </div>
              </div>
              {isAdmin && (
                <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                  관리자: 모든 프로젝트에 대해 사용자별 보기·편집 권한을 부여할 수 있습니다.
                </p>
              )}
            </section>
          )}
        </div>

        {!inviteLink && !canManage && (
          <div className="shrink-0 border-t border-[var(--color-line)] px-5 py-3">
            <p className="text-center text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
              이 프로젝트에 공유되어 있습니다. 소유자만 초대 링크를 생성할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
