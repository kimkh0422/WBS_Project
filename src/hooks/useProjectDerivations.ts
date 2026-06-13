import { useMemo } from 'react';
import type { Task, Project } from '../types';
import { isPrivateProjectHiddenFromViewer } from '../lib/projectKind';

interface UseProjectDerivationsParams {
  projects: Project[];
  allTasks: Task[];
  userId: string | undefined;
  /** 프로젝트 "삭제" 전용 권한(소유자·운영자). 사내 일반 계정은 제외 */
  realIsAdmin: boolean;
}

/**
 * 프로젝트 목록 파생값 모음 — 헤더 드롭다운·필터·삭제 선택 등에서 공유.
 * WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useProjectDerivations({ projects, allTasks, userId, realIsAdmin }: UseProjectDerivationsParams) {
  const taskCountByProject = useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach((p) => {
      m[p.id] = 0;
    });
    allTasks.forEach((t) => {
      if (t.projectId && m[t.projectId] !== undefined) m[t.projectId]++;
    });
    return m;
  }, [projects, allTasks]);

  /** 목록에 없는 projectId 또는 projectId 없음 (드롭다운 합계 ≠ 전체일 때 표시) */
  const orphanAndUnassignedTaskCount = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    return allTasks.filter((t) => !t.projectId || !ids.has(t.projectId)).length;
  }, [projects, allTasks]);

  // 프로젝트 목록: id 기준으로만 표시 (이름+소유자로 묶지 않음 → 사용자별 복사본이 원본과 합쳐지지 않음)
  const uniqueProjects = useMemo(() => {
    const seen = new Set<string>();
    return projects.filter((p) => {
      if (isPrivateProjectHiddenFromViewer(p, userId)) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [projects, userId]);

  // 권한 등급과 무관하게 동일한 목록: 소유자 그룹 없이 이름순 단일 목록 (이름 같으면 id로 2차 정렬해 순서 고정)
  const projectsSortedByName = useMemo(() => {
    return [...uniqueProjects].sort((a, b) => {
      const byName = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
      return byName !== 0 ? byName : (a.id ?? '').localeCompare(b.id ?? '', 'ko');
    });
  }, [uniqueProjects]);

  const deletableProjects = useMemo(() => {
    // "프로젝트 선택해서 삭제"는 실제로 '프로젝트+소속 작업 삭제'이므로,
    // 작업이 있는 프로젝트만 표시. 관리자가 아니면 본인이 만든 프로젝트로 한정
    return projectsSortedByName
      .filter((p) => (taskCountByProject[p.id] ?? 0) > 0)
      .filter((p) => realIsAdmin || (userId ? p.ownerId === userId : false));
  }, [projectsSortedByName, taskCountByProject, realIsAdmin, userId]);

  return { taskCountByProject, orphanAndUnassignedTaskCount, uniqueProjects, projectsSortedByName, deletableProjects };
}
