import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Link2, Users, Loader2, UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  fetchProjectMembers,
  createProjectInvite,
  removeProjectMember,
  upsertProjectMember,
  setProjectMemberRole,
} from '../lib/db';
import { ProjectMemberRow } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

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

  const canManage = (isOwner ?? false) || (isAdmin ?? false);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setLoading(true);
    setError(null);
    fetchProjectMembers(projectId)
      .then(setMembers)
      .catch(err => {
        setError(err.message);
        setMembers([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

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
    } catch (err: any) {
      setError(err.message || '초대 링크 생성 실패');
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
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err: any) {
      setError(err.message || '멤버 제거 실패');
    }
  };

  const handleRoleChange = async (userId: string, role: 'editor' | 'viewer') => {
    if (!projectId || !canManage) return;
    setRoleChangingId(userId);
    setError(null);
    const result = await setProjectMemberRole(projectId, userId, role);
    setRoleChangingId(null);
    if (result.success) {
      setMembers(prev => prev.map(m => (m.user_id === userId ? { ...m, role } : m)));
    } else {
      setError(result.error || '역할 변경 실패');
    }
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
    } catch (err: any) {
      setError(err?.message || '멤버 추가 실패');
    } finally {
      setAdding(false);
    }
  };

  const memberUserIds = new Set(members.map(m => m.user_id));
  const addableProfiles = profiles.filter(
    p => !memberUserIds.has(p.id) && p.id !== ownerId
  );
  const filteredAddableProfiles = addableProfiles.filter((p) => {
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
        {projectName && (
          <p className="text-sm text-stone-500 mb-3">프로젝트: {projectName}</p>
        )}
        <p className="text-xs text-stone-500 mb-3">
          프로젝트를 만든 사람(소유자)이 멤버를 초대하고 권한을 줄 수 있습니다. <strong>보기</strong>: 담당자별 필터로 조회만 가능. <strong>편집</strong>: 작업·일정 수정 가능.
        </p>

        {error && (
          <p className="text-sm text-red-500 mb-3">{error}</p>
        )}

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
                  "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors",
                  inviteCreating ? "bg-stone-100 text-stone-400 cursor-not-allowed" : "bg-teal-600 text-white hover:bg-teal-700"
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
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors",
                    copied ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"
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
              {members.map(m => {
                const displayName = m.user_id === user?.id ? '나' : (profileMap[m.user_id] ?? `멤버 (${m.user_id.slice(0, 8)}...)`);
                const canChangeRole = canManage && m.role !== 'owner' && (m.role === 'editor' || m.role === 'viewer');
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-stone-50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium text-[var(--color-ink)] truncate">
                        {displayName}
                      </span>
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
                      {roleChangingId === m.user_id && (
                        <Loader2 size={12} className="animate-spin text-stone-400 shrink-0" />
                      )}
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

          {canManage && addableProfiles.length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-200">
              <h4 className="text-xs font-semibold text-stone-600 mb-2 flex items-center gap-1.5">
                <UserPlus size={12} /> 사용자 권한 부여
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
                      {filteredAddableProfiles.length > 0 && filteredAddableProfiles.every(p => selectedAddUserIds.has(p.id)) ? '전체 해제' : '전체 선택'}
                    </button>
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
                      <div className="text-xs text-stone-400 py-4 text-center">선택 가능한 사용자가 없습니다.</div>
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
                                <span className="text-sm text-stone-700 truncate" title={label}>{label}</span>
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
                    "px-4 py-2 rounded-lg font-medium text-sm transition-colors shrink-0",
                    selectedAddUserIds.size > 0 && !adding
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : "bg-stone-100 text-stone-400 cursor-not-allowed"
                  )}
                  title="체크한 사용자에게 권한을 일괄 부여"
                >
                  {adding ? <Loader2 size={14} className="animate-spin inline" /> : `선택 추가`}
                </button>
              </div>
              {isAdmin && (
                <p className="text-[11px] text-stone-400 mt-1.5">관리자: 모든 프로젝트에 대해 사용자별 보기/편집 권한을 부여할 수 있습니다.</p>
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
