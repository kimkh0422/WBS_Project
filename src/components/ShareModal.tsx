import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Link2, Users, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchProjectMembers, createProjectInvite, removeProjectMember } from '../lib/db';
import { ProjectMemberRow } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  projectName?: string;
  isOwner?: boolean;
}

export function ShareModal({ isOpen, onClose, projectId, projectName, isOwner }: ShareModalProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = isOwner ?? false;

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
              {members.map(m => (
                <li key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-ink)]">
                      {m.user_id === user?.id ? '나' : `멤버 (${m.user_id.slice(0, 8)}...)`}
                    </span>
                    <span className="text-[11px] text-stone-500 px-1.5 py-0.5 rounded bg-stone-200">
                      {m.role === 'owner' ? '소유자' : m.role === 'editor' ? '편집' : '보기'}
                    </span>
                  </div>
                  {canManage && m.user_id !== user?.id && m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemoveMember(m.user_id)}
                      className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
                    >
                      제거
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!inviteLink && !canManage && (
          <p className="text-[11px] text-stone-400 mt-3">이 프로젝트에 공유되어 있습니다. 소유자만 초대 링크를 생성할 수 있습니다.</p>
        )}
      </div>
    </>
  );
}
