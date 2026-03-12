import React, { useState, useEffect } from 'react';
import { X, Users, Loader2, Trash2, Pencil, Check, UserCheck } from 'lucide-react';
import { fetchProfiles, getProfileStatus, getMemberVisitStats, deleteMemberAsAdmin, updateProfileFullName, updateMemberRole, updateMemberApproved } from '../lib/db';
import { ProfileRow } from '../lib/supabase';
import { format } from 'date-fns';

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  onDeleted?: () => void;
  onApproved?: () => void;
}

export function MembersModal({ isOpen, onClose, currentUserId, onDeleted, onApproved }: MembersModalProps) {
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

  useEffect(() => {
    if (!isOpen) return;
    loadMembers();
  }, [isOpen]);

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
    const result = await deleteMemberAsAdmin(memberToDelete.id);
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
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">회원명</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">이메일</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">가입일</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">접속횟수</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">마지막 접속시각</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">승인</th>
                  <th className="text-left py-3 px-2 font-semibold text-stone-600">역할</th>
                  <th className="text-right py-3 px-2 font-semibold text-stone-600 w-16">삭제</th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
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
                    <td className="py-3 px-2 text-stone-500">
                      {m.last_visited_at ? (
                        <span title={format(new Date(m.last_visited_at), 'yyyy-MM-dd HH:mm')}>
                          {format(new Date(m.last_visited_at), 'yyyy-MM-dd')}
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
    </>
  );
}
