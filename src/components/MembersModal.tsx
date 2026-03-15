import React, { useState, useEffect, useMemo } from 'react';
import { X, Users, Loader2, Trash2, Pencil, Check, UserCheck, ArrowUpDown, ArrowUp, ArrowDown, FolderGit2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { fetchProfiles, getProfileStatus, getMemberVisitStats, deleteMemberAsAdmin, updateProfileFullName, updateMemberRole, updateMemberApproved, listPendingProjectAccessRequests, approveProjectAccessRequest, rejectProjectAccessRequest } from '../lib/db';
import { WBS_ADMIN_PASSWORD } from '../constants/adminBypass';
import { ProfileRow } from '../lib/supabase';
import type { ProjectAccessRequestRow } from '../lib/supabase';
import { format } from 'date-fns';
import { MemberProjectAccessModal } from './MemberProjectAccessModal';
import type { Project } from '../types';

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  /** DB profiles.is_admin (비밀번호 관리자 모드와 구분) */
  dbIsAdmin?: boolean;
  /** 비밀번호로 관리자 모드 전환 여부 — 삭제 시 Edge Function에 비밀번호 검증용 전달 */
  adminOverride?: boolean;
  /** 프로젝트 권한 요청 목록에서 프로젝트명 표시용 */
  projects?: Array<Pick<Project, 'id' | 'name' | 'ownerId'>>;
  profileMap?: Record<string, string>;
  onDeleted?: () => void;
  onApproved?: () => void;
}

