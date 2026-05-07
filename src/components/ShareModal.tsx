import React, { useState, useEffect, useMemo } from 'react';
import { X, Copy, Check, Link2, Users, Loader2, UserPlus, Building2, UserCheck, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
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
  profiles = [],
  ownerId,
}: ShareModalProps) {
  const { user } = useAuth();
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
      if (byEmail) return { id: byEmail.id, label: profileMap[byEmail.id] ?? byEmail.full_name ?? byEmail.email ?? byEmail.id };
    }
    if (nameNorm) {
      const byName = profiles.find((p) => {
        const candidate = (profileMap[p.id] ?? p.full_name ?? '').trim();
        return candidate === nameNorm;
      });
      if (byName) return { id: byName.id, label: profileMap[byName.id] ?? byName.full_name ?? byName.email ?? byName.id };
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
      const list = await fetchPendingProjectInvitations(projectId);
      setPendingInvitations(list);
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
  const filteredAddableProfiles = addableProfiles.filter((p) => {
    // 조직 필터: 프로필 표시명(또는 full_name)이 선택된 조직 인원에 속해야 함
    if (namesInSelectedOrg) {
      const name = profileMap[p.id] ?? p.full_name ?? '';
      if (!namesInSelectedOrg.has(name)) return false;
    }
    const q = addSearch.trim().toLowerCase();
    if (!q) return true;
    const label = (profileMap[p.id] ?? p.full_name ?? p.email ?? p.id).toLowerCase();
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

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50 animate-in fade-in duration-150" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-xl border border-[var(--color-line)] p-6 animate-in zoom-in-95 fade-in duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-ink)]">공유</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 transition-colors">
            <X size={18} />
          </button>
        </div>
        {projectName && <p className="text-sm text-stone-500 mb-3">프로젝트: {projectName}</p>}
        <p className="text-xs text-stone-500 mb-3">
          프로젝트를 만든 사람(소유자)이 멤버를 초대하고 권한을 줄 수 있습니다. <strong>보기</strong>: 담당자별 필터로 조회만 가능.{' '}
          <strong>편집</strong>: 작업·일정 수정 가능.
        </p>

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {canManage && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-2 flex items-center gap-2">
              <Link2 size={14} /> 초대 링크
            </h3>
            {!inviteLink ? (
              <button
                onClick={handleCreateInvite}
                disabled={inviteCreating}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                  inviteCreating ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700',
                )}
              >
                {inviteCreating ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                {inviteCreating ? '생성 중...' : '초대 링크 생성'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteLink}
                  className="flex-1 px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-stone-50 text-stone-600"
                />
                <button
                  onClick={() => handleCopyLink(inviteLink)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors',
                    copied ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-600 text-white hover:bg-teal-700',
                  )}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
            )}
            <p className="text-[11px] text-stone-400 mt-2">링크를 공유한 팀원이 로그인 후 접속하면 프로젝트에 편집 권한으로 추가됩니다.</p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-[var(--color-ink)] mb-2 flex items-center gap-2">
            <Users size={14} /> 멤버
          </h3>
          {loading ? (
            <div className="flex items-center gap-2 text-stone-500 text-sm py-4">
              <Loader2 size={16} className="animate-spin" />
              로딩 중...
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-stone-500 py-2">공유된 멤버가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const displayName = m.user_id === user?.id ? '나' : (profileMap[m.user_id] ?? `멤버 (${m.user_id.slice(0, 8)}...)`);
                const canChangeRole = canManage && m.role !== 'owner' && (m.role === 'editor' || m.role === 'viewer');
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-stone-50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium text-[var(--color-ink)] truncate">{displayName}</span>
                      {canChangeRole ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.user_id, e.target.value as 'editor' | 'viewer')}
                          disabled={roleChangingId === m.user_id}
                          className="text-[11px] font-medium px-1.5 py-0.5 rounded border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] cursor-pointer shrink-0"
                        >
                          <option value="viewer">보기</option>
                          <option value="editor">편집</option>
                        </select>
                      ) : (
                        <span className="text-[11px] text-stone-500 px-1.5 py-0.5 rounded bg-stone-200 shrink-0">
                          {m.role === 'owner' ? '소유자' : m.role === 'editor' ? '편집' : '보기'}
                        </span>
                      )}
                      {roleChangingId === m.user_id && <Loader2 size={12} className="animate-spin text-stone-400 shrink-0" />}
                    </div>
                    {canManage && m.user_id !== user?.id && m.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded shrink-0"
                      >
                        제거
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 사전 초대(미가입자) — 가입 시 자동 권한 부여 예정 */}
          {canManage && pendingInvitations.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Clock size={11} /> 가입 대기 (가입 시 자동 부여)
              </p>
              <ul className="space-y-1.5">
                {pendingInvitations.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 py-1.5 px-3 rounded-lg bg-amber-50 border border-amber-100"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium text-stone-700 truncate">{p.full_name || p.email || '(이름 미지정)'}</span>
                      {p.full_name && p.email && <span className="text-[10px] text-stone-500 truncate">({p.email})</span>}
                      <span className="text-[10px] text-amber-700 px-1.5 py-0.5 rounded bg-amber-100 shrink-0">미가입</span>
                      <span className="text-[11px] text-stone-500 px-1.5 py-0.5 rounded bg-stone-200 shrink-0">
                        {p.role === 'editor' ? '편집' : '보기'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemovePendingInvitation(p.id)}
                      className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded shrink-0"
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 미가입자 사전 등록 — 조직 회원 이름 자동완성 + 이메일(선택) */}
          {canManage && (
            <div className="mt-4 pt-4 border-t border-stone-200">
              <h4 className="text-xs font-semibold text-stone-600 mb-2 flex items-center gap-1.5">
                <UserCheck size={12} /> 이름·이메일로 권한 부여 (미가입자 가능)
              </h4>
              <p className="text-[11px] text-stone-400 mb-2">
                조직 회원 목록에서 이름을 선택하거나 직접 입력하세요. 가입한 사람은 즉시 멤버로 추가, 아직 가입 전인 사람은 가입 완료 시
                자동으로 권한이 부여됩니다.
              </p>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] text-stone-500 font-medium mb-1">이름</label>
                  <input
                    type="text"
                    list="share-modal-org-members"
                    value={pendingName}
                    onChange={(e) => setPendingName(e.target.value)}
                    placeholder="조직 회원에서 검색 또는 직접 입력"
                    className="w-full px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  />
                  <datalist id="share-modal-org-members">
                    {orgMembers.map((m) => {
                      const label = orgMemberLabelByName.get(m.name);
                      return label ? <option key={m.name} value={m.name} label={label} /> : <option key={m.name} value={m.name} />;
                    })}
                  </datalist>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className="block text-[11px] text-stone-500 font-medium mb-1">이메일 (선택)</label>
                  <input
                    type="email"
                    value={pendingEmail}
                    onChange={(e) => setPendingEmail(e.target.value)}
                    placeholder="가입 시 매칭(권장)"
                    className="w-full px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                    title="이메일을 알면 가입 매칭 정확도가 더 높습니다."
                  />
                </div>
                <select
                  value={pendingRole}
                  onChange={(e) => setPendingRole(e.target.value as 'editor' | 'viewer')}
                  className="px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  title="부여할 권한"
                >
                  <option value="viewer">보기</option>
                  <option value="editor">편집</option>
                </select>
                <button
                  onClick={handleAddPendingInvitation}
                  disabled={pendingSubmitting || (!pendingName.trim() && !pendingEmail.trim())}
                  className={cn(
                    'px-4 py-2 rounded-lg font-medium text-sm transition-colors shrink-0',
                    !pendingSubmitting && (pendingName.trim() || pendingEmail.trim())
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-stone-100 text-stone-400 cursor-not-allowed',
                  )}
                >
                  {pendingSubmitting ? <Loader2 size={14} className="animate-spin inline" /> : '추가'}
                </button>
              </div>
            </div>
          )}

          {canManage && addableProfiles.length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-200">
              <h4 className="text-xs font-semibold text-stone-600 mb-2 flex items-center gap-1.5">
                <UserPlus size={12} /> 가입 회원 일괄 추가
              </h4>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-stone-500 font-medium">사용자 선택 (체크)</label>
                    <button
                      type="button"
                      onClick={toggleAddSelectAll}
                      className="text-[11px] font-medium text-stone-500 hover:text-[var(--color-accent)]"
                      title="현재 목록 전체 선택/해제"
                    >
                      {filteredAddableProfiles.length > 0 && filteredAddableProfiles.every((p) => selectedAddUserIds.has(p.id))
                        ? '전체 해제'
                        : '전체 선택'}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Building2 size={12} className="text-stone-400 shrink-0" />
                    <select
                      value={orgFilterId}
                      onChange={(e) => setOrgFilterId(e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      title="조직(부서)을 선택하면 해당 조직(하위 부서 포함) 인원만 목록에 표시됩니다."
                    >
                      <option value="all">전체 조직</option>
                      {orgOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {`${'  '.repeat(o.depth)}${o.label}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="검색 (이름/이메일)…"
                    className="w-full px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  />
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-2">
                    {filteredAddableProfiles.length === 0 ? (
                      <div className="text-xs text-stone-400 py-4 text-center">
                        {orgFilterId !== 'all' ? '선택한 조직의 가입 사용자가 없습니다.' : '선택 가능한 사용자가 없습니다.'}
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {filteredAddableProfiles.map((p) => {
                          const label = profileMap[p.id] ?? p.full_name ?? p.email ?? p.id.slice(0, 8);
                          const checked = selectedAddUserIds.has(p.id);
                          return (
                            <li key={p.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAddSelection(p.id)}
                                  className="rounded border-stone-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                                />
                                <span className="text-sm text-stone-700 truncate" title={label}>
                                  {label}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-stone-400">
                    {selectedAddUserIds.size > 0 ? `${selectedAddUserIds.size}명 선택됨` : '선택된 사용자가 없습니다.'}
                  </div>
                </div>

                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as 'editor' | 'viewer')}
                  className="px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  title="선택 사용자에게 부여할 권한: 보기=담당자별 보기만, 편집=수정 가능"
                >
                  <option value="viewer">보기 (담당자별 보기)</option>
                  <option value="editor">편집</option>
                </select>
                <button
                  onClick={handleAddMembersBulk}
                  disabled={selectedAddUserIds.size === 0 || adding}
                  className={cn(
                    'px-4 py-2 rounded-lg font-medium text-sm transition-colors shrink-0',
                    selectedAddUserIds.size > 0 && !adding
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'bg-stone-100 text-stone-400 cursor-not-allowed',
                  )}
                  title="체크한 사용자에게 권한을 일괄 부여"
                >
                  {adding ? <Loader2 size={14} className="animate-spin inline" /> : `선택 추가`}
                </button>
              </div>
              {isAdmin && (
                <p className="text-[11px] text-stone-400 mt-1.5">
                  관리자: 모든 프로젝트에 대해 사용자별 보기/편집 권한을 부여할 수 있습니다.
                </p>
              )}
            </div>
          )}
        </div>

        {!inviteLink && !canManage && (
          <p className="text-[11px] text-stone-400 mt-3">이 프로젝트에 공유되어 있습니다. 소유자만 초대 링크를 생성할 수 있습니다.</p>
        )}
      </div>
    </>
  );
}
