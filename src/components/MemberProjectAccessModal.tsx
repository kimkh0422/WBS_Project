import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { Project } from '../types';
import type { ProjectMemberRow } from '../lib/supabase';
import { formatProjectDisplayName, isPrivateProjectHiddenFromViewer } from '../lib/projectKind';
import { fetchProjectMembershipsByUser, removeProjectMember, setProjectMemberRole, upsertProjectMember } from '../lib/db';
import { cn } from '../lib/utils';
import { MODAL_SCRIM_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';

type RoleUi = 'owner' | 'editor' | 'viewer' | 'none';

export interface MemberProjectAccessModalMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface MemberProjectAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: MemberProjectAccessModalMember | null;
  projects: Array<Pick<Project, 'id' | 'name' | 'ownerId' | 'projectKind'>>;
  profileMap?: Record<string, string>;
  profileDisplayById?: Record<string, string>;
}

export function MemberProjectAccessModal({
  isOpen,
  onClose,
  member,
  projects,
  profileMap = {},
  profileDisplayById = {},
}: MemberProjectAccessModalProps) {
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<ProjectMemberRow[]>([]);

  useEffect(() => {
    if (!isOpen || !member?.id) return;
    setLoading(true);
    setError(null);
    fetchProjectMembershipsByUser(member.id)
      .then(setMemberships)
      .catch((e) => {
        setError(e instanceof Error ? e.message : '프로젝트 권한을 불러오지 못했습니다.');
        setMemberships([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, member?.id]);

  const membershipByProjectId = useMemo(() => {
    const m = new Map<string, ProjectMemberRow>();
    memberships.forEach((row) => {
      if (row?.project_id) m.set(row.project_id, row);
    });
    return m;
  }, [memberships]);

  const rows = useMemo(() => {
    const uid = member?.id ?? '';
    const list = projects
      .filter((p) => !isPrivateProjectHiddenFromViewer(p, uid || undefined))
      .map((p) => {
        const isOwner = !!uid && p.ownerId === uid;
        const membership = membershipByProjectId.get(p.id);
        const role: RoleUi = isOwner ? 'owner' : (membership?.role ?? 'none');
        return {
          projectId: p.id,
          projectName: formatProjectDisplayName(p.name, p.projectKind),
          projectOwnerId: p.ownerId ?? null,
          role,
          membership,
        };
      });
    return list.sort((a, b) => a.projectName.localeCompare(b.projectName, 'ko'));
  }, [projects, membershipByProjectId, member?.id]);

  const setRole = async (projectId: string, nextRole: RoleUi) => {
    if (!member?.id) return;
    const row = rows.find((r) => r.projectId === projectId);
    if (!row) return;
    if (row.role === 'owner') return; // 소유자는 여기서 변경하지 않음

    setSavingKey(`${projectId}:${member.id}`);
    setError(null);
    try {
      if (nextRole === 'none') {
        if (row.membership) {
          await removeProjectMember(projectId, member.id);
        }
      } else if (nextRole === 'viewer' || nextRole === 'editor') {
        if (row.membership) {
          const res = await setProjectMemberRole(projectId, member.id, nextRole);
          if (!res.success) throw new Error(res.error || '권한 변경에 실패했습니다.');
        } else {
          const res = await upsertProjectMember(projectId, member.id, nextRole);
          if (!res.success) throw new Error(res.error || '권한 부여에 실패했습니다.');
        }
      }
      const refreshed = await fetchProjectMembershipsByUser(member.id);
      setMemberships(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : '권한 설정에 실패했습니다.');
    } finally {
      setSavingKey(null);
    }
  };

  if (!isOpen || !member) return null;

  const memberLabel = (member.full_name && member.full_name.trim()) || member.email || member.id;

  return (
    <>
      <div className={cn(MODAL_SCRIM_CLASS, 'z-[70]')} onClick={onClose} />
      <div
        className={cn(
          MODAL_PANEL_BASE_CLASS,
          'fixed z-[80] inset-4 md:inset-10 max-w-4xl mx-auto overflow-hidden flex flex-col border-[var(--color-line)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-line)]">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[var(--color-ink)] truncate">프로젝트 권한</h2>
            <p className="text-xs text-slate-500 mt-1 truncate" title={memberLabel}>
              회원: {memberLabel}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
              <Loader2 size={24} className="animate-spin" />
              <span>로딩 중...</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-slate-500 text-center py-12">프로젝트가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)]">
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">프로젝트</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">소유자</th>
                  <th className="text-left py-3 px-2 font-semibold text-slate-600">권한</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ownerLabel = r.projectOwnerId
                    ? (profileDisplayById[r.projectOwnerId] ?? profileMap[r.projectOwnerId] ?? r.projectOwnerId)
                    : '-';
                  const saving = savingKey === `${r.projectId}:${member.id}`;
                  const roleValue: RoleUi = r.role;
                  return (
                    <tr key={r.projectId} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-2 text-[var(--color-ink)]">
                        <span className="font-medium">{r.projectName}</span>
                      </td>
                      <td className="py-3 px-2 text-slate-500 truncate" title={ownerLabel}>
                        {ownerLabel}
                      </td>
                      <td className="py-3 px-2">
                        {roleValue === 'owner' ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">소유자</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              value={roleValue}
                              onChange={(e) => setRole(r.projectId, e.target.value as RoleUi)}
                              disabled={saving}
                              className="text-xs font-medium px-2 py-1 rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                              title="승인된 보기·편집 멤버 모두 동일하게 작업 편집 가능(라벨 구분)"
                            >
                              <option value="none">없음</option>
                              <option value="viewer">보기</option>
                              <option value="editor">편집</option>
                            </select>
                            {saving && <Loader2 size={14} className="animate-spin text-slate-400" />}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-[var(--color-line)] bg-slate-50/50">
          <p className="text-xs text-slate-500">변경 사항은 즉시 저장됩니다. (없음 = 해당 프로젝트 멤버에서 제거)</p>
        </div>
      </div>
    </>
  );
}