export function MembersModal({ isOpen, onClose, currentUserId, dbIsAdmin = false, adminOverride = false, projects = [], profileMap = {}, onDeleted, onApproved }: MembersModalProps) {
  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<ProfileRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [accessRequests, setAccessRequests] = useState<ProjectAccessRequestRow[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [accessMember, setAccessMember] = useState<ProfileRow | null>(null);

  type SortKey = 'full_name' | 'email' | 'created_at' | 'login_count' | 'last_visited_at' | 'approved' | 'role';
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'full_name' || key === 'email' ? 'asc' : 'desc');
    }
  };

  const sortedMembers = useMemo(() => {
    const arr = [...members];
    arr.sort((a, b) => {
      let va: string | number | boolean | null | undefined, vb: string | number | boolean | null | undefined;
      switch (sortKey) {
        case 'full_name':
          va = (a.full_name || '').toLowerCase();
          vb = (b.full_name || '').toLowerCase();
          break;
        case 'email':
          va = (a.email || '').toLowerCase();
          vb = (b.email || '').toLowerCase();
          break;
        case 'created_at':
          va = a.created_at ? new Date(a.created_at).getTime() : 0;
          vb = b.created_at ? new Date(b.created_at).getTime() : 0;
          break;
        case 'login_count':
          va = a.login_count ?? -1;
          vb = b.login_count ?? -1;
          break;
        case 'last_visited_at':
          va = a.last_visited_at ? new Date(a.last_visited_at).getTime() : 0;
          vb = b.last_visited_at ? new Date(b.last_visited_at).getTime() : 0;
          break;
        case 'approved':
          va = a.approved ? 1 : 0;
          vb = b.approved ? 1 : 0;
          break;
        case 'role':
          va = a.is_admin ? 1 : 0;
          vb = b.is_admin ? 1 : 0;
          break;
        default:
          return 0;
      }
      if (typeof va === 'string' && typeof vb === 'string') {
        const c = va.localeCompare(vb);
        return sortDir === 'asc' ? c : -c;
      }
      const n = (Number(va) - Number(vb)) * (sortDir === 'asc' ? 1 : -1);
      return n;
    });
    return arr;
  }, [members, sortKey, sortDir]);

  const loadMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      // 현재 사용자 프로필이 없으면 생성(ensure_profile). 없으면 RLS로 인해 0명만 보임.
      await getProfileStatus();
      const list = await fetchProfiles();
      let stats: Record<string, { login_count: number; last_visited_at: string | null }> = {};
      try {
        stats = await getMemberVisitStats();
      } catch (e) {
        setError(e instanceof Error ? e.message : '접속 통계를 불러오지 못했습니다.');
      }
      setMembers(
        list.map(p => ({
          ...p,
          login_count: stats[p.id]?.login_count ?? 0,
          last_visited_at: stats[p.id]?.last_visited_at ?? null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원 목록을 불러오지 못했습니다.');
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAccessRequests = async () => {
    try {
      const list = await listPendingProjectAccessRequests();
      setAccessRequests(list);
    } catch {
      setAccessRequests([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadMembers();
    loadAccessRequests();
  }, [isOpen]);

  const handleApproveRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    setError(null);
    const result = await approveProjectAccessRequest(requestId);
    setProcessingRequestId(null);
    if (result.success) {
      setAccessRequests(prev => prev.filter(r => r.id !== requestId));
    } else {
      setError(result.error ?? '승인에 실패했습니다.');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    setError(null);
    const result = await rejectProjectAccessRequest(requestId);
    setProcessingRequestId(null);
    if (result.success) {
      setAccessRequests(prev => prev.filter(r => r.id !== requestId));
    } else {
      setError(result.error ?? '거절에 실패했습니다.');
    }
  };

  const startEdit = (m: ProfileRow) => {
    setEditingId(m.id);
    setEditingName(m.full_name || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveName = async () => {
    if (!editingId || savingName) return;
    const name = editingName.trim();
    setSavingName(true);
    const result = await updateProfileFullName(editingId, name);
    setSavingName(false);
    setEditingId(null);
    setEditingName('');
    if (result.success) {
      setMembers(prev => prev.map(m => m.id === editingId ? { ...m, full_name: name || null } : m));
    } else {
      setError(result.error ?? '이름 저장에 실패했습니다.');
    }
  };

  const setRole = async (member: ProfileRow, isAdmin: boolean) => {
    if (member.id === currentUserId) return;
    setSavingRoleId(member.id);
    const result = await updateMemberRole(member.id, isAdmin);
    setSavingRoleId(null);
    if (result.success) {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, is_admin: isAdmin } : m));
    } else {
      setError(result.error ?? '역할 변경에 실패했습니다.');
    }
  };

  const approveMember = async (member: ProfileRow) => {
    if (member.approved) return;
    setApprovingId(member.id);
    const result = await updateMemberApproved(member.id, true);
    setApprovingId(null);
    if (result.success) {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, approved: true } : m));
      onApproved?.();
    } else {
      setError(result.error ?? '승인에 실패했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!memberToDelete) return;
    setDeleting(true);
    const usePasswordBypass = adminOverride && !dbIsAdmin;
    const result = await deleteMemberAsAdmin(memberToDelete.id, {
      wbsAdminPassword: usePasswordBypass ? WBS_ADMIN_PASSWORD : undefined,
    });
    setDeleting(false);
    setMemberToDelete(null);
    if (result.success) {
      loadMembers();
      onDeleted?.();
    } else {
      setError(result.error ?? '삭제에 실패했습니다.');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50 animate-in fade-in duration-150" onClick={onClose} />
      <div className="fixed inset-4 z-50 bg-white rounded-2xl shadow-xl border border-[var(--color-line)] overflow-hidden animate-in zoom-in-95 fade-in duration-200 flex flex-col md:inset-8">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-line)]">
          <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Users size={20} />
            회원 관리
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && (
            <p className="text-red-500 text-sm mb-4">{error}</p>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-stone-500">
              <Loader2 size={24} className="animate-spin" />
              <span>로딩 중...</span>
            </div>
          ) : members.length === 0 ? (
            <p className="text-stone-500 text-center py-12">등록된 회원이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('full_name')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="회원명으로 정렬">
                      회원명
                      {sortKey === 'full_name' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('email')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="이메일로 정렬">
                      이메일
                      {sortKey === 'email' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('created_at')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="가입일로 정렬">
                      가입일
                      {sortKey === 'created_at' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('login_count')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="접속횟수로 정렬">
                      접속횟수
                      {sortKey === 'login_count' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('last_visited_at')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="마지막 접속으로 정렬">
                      마지막 접속시각
                      {sortKey === 'last_visited_at' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('approved')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="승인 여부로 정렬">
                      승인
                      {sortKey === 'approved' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">프로젝트 권한</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">
                    <button type="button" onClick={() => toggleSort('role')} className="inline-flex items-center gap-1 hover:text-stone-800 transition-colors" title="역할로 정렬">
                      역할
                      {sortKey === 'role' ? (sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="opacity-40" />}
                    </button>
                  </th>
                  <th className="text-right py-3 px-2 font-semibold text-stone-600 w-16">삭제</th>
                </tr>
              </thead>
              <tbody>
                {sortedMembers.map(m => (
                  <tr key={m.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="py-3 px-2 text-[var(--color-ink)]">
                      {editingId === m.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveName();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            onBlur={saveName}
                            autoFocus
                            className="flex-1 min-w-0 px-2 py-1 text-sm border border-stone-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            disabled={savingName}
                          />
                          <button
                            onClick={saveName}
                            disabled={savingName}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="저장"
                          >
                            <Check size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group">
                          <span>{m.full_name || '-'}</span>
                          <button
                            onClick={() => startEdit(m)}
                            className="p-1 text-stone-400 hover:text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="이름 수정"
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2 text-[var(--color-ink)]">{m.email || '(이메일 없음)'}</td>
                    <td className="py-3 px-2 text-stone-500">
                      {m.created_at ? (
                        <span title={format(new Date(m.created_at), 'yyyy-MM-dd HH:mm')}>
                          {format(new Date(m.created_at), 'yyyy-MM-dd')}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-3 px-2 text-stone-600 tabular-nums">
                      {m.login_count != null ? m.login_count : '-'}
                    </td>
                    <td className="py-3 px-2 text-stone-500 whitespace-nowrap">
                      {m.last_visited_at ? (
                        <span title={format(new Date(m.last_visited_at), 'yyyy-MM-dd HH:mm:ss')}>
                          {format(new Date(m.last_visited_at), 'yyyy-MM-dd HH:mm')}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-3 px-2">
                      {m.approved ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">승인됨</span>
                      ) : m.id === currentUserId ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">대기</span>
                      ) : approvingId === m.id ? (
                        <span className="text-stone-400 text-xs flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> 처리 중
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => approveMember(m)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors"
                          title="승인 시 해당 회원은 DB와 동기화할 수 있습니다."
                        >
                          <UserCheck size={12} /> 승인
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <button
                        type="button"
                        onClick={() => setAccessMember(m)}
                        className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
                        title="회원별 프로젝트 권한(보기/편집) 확인 및 수정"
                      >
                        보기/수정
                      </button>
                    </td>
                    <td className="py-3 px-2">
                      {m.id === currentUserId ? (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.is_admin ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'}`}>
                          {m.is_admin ? '관리자' : '회원'}
                        </span>
                      ) : savingRoleId === m.id ? (
                        <span className="text-stone-400 text-xs flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> 변경 중
                        </span>
                      ) : (
                        <select
                          value={m.is_admin ? 'admin' : 'member'}
                          onChange={(e) => setRole(m, e.target.value === 'admin')}
                          className="text-xs font-medium px-2 py-1 rounded border border-stone-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                        >
                          <option value="member">회원</option>
                          <option value="admin">관리자</option>
                        </select>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {m.id !== currentUserId ? (
                        <button
                          onClick={() => setMemberToDelete(m)}
                          className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="회원 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <span className="text-stone-300 text-xs">본인</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && accessRequests.length > 0 && (
            <div className="mt-8 pt-6 border-t border-[var(--color-line)]">
              <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2 mb-3">
                <FolderGit2 size={16} />
                프로젝트 권한 요청 (대기 중)
              </h3>
              <p className="text-xs text-stone-500 mb-3">승인된 회원이 특정 프로젝트에 대한 보기/편집 권한을 요청한 목록입니다. 승인 시 해당 회원이 프로젝트 내용을 볼 수 있습니다.</p>
              <table className="w-full text-sm border border-stone-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left py-2 px-3 font-semibold text-stone-600">프로젝트</th>
                    <th className="text-left py-2 px-3 font-semibold text-stone-600">요청자</th>
                    <th className="text-left py-2 px-3 font-semibold text-stone-600">요청 권한</th>
                    <th className="text-left py-2 px-3 font-semibold text-stone-600">요청일</th>
                    <th className="text-right py-2 px-3 font-semibold text-stone-600 w-32">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRequests.map((req) => {
                    const projectName = projects.find(p => p.id === req.project_id)?.name ?? req.project_id;
                    const requester = members.find(m => m.id === req.user_id);
                    const requesterName = requester ? (requester.full_name || requester.email || req.user_id) : req.user_id;
                    const isProcessing = processingRequestId === req.id;
                    return (
                      <tr key={req.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                        <td className="py-2 px-3 text-[var(--color-ink)]">{projectName}</td>
                        <td className="py-2 px-3 text-stone-600">{requesterName}</td>
                        <td className="py-2 px-3">
                          <span className={req.requested_role === 'editor' ? 'text-indigo-600' : 'text-stone-600'}>
                            {req.requested_role === 'editor' ? '편집' : '보기'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-stone-500">
                          {req.created_at ? format(new Date(req.created_at), 'yyyy-MM-dd HH:mm') : '-'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleApproveRequest(req.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors"
                              title="승인"
                            >
                              {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                              승인
                            </button>
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleRejectRequest(req.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors"
                              title="거절"
                            >
                              <ThumbsDown size={12} />
                              거절
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[var(--color-line)] bg-stone-50/50">
          <p className="text-xs text-stone-500">총 {members.length}명</p>
        </div>
      </div>

      {memberToDelete && (
        <div className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-xl border border-[var(--color-line)] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[var(--color-line)]">
              <h3 className="text-lg font-bold text-[var(--color-ink)]">회원 삭제</h3>
              <p className="mt-2 text-sm text-stone-600">
                <strong>{memberToDelete.full_name ? `${memberToDelete.full_name} (${memberToDelete.email || '이메일 없음'})` : memberToDelete.email || '(이메일 없음)'}</strong> 회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없으며, 해당 회원의 모든 데이터가 삭제됩니다.
              </p>
            </div>
            <div className="p-5 flex justify-end gap-2">
              <button
                onClick={() => setMemberToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : null}
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      <MemberProjectAccessModal
        isOpen={!!accessMember}
        onClose={() => setAccessMember(null)}
        member={accessMember ? { id: accessMember.id, full_name: accessMember.full_name ?? null, email: accessMember.email ?? null } : null}
        projects={projects}
        profileMap={profileMap}
      />
    </>
  );
}
