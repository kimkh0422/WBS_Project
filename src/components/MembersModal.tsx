import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import {
  X,
  Users,
  Loader2,
  Trash2,
  Pencil,
  Check,
  UserCheck,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FolderGit2,
  Shield,
  ThumbsUp,
  ThumbsDown,
  Building2,
  UserX,
} from 'lucide-react';
import {
  fetchProfiles,
  getProfileStatus,
  getMemberVisitStats,
  deleteMemberAsAdmin,
  updateProfileFullName,
  updateMemberRole,
  updateMemberApproved,
  updateMemberOrgFields,
  listPendingProjectAccessRequests,
  listPendingAdminAccessRequests,
  approveProjectAccessRequest,
  approveAdminAccessRequest,
  rejectProjectAccessRequest,
  rejectAdminAccessRequest,
} from '../lib/db';
import { WBS_ADMIN_PASSWORD } from '../constants/adminBypass';
import { ProfileRow } from '../lib/supabase';
import type { ProjectAccessRequestRow, AdminAccessRequestRow } from '../lib/supabase';
import { format } from 'date-fns';
import { MemberProjectAccessModal } from './MemberProjectAccessModal';
import type { Project } from '../types';
import { useOrganization } from '../context/OrganizationContext';
import type { OrgNode, OrgMember } from '../data/organization';
import { departmentInManagedSubtree } from '../lib/orgProfileScope';
import { buildOrgDepartmentByNameMap, lookupOrgDepartment, resolveMemberDepartment, normalizePersonName } from '../lib/orgDepartmentLookup';
import { buildOrgMemberDisplayMetaMap, formatPersonDisplay } from '../lib/assigneeOptions';
import { cn } from '../lib/utils';
import { MODAL_SCRIM_CLASS, MODAL_PANEL_BASE_CLASS, MODAL_BACKDROP_CLASS } from '../lib/modalChrome';
import { formatProjectDisplayName } from '../lib/projectKind';
import { isInternalCompanyEmail } from '../lib/emailDomain';

/** 사내(@gmtc.kr)는 정책상 항상 승인된 계정으로 표시(DB 플래그 지연 시에도 동일). */
function isMemberEffectivelyApproved(m: Pick<ProfileRow, 'approved' | 'email'>): boolean {
  return m.approved === true || isInternalCompanyEmail(m.email ?? '');
}

const TABLE_COL_COUNT = 11;

interface MembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId?: string;
  /** DB profiles.is_admin (비밀번호 관리자 모드와 구분) */
  dbIsAdmin?: boolean;
  /** 비밀번호로 관리자 모드 전환 여부 — 삭제 시 Edge Function에 비밀번호 검증용 전달 */
  adminOverride?: boolean;
  /** 프로필에 managed_org_node_id 가 있으면 소속 subtree 회원의 역할만 변경 */
  isOrgScopedManager?: boolean;
  /** 로그인 사용자의 org_nodes.id (조직 책임 범위 루트) */
  managedOrgNodeIdForViewer?: string | null;
  /** 프로젝트 권한 요청 목록에서 프로젝트명 표시용 */
  projects?: Array<Pick<Project, 'id' | 'name' | 'ownerId' | 'projectKind'>>;
  profileMap?: Record<string, string>;
  profileDisplayById?: Record<string, string>;
  /** 관리자: 회원별 소유 프로젝트 칩에서 해당 프로젝트 작업 화면으로 이동 */
  onNavigateToProject?: (projectId: string) => void;
  onDeleted?: () => void;
  onApproved?: () => void;
}

