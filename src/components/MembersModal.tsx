import React, { useState, useEffect } from 'react';
import { X, Users, Loader2, Trash2, Pencil, Check } from 'lucide-react';
import { fetchProfiles, deleteMemberAsAdmin, updateProfileFullName } from '../lib/db';
import { ProfileRow } from '../lib/supabase';
import { format } from 'date-fns';

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  onDeleted?: () => void;
}

export function MembersModal({ isOpen, onClose, currentUserId, onDeleted }: MembersModalProps) {
  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<ProfileRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const loadMembers = () => {
    setLoading(true);
    setError(null);
    fetchProfiles()
      .then(setMembers)
      .catch(err => {
        setError(err.message);
        setMembers([]);
      })
      .finally(() => setLoading(false));
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
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[var(--color-line)] overflow-hidden animate-in zoom-in-95 fade-in duration-200 max-h-[85vh] flex flex-col">
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
                      {m.created_at ? format(new Date(m.created_at), 'yyyy-MM-dd HH:mm') : '-'}
                    </td>
                    <td className="py-3 px-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.is_admin ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'}`}>
                        {m.is_admin ? '관리자' : '회원'}
                      </span>
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
