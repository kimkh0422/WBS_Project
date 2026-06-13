import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../types';
import { fetchProfiles, getProjectOwnerDisplayNames, getMyProjectMemberProjectIds } from '../lib/db';
import { buildProfileDisplayById, buildOrgMemberDisplayMetaMap, formatPersonDisplay } from '../lib/assigneeOptions';

type ViewerUser = { id: string; email?: string | null; user_metadata?: unknown } | null | undefined;
type OrgMembers = Parameters<typeof buildOrgMemberDisplayMetaMap>[0];
type AssigneeDisplayMeta = ReturnType<typeof buildOrgMemberDisplayMetaMap>;

interface UseViewerDirectoryParams {
  user: ViewerUser;
  projects: Project[];
  orgMembers: OrgMembers;
  assigneeDisplayMetaByName: AssigneeDisplayMeta;
}

/**
 * 로그인 사용자·회원 표시명 디렉터리 — 프로필/소유자/멤버 ID 로딩과 표시명 파생값을 한곳에 모은다.
 * 헤더·대시보드·공유·작업표 등에서 공유. WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useViewerDirectory({ user, projects, orgMembers, assigneeDisplayMetaByName }: UseViewerDirectoryParams) {
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof fetchProfiles>>>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [myMemberProjectIds, setMyMemberProjectIds] = useState<string[]>([]);

  // 회원(프로필) 목록 로드: 관리자는 전체, 일반 사용자는 본인 프로필만 (현재 로그인 사용자 표시용)
  useEffect(() => {
    if (!user?.id) return;
    fetchProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [user?.id]);

  // 접근 가능한 프로젝트 소유자 표시명 보강 (RLS로 프로필 미조회 시에도 이름 표시)
  useEffect(() => {
    if (!user?.id || !projects.length) {
      setOwnerDisplayNames({});
      return;
    }
    const knownIds = new Set(profiles.map((p) => p.id));
    const ownerIds: string[] = projects.map((p) => p.ownerId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    const uniqueOwnerIds = Array.from(new Set(ownerIds));
    const missingOwnerIds = uniqueOwnerIds.filter((id) => !knownIds.has(id));
    if (missingOwnerIds.length === 0) {
      setOwnerDisplayNames({});
      return;
    }
    getProjectOwnerDisplayNames(missingOwnerIds).then(setOwnerDisplayNames);
  }, [user?.id, projects, profiles]);

  // 내가 멤버인 프로젝트 ID (권한 요청 배너 표시 여부 판단용)
  useEffect(() => {
    if (!user?.id) {
      setMyMemberProjectIds([]);
      return;
    }
    getMyProjectMemberProjectIds()
      .then(setMyMemberProjectIds)
      .catch(() => setMyMemberProjectIds([]));
  }, [user?.id]);

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

  /** 대시보드 인원별 투입 현황에 표시할 등록 회원 표시명 집합 (profiles 기준) */
  const registeredMemberDisplayNames = useMemo(() => {
    const names = new Set<string>();
    profiles.forEach((p) => {
      const name = (p.full_name && String(p.full_name).trim()) || p.email || '(이메일 없음)';
      names.add(name);
    });
    return names;
  }, [profiles]);

  const profileDisplayById = useMemo(
    () => buildProfileDisplayById(profiles, orgMembers, ownerDisplayNames),
    [profiles, orgMembers, ownerDisplayNames],
  );

  /** 프로젝트 목록 조직도 보기: 소유자 부서 보조 매칭 */
  const ownerDepartmentByUserId = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const p of profiles) {
      const d = p.department != null ? String(p.department).trim() : '';
      m[p.id] = d.length > 0 ? d : null;
    }
    return m;
  }, [profiles]);

  /** 필터·담당자 매칭·PM 기본값 등 저장/비교용 평문 표시명 */
  const currentUserPlainName = useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id) as { full_name?: string | null } | undefined;
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return ((name && String(name).trim()) || user.email || '사용자').trim();
  }, [user, profiles]);

  const currentUserDisplay = useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id) as { full_name?: string | null; department?: string | null } | undefined;
    const plain =
      (profile?.full_name && String(profile.full_name).trim()) ||
      (user.user_metadata as { full_name?: string } | undefined)?.full_name ||
      '';
    const base = (plain && String(plain).trim()) || user.email || '사용자';
    return formatPersonDisplay(base, { orgMetaByName: assigneeDisplayMetaByName, fallbackDepartment: profile?.department });
  }, [user, profiles, assigneeDisplayMetaByName]);

  return {
    profiles,
    ownerDisplayNames,
    myMemberProjectIds,
    setMyMemberProjectIds,
    profileMap,
    registeredMemberDisplayNames,
    profileDisplayById,
    ownerDepartmentByUserId,
    currentUserPlainName,
    currentUserDisplay,
  };
}