export function MembersModal({
  isOpen,
  onClose,
  currentUserId,
  dbIsAdmin = false,
  adminOverride = false,
  isOrgScopedManager = false,
  managedOrgNodeIdForViewer = null,
  projects = [],
  profileMap = {},
  profileDisplayById = {},
  onNavigateToProject,
  onDeleted,
  onApproved,
}: MembersModalProps) {
  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<ProfileRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { orgTree, orgMembers } = useOrganization();
  const orgDeptByName = useMemo(() => buildOrgDepartmentByNameMap(orgMembers), [orgMembers]);
  const memberDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const membersRef = useRef(members);
  membersRef.current = members;
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const effectiveIsAdmin = dbIsAdmin || adminOverride;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [accessRequests, setAccessRequests] = useState<ProjectAccessRequestRow[]>([]);
  const [adminAccessRequests, setAdminAccessRequests] = useState<AdminAccessRequestRow[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [processingAdminRequestId, setProcessingAdminRequestId] = useState<string | null>(null);
  const [accessMember, setAccessMember] = useState<ProfileRow | null>(null);
  /** 회원 표에서「프로젝트 수」클릭 시 소유 프로젝트 목록 표시 */
  const [expandedOwnedProjectsMemberId, setExpandedOwnedProjectsMemberId] = useState<string | null>(null);

  type SortKey = 'full_name' | 'email' | 'created_at' | 'login_count' | 'last_visited_at' | 'approved' | 'role' | 'project_count';
  const [sortKey, setSortKey] = useState<SortKey>('last_visited_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  /** 미가입(조직도에는 있으나 회원가입 안 한) 인원만 표시하는 필터. 가입 권유 명단 추리기에 사용. */
  const [showUnregisteredOnly, setShowUnregisteredOnly] = useState(false);

  /** 회원별 본인이 만든 프로젝트(소유자) 목록·갯수. `projects` prop은 RLS로 조회 가능한 범위만 포함. */
  const projectsByOwner = useMemo(() => {
    const map = new Map<string, Array<Pick<Project, 'id' | 'name' | 'projectKind'>>>();
    for (const p of projects) {
      const k = p.ownerId;
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push({ id: p.id, name: p.name, projectKind: p.projectKind });
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
    return map;
  }, [projects]);
  const getProjectCountForMember = useCallback((memberId: string) => projectsByOwner.get(memberId)?.length ?? 0, [projectsByOwner]);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of orgMembers) {
      const t = (m.department ?? '').trim();
      if (t) set.add(t);
    }
    const walk = (n: OrgNode) => {
      for (const d of n.departments ?? []) {
        const t = d.trim();
        if (t) set.add(d);
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(orgTree);
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [orgTree, orgMembers]);

  const canChangeMemberRole = useCallback(
    (m: ProfileRow) => {
      if (m.id === currentUserId) return false;
      if (effectiveIsAdmin) return true;
      if (isOrgScopedManager && managedOrgNodeIdForViewer) {
        return departmentInManagedSubtree(m.department ?? null, managedOrgNodeIdForViewer, orgTree);
      }
      return false;
    },
    [currentUserId, effectiveIsAdmin, isOrgScopedManager, managedOrgNodeIdForViewer, orgTree],
  );

  const persistMemberDepartment = useCallback(
    async (member: ProfileRow, department: string) => {
      if (!effectiveIsAdmin || savingOrgId === member.id) return;
      setSavingOrgId(member.id);
      const result = await updateMemberOrgFields(member.id, {
        department: department.trim() || null,
      });
      setSavingOrgId(null);
      if (result.success) {
        setMembers((prev) => prev.map((x) => (x.id === member.id ? { ...x, department: department.trim() || null } : x)));
      } else {
        setError(result.error ?? '부서 저장에 실패했습니다.');
      }
    },
    [effectiveIsAdmin, savingOrgId],
  );

  /** 부서가 비어 있는 회원만 조직현황(조직도 인원)과 이름 매칭해 DB에 저장 */
  const autoLinkDepartmentsFromOrg = useCallback(
    async (profileList: ProfileRow[]): Promise<ProfileRow[]> => {
      if (!effectiveIsAdmin || orgDeptByName.size === 0) return profileList;
      let next = profileList;
      for (const m of profileList) {
        if ((m.department ?? '').trim()) continue;
        const suggested = lookupOrgDepartment(m.full_name, orgDeptByName);
        if (!suggested) continue;
        const result = await updateMemberOrgFields(m.id, { department: suggested });
        if (result.success) {
          if (next === profileList) next = [...profileList];
          next = next.map((x) => (x.id === m.id ? { ...x, department: suggested } : x));
        } else {
          setError(result.error ?? '조직현황 부서 연동에 실패했습니다.');
        }
      }
      return next;
    },
    [effectiveIsAdmin, orgDeptByName],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'full_name' || key === 'email' ? 'asc' : 'desc');
    }
  };

  const sortProfiles = useCallback(
    (arr: ProfileRow[]): ProfileRow[] => {
      const out = [...arr];
      out.sort((a, b) => {
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
            va = isMemberEffectivelyApproved(a) ? 1 : 0;
            vb = isMemberEffectivelyApproved(b) ? 1 : 0;
            break;
          case 'role':
            va = a.is_admin ? 1 : 0;
            vb = b.is_admin ? 1 : 0;
            break;
          case 'project_count':
            va = getProjectCountForMember(a.id);
            vb = getProjectCountForMember(b.id);
            break;
          default:
            return 0;
        }
        if (typeof va === 'string' && typeof vb === 'string') {
          const c = va.localeCompare(vb);
          return sortDir === 'asc' ? c : -c;
        }
        return (Number(va) - Number(vb)) * (sortDir === 'asc' ? 1 : -1);
      });
      return out;
    },
    [sortKey, sortDir, getProjectCountForMember],
  );

  type OrgSectionRow = { kind: 'profile'; key: string; profile: ProfileRow } | { kind: 'unregistered'; key: string; orgMember: OrgMember };

  interface OrgSection {
    nodeId: string;
    nodeName: string;
    depth: number;
    registeredCount: number;
    unregisteredCount: number;
    rows: OrgSectionRow[];
  }

  /** 조직도(orgTree) 순서대로 가입자/미가입자를 그룹핑. 미배정자(매칭 부서 없음)는 마지막 섹션. */
  const orgSections = useMemo<OrgSection[]>(() => {
    const sections: OrgSection[] = [];
    const assignedProfileIds = new Set<string>();
    const profileNameKeys = new Set<string>();
    for (const p of members) {
      const k = normalizePersonName(p.full_name);
      if (k) profileNameKeys.add(k);
    }

    const walk = (node: OrgNode, depth: number) => {
      const depts = node.departments ?? [];
      if (depts.length > 0) {
        const deptSet = new Set(depts);
        const matchingProfiles = members.filter((m) => {
          const resolved = resolveMemberDepartment(m.department, m.full_name, orgDeptByName);
          return resolved ? deptSet.has(resolved) : false;
        });
        const sortedProfiles = sortProfiles(matchingProfiles);
        for (const p of sortedProfiles) assignedProfileIds.add(p.id);

        const unregistered = orgMembers
          .filter((om) => {
            if (!deptSet.has(om.department)) return false;
            const key = normalizePersonName(om.name);
            return key.length > 0 && !profileNameKeys.has(key);
          })
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        if (sortedProfiles.length > 0 || unregistered.length > 0) {
          sections.push({
            nodeId: node.id,
            nodeName: node.name,
            depth,
            registeredCount: sortedProfiles.length,
            unregisteredCount: unregistered.length,
            rows: [
              ...sortedProfiles.map<OrgSectionRow>((p) => ({ kind: 'profile', key: p.id, profile: p })),
              ...unregistered.map<OrgSectionRow>((om) => ({
                kind: 'unregistered',
                key: `unreg:${om.department}:${om.name}`,
                orgMember: om,
              })),
            ],
          });
        }
      }
      for (const c of node.children ?? []) walk(c, depth + 1);
    };
    walk(orgTree, 0);

    const unassigned = sortProfiles(members.filter((m) => !assignedProfileIds.has(m.id)));
    if (unassigned.length > 0) {
      sections.push({
        nodeId: '__unassigned__',
        nodeName: '미배정 (조직도에 매칭되는 부서 없음)',
        depth: 0,
        registeredCount: unassigned.length,
        unregisteredCount: 0,
        rows: unassigned.map<OrgSectionRow>((p) => ({ kind: 'profile', key: p.id, profile: p })),
      });
    }
    return sections;
  }, [members, orgMembers, orgTree, orgDeptByName, sortProfiles]);

  const totalUnregistered = useMemo(() => orgSections.reduce((sum, s) => sum + s.unregisteredCount, 0), [orgSections]);

  /** 미가입만 보기 토글이 켜져 있으면, 각 섹션에서 미가입 행만 남기고 비어 있는 섹션은 숨긴다. */
  const displayedSections = useMemo<OrgSection[]>(() => {
    if (!showUnregisteredOnly) return orgSections;
    return orgSections
      .map((section) => ({ ...section, rows: section.rows.filter((r) => r.kind === 'unregistered') }))
      .filter((section) => section.rows.length > 0);
  }, [orgSections, showUnregisteredOnly]);

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
      const withStats = list.map((p) => ({
        ...p,
        login_count: stats[p.id]?.login_count ?? 0,
        last_visited_at: stats[p.id]?.last_visited_at ?? null,
      }));
      const linked = await autoLinkDepartmentsFromOrg(withStats);
      setMembers(linked);
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

  const loadAdminAccessRequests = async () => {
    try {
      const list = await listPendingAdminAccessRequests();
      setAdminAccessRequests(list);
    } catch {
      setAdminAccessRequests([]);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadMembers();
    if (effectiveIsAdmin) {
      void loadAccessRequests();
      void loadAdminAccessRequests();
    } else {
      setAccessRequests([]);
      setAdminAccessRequests([]);
    }
  }, [isOpen, effectiveIsAdmin]);

  /** 조직현황 DB 로드가 회원 목록보다 늦을 때 빈 부서만 재연동 */
  useEffect(() => {
    if (!isOpen || !effectiveIsAdmin || loading || orgDeptByName.size === 0 || membersRef.current.length === 0) return;
    let cancelled = false;
    void (async () => {
      const linked = await autoLinkDepartmentsFromOrg(membersRef.current);
      if (cancelled) return;
      setMembers((prev) => {
        const changed = linked.some((m) => {
          const p = prev.find((x) => x.id === m.id);
          return p && m.department !== p.department;
        });
        return changed ? linked : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, effectiveIsAdmin, loading, orgDeptByName, autoLinkDepartmentsFromOrg]);

  const handleApproveRequest = async (requestId: string) => {
    setProcessingRequestId(requestId);
    setError(null);
    const result = await approveProjectAccessRequest(requestId);
    setProcessingRequestId(null);
    if (result.success) {
      setAccessRequests((prev) => prev.filter((r) => r.id !== requestId));
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
      setAccessRequests((prev) => prev.filter((r) => r.id !== requestId));
    } else {
      setError(result.error ?? '거절에 실패했습니다.');
    }
  };

  const handleApproveAdminRequest = async (requestId: string, targetUserId: string) => {
    setProcessingAdminRequestId(requestId);
    setError(null);
    const result = await approveAdminAccessRequest(requestId);
    setProcessingAdminRequestId(null);
    if (result.success) {
      setAdminAccessRequests((prev) => prev.filter((r) => r.id !== requestId));
      setMembers((prev) => prev.map((m) => (m.id === targetUserId ? { ...m, is_admin: true } : m)));
    } else {
      setError(result.error ?? '승인에 실패했습니다.');
    }
  };

  const handleRejectAdminRequest = async (requestId: string) => {
    setProcessingAdminRequestId(requestId);
    setError(null);
    const result = await rejectAdminAccessRequest(requestId);
    setProcessingAdminRequestId(null);
    if (result.success) {
      setAdminAccessRequests((prev) => prev.filter((r) => r.id !== requestId));
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
      setMembers((prev) => prev.map((m) => (m.id === editingId ? { ...m, full_name: name || null } : m)));
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
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, is_admin: isAdmin } : m)));
    } else {
      setError(result.error ?? '역할 변경에 실패했습니다.');
    }
  };

  const approveMember = async (member: ProfileRow) => {
    if (isMemberEffectivelyApproved(member)) return;
    setApprovingId(member.id);
    const result = await updateMemberApproved(member.id, true);
    setApprovingId(null);
    if (result.success) {
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, approved: true } : m)));
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

  const renderProfileRow = (m: ProfileRow) => (
    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-3 px-2 text-[var(--color-ink)]">
        {editingId === m.id ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') cancelEdit();
              }}
              onBlur={saveName}
              autoFocus
              className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              disabled={savingName}
            />
            <button onClick={saveName} disabled={savingName} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" title="저장">
              <Check size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 group">
            <span>
              {formatPersonDisplay(m.full_name || '', {
                orgMetaByName: memberDisplayMetaByName,
                fallbackDepartment: m.department,
              }) || '-'}
            </span>
            {effectiveIsAdmin && (
              <button
                onClick={() => startEdit(m)}
                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="이름 수정"
                type="button"
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        )}
      </td>
      <td className="py-3 px-2 text-[var(--color-ink)]">{m.email || '(이메일 없음)'}</td>
      <td className="py-3 px-2 align-top">
        {effectiveIsAdmin ? (
          (() => {
            const savedDept = (m.department ?? '').trim();
            const orgSuggested = lookupOrgDepartment(m.full_name, orgDeptByName);
            const displayDept = resolveMemberDepartment(m.department, m.full_name, orgDeptByName);
            const fromOrgOnly = !savedDept && !!orgSuggested;
            return (
              <input
                list="wbs-profile-dept-options"
                defaultValue={displayDept}
                key={`${m.id}:${displayDept}`}
                disabled={savingOrgId === m.id}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== savedDept) void persistMemberDepartment(m, v);
                }}
                placeholder={orgSuggested ? orgSuggested : '부서명'}
                title={
                  fromOrgOnly
                    ? `조직현황에서 자동 연동: ${orgSuggested}. 클릭해 수정할 수 있습니다.`
                    : orgSuggested && savedDept !== orgSuggested
                      ? `저장된 부서: ${savedDept}. 조직현황: ${orgSuggested}`
                      : '조직현황과 동일한 부서명을 권장합니다. 필요 시 직접 수정'
                }
                className={cn(
                  'w-full min-w-[100px] max-w-[180px] px-2 py-1 text-xs border rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500',
                  fromOrgOnly ? 'border-teal-200 bg-teal-50/50' : 'border-slate-200',
                )}
              />
            );
          })()
        ) : (
          <span className="text-slate-600 text-xs" title={resolveMemberDepartment(m.department, m.full_name, orgDeptByName) || undefined}>
            {resolveMemberDepartment(m.department, m.full_name, orgDeptByName) || '—'}
          </span>
        )}
      </td>
      <td className="py-3 px-2 text-slate-500">
        {m.created_at ? (
          <span title={format(new Date(m.created_at), 'yyyy-MM-dd HH:mm')}>{format(new Date(m.created_at), 'yyyy-MM-dd')}</span>
        ) : (
          '-'
        )}
      </td>
      <td className="py-3 px-2 text-slate-600 tabular-nums">{m.login_count != null ? m.login_count : '-'}</td>
      <td className="py-3 px-2 text-slate-500 whitespace-nowrap">
        {m.last_visited_at ? (
          <span title={format(new Date(m.last_visited_at), 'yyyy-MM-dd HH:mm:ss')}>
            {format(new Date(m.last_visited_at), 'yyyy-MM-dd HH:mm')}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td className="py-3 px-2">
        {isMemberEffectivelyApproved(m) ? (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">승인됨</span>
        ) : m.id === currentUserId ? (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">대기</span>
        ) : !effectiveIsAdmin ? (
          <span className="text-slate-400 text-xs" title="회원 승인은 시스템 관리자만 처리합니다.">
            —
          </span>
        ) : approvingId === m.id ? (
          <span className="text-slate-400 text-xs flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> 처리 중
          </span>
        ) : (
          <button
            type="button"
            onClick={() => approveMember(m)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors"
            title="승인 시 전체 프로젝트 목록 조회 등(승인 사용자 정책)이 적용됩니다."
          >
            <UserCheck size={12} /> 승인
          </button>
        )}
      </td>
      <td className="py-3 px-2 text-slate-700 align-top">
        {(() => {
          const owned = projectsByOwner.get(m.id) ?? [];
          const count = owned.length;
          if (count === 0) {
            return <span className="tabular-nums text-slate-300">0</span>;
          }
          const isOpen = expandedOwnedProjectsMemberId === m.id;
          return (
            <div className="flex flex-col gap-1.5 min-w-0 max-w-[280px]">
              <button
                type="button"
                onClick={() => setExpandedOwnedProjectsMemberId((prev) => (prev === m.id ? null : m.id))}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium tabular-nums w-fit text-left transition-colors',
                  isOpen ? 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
                )}
                title={isOpen ? '목록 접기' : '소유 프로젝트 목록 펼치기'}
                aria-expanded={isOpen}
              >
                <FolderGit2 size={12} className="shrink-0" />
                {count}
              </button>
              {isOpen ? (
                <div className="flex flex-wrap gap-1.5">
                  {owned.map((p) =>
                    onNavigateToProject ? (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onNavigateToProject(p.id);
                          onClose();
                        }}
                        className="px-2 py-0.5 text-xs rounded-md border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 text-slate-700 transition-colors text-left break-words max-w-full"
                        title={`${formatProjectDisplayName(p.name, p.projectKind)} — 작업 화면으로 이동`}
                      >
                        {formatProjectDisplayName(p.name, p.projectKind)}
                      </button>
                    ) : (
                      <span
                        key={p.id}
                        className="px-2 py-0.5 text-xs rounded-md border border-slate-200 bg-slate-50 text-slate-700 break-words max-w-full"
                        title={formatProjectDisplayName(p.name, p.projectKind)}
                      >
                        {formatProjectDisplayName(p.name, p.projectKind)}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })()}
      </td>
      <td className="py-3 px-2">
        {effectiveIsAdmin ? (
          <button
            type="button"
            onClick={() => setAccessMember(m)}
            className="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            title="회원별 프로젝트 권한(보기/편집) 확인 및 수정"
          >
            보기/수정
          </button>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
      </td>
      <td className="py-3 px-2">
        {m.id === currentUserId ? (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${m.is_admin ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
            title="본인 계정의 역할은 직접 변경할 수 없습니다. (회원 화면 미리보기는 헤더의 '회원 체험' 사용)"
          >
            {m.is_admin ? '관리자' : '회원'}
          </span>
        ) : !canChangeMemberRole(m) ? (
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${m.is_admin ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
            title={effectiveIsAdmin ? undefined : '소속 범위 밖이거나 조직 책임자에게서만 변경 가능한 회원이 아닙니다.'}
          >
            {m.is_admin ? '관리자' : '회원'}
          </span>
        ) : savingRoleId === m.id ? (
          <span className="text-slate-400 text-xs flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> 변경 중
          </span>
        ) : (
          <select
            value={m.is_admin ? 'admin' : 'member'}
            onChange={(e) => setRole(m, e.target.value === 'admin')}
            className="text-xs font-medium px-2 py-1 rounded border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
          >
            <option value="member">회원</option>
            <option value="admin">관리자</option>
          </select>
        )}
      </td>
      <td className="py-3 px-2 text-right">
        {effectiveIsAdmin && m.id !== currentUserId ? (
          <button
            type="button"
            onClick={() => setMemberToDelete(m)}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="회원 삭제"
          >
            <Trash2 size={16} />
          </button>
        ) : m.id === currentUserId ? (
          <span className="text-slate-300 text-xs">본인</span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
      </td>
    </tr>
  );

  /** 조직도에는 있으나 회원가입(profiles)이 없는 인원. 가입 유도용으로 회색 톤으로 표시 */
  const renderUnregisteredRow = (om: OrgMember, rowKey: string) => {
    const displayName =
      formatPersonDisplay(om.name, {
        orgMetaByName: memberDisplayMetaByName,
        fallbackDepartment: om.department,
      }) || om.name;
    return (
      <tr key={rowKey} className="border-b border-slate-100 bg-slate-50/40 hover:bg-slate-100/50">
        <td className="py-3 px-2 text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <UserX size={14} className="text-slate-400 shrink-0" />
            {displayName}
          </span>
        </td>
        <td className="py-3 px-2 text-slate-400 text-xs italic">(회원가입 안 됨)</td>
        <td className="py-3 px-2 text-slate-500 text-xs">{om.department || '—'}</td>
        <td className="py-3 px-2 text-slate-300">—</td>
        <td className="py-3 px-2 text-slate-300">—</td>
        <td className="py-3 px-2 text-slate-300">—</td>
        <td className="py-3 px-2">
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200/70 text-slate-600 whitespace-nowrap">미가입</span>
        </td>
        <td className="py-3 px-2 text-slate-300">—</td>
        <td className="py-3 px-2 text-slate-300">—</td>
        <td className="py-3 px-2 text-slate-500 text-xs whitespace-nowrap">{om.position || '—'}</td>
        <td className="py-3 px-2 text-right text-slate-300 text-xs">—</td>
      </tr>
    );
  };

  return (
    <>
      <div className={cn(MODAL_SCRIM_CLASS, 'z-50')} onClick={onClose} />
      <div
        className={cn(
          MODAL_PANEL_BASE_CLASS,
          'fixed z-[51] inset-2 md:inset-6 !w-auto overflow-hidden flex flex-col border-[var(--color-line)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-line)]">
          <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Users size={20} />
            회원 관리
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUnregisteredOnly((v) => !v)}
              aria-pressed={showUnregisteredOnly}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                showUnregisteredOnly
                  ? 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100',
              )}
              title={
                showUnregisteredOnly
                  ? '모든 회원·미가입자를 다시 표시합니다.'
                  : '조직도엔 있으나 회원가입을 하지 않은 인원만 표시합니다. 가입 권유 명단 추리기에 사용하세요.'
              }
            >
              <UserX size={14} />
              {showUnregisteredOnly ? '전체 보기' : '미가입만 보기'}
              {totalUnregistered > 0 ? (
                <span
                  className={cn(
                    'tabular-nums rounded-md px-1.5 py-0.5 text-[10px]',
                    showUnregisteredOnly ? 'bg-white/70 text-amber-800' : 'bg-amber-100 text-amber-700',
                  )}
                >
                  {totalUnregistered}
                </span>
              ) : null}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
          {!effectiveIsAdmin && isOrgScopedManager && (
            <p className="text-sm text-teal-900 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2.5 mb-4 leading-relaxed">
              <strong>조직 책임자</strong>로 로그인했습니다. 같은 조직 범위(org_nodes 하위 부서) 소속 회원의{' '}
              <strong>역할(회원·관리자)</strong>만 바꿀 수 있습니다. 회원의 <strong>부서</strong>는 시스템 관리자가 지정해야 하며, 본인의{' '}
              <strong>관리 범위</strong>도 관리자에게 요청해 주세요.
            </p>
          )}
          {effectiveIsAdmin && (
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              조직도(<span className="font-mono">org_members</span>)에서 직책이 팀장이면 부팀장을 제외하고, 회원명·부서가 동일할 때{' '}
              <strong>관리자</strong> 권한이 자동으로 부여됩니다(로그인·부서·조직도 갱신 시 반영).
            </p>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
              <Loader2 size={24} className="animate-spin" />
              <span>로딩 중...</span>
            </div>
          ) : displayedSections.length === 0 ? (
            <p className="text-slate-500 text-center py-12">
              {showUnregisteredOnly ? '미가입자가 없습니다. 모두 회원가입이 완료되었어요.' : '등록된 회원이 없습니다.'}
            </p>
          ) : (
            <>
              <datalist id="wbs-profile-dept-options">
                {departmentOptions.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <div className="overflow-x-auto -mx-5 px-5 pb-2">
                <table className="w-full text-sm min-w-[1180px]">
                  <thead>
                    <tr className="border-b border-[var(--color-line)]">
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('full_name')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="회원명으로 정렬"
                        >
                          회원명
                          {sortKey === 'full_name' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('email')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="이메일로 정렬"
                        >
                          이메일
                          {sortKey === 'email' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th
                        className="text-left py-3 px-2 font-semibold text-slate-600 whitespace-nowrap"
                        title="조직현황(조직도) 인원과 회원명으로 자동 연동. 필요 시 직접 수정"
                      >
                        부서
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('created_at')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="가입일로 정렬"
                        >
                          가입일
                          {sortKey === 'created_at' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('login_count')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="접속횟수로 정렬"
                        >
                          접속횟수
                          {sortKey === 'login_count' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('last_visited_at')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="마지막 접속으로 정렬"
                        >
                          마지막 접속시각
                          {sortKey === 'last_visited_at' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('approved')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="승인 여부로 정렬"
                        >
                          승인
                          {sortKey === 'approved' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th
                        className="text-left py-3 px-2 font-semibold text-slate-600 whitespace-nowrap"
                        title="해당 회원이 만든(소유한) 프로젝트 개수. 숫자를 누르면 프로젝트 이름을 펼칩니다."
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort('project_count')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="프로젝트 수로 정렬 (셀의 숫자는 클릭하여 목록 표시)"
                        >
                          프로젝트 수
                          {sortKey === 'project_count' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">프로젝트 권한</th>
                      <th className="text-left py-3 px-2 font-semibold text-slate-600">
                        <button
                          type="button"
                          onClick={() => toggleSort('role')}
                          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
                          title="역할로 정렬"
                        >
                          역할
                          {sortKey === 'role' ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )
                          ) : (
                            <ArrowUpDown size={14} className="opacity-40" />
                          )}
                        </button>
                      </th>
                      <th className="text-right py-3 px-2 font-semibold text-slate-600 w-16">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedSections.map((section) => (
                      <Fragment key={section.nodeId}>
                        <tr className="bg-gradient-to-r from-indigo-50/80 via-indigo-50/40 to-transparent">
                          <td
                            colSpan={TABLE_COL_COUNT}
                            className="px-2 py-2 border-t border-b border-indigo-100 text-xs font-semibold text-slate-700"
                          >
                            <div className="flex items-center gap-2">
                              <span aria-hidden style={{ paddingLeft: `${section.depth * 14}px` }} />
                              <Building2 size={14} className="text-indigo-500 shrink-0" />
                              <span>{section.nodeName}</span>
                              <span className="text-slate-500 font-normal">
                                {showUnregisteredOnly ? (
                                  <>
                                    미가입 <span className="tabular-nums text-amber-700">{section.unregisteredCount}</span>
                                  </>
                                ) : (
                                  <>
                                    가입 <span className="tabular-nums text-slate-700">{section.registeredCount}</span>
                                    {section.unregisteredCount > 0 ? (
                                      <>
                                        {' · '}미가입 <span className="tabular-nums text-amber-700">{section.unregisteredCount}</span>
                                      </>
                                    ) : null}
                                  </>
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {section.rows.map((row) =>
                          row.kind === 'profile' ? renderProfileRow(row.profile) : renderUnregisteredRow(row.orgMember, row.key),
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {dbIsAdmin && !loading && adminAccessRequests.length > 0 && (
            <div className="mt-8 pt-6 border-t border-[var(--color-line)]">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <Shield size={16} />
                시스템 관리자 권한 요청 (대기 중)
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                회원이 DB 시스템 관리자(<span className="font-mono">is_admin</span>) 권한을 요청한 목록입니다. 승인 시 해당 회원이
                대시보드·전역 설정 등 관리자 기능을 사용할 수 있습니다.
              </p>
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">요청자</th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">사유</th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">요청일</th>
                    <th className="text-right py-2 px-3 font-semibold text-slate-600 w-32">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {adminAccessRequests.map((req) => {
                    const requester = members.find((m) => m.id === req.user_id);
                    const requesterName = requester
                      ? formatPersonDisplay((requester.full_name || '').trim(), {
                          orgMetaByName: memberDisplayMetaByName,
                          fallbackDepartment: requester.department,
                        }) ||
                        requester.email ||
                        req.user_id
                      : req.user_id;
                    const isProcessing = processingAdminRequestId === req.id;
                    return (
                      <tr key={req.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="py-2 px-3 text-[var(--color-ink)]">{requesterName}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-[220px]">
                          <span className="line-clamp-2 break-words" title={req.message ?? undefined}>
                            {req.message?.trim() ? req.message : '—'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                          {req.created_at ? format(new Date(req.created_at), 'yyyy-MM-dd HH:mm') : '-'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleApproveAdminRequest(req.id, req.user_id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 transition-colors"
                              title="승인"
                            >
                              {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                              승인
                            </button>
                            <button
                              type="button"
                              disabled={isProcessing}
                              onClick={() => handleRejectAdminRequest(req.id)}
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

          {effectiveIsAdmin && !loading && accessRequests.length > 0 && (
            <div className="mt-8 pt-6 border-t border-[var(--color-line)]">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <FolderGit2 size={16} />
                프로젝트 권한 요청 (대기 중)
              </h3>
              <p className="text-xs text-slate-500 mb-3">
                승인된 회원이 특정 프로젝트에 대한 보기/편집 권한을 요청한 목록입니다. 승인 시 해당 회원이 프로젝트 내용을 볼 수 있습니다.
              </p>
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">프로젝트</th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">요청자</th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">요청 권한</th>
                    <th className="text-left py-2 px-3 font-semibold text-slate-600">요청일</th>
                    <th className="text-right py-2 px-3 font-semibold text-slate-600 w-32">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRequests.map((req) => {
                    const proj = projects.find((p) => p.id === req.project_id);
                    const projectName = proj ? formatProjectDisplayName(proj.name, proj.projectKind) : req.project_id;
                    const requester = members.find((m) => m.id === req.user_id);
                    const requesterName = requester
                      ? formatPersonDisplay((requester.full_name || '').trim(), {
                          orgMetaByName: memberDisplayMetaByName,
                          fallbackDepartment: requester.department,
                        }) ||
                        requester.email ||
                        req.user_id
                      : req.user_id;
                    const isProcessing = processingRequestId === req.id;
                    return (
                      <tr key={req.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="py-2 px-3 text-[var(--color-ink)]">{projectName}</td>
                        <td className="py-2 px-3 text-slate-600">{requesterName}</td>
                        <td className="py-2 px-3">
                          <span className={req.requested_role === 'editor' ? 'text-indigo-600' : 'text-slate-600'}>
                            {req.requested_role === 'editor' ? '편집' : '보기'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-500">
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

        <div className="p-4 border-t border-[var(--color-line)] bg-slate-50/50">
          <p className="text-xs text-slate-500">
            가입 <span className="font-medium text-slate-700">{members.length}명</span>
            {totalUnregistered > 0 ? (
              <>
                {' · '}미가입 <span className="font-medium text-amber-700">{totalUnregistered}명</span>
                {' · '}총 <span className="font-medium text-slate-700">{members.length + totalUnregistered}명</span>
              </>
            ) : null}
            {showUnregisteredOnly ? (
              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-medium">
                미가입만 표시 중
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {memberToDelete && (
        <div className={cn(MODAL_BACKDROP_CLASS, 'z-[60]')} onClick={() => setMemberToDelete(null)}>
          <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md overflow-hidden')} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-[var(--color-line)]">
              <h3 className="text-lg font-bold text-[var(--color-ink)]">회원 삭제</h3>
              <p className="mt-2 text-sm text-slate-600">
                <strong>
                  {memberToDelete.full_name
                    ? `${memberToDelete.full_name} (${memberToDelete.email || '이메일 없음'})`
                    : memberToDelete.email || '(이메일 없음)'}
                </strong>{' '}
                회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없으며, 해당 회원의 모든 데이터가 삭제됩니다.
              </p>
            </div>
            <div className="p-5 flex justify-end gap-2">
              <button
                onClick={() => setMemberToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
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
        profileDisplayById={profileDisplayById}
      />
    </>
  );
}
