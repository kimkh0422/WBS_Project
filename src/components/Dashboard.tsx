import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVisitorStats, getRegisteredMemberCount } from '../lib/db';
import {
  Briefcase,
  LayoutGrid,
  Loader2,
  Building2,
  Settings2,
  Check,
  User,
  Ban,
  Table2,
  Calendar,
  ChevronDown,
  CircleHelp,
  RotateCcw,
} from 'lucide-react';
import { cn, randomUUID, formatPercent1 } from '../lib/utils';
import { dashboardTaskOverdue, buildDepthGetter, computeWeightedProgress, computeWeightedPlanned } from '../lib/dashboardStats';
import {
  PROJECT_KINDS,
  formatProjectDisplayName,
  resolveProjectKindOrDefault,
  isPrivateProjectHiddenFromViewer,
  type ProjectKind,
} from '../lib/projectKind';
import { computeProjectAssigneeWorkEffort } from '../lib/personAllocations';
import { computePlannedProgressMap } from '../lib/plannedProgress';
import { computeWbsQualityScore } from '../lib/wbsQualityScore';
import type { Task, Project } from '../types';
import type { ProjectStats } from '../lib/dashboardTypes';
import type { WBSSettings } from '../lib/wbsSettings';
import {
  readDashboardSectionVisibility,
  type DashboardSectionId,
  WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED,
} from '../lib/dashboardSections';
import {
  readDashboardSectionLayout,
  writeDashboardSectionLayout,
  type DashboardSectionLayoutMode,
  type DashboardSectionLayout,
  WBS_DASHBOARD_SECTION_LAYOUT_CHANGED,
} from '../lib/dashboardSectionLayout';
import { useOrganization } from '../context/OrganizationContext';
import type { OrgNode } from '../data/organization';
import { buildOrgMemberDisplayMetaMap, buildOrgMemberLabelMap } from '../lib/assigneeOptions';
import { sortOrgMembersByPosition } from '../lib/orgMemberSort';
import { inferProjectTopDivisionId } from '../lib/allocationDivisionInfer';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { CooperationRequestSection } from './CooperationRequestSection';
import { hasUndeterminedProjectPeriod } from '../lib/projectPeriod';
import { DashboardTableHintCell, DashboardHeroBand, ProjectCard } from './dashboardCards';

import { DashboardDivisionDetail } from './DashboardDivisionDetail';
import { DashboardDetailPage, type DashboardDetailKind } from './DashboardDetailPage';
import { DashboardProjectCardDetailPanel } from './DashboardProjectCardDetailPanel';
import { BaseModal } from './Base/Modal';
import { useToast } from './Toast';
import { downloadProjectRegistrationPdfReport } from '../lib/projectPdf';
import {
  type ActionDueDateFilter,
  filterActionTasksByDuePeriod,
  getActionTasksWithDueDate,
  sortActionTasksByEndDate,
} from '../lib/actionItemDueFilter';

const DASHBOARD_DETAIL_KINDS = new Set<DashboardDetailKind>([
  'projects',
  'tasks',
  'members',
  'visitors',
  'issues',
  'actions',
  'milestones',
  'project',
]);

type DivisionStatRow = {
  projectCount: number;
  total: number;
  assignmentPersonCount: number;
};

/** 프로젝트·Task·프로젝트 투입 인원 중 하나라도 있는 사업부 */
function isActiveDivisionStat(d: DivisionStatRow): boolean {
  return d.projectCount > 0 || d.total > 0 || d.assignmentPersonCount > 0;
}

export function Dashboard({
  onNavigate,
  onOpenTaskInTable,
  registeredMemberDisplayNames,
  accessibleProjectIds,
  myInvolvedProjectIds,
  currentUserDisplay,
  profileMap,
  ownerDepartmentByUserId,
  currentUserId,
  mobileReadabilityMode = false,
  projectRegistrationPdfRef,
}: {
  onNavigate?: (view: string, filters: Record<string, string>) => void;
  /** 이슈 작업 행 선택 시 해당 작업이 있는 프로젝트 WBS 표로 이동·스크롤(PC). 미제공 시 기존처럼 이슈 상세만 엽니다. */
  onOpenTaskInTable?: (taskId: string, projectId: string) => void;
  registeredMemberDisplayNames?: Set<string>;
  /** undefined: 전체(관리자). Set이면 그 ID 집합에 속한 프로젝트만 노출 (본인 참여 프로젝트). */
  accessibleProjectIds?: Set<string>;
  /** "내가 포함된 프로젝트" 빠른 필터 대상 ID. owner/멤버/작업 담당자 매칭. undefined면 토글 비활성. */
  myInvolvedProjectIds?: Set<string>;
  /** 현재 사용자 표시 이름. 부서 매칭("내가 포함된 부서") 등에 사용. */
  currentUserDisplay?: string;
  /** 프로젝트 owner_id → 프로필 표시명 (PM 미지정 시 소유자 이름 표시용). */
  profileMap?: Record<string, string>;
  /** 조직도 매칭 보조: owner_id → 프로필 부서명 */
  ownerDepartmentByUserId?: Record<string, string | null | undefined>;
  currentUserId?: string;
  /** 모바일 전용: 한 열·카드형 레이아웃으로 가독성 강화(App에서 대시보드 고정 시 true) */
  mobileReadabilityMode?: boolean;
  /** App 상단 ⋮ 메뉴에서 프로젝트 등록현황 PDF 저장 시 호출할 비동기 함수를 등록 */
  projectRegistrationPdfRef?: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const { projects: allProjects, allTasks: allTasksRaw, wbsSettings, updateTask, updateProject } = useWBS();
  const { push: pushToast } = useToast();
  // 권한 필터: accessibleProjectIds가 주어지면 그 집합으로 프로젝트와 작업을 좁힘.
  const projects = useMemo(() => {
    const base = accessibleProjectIds ? allProjects.filter((p) => accessibleProjectIds.has(p.id)) : allProjects;
    return base.filter((p) => !isPrivateProjectHiddenFromViewer(p, currentUserId));
  }, [allProjects, accessibleProjectIds, currentUserId]);
  const allTasks = useMemo(
    () => (accessibleProjectIds ? allTasksRaw.filter((t) => accessibleProjectIds.has(t.projectId)) : allTasksRaw),
    [allTasksRaw, accessibleProjectIds],
  );

  // ─── 대시보드에 집계할 프로젝트 구분(이 브라우저에만 저장). 체크 해제한 구분은 표시·계산에서 제외 ─────────
  const DASHBOARD_INCLUDED_KINDS_KEY = 'wbs-dashboard-included-project-kinds';
  /** 초기 접속·새로고침 시에는 저장된 필터를 적용하지 않고 전체 구분·필터 없음으로 시작한다. */
  const [dashboardIncludedKinds, setDashboardIncludedKinds] = useState<Set<ProjectKind>>(() => new Set(PROJECT_KINDS));
  const persistDashboardIncludedKinds = (next: Set<ProjectKind>) => {
    try {
      const ordered = PROJECT_KINDS.filter((k) => next.has(k));
      if (ordered.length === PROJECT_KINDS.length) localStorage.removeItem(DASHBOARD_INCLUDED_KINDS_KEY);
      else localStorage.setItem(DASHBOARD_INCLUDED_KINDS_KEY, JSON.stringify(ordered));
    } catch {
      /* ignore */
    }
    setDashboardIncludedKinds(next);
  };
  const toggleDashboardIncludedKind = (kind: ProjectKind) => {
    const next = new Set<ProjectKind>(dashboardIncludedKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    persistDashboardIncludedKinds(next);
  };
  const selectAllDashboardKinds = () => persistDashboardIncludedKinds(new Set(PROJECT_KINDS));
  const dashboardKindsFilterActive = useMemo(() => PROJECT_KINDS.some((k) => !dashboardIncludedKinds.has(k)), [dashboardIncludedKinds]);

  const projectsEligibleForDashboard = useMemo(
    () =>
      projects.filter((p) => {
        if (p.includeInDashboard === false) return false;
        const kind = resolveProjectKindOrDefault(p);
        return dashboardIncludedKinds.has(kind);
      }),
    [projects, dashboardIncludedKinds],
  );

  // ─── 대시보드 집계에서 제외할 프로젝트 (localStorage, 사용자별) ─────────
  const DASHBOARD_EXCLUDED_KEY = 'wbs-dashboard-excluded-project-ids';
  const [dashboardExcludedIds, setDashboardExcludedIds] = useState<Set<string>>(() => new Set<string>());
  const persistDashboardExcluded = (next: Set<string>) => {
    try {
      if (next.size === 0) localStorage.removeItem(DASHBOARD_EXCLUDED_KEY);
      else localStorage.setItem(DASHBOARD_EXCLUDED_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
    setDashboardExcludedIds(next);
  };
  const toggleDashboardExcluded = (id: string) => {
    const next = new Set<string>(dashboardExcludedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDashboardExcluded(next);
  };
  const clearDashboardExcluded = () => persistDashboardExcluded(new Set());

  const projectsForDashboard = useMemo(
    () => projectsEligibleForDashboard.filter((p) => !dashboardExcludedIds.has(p.id)),
    [projectsEligibleForDashboard, dashboardExcludedIds],
  );
  const projectsWithUndeterminedPeriod = useMemo(
    () => projectsForDashboard.filter((p) => hasUndeterminedProjectPeriod(p)),
    [projectsForDashboard],
  );
  const dashboardAggregatedProjectIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of projectsEligibleForDashboard) {
      if (!dashboardExcludedIds.has(p.id)) s.add(p.id);
    }
    return s;
  }, [projectsEligibleForDashboard, dashboardExcludedIds]);
  const allTasksForDashboard = useMemo(
    () => allTasks.filter((t) => dashboardAggregatedProjectIds.has(t.projectId)),
    [allTasks, dashboardAggregatedProjectIds],
  );
  /** 집계 제외 설정 UI: 대시보드 반영이 켜진 프로젝트만(로컬 제외 대상) */
  const projectsForExclusionPicker = useMemo(
    () => [...projectsEligibleForDashboard].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [projectsEligibleForDashboard],
  );

  const { orgTree, orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const dashboardOrgMemberLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);

  // 조직 트리의 최상위 자식(사업부/본부) 목록
  const topLevelDivisions = useMemo<OrgNode[]>(() => orgTree.children?.[0]?.children ?? [], [orgTree]);

  // 멤버 이름 → 최상위 사업부/본부 ID 매핑 (자식 노드 포함 모든 멤버를 그 division에 매핑)
  const memberToDivisionId = useMemo(() => {
    const m = new Map<string, string>();
    const collect = (node: OrgNode, divisionId: string) => {
      const deptSet = new Set(node.departments ?? []);
      for (const member of orgMembers) {
        if (deptSet.has(member.department) && !m.has(member.name)) m.set(member.name, divisionId);
      }
      for (const child of node.children ?? []) collect(child, divisionId);
    };
    topLevelDivisions.forEach((division) => collect(division, division.id));
    return m;
  }, [topLevelDivisions, orgMembers]);

  /** 프로젝트 그룹명(부서명) 문자열 → 최상위 사업부/본부 ID. 조직 노드의 departments·aliases와 동일한 문자열이면 매칭 */
  const departmentNameToDivisionId = useMemo(() => {
    const m = new Map<string, string>();
    for (const division of topLevelDivisions) {
      const walk = (node: OrgNode) => {
        for (const d of node.departments ?? []) {
          const key = d.trim();
          if (key.length > 0 && !m.has(key)) m.set(key, division.id);
        }
        for (const child of node.children ?? []) walk(child);
      };
      walk(division);
    }
    return m;
  }, [topLevelDivisions]);

  /** PM·PO·소유자 부서·(보조)프로젝트 그룹명으로 사업부 추론 — 투입공수 집계와 동일 규칙 */
  const divisionInferCtx = useMemo(
    () => ({
      memberToDivisionId,
      departmentNameToDivisionId,
      profileMap: profileMap ?? {},
      ownerDepartmentByUserId,
    }),
    [memberToDivisionId, departmentNameToDivisionId, profileMap, ownerDepartmentByUserId],
  );

  // 공유 파생 데이터 — 여러 useMemo에서 재사용 (집계 제외 반영)
  const projectMap = useMemo(() => new Map(projectsForDashboard.map((p) => [p.id, p])), [projectsForDashboard]);

  // Calculate stats for each project
  const projectStats = useMemo(() => {
    const doneIds = new Set<string>((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => String(c.id)));
    return projectsForDashboard.map((project) => {
      const pTasks = allTasksForDashboard.filter((t) => t.projectId === project.id);
      const total = pTasks.length;

      let issueCount = 0;
      let actionCount = 0;
      let overdueCount = 0;
      for (const t of pTasks) {
        if (t.isIssue) issueCount++;
        if (t.isActionItem) actionCount++;
        if (dashboardTaskOverdue(t, doneIds)) overdueCount++;
      }

      // Dynamic status counts
      const statusCounts: Record<string, number> = {};
      wbsSettings.statusConfigs.forEach((c) => (statusCounts[c.id] = 0));
      pTasks.forEach((t) => {
        if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
      });

      const assignees = Array.from(new Set(pTasks.map((t) => t.assignee).filter(Boolean)));
      const assigneeWorkMd = computeProjectAssigneeWorkEffort(pTasks, project.id);
      const inputManDays = [...assigneeWorkMd.values()].reduce((a, b) => a + b, 0);

      // 전체 진척율: 1레벨 (progress×weight) 가중평균. 가중치 합이 100이 아니어도 Σ(pw)/Σw.
      // 1레벨이 없으면 폴백으로 리프(단말) 단순 평균.
      const taskById = new Map<string, Task>(pTasks.map((t) => [t.id, t]));
      const getDepth = buildDepthGetter(taskById);
      const level1 = pTasks.filter((t) => getDepth(t.id) === 0);
      // 프로젝트 내 부모 ID 세트로 leaf 판별 O(n)화
      const pParentIdSet = new Set(pTasks.map((t) => t.parentId).filter(Boolean));
      const leafTasks = pTasks.filter((t) => !pParentIdSet.has(t.id));
      const forAggregate = leafTasks.length > 0 ? leafTasks : pTasks;
      const progress =
        level1.length > 0
          ? computeWeightedProgress(level1)
          : forAggregate.length > 0
            ? Math.min(100, Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (t.progress || 0), 0) / forAggregate.length)))
            : 0;

      // 계획율: 진척률과 동일 대상(level1 우선)·동일 가중으로 집계. 차이 = 진척 − 계획.
      const plannedById = computePlannedProgressMap(pTasks);
      const planned =
        level1.length > 0
          ? computeWeightedPlanned(level1, plannedById)
          : forAggregate.length > 0
            ? Math.min(
                100,
                Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (plannedById.get(t.id) ?? 0), 0) / forAggregate.length)),
              )
            : 0;
      const variance = Math.round((progress - planned) * 10) / 10;

      // WBS 작성 충실도(체크리스트 기반). 이미 계산한 plannedById 재사용.
      const quality = computeWbsQualityScore(pTasks, project, wbsSettings.statusConfigs ?? [], { plannedById });

      return {
        ...project,
        stats: {
          total,
          statusCounts,
          progress,
          planned,
          variance,
          assigneeCount: assignees.length,
          inputManDays,
          issueCount,
          actionCount,
          overdueCount,
          quality,
        },
      };
    });
  }, [projectsForDashboard, allTasksForDashboard, wbsSettings.statusConfigs]);

  // 작업(WBS) 0개인 프로젝트는 대시보드에서 숨김
  const visibleProjectStats = useMemo(() => projectStats.filter((p) => (p?.stats?.total ?? 0) > 0), [projectStats]);

  // ─── 대시보드 표시 프로젝트 사용자 선택 (localStorage 저장) ──────────────
  // null = 모든 프로젝트 표시 (기본). Set = 명시적으로 선택된 프로젝트만 표시.
  const DASHBOARD_VISIBLE_KEY = 'wbs-dashboard-visible-project-ids';
  const [dashboardVisibleIds, setDashboardVisibleIds] = useState<Set<string> | null>(() => null);
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);
  const [isExclusionPickerOpen, setIsExclusionPickerOpen] = useState(false);
  const exclusionPickerRef = useRef<HTMLDivElement>(null);

  // 선택 외부 클릭 시 닫기
  useEffect(() => {
    if (!isExclusionPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (exclusionPickerRef.current && !exclusionPickerRef.current.contains(e.target as Node)) {
        setIsExclusionPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isExclusionPickerOpen]);

  // 선택 외부 클릭 시 닫기
  useEffect(() => {
    if (!isProjectPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (projectPickerRef.current && !projectPickerRef.current.contains(e.target as Node)) {
        setIsProjectPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isProjectPickerOpen]);

  const persistDashboardVisible = (next: Set<string> | null) => {
    if (next === null) {
      localStorage.removeItem(DASHBOARD_VISIBLE_KEY);
    } else {
      localStorage.setItem(DASHBOARD_VISIBLE_KEY, JSON.stringify(Array.from(next)));
    }
    setDashboardVisibleIds(next);
  };
  const toggleDashboardProject = (id: string) => {
    // 현재 null(=모두 표시)이면 모든 프로젝트 ID로 채운 뒤 클릭한 것 토글
    const base: Set<string> = dashboardVisibleIds ?? new Set<string>(visibleProjectStats.map((p) => p.id as string));
    const next = new Set<string>(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDashboardVisible(next);
  };
  const showAllDashboardProjects = () => persistDashboardVisible(null);

  // ─── 빠른 필터: 내가 포함된 프로젝트만 ──────────────────────────────────
  const MY_ONLY_KEY = 'wbs-dashboard-my-only';
  const [showMyOnly, setShowMyOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(MY_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleShowMyOnly = () => {
    setShowMyOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(MY_ONLY_KEY, '1');
        else localStorage.removeItem(MY_ONLY_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // ─── 빠른 필터: 즐겨찾기(관심) 프로젝트만 ───────────────────────────────
  const FAV_ONLY_KEY = 'wbs-dashboard-favorite-only';
  const [showFavoriteOnly, setShowFavoriteOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(FAV_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleShowFavoriteOnly = () => {
    setShowFavoriteOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(FAV_ONLY_KEY, '1');
        else localStorage.removeItem(FAV_ONLY_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  /** wbsSettings.favoriteProjectIds → 집합. 빠른 필터에 사용. */
  const favoriteProjectIdSet = useMemo<Set<string>>(
    () => new Set((wbsSettings.favoriteProjectIds ?? []).filter(Boolean)),
    [wbsSettings.favoriteProjectIds],
  );

  // ─── "내 프로젝트·즐겨찾기만" 단일 토글: 내가 포함된 프로젝트 ∪ 즐겨찾기 합집합 표시 ───
  const myAndFavActive = showMyOnly || showFavoriteOnly;
  const toggleMyAndFavOnly = () => {
    const next = !myAndFavActive;
    setShowMyOnly(next);
    setShowFavoriteOnly(next);
    try {
      if (next) {
        localStorage.setItem(MY_ONLY_KEY, '1');
        localStorage.setItem(FAV_ONLY_KEY, '1');
      } else {
        localStorage.removeItem(MY_ONLY_KEY);
        localStorage.removeItem(FAV_ONLY_KEY);
      }
    } catch {
      /* ignore */
    }
  };

  const [showUndeterminedPeriodProjectsOnly, setShowUndeterminedPeriodProjectsOnly] = useState(false);
  /** 프로젝트별 현황을 소속 부서(사업부)별로 묶어서 볼지 여부 */
  // 프로젝트별 현황 기본 보기: 부서별 묶기(true). 헤더의 「부서별」 토글로 평면 목록으로 전환 가능(세션 내).
  const [groupProjectsByDivision, setGroupProjectsByDivision] = useState(true);

  // 사용자 선택 + "내 프로젝트만" + "즐겨찾기만" + "기간 미정만" 토글 적용한 표시 목록.
  // 「내 프로젝트만」 + 「즐겨찾기만」이 모두 켜져 있으면 합집합(OR)으로 표시.
  const baseDisplayProjectStats = useMemo(() => {
    const base = showUndeterminedPeriodProjectsOnly ? projectStats.filter((p) => hasUndeterminedProjectPeriod(p)) : visibleProjectStats;
    if (showMyOnly || showFavoriteOnly) {
      return base.filter((p) => {
        const isMine = showMyOnly && !!myInvolvedProjectIds && myInvolvedProjectIds.has(p.id);
        const isFav = showFavoriteOnly && favoriteProjectIdSet.has(p.id);
        return isMine || isFav;
      });
    }
    if (!dashboardVisibleIds) return base;
    return base.filter((p) => dashboardVisibleIds.has(p.id));
  }, [
    visibleProjectStats,
    projectStats,
    showUndeterminedPeriodProjectsOnly,
    dashboardVisibleIds,
    showMyOnly,
    showFavoriteOnly,
    myInvolvedProjectIds,
    favoriteProjectIdSet,
  ]);

  /** 프로젝트별 상태 카드/표 행 선택 시 상세 팝업에 표시할 프로젝트 ID */
  const [selectedProjectCardId, setSelectedProjectCardId] = useState<string | null>(null);

  // ─── 대시보드 본문 블록 표시 여부(설정 → 대시보드 탭에서 변경·초기화) ───
  const [dashboardSectionVisibility, setDashboardSectionVisibility] = useState(() => readDashboardSectionVisibility());
  useEffect(() => {
    const onChange = () => setDashboardSectionVisibility(readDashboardSectionVisibility());
    window.addEventListener(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED, onChange);
    return () => window.removeEventListener(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED, onChange);
  }, []);
  const showDashSection = (id: DashboardSectionId) => dashboardSectionVisibility[id] !== false;

  const [persistedDashboardSectionLayout, setDashboardSectionLayout] = useState(() => readDashboardSectionLayout());
  const dashboardSectionLayout = useMemo(() => {
    if (mobileReadabilityMode) {
      return {
        summary: 'card',
        divisions: 'card',
        projects: 'card',
      } as DashboardSectionLayout;
    }
    return persistedDashboardSectionLayout;
  }, [mobileReadabilityMode, persistedDashboardSectionLayout]);
  useEffect(() => {
    const onChange = () => setDashboardSectionLayout(readDashboardSectionLayout());
    window.addEventListener(WBS_DASHBOARD_SECTION_LAYOUT_CHANGED, onChange);
    return () => window.removeEventListener(WBS_DASHBOARD_SECTION_LAYOUT_CHANGED, onChange);
  }, []);
  const persistDashboardSectionLayout = useCallback(
    (id: DashboardSectionId, mode: DashboardSectionLayoutMode) => {
      const next = { ...dashboardSectionLayout, [id]: mode };
      writeDashboardSectionLayout(next);
      setDashboardSectionLayout(next);
    },
    [dashboardSectionLayout],
  );

  const displayProjectStats = baseDisplayProjectStats;

  const selectedProjectCard = useMemo(
    () => (selectedProjectCardId ? displayProjectStats.find((p) => p.id === selectedProjectCardId) : undefined),
    [selectedProjectCardId, displayProjectStats],
  );

  const tasksForSelectedProjectCard = useMemo(() => {
    if (!selectedProjectCardId) return [];
    return allTasksForDashboard.filter((t) => t.projectId === selectedProjectCardId);
  }, [selectedProjectCardId, allTasksForDashboard]);

  const effortUnitForProjectCardPanel = useMemo((): 'mm' | 'md' => {
    if (typeof window === 'undefined') return 'mm';
    try {
      const v = window.localStorage.getItem('dashboard-person-allocation-effort-unit');
      if (v === 'md' || v === 'mm') return v;
    } catch {
      /* ignore */
    }
    return 'mm';
  }, [selectedProjectCardId]);

  useEffect(() => {
    if (selectedProjectCardId && !displayProjectStats.some((p) => p.id === selectedProjectCardId)) {
      setSelectedProjectCardId(null);
    }
  }, [selectedProjectCardId, displayProjectStats]);

  const summary = useMemo(
    () => ({
      totalProjects: projectsForDashboard.length,
      totalTasks: allTasksForDashboard.length,
    }),
    [projectsForDashboard, allTasksForDashboard],
  );

  /** 상단 프로젝트 목록(구분별) 개수와 달라 보일 때 — 요약은 집계 범위만 센다는 안내 */
  const projectCountSummarySubtitle = useMemo(() => {
    if (projects.length > projectsForDashboard.length) {
      return `※ 요약 집계 ${projectsForDashboard.length}개 / 이 화면에서 접근 가능 ${projects.length}개. 차이는 구분(종류) 필터·프로젝트「대시보드에 포함」해제·요약에서 제외한 프로젝트 때문일 수 있습니다.`;
    }
    if (dashboardExcludedIds.size > 0) {
      return `※ 대시보드 집계 제외 ${dashboardExcludedIds.size}개(대시보드 반영 ${projectsEligibleForDashboard.length}개 중)`;
    }
    return '';
  }, [projects.length, projectsForDashboard.length, dashboardExcludedIds.size, projectsEligibleForDashboard.length]);

  // 마일스톤 목록 (날짜순)
  const milestones = useMemo(() => {
    return allTasksForDashboard
      .filter((t) => t.isMilestone)
      .map((t) => ({
        ...t,
        projectName: (() => {
          const pm = projectMap.get(t.projectId);
          return pm ? formatProjectDisplayName(pm.name, pm.projectKind) : '-';
        })(),
      }))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }, [allTasksForDashboard, projectMap]);

  // 이슈 작업 — 대시보드 본문은 상위 50건, 상세 페이지는 전체
  const issueTasksAll = useMemo(() => {
    return allTasksForDashboard.filter((t) => t.isIssue).sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));
  }, [allTasksForDashboard]);

  const doneStatusIds = useMemo(
    () => new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id)),
    [wbsSettings.statusConfigs],
  );
  const doneStatusId = useMemo(() => wbsSettings.statusConfigs.find((c) => c.progress === 100)?.id ?? 'done', [wbsSettings.statusConfigs]);
  const todoStatusId = useMemo(() => wbsSettings.statusConfigs.find((c) => c.id === 'todo')?.id ?? 'todo', [wbsSettings.statusConfigs]);

  const isActionTaskCompleted = (t: Task) =>
    doneStatusIds.has(t.status) || (typeof t.progress === 'number' && Number.isFinite(t.progress) && t.progress >= 100);

  const ACTION_DUE_FILTER_LS_KEY = 'wbs-dashboard-action-due-filter';
  const [actionDueDateFilter, setActionDueDateFilter] = useState<ActionDueDateFilter>(() => {
    try {
      const raw = localStorage.getItem(ACTION_DUE_FILTER_LS_KEY);
      if (raw === 'today' || raw === 'thisWeek' || raw === 'overdue') return raw;
    } catch {
      /* ignore */
    }
    return 'thisWeek';
  });
  useEffect(() => {
    try {
      localStorage.setItem(ACTION_DUE_FILTER_LS_KEY, actionDueDateFilter);
    } catch {
      /* ignore */
    }
  }, [actionDueDateFilter]);

  const actionTasksWithDueDate = useMemo(() => {
    return getActionTasksWithDueDate(allTasksForDashboard).sort(sortActionTasksByEndDate);
  }, [allTasksForDashboard]);

  const actionTasksFiltered = useMemo(() => {
    return filterActionTasksByDuePeriod(actionTasksWithDueDate, actionDueDateFilter, new Date(), isActionTaskCompleted).sort(
      sortActionTasksByEndDate,
    );
  }, [actionTasksWithDueDate, actionDueDateFilter, doneStatusIds]);

  // 사업부/본부별 등록 현황: 조직도 1단계(지엠티 직속) 전 노드를 행으로 두고, 소속 프로젝트·미분류 목록을 함께 산출
  const { divisionStats, unclassifiedDashboardProjects, projectDivisionNameById } = useMemo(() => {
    const doneStatusIdsSet = new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id));
    const groupNameById = new Map((wbsSettings.projectGroups ?? []).map((g) => [g.id, (g.name || '').trim()] as const));

    const resolveDivisionId = (p: (typeof projectsForDashboard)[number]): string | undefined => {
      const inferred = inferProjectTopDivisionId(p, divisionInferCtx);
      if (inferred) return inferred;
      if (p.groupId) {
        const gname = groupNameById.get(p.groupId);
        if (gname) return departmentNameToDivisionId.get(gname);
      }
      return undefined;
    };

    const unclassified: { id: string; label: string }[] = [];
    for (const p of projectsForDashboard) {
      if (!resolveDivisionId(p)) {
        unclassified.push({ id: p.id, label: formatProjectDisplayName(p.name, p.projectKind) });
      }
    }
    unclassified.sort((a, b) => a.label.localeCompare(b.label, 'ko'));

    const divisionNameById = new Map<string, string>(topLevelDivisions.map((d) => [String(d.id), String(d.name)] as [string, string]));
    // 프로젝트 → 소속 사업부명: "사업부 현황"과 동일 분류로 프로젝트 카드에 표시
    const projectDivisionNameById = new Map<string, string>();
    const projectsByDivision = new Map<string, { id: string; label: string }[]>();
    const projectIdsByDivision = new Map<string, Set<string>>();
    for (const division of topLevelDivisions) {
      projectsByDivision.set(division.id, []);
      projectIdsByDivision.set(division.id, new Set());
    }

    for (const p of projectsForDashboard) {
      const divId = resolveDivisionId(p);
      if (!divId) continue;
      const list = projectsByDivision.get(divId);
      const idSet = projectIdsByDivision.get(divId);
      if (!list || !idSet) continue;
      idSet.add(p.id);
      list.push({ id: p.id, label: formatProjectDisplayName(p.name, p.projectKind) });
      const dn = divisionNameById.get(divId);
      if (dn) projectDivisionNameById.set(p.id, dn);
    }
    for (const list of projectsByDivision.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    }

    const stats = topLevelDivisions.map((division) => {
      const projectIds = projectIdsByDivision.get(division.id) ?? new Set<string>();
      const divisionProjects = projectsForDashboard.filter((p) => projectIds.has(p.id));
      const tasks = allTasksForDashboard.filter((t) => projectIds.has(t.projectId));
      const total = tasks.length;
      const doneCount = tasks.filter((t) => doneStatusIdsSet.has(t.status) || (typeof t.progress === 'number' && t.progress >= 100)).length;
      const issueCount = tasks.filter((t) => t.isIssue).length;
      const inProgressCount = total - doneCount;
      const assigneeSet = new Set(tasks.map((t) => (t.assignee || '').trim()).filter(Boolean));
      const progress = computeWeightedProgress(tasks);
      const plannedById = computePlannedProgressMap(tasks);
      const planned = computeWeightedPlanned(tasks, plannedById);
      const memberCount = orgMembers.filter((m) => memberToDivisionId.get(m.name) === division.id).length;
      const registeredProjects = projectsByDivision.get(division.id) ?? [];

      const assignmentNames = new Set<string>();
      for (const proj of divisionProjects) {
        for (const a of proj.assignments ?? []) {
          const n = (a.assignee ?? '').trim();
          if (n) assignmentNames.add(n);
        }
      }
      const assignmentPersonCount = assignmentNames.size;

      return {
        id: division.id,
        name: division.name,
        total,
        doneCount,
        issueCount,
        progress,
        planned,
        assigneeCount: assigneeSet.size,
        assignmentPersonCount,
        memberCount,
        inProgressCount,
        projectCount: registeredProjects.length,
        registeredProjects,
      };
    });
    const sorted = stats.sort((a, b) => {
      const actA = isActiveDivisionStat(a) ? 1 : 0;
      const actB = isActiveDivisionStat(b) ? 1 : 0;
      if (actA !== actB) return actB - actA;
      if (b.projectCount !== a.projectCount) return b.projectCount - a.projectCount;
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name, 'ko');
    });
    return { divisionStats: sorted, unclassifiedDashboardProjects: unclassified, projectDivisionNameById };
  }, [
    topLevelDivisions,
    allTasksForDashboard,
    orgMembers,
    memberToDivisionId,
    wbsSettings.statusConfigs,
    wbsSettings.projectGroups,
    projectsForDashboard,
    departmentNameToDivisionId,
    divisionInferCtx,
  ]);

  /** 프로젝트별 현황: 카드 1개 렌더 (목록·부서별 묶기에서 공통 사용) */
  const renderProjectCard = (project: (typeof displayProjectStats)[number]) => (
    <ProjectCard
      key={project.id}
      project={project}
      isSelected={selectedProjectCardId === project.id}
      onClick={() => (onNavigate ? openTableProject(project.id) : openDashboardDetail('project', { projectId: project.id }))}
      mobileReadabilityMode={mobileReadabilityMode}
      divisionName={projectDivisionNameById.get(project.id)}
      pmName={resolveProjectPmRawDisplayName(project, profileMap)}
    />
  );

  /** 부서(사업부)별로 묶은 프로젝트 현황. divisionStats 순서를 따르고 미분류는 마지막. 등록된 프로젝트가 없는 사업부도 빈 그룹으로 표시. */
  const projectStatsGroupedByDivision = useMemo(() => {
    const UNCLASSIFIED = '미분류';
    const byName = new Map<string, typeof displayProjectStats>();
    for (const p of displayProjectStats) {
      const name = projectDivisionNameById.get(p.id) || UNCLASSIFIED;
      const arr = byName.get(name);
      if (arr) arr.push(p);
      else byName.set(name, [p]);
    }
    const ordered: { name: string; projects: typeof displayProjectStats }[] = [];
    // divisionStats 순서대로 — 등록된 프로젝트가 없는 사업부도 빈 배열로 포함
    for (const ds of divisionStats) {
      const arr = byName.get(ds.name) ?? [];
      ordered.push({ name: ds.name, projects: arr });
      byName.delete(ds.name);
    }
    // divisionStats에 없는 그룹(미분류 제외) — 보통 발생하지 않지만 안전망
    for (const [name, arr] of byName) {
      if (name === UNCLASSIFIED) continue;
      ordered.push({ name, projects: arr });
    }
    const unclassified = byName.get(UNCLASSIFIED);
    if (unclassified && unclassified.length > 0) ordered.push({ name: UNCLASSIFIED, projects: unclassified });
    return ordered;
  }, [displayProjectStats, projectDivisionNameById, divisionStats]);

  // ─── 사업부 표시 필터 (사용자 선택 + 내가 포함된 부서 토글) ─────────────
  const DIVISION_VISIBLE_KEY = 'wbs-dashboard-visible-division-ids';
  const DIVISION_MY_ONLY_KEY = 'wbs-dashboard-division-my-only';
  const [divisionVisibleIds, setDivisionVisibleIds] = useState<Set<string> | null>(() => null);
  const [showMyDivisionOnly, setShowMyDivisionOnly] = useState<boolean>(false);
  const [isDivisionPickerOpen, setIsDivisionPickerOpen] = useState(false);
  const divisionPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isDivisionPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (divisionPickerRef.current && !divisionPickerRef.current.contains(e.target as Node)) {
        setIsDivisionPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDivisionPickerOpen]);

  const persistDivisionVisible = (next: Set<string> | null) => {
    if (next === null) localStorage.removeItem(DIVISION_VISIBLE_KEY);
    else localStorage.setItem(DIVISION_VISIBLE_KEY, JSON.stringify(Array.from(next)));
    setDivisionVisibleIds(next);
  };
  const toggleDivision = (id: string) => {
    const base: Set<string> = divisionVisibleIds ?? new Set<string>(divisionStats.map((d) => d.id));
    const next = new Set<string>(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDivisionVisible(next);
  };
  const showAllDivisions = () => persistDivisionVisible(null);
  const toggleShowMyDivisionOnly = () => {
    setShowMyDivisionOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(DIVISION_MY_ONLY_KEY, '1');
        else localStorage.removeItem(DIVISION_MY_ONLY_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  /** 구분·부서·프로젝트·집계 제외·빠른 필터를 한 번에 기본(전체 표시)으로 되돌림 */
  const resetAllDashboardDisplayFilters = useCallback(() => {
    persistDashboardIncludedKinds(new Set(PROJECT_KINDS));
    persistDashboardExcluded(new Set());
    persistDashboardVisible(null);
    try {
      localStorage.removeItem(MY_ONLY_KEY);
      localStorage.removeItem(FAV_ONLY_KEY);
    } catch {
      /* ignore */
    }
    setShowMyOnly(false);
    setShowFavoriteOnly(false);
    setShowUndeterminedPeriodProjectsOnly(false);
    persistDivisionVisible(null);
    try {
      localStorage.removeItem(DIVISION_MY_ONLY_KEY);
    } catch {
      /* ignore */
    }
    setShowMyDivisionOnly(false);
    setIsDivisionPickerOpen(false);
    setIsProjectPickerOpen(false);
    setIsExclusionPickerOpen(false);
    pushToast('대시보드 표시 필터를 초기화했습니다.', { variant: 'success' });
  }, [
    persistDashboardIncludedKinds,
    persistDashboardExcluded,
    persistDashboardVisible,
    MY_ONLY_KEY,
    persistDivisionVisible,
    DIVISION_MY_ONLY_KEY,
    pushToast,
  ]);

  // 현재 사용자가 속한 부서 ID (organizationMembers의 이름 매칭)
  const myDivisionId = useMemo(() => {
    const name = (currentUserDisplay || '').trim();
    if (!name) return undefined;
    return memberToDivisionId.get(name);
  }, [currentUserDisplay, memberToDivisionId]);

  const divisionStatsAfterVisibility = useMemo(() => {
    if (showMyDivisionOnly) {
      if (!myDivisionId) return [];
      return divisionStats.filter((d) => d.id === myDivisionId);
    }
    if (!divisionVisibleIds) return divisionStats;
    return divisionStats.filter((d) => divisionVisibleIds.has(d.id));
  }, [divisionStats, divisionVisibleIds, showMyDivisionOnly, myDivisionId]);

  // 사용자 선택 + "내 부서만" 토글 적용한 최종 표시 부서 목록.
  const displayDivisionStats = divisionStatsAfterVisibility;

  /** 카드 뷰 분리: 프로젝트·작업이 있는 사업부만 카드로, 0투성이(미등록) 조직은 접이식 칩 묶음으로 */
  const activeDivisionCards = useMemo(() => displayDivisionStats.filter((d) => d.projectCount > 0 || d.total > 0), [displayDivisionStats]);
  const emptyDivisionCards = useMemo(
    () => displayDivisionStats.filter((d) => d.projectCount === 0 && d.total === 0),
    [displayDivisionStats],
  );

  /** 현재 카드·표에 나오는 사업부 기준 합계(프로젝트·Task는 사업부 간 중복 없음) */
  const divisionAggregatedSummary = useMemo(() => {
    let projectSum = 0;
    let taskSum = 0;
    let wProg = 0;
    let wPlanned = 0;
    for (const d of displayDivisionStats) {
      projectSum += d.projectCount;
      taskSum += d.total;
      wProg += d.progress * d.total;
      wPlanned += d.planned * d.total;
    }
    const tableProgress = taskSum > 0 ? Math.min(100, Math.max(0, Math.round(wProg / taskSum))) : 0;
    const tablePlanned = taskSum > 0 ? Math.min(100, Math.max(0, Math.round(wPlanned / taskSum))) : 0;
    return {
      projectSum,
      taskSum,
      tableProgress,
      tablePlanned,
    };
  }, [displayDivisionStats]);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const divisionDetailIdRaw = searchParams.get('division');
  const divisionDetailId = divisionDetailIdRaw && divisionDetailIdRaw.trim() ? divisionDetailIdRaw.trim() : null;
  const detailParamRaw = searchParams.get('detail');
  const detailKind: DashboardDetailKind | null =
    detailParamRaw && DASHBOARD_DETAIL_KINDS.has(detailParamRaw as DashboardDetailKind) ? (detailParamRaw as DashboardDetailKind) : null;
  const detailProjectIdRaw = searchParams.get('projectId');
  const detailProjectId = detailProjectIdRaw && detailProjectIdRaw.trim() ? detailProjectIdRaw.trim() : null;

  const clearDashboardDetailParams = useCallback(() => {
    navigate('/dashboard', { replace: true });
  }, [navigate]);

  const openDashboardDetail = useCallback(
    (kind: DashboardDetailKind, extra?: { projectId?: string }) => {
      const sp = new URLSearchParams();
      sp.set('detail', kind);
      if (extra?.projectId) sp.set('projectId', extra.projectId);
      navigate({ pathname: '/dashboard', search: sp.toString() });
    },
    [navigate],
  );

  const clearDivisionDetail = useCallback(() => {
    clearDashboardDetailParams();
  }, [clearDashboardDetailParams]);

  const openDivisionDetail = useCallback(
    (id: string) => {
      navigate({ pathname: '/dashboard', search: `?division=${encodeURIComponent(id)}` });
    },
    [navigate],
  );

  const groupNameByProjectGroupId = useMemo(
    () => new Map((wbsSettings.projectGroups ?? []).map((g) => [g.id, (g.name || '').trim()] as const)),
    [wbsSettings.projectGroups],
  );

  const divisionDetailStat = useMemo(
    () => (divisionDetailId ? divisionStats.find((d) => d.id === divisionDetailId) : undefined),
    [divisionDetailId, divisionStats],
  );

  const divisionDetailProjects = useMemo(() => {
    if (!divisionDetailId) return [];
    const groupNameById = new Map((wbsSettings.projectGroups ?? []).map((g) => [g.id, (g.name || '').trim()] as const));
    return projectsForDashboard.filter((p) => {
      const inferred = inferProjectTopDivisionId(p, divisionInferCtx);
      if (inferred === divisionDetailId) return true;
      if (p.groupId) {
        const gname = groupNameById.get(p.groupId);
        if (gname && departmentNameToDivisionId.get(gname) === divisionDetailId) return true;
      }
      return false;
    });
  }, [divisionDetailId, projectsForDashboard, divisionInferCtx, wbsSettings.projectGroups, departmentNameToDivisionId]);

  const divisionDetailProjectIdSet = useMemo(() => new Set(divisionDetailProjects.map((p) => p.id)), [divisionDetailProjects]);

  const divisionDetailTasks = useMemo(() => {
    if (!divisionDetailId) return [];
    return allTasksForDashboard
      .filter((t) => divisionDetailProjectIdSet.has(t.projectId))
      .sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));
  }, [allTasksForDashboard, divisionDetailProjectIdSet]);

  const divisionDetailMembers = useMemo(() => {
    if (!divisionDetailId) return [];
    return sortOrgMembersByPosition(orgMembers.filter((m) => memberToDivisionId.get(m.name) === divisionDetailId));
  }, [divisionDetailId, orgMembers, memberToDivisionId]);

  const divisionProjectTaskCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of divisionDetailTasks) {
      m[t.projectId] = (m[t.projectId] ?? 0) + 1;
    }
    return m;
  }, [divisionDetailTasks]);

  // Visitor tracking: DB 기반 (Supabase)
  const { user } = useAuth();
  const [visitorStats, setVisitorStats] = React.useState({ daily: 0, total: 0 });
  const [loadingVisitorStats, setLoadingVisitorStats] = React.useState(false);
  const [memberCount, setMemberCount] = React.useState(0);
  const [loadingMemberCount, setLoadingMemberCount] = React.useState(false);

  React.useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !user) {
      setVisitorStats({ daily: 0, total: 0 });
      setLoadingVisitorStats(false);
      setMemberCount(0);
      setLoadingMemberCount(false);
      return;
    }

    const run = async () => {
      setLoadingVisitorStats(true);
      setLoadingMemberCount(true);
      // 세션당 하루 1회만 기록
      let sessionId = sessionStorage.getItem('wbs-visit-session-id');
      if (!sessionId) {
        sessionId = randomUUID();
        sessionStorage.setItem('wbs-visit-session-id', sessionId);
      }

      try {
        await supabase.rpc('record_visit', { p_session_id: sessionId });
      } catch {
        // 무시 (이미 기록된 경우 등)
      }

      try {
        const [stats, count] = await Promise.all([getVisitorStats(), getRegisteredMemberCount()]);
        setVisitorStats(stats);
        setMemberCount(count);
      } catch {
        setVisitorStats({ daily: 0, total: 0 });
        setMemberCount(0);
      } finally {
        setLoadingVisitorStats(false);
        setLoadingMemberCount(false);
      }
    };

    run();
  }, [user?.id]);

  const dashboardFiltersActive =
    showMyOnly ||
    showFavoriteOnly ||
    showMyDivisionOnly ||
    dashboardVisibleIds !== null ||
    divisionVisibleIds !== null ||
    dashboardExcludedIds.size > 0 ||
    dashboardKindsFilterActive;
  /** 상단 '필터 초기화' 버튼 활성화: 표시 범위·기간 미정만 등 */
  const canResetDashboardDisplayFilters = dashboardFiltersActive || showUndeterminedPeriodProjectsOnly;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wbs-dashboard-filters-active', { detail: { active: dashboardFiltersActive } }));
  }, [dashboardFiltersActive]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('wbs-dashboard-filters-active', { detail: { active: false } }));
    };
  }, []);

  const runProjectRegistrationPdfExport = useCallback(async () => {
    const rows = [...projectStats].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
    const subtitleLines: string[] = [];
    if (dashboardExcludedIds.size > 0) {
      subtitleLines.push(
        `집계에서 제외된 프로젝트 ${dashboardExcludedIds.size}개는 목록·합계에서 제외된 상태입니다. (전체 ${projects.length}개 중)`,
      );
    }
    if (dashboardFiltersActive) {
      subtitleLines.push('대시보드 상단 필터가 적용된 표시 범위입니다.');
    }
    await downloadProjectRegistrationPdfReport({
      rows,
      subtitleLines,
      profileMap,
      orgTree,
      orgMembers,
      ownerDepartmentByUserId,
    });
    pushToast('프로젝트 등록현황 PDF를 저장했습니다.', { variant: 'success' });
  }, [
    projectStats,
    dashboardExcludedIds,
    projects.length,
    dashboardFiltersActive,
    pushToast,
    profileMap,
    orgTree,
    orgMembers,
    ownerDepartmentByUserId,
  ]);

  useEffect(() => {
    if (!projectRegistrationPdfRef) return;
    projectRegistrationPdfRef.current = async () => {
      try {
        await runProjectRegistrationPdfExport();
      } catch (e) {
        console.error(e);
        pushToast('PDF 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.', { variant: 'error' });
      }
    };
    return () => {
      projectRegistrationPdfRef.current = null;
    };
  }, [projectRegistrationPdfRef, runProjectRegistrationPdfExport, pushToast]);

  useEffect(() => {
    if (!projectRegistrationPdfRef) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('wbs-pending-project-registration-pdf') === '1';
    } catch {
      /* ignore */
    }
    if (!pending) return;
    try {
      sessionStorage.removeItem('wbs-pending-project-registration-pdf');
    } catch {
      /* ignore */
    }
    const run = projectRegistrationPdfRef.current;
    if (run) void run();
  }, [projectRegistrationPdfRef]);

  /** 구분·부서·집계 제외 등 — 기본은 접어 두고, 해당 옵션이 켜지면 자동으로 펼침 */
  const dashboardAdvancedFiltersActive =
    dashboardKindsFilterActive || showMyDivisionOnly || divisionVisibleIds !== null || dashboardExcludedIds.size > 0;
  // 고급(구분·부서·집계 제외) 툴바는 제거됨 — 항상 접힌 상태로 두어 아래 조건부 블록이 렌더되지 않게 한다.
  const [showAdvancedDashboardToolbar] = useState(false);

  /** 렌더 시점에는 형제인 #dashboard-filter-toolbar-host 가 아직 DOM에 없을 수 있어, 커밋 직후에 포털 대상을 잡는다. */
  const [dashboardToolbarHost, setDashboardToolbarHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setDashboardToolbarHost(document.getElementById('dashboard-filter-toolbar-host'));
    return () => setDashboardToolbarHost(null);
  }, []);

  const dashboardFiltersToolbar =
    dashboardToolbarHost &&
    createPortal(
      <div className="flex flex-col items-stretch gap-3 w-full">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">대시보드 표시</span>
          <button
            type="button"
            onClick={toggleMyAndFavOnly}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
              myAndFavActive
                ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
            aria-pressed={myAndFavActive}
            title="내가 포함된 프로젝트(소유자·멤버·담당자) 또는 즐겨찾기(★)한 프로젝트만 표시합니다. 다시 누르면 전체 표시."
          >
            <User size={13} aria-hidden />
            <span aria-hidden className={cn('text-[12px] leading-none', myAndFavActive ? 'text-amber-300' : 'text-amber-500')}>
              ★
            </span>
            내 프로젝트·즐겨찾기만
            {myAndFavActive && <Check size={11} strokeWidth={3} aria-hidden />}
          </button>
        </div>

        {showAdvancedDashboardToolbar ? (
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 w-full">
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50/70 border border-slate-200/70 px-2 py-1.5">
              <span
                className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0"
                title="체크한 구분의 프로젝트만 대시보드 요약·집계·카드·부서·투입에 반영됩니다."
              >
                구분
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {PROJECT_KINDS.map((kind) => {
                  const on = dashboardIncludedKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => toggleDashboardIncludedKind(kind)}
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors',
                        on
                          ? 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700'
                          : 'bg-white border-slate-200 text-slate-400 line-through hover:bg-slate-50',
                      )}
                      title={on ? '클릭하여 이 구분을 집계에서 제외' : '클릭하여 이 구분을 집계에 포함'}
                      aria-pressed={on}
                    >
                      {kind}
                    </button>
                  );
                })}
                {dashboardKindsFilterActive && (
                  <button
                    type="button"
                    onClick={selectAllDashboardKinds}
                    className="text-[11px] text-violet-700 hover:text-violet-900 font-medium px-1.5"
                    title="모든 구분을 집계에 포함"
                  >
                    전체
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50/70 border border-slate-200/70 px-2 py-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0" title="사업부별 등록 프로젝트 현황">
                사업부
              </span>
              {currentUserDisplay && (
                <button
                  type="button"
                  onClick={toggleShowMyDivisionOnly}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors',
                    showMyDivisionOnly
                      ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                  )}
                  title={myDivisionId ? '내가 소속된 부서만 표시' : '조직도에서 본인 매칭 안 됨'}
                  aria-pressed={showMyDivisionOnly}
                  disabled={!myDivisionId}
                >
                  <User size={12} />
                  내가 포함된 부서만
                  {showMyDivisionOnly && <Check size={11} strokeWidth={3} />}
                </button>
              )}
              <div className="relative" ref={divisionPickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsDivisionPickerOpen((v) => !v);
                    setIsProjectPickerOpen(false);
                    setIsExclusionPickerOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                  title="대시보드에 표시할 부서 선택"
                >
                  <Settings2 size={12} />
                  필터
                  {divisionVisibleIds && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold">
                      {divisionVisibleIds.size}
                    </span>
                  )}
                </button>
                {isDivisionPickerOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-72 max-h-[60vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-[60] p-2">
                    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-slate-100 mb-1">
                      <span className="text-[11px] font-bold text-slate-500 uppercase whitespace-nowrap">표시할 부서</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => persistDivisionVisible(new Set(divisionStats.map((d) => d.id)))}
                          className="text-[11px] text-sky-600 hover:text-sky-800 font-medium"
                          title="모든 부서 선택"
                        >
                          모두 선택
                        </button>
                        <button
                          type="button"
                          onClick={() => persistDivisionVisible(new Set())}
                          className="text-[11px] text-slate-500 hover:text-slate-700 font-medium"
                          title="모든 부서 해제"
                        >
                          모두 해제
                        </button>
                      </div>
                    </div>
                    {divisionStats.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400 text-center">표시 가능한 부서가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {divisionStats.map((d) => {
                          const checked = divisionVisibleIds === null ? true : divisionVisibleIds.has(d.id);
                          return (
                            <li key={d.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border',
                                    checked ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 bg-white',
                                  )}
                                >
                                  {checked && <Check size={11} strokeWidth={3} />}
                                </span>
                                <input type="checkbox" checked={checked} onChange={() => toggleDivision(d.id)} className="sr-only" />
                                <span className="text-sm text-slate-700 truncate" title={d.name}>
                                  {d.name}
                                </span>
                                <span
                                  className="ml-auto text-[10px] text-slate-400 shrink-0 tabular-nums max-w-[10rem] truncate text-right"
                                  title={
                                    d.registeredProjects.length > 0
                                      ? d.registeredProjects.map((r) => r.label).join('\n')
                                      : `프로젝트 ${d.projectCount} · Task ${d.total} · 투입 ${d.assignmentPersonCount}`
                                  }
                                >
                                  P{d.projectCount} · T{d.total} · 투{d.assignmentPersonCount}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="px-2 pt-2 mt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={showAllDivisions}
                        className="w-full text-[11px] text-slate-500 hover:text-sky-700 font-medium py-1"
                        title="필터 해제 (기본 상태로)"
                      >
                        필터 초기화 (기본)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50/70 border border-slate-200/70 px-2 py-1.5">
              <span
                className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0"
                title="요약 숫자·부서별 집계·이슈·액션·마일스톤·투입 현황·프로젝트 카드에서 제외"
              >
                집계 제외
              </span>
              <div className="relative" ref={exclusionPickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsExclusionPickerOpen((v) => !v);
                    setIsProjectPickerOpen(false);
                    setIsDivisionPickerOpen(false);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors',
                    dashboardExcludedIds.size > 0
                      ? 'border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200/90'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600',
                  )}
                  title="대시보드 집계에서 뺄 프로젝트 선택 (이 브라우저에만 저장)"
                >
                  <Ban size={12} className="shrink-0" />
                  프로젝트 선택
                  {dashboardExcludedIds.size > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold tabular-nums">
                      {dashboardExcludedIds.size}
                    </span>
                  )}
                </button>
                {isExclusionPickerOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-80 max-h-[60vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-[60] p-2">
                    <p className="px-2 pb-2 text-[11px] text-slate-500 leading-snug border-b border-slate-100 mb-1">
                      체크한 프로젝트는 대시보드 요약·목록·카드·부서 집계·투입 현황에 포함되지 않습니다. (표시 필터와 별개, 이 기기에만
                      저장)
                    </p>
                    <div className="flex items-center justify-end gap-2 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => clearDashboardExcluded()}
                        className="text-[11px] text-amber-700 hover:text-amber-900 font-medium"
                        title="집계 제외 목록 비우기"
                      >
                        제외 전체 해제
                      </button>
                    </div>
                    {projectsForExclusionPicker.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400 text-center">프로젝트가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {projectsForExclusionPicker.map((p) => {
                          const excluded = dashboardExcludedIds.has(p.id);
                          return (
                            <li key={p.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border shrink-0',
                                    excluded ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 bg-white',
                                  )}
                                >
                                  {excluded && <Check size={11} strokeWidth={3} />}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={excluded}
                                  onChange={() => toggleDashboardExcluded(p.id)}
                                  className="sr-only"
                                />
                                <span
                                  className="text-sm text-slate-700 break-words min-w-0"
                                  title={formatProjectDisplayName(p.name, p.projectKind)}
                                >
                                  {formatProjectDisplayName(p.name, p.projectKind)}
                                </span>
                                <span className="ml-auto text-[10px] text-amber-700/80 shrink-0 font-medium whitespace-nowrap">
                                  {excluded ? '집계 제외' : ''}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>,
      dashboardToolbarHost,
    );

  const openTableAll = useCallback(() => {
    onNavigate?.('table', { projectId: 'all', status: 'all', assignee: '' });
  }, [onNavigate]);
  const openTableProject = useCallback(
    (projectId: string) => {
      // 카드 클릭 시 기본 표+간트(tablegantt) 뷰로 이동. (요청: 표만 보지 말고 간트도 같이)
      onNavigate?.('tablegantt', { projectId, status: 'all', assignee: '' });
    },
    [onNavigate],
  );

  const openAllocationOverview = useCallback(() => {
    onNavigate?.('allocation', { projectId: 'all', status: 'all', assignee: '' });
  }, [onNavigate]);

  useEffect(() => {
    if (detailKind || divisionDetailId) {
      setSelectedProjectCardId(null);
    }
  }, [detailKind, divisionDetailId]);

  return (
    <>
      {!divisionDetailId && !detailKind && dashboardFiltersToolbar}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-[var(--color-bg)] p-3 pb-6 sm:p-4 md:p-5">
        {divisionDetailId ? (
          <div
            className={cn(
              'max-w-[min(100%,96rem)] mx-auto p-3 pb-6 sm:p-4 md:p-5 animate-in fade-in slide-in-from-bottom-4 duration-500',
              mobileReadabilityMode ? 'space-y-6' : 'space-y-8',
            )}
          >
            {divisionDetailStat ? (
              <DashboardDivisionDetail
                stats={divisionDetailStat}
                members={divisionDetailMembers}
                projects={divisionDetailProjects}
                tasks={divisionDetailTasks}
                projectMap={projectMap}
                projectTaskCounts={divisionProjectTaskCounts}
                wbsSettings={wbsSettings}
                assigneeDisplayMetaByName={assigneeDisplayMetaByName}
                onBack={clearDivisionDetail}
                onOpenProjectTasks={(projectId) => {
                  onNavigate?.('tablegantt', { projectId, status: 'all', assignee: '' });
                }}
                onOpenAllocationForDivision={
                  onNavigate
                    ? () => {
                        clearDivisionDetail();
                        openAllocationOverview();
                      }
                    : undefined
                }
                mobileReadabilityMode={mobileReadabilityMode}
              />
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-4">
                <p className="text-slate-600">요청한 사업부를 찾을 수 없습니다.</p>
                <button
                  type="button"
                  onClick={clearDivisionDetail}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  사업부 현황으로 돌아가기
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              className={cn(
                'max-w-[min(100%,96rem)] mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500',
                mobileReadabilityMode ? 'space-y-5' : 'space-y-5 md:space-y-7',
              )}
            >
              {mobileReadabilityMode && (
                <div
                  role="status"
                  className="rounded-xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-950 leading-relaxed"
                >
                  모바일 화면에서는 <strong className="font-semibold">요약 대시보드</strong>만 표시됩니다. 작업 표·간트·칸반 편집은 PC(가로
                  넓은 화면)에서 이용해 주세요.
                </div>
              )}
              {/* Header Summary */}
              {showDashSection('summary') && (
                <section>
                  <div className={cn('flex flex-wrap items-center justify-between gap-2 mb-3', mobileReadabilityMode && 'mb-2.5')}>
                    <h2
                      className={cn(
                        'font-bold text-[var(--color-ink)] flex items-center gap-2.5 m-0',
                        mobileReadabilityMode ? 'text-lg' : 'text-lg md:text-xl',
                      )}
                    >
                      <span className="inline-flex items-center justify-center size-8 rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 shadow-sm shrink-0">
                        <LayoutGrid size={mobileReadabilityMode ? 20 : 18} />
                      </span>
                      전체현황
                    </h2>
                  </div>
                  {dashboardSectionLayout.summary === 'card' ? (
                    <DashboardHeroBand
                      totalProjects={summary.totalProjects}
                      totalTasks={summary.totalTasks}
                      memberCount={memberCount}
                      loadingMemberCount={loadingMemberCount}
                      visitorStats={visitorStats}
                      loadingVisitorStats={loadingVisitorStats}
                      projectCountSubtitle={projectCountSummarySubtitle}
                      excludedCount={dashboardExcludedIds.size}
                      mobileReadabilityMode={mobileReadabilityMode}
                      onOpenDetail={openDashboardDetail}
                    />
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-2">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr className="text-xs text-slate-500">
                            <th className="text-left font-medium px-3 py-2.5">항목</th>
                            <th className="text-left font-medium px-3 py-2.5">값</th>
                            <th className="text-left font-medium px-3 py-2.5 min-w-[40%]">비고</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                            onClick={() => openDashboardDetail('projects')}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">등록된 프로젝트 수</td>
                            <td className="px-3 py-2.5 tabular-nums font-bold text-[var(--color-ink)]">{summary.totalProjects}</td>
                            <DashboardTableHintCell text={projectCountSummarySubtitle} />
                          </tr>
                          <tr
                            className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                            onClick={() => openDashboardDetail('tasks')}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">등록된 총 작업 수</td>
                            <td className="px-3 py-2.5 tabular-nums font-bold text-[var(--color-ink)]">{summary.totalTasks}</td>
                            <DashboardTableHintCell
                              text={dashboardExcludedIds.size > 0 ? '※ 제외된 프로젝트의 작업은 합계에 포함되지 않음' : ''}
                            />
                          </tr>
                          <tr
                            className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                            onClick={() => openDashboardDetail('members')}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">회원가입자 수</td>
                            <td className="px-3 py-2.5 font-bold text-violet-600 tabular-nums">
                              {loadingMemberCount ? <Loader2 size={14} className="animate-spin text-slate-400" /> : memberCount}
                            </td>
                            <DashboardTableHintCell text="클릭하여 명단·상세" />
                          </tr>
                          <tr
                            className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                            onClick={() => openDashboardDetail('visitors')}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-700 whitespace-nowrap">접속자수</td>
                            <td className="px-3 py-2.5 text-slate-800">
                              {loadingVisitorStats ? (
                                <Loader2 size={14} className="animate-spin text-slate-400" />
                              ) : (
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
                                  <span>
                                    <span className="text-[10px] font-medium text-slate-400 mr-1">금일</span>
                                    <span className="font-bold text-indigo-600">{visitorStats.daily}</span>
                                  </span>
                                  <span>
                                    <span className="text-[10px] font-medium text-slate-400 mr-1">누적</span>
                                    <span className="font-bold text-purple-600">{visitorStats.total}</span>
                                  </span>
                                </div>
                              )}
                            </td>
                            <DashboardTableHintCell text="클릭하여 금일 명단·상세" />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* 업무 협조 요청 — 전체현황 바로 아래 */}
              {showDashSection('cooperation') && <CooperationRequestSection mobileReadabilityMode={mobileReadabilityMode} />}

              {/* 사업부 현황 */}
              {showDashSection('divisions') && (
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h2 className="text-lg md:text-xl font-bold text-[var(--color-ink)] flex items-center gap-2.5 flex-wrap m-0">
                      <span
                        className="inline-flex items-center justify-center size-8 rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100 shadow-sm shrink-0"
                        aria-hidden
                      >
                        <Building2 size={18} />
                      </span>
                      사업부 현황
                      <span className="ml-2 inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-800 shrink-0">
                        조직도 기준
                      </span>
                      <span className="text-sm font-normal text-slate-500 ml-1">
                        ({displayDivisionStats.length}
                        {(divisionVisibleIds || showMyDivisionOnly) && divisionStats.length !== divisionStatsAfterVisibility.length
                          ? ` / ${divisionStats.length}`
                          : ''}
                        개)
                      </span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!mobileReadabilityMode && (
                        <div
                          className="inline-flex gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0"
                          role="group"
                          aria-label="사업부별 등록 프로젝트 현황 표 또는 카드 보기"
                        >
                          <button
                            type="button"
                            onClick={() => persistDashboardSectionLayout('divisions', 'table')}
                            className={cn(
                              'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                              dashboardSectionLayout.divisions === 'table' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-50',
                            )}
                            title="표로 보기"
                          >
                            <Table2 size={12} aria-hidden />표
                          </button>
                          <button
                            type="button"
                            onClick={() => persistDashboardSectionLayout('divisions', 'card')}
                            className={cn(
                              'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                              dashboardSectionLayout.divisions === 'card' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-50',
                            )}
                            title="카드로 보기"
                          >
                            <LayoutGrid size={12} aria-hidden />
                            카드
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <details className="mb-2 group/divhint">
                    <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
                      <CircleHelp size={13} className="shrink-0 opacity-70" aria-hidden />
                      조직·집계 기준 안내
                    </summary>
                    <div className="mt-1.5 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 text-xs text-slate-600 leading-relaxed space-y-1.5">
                      <p className="m-0">
                        <span className="font-semibold text-slate-800">회사 직속 하위 조직(본부·사업부·실 등) 전체</span>를 한 행씩 보여
                        줍니다. PM·PO·소유자 부서·그룹명으로 사업부를 찾지 못한 조직은 프로젝트 0으로 표시되고, 합계는{' '}
                        <strong className="text-slate-800">표시 중인 행만</strong> 더합니다.
                      </p>
                      <p className="m-0">
                        카드(또는 표 행)를 누르면 사업부 상세, <strong className="text-slate-800">프로젝트 이름</strong>을 누르면 해당 WBS
                        표로 이동합니다.
                      </p>
                    </div>
                  </details>
                  {displayDivisionStats.length > 0 && (
                    <div
                      className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-2"
                      role="region"
                      aria-label="표시 중인 사업부 합계"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 shrink-0">표시 중 합계</span>
                      <span className="inline-flex items-baseline gap-1">
                        <span className="text-xs text-slate-500">분류된 프로젝트</span>
                        <strong className="text-base font-bold tabular-nums text-sky-700">{divisionAggregatedSummary.projectSum}</strong>
                        <span className="text-[11px] text-slate-400">건</span>
                      </span>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <span className="inline-flex items-baseline gap-1">
                        <span className="text-xs text-slate-500">등록 Task</span>
                        <strong className="text-base font-bold tabular-nums text-slate-800">{divisionAggregatedSummary.taskSum}</strong>
                        <span className="text-[11px] text-slate-400">건</span>
                      </span>
                      {unclassifiedDashboardProjects.length > 0 && (
                        <span className="text-[11px] text-amber-700/90 sm:ml-auto">
                          ※ 미분류 {unclassifiedDashboardProjects.length}건 미포함
                        </span>
                      )}
                    </div>
                  )}
                  {unclassifiedDashboardProjects.length > 0 && (
                    <details className="mb-2 rounded-lg border border-amber-200 bg-amber-50/90 text-amber-950 shadow-sm group/uncls">
                      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold flex items-center gap-1.5 select-none [&::-webkit-details-marker]:hidden">
                        <ChevronDown
                          size={16}
                          className="shrink-0 opacity-70 group-open/uncls:rotate-180 transition-transform"
                          aria-hidden
                        />
                        사업부 미분류 프로젝트 ({unclassifiedDashboardProjects.length}건)
                      </summary>
                      <div className="px-3 pb-2 pt-0 border-t border-amber-100/80">
                        <p className="mt-2 mb-2 m-0 text-xs text-amber-900/90 leading-relaxed">
                          PM·PO·소유자 부서 문자열이 조직도와 맞지 않거나, 프로젝트 그룹명으로도 사업부를 찾지 못한 경우입니다.
                        </p>
                        <ul className="m-0 max-h-28 overflow-y-auto space-y-0.5 text-xs font-medium leading-snug pl-4 list-disc marker:text-amber-700">
                          {unclassifiedDashboardProjects.slice(0, 24).map((p) => (
                            <li key={p.id} className="break-words">
                              {onNavigate ? (
                                <button
                                  type="button"
                                  className="text-left w-full font-medium text-amber-950 hover:text-teal-800 hover:underline rounded px-0.5 -mx-0.5"
                                  onClick={() => openTableProject(p.id)}
                                  title="해당 프로젝트 WBS 작업 표로 이동"
                                >
                                  {p.label}
                                </button>
                              ) : (
                                <span title={p.label}>{p.label}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                        {unclassifiedDashboardProjects.length > 24 && (
                          <p className="mt-1.5 mb-0 text-[11px] text-amber-900/80">외 {unclassifiedDashboardProjects.length - 24}건</p>
                        )}
                      </div>
                    </details>
                  )}
                  {displayDivisionStats.length === 0 ? (
                    <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
                      {divisionStats.length === 0
                        ? '조직도 데이터를 불러오는 중이거나 매칭되는 부서가 없습니다.'
                        : showMyDivisionOnly
                          ? '내가 포함된 부서가 조직도에서 매칭되지 않습니다. 토글을 해제하세요.'
                          : '상단의 대시보드 표시에서 부서를 선택하세요. (또는 필터 초기화)'}
                    </div>
                  ) : dashboardSectionLayout.divisions === 'card' ? (
                    <>
                      <div
                        className={cn(
                          'grid gap-2',
                          mobileReadabilityMode
                            ? 'grid-cols-1'
                            : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
                        )}
                      >
                        {activeDivisionCards.map((d) => (
                          <div key={d.id} className="relative group">
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => openDivisionDetail(d.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openDivisionDetail(d.id);
                                }
                              }}
                              className={cn(
                                'rounded-lg p-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 border h-full',
                                d.projectCount === 0
                                  ? 'border-dashed border-slate-300 bg-slate-50/60 hover:border-slate-400'
                                  : 'bg-white border-slate-200 hover:border-indigo-200/80',
                              )}
                              title={
                                d.registeredProjects.length > 0
                                  ? `클릭하여 상세 · 프로젝트 ${d.registeredProjects.length}건(목록은 카드 위에 마우스)`
                                  : '클릭하여 사업부 상세 보기'
                              }
                            >
                              <h3
                                className="font-semibold text-slate-900 text-sm mb-2 flex items-center gap-1.5 flex-wrap min-w-0"
                                title={d.name}
                              >
                                <Building2 className="text-sky-500 shrink-0" size={16} aria-hidden />
                                <span className="truncate min-w-0 leading-tight">{d.name}</span>
                                {d.projectCount === 0 && (
                                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide rounded bg-slate-200/90 text-slate-700 px-1 py-0.5">
                                    미등록
                                  </span>
                                )}
                              </h3>
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-1.5">
                                  <div className="rounded-lg border border-sky-200/80 bg-sky-50/90 px-2 py-2 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-sky-900 tracking-wide">프로젝트</div>
                                    <div className="text-2xl font-bold text-sky-700 tabular-nums leading-none mt-0.5">{d.projectCount}</div>
                                    <div className="text-[9px] font-medium text-sky-800/80 mt-0.5">건</div>
                                  </div>
                                  <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-2 py-2 text-center shadow-sm">
                                    <div className="text-[10px] font-bold text-slate-900 tracking-wide">Task</div>
                                    <div className="text-2xl font-bold text-slate-800 tabular-nums leading-none mt-0.5">{d.total}</div>
                                    <div className="text-[9px] font-medium text-slate-700/85 mt-0.5">건</div>
                                  </div>
                                </div>
                                {d.projectCount === 0 && (
                                  <p className="text-[10px] text-slate-500 m-0 text-center leading-snug">
                                    이 조직으로 분류된 프로젝트가 없습니다.
                                  </p>
                                )}
                                <div>
                                  <div className="flex items-baseline justify-between gap-1 mb-0.5">
                                    <span
                                      className="text-[9px] font-bold text-slate-500 uppercase tracking-wide cursor-help"
                                      title="계획율은 소속 프로젝트의 시작일·종료일 기준으로 자동 산정됩니다 (직접 입력 아님). 날짜를 수정하면 바뀝니다."
                                    >
                                      계획율
                                    </span>
                                    <span className="text-base font-bold text-amber-700 tabular-nums leading-none">
                                      {formatPercent1(d.planned)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-amber-400 to-amber-500"
                                      style={{ width: `${Math.min(100, d.planned)}%` }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-baseline justify-between gap-1 mb-0.5">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">진척율</span>
                                    <span className="text-base font-bold text-indigo-600 tabular-nums leading-none">
                                      {formatPercent1(d.progress)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                                      style={{ width: `${Math.min(100, d.progress)}%` }}
                                    />
                                  </div>
                                </div>
                                {mobileReadabilityMode && d.registeredProjects.length > 0 && (
                                  <details className="rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5 text-left">
                                    <summary className="text-[11px] font-semibold text-slate-600 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                                      프로젝트 이름 ({d.registeredProjects.length}건) — 탭하여 펼치기
                                    </summary>
                                    <ul className="mt-2 space-y-0.5 text-[11px] font-medium text-slate-800 leading-snug m-0 pl-3 list-disc max-h-40 overflow-y-auto">
                                      {d.registeredProjects.map((rp) => (
                                        <li key={rp.id} className="break-words">
                                          {onNavigate ? (
                                            <button
                                              type="button"
                                              className="text-left w-full font-medium text-slate-800 hover:text-teal-800 hover:underline rounded px-0.5 -mx-0.5"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openTableProject(rp.id);
                                              }}
                                              title="해당 프로젝트 WBS 작업 표로 이동"
                                            >
                                              {rp.label}
                                            </button>
                                          ) : (
                                            <span title={rp.label}>{rp.label}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </div>
                            </div>
                            {d.registeredProjects.length > 0 && !mobileReadabilityMode && (
                              <div
                                className={cn(
                                  'absolute left-0 right-0 top-full z-[80] pt-1',
                                  'opacity-0 invisible translate-y-1 transition-all duration-150',
                                  'group-hover:opacity-100 group-hover:visible group-hover:translate-y-0',
                                  // 카드 클릭 시 focus가 카드에 잡히면서 popover가 안 사라지던 문제 방지: focus-within 트리거 제거(호버로만 노출).
                                  'pointer-events-none group-hover:pointer-events-auto',
                                )}
                              >
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl max-h-56 overflow-y-auto text-left">
                                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">프로젝트 이름</div>
                                  <ul className="space-y-1 text-[12px] font-medium text-slate-800 leading-snug m-0 pl-3 list-disc">
                                    {d.registeredProjects.map((rp) => (
                                      <li key={rp.id} className="break-words">
                                        {onNavigate ? (
                                          <button
                                            type="button"
                                            className="text-left w-full font-medium text-slate-800 hover:text-teal-800 hover:underline rounded px-0.5 -mx-0.5"
                                            onClick={() => openTableProject(rp.id)}
                                            title="해당 프로젝트 WBS 작업 표로 이동"
                                          >
                                            {rp.label}
                                          </button>
                                        ) : (
                                          <span title={rp.label}>{rp.label}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {emptyDivisionCards.length > 0 && (
                        <details className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50/50 group/empty">
                          <summary className="cursor-pointer list-none px-3 py-2 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 select-none [&::-webkit-details-marker]:hidden">
                            <ChevronDown
                              size={14}
                              className="shrink-0 opacity-60 transition-transform group-open/empty:rotate-180"
                              aria-hidden
                            />
                            미등록 조직 <span className="tabular-nums">{emptyDivisionCards.length}</span>개
                            <span className="font-normal text-slate-400">· 분류된 프로젝트·작업 없음</span>
                          </summary>
                          <div className="px-3 pb-2.5 pt-0.5 flex flex-wrap gap-1.5">
                            {emptyDivisionCards.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => openDivisionDetail(d.id)}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-sky-300 hover:text-sky-700 transition-colors"
                                title="클릭하여 사업부 상세 보기"
                              >
                                <Building2 size={11} className="shrink-0 opacity-50" aria-hidden />
                                <span className="truncate max-w-[10rem]">{d.name}</span>
                              </button>
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
                      <table className="w-full text-sm min-w-[520px]">
                        <thead className="bg-slate-100 border-b-2 border-slate-200">
                          <tr className="text-[11px] text-slate-700">
                            <th className="text-left font-bold px-3 py-2.5">조직</th>
                            <th
                              className="text-right font-bold px-2 py-2.5 w-[4.5rem]"
                              title="조직도 기준으로 이 사업부에 묶인 프로젝트 수"
                            >
                              프로젝트
                              <span className="block text-[9px] font-normal text-slate-500 normal-case">(건)</span>
                            </th>
                            <th className="text-right font-bold px-2 py-2.5 w-[4.5rem]" title="해당 프로젝트들에 등록된 작업 수">
                              Task
                              <span className="block text-[9px] font-normal text-slate-500 normal-case">(건)</span>
                            </th>
                            <th className="text-right font-bold px-2 py-2.5 w-20" title="일정 기준 기대 진척, Task 가중">
                              계획율
                            </th>
                            <th className="text-right font-bold px-3 py-2.5 w-20" title="실제 진척, Task 가중">
                              진척율
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayDivisionStats.map((d) => (
                            <tr
                              key={d.id}
                              className={cn(
                                'border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer',
                                d.projectCount === 0 && 'bg-slate-50/70',
                              )}
                              onClick={() => openDivisionDetail(d.id)}
                              title={
                                d.registeredProjects.length > 0
                                  ? `클릭하여 상세\n프로젝트:\n${d.registeredProjects.map((r) => r.label).join('\n')}`
                                  : '클릭하여 사업부 상세 보기'
                              }
                            >
                              <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[16rem] align-middle">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate min-w-0" title={d.name}>
                                    {d.name}
                                  </span>
                                  {d.projectCount === 0 && (
                                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded bg-slate-200/90 text-slate-700 px-1.5 py-0.5 whitespace-nowrap">
                                      미등록
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-sky-800 font-bold text-lg align-middle">
                                {d.projectCount}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-slate-900 font-bold text-lg">{d.total}</td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-amber-800 font-bold">{formatPercent1(d.planned)}%</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700 font-bold">
                                {formatPercent1(d.progress)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-sky-50/80 border-t-2 border-sky-200">
                          <tr className="text-sm font-bold text-slate-900">
                            <td className="px-3 py-2.5">합계 (표시 중)</td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-sky-800 text-lg">
                              {divisionAggregatedSummary.projectSum}
                            </td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-slate-900 text-lg">
                              {divisionAggregatedSummary.taskSum}
                            </td>
                            <td className="px-2 py-2.5 text-right tabular-nums text-amber-900">
                              {formatPercent1(divisionAggregatedSummary.tablePlanned)}%
                              <span className="block text-[9px] font-normal text-slate-500">Task 가중</span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-indigo-800">
                              {formatPercent1(divisionAggregatedSummary.tableProgress)}%
                              <span className="block text-[9px] font-normal text-slate-500">Task 가중</span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {/* 프로젝트별 현황 */}
              {showDashSection('projects') && (
                <section>
                  <div className="flex flex-col gap-2 mb-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg md:text-xl font-bold text-[var(--color-ink)] flex items-center gap-2.5 flex-wrap">
                      <span className="inline-flex items-center justify-center size-8 rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-1 ring-indigo-100 shadow-sm shrink-0">
                        <Briefcase size={18} />
                      </span>
                      프로젝트별 현황
                      <span className="text-sm font-normal text-slate-500 ml-1">
                        ({displayProjectStats.length}개
                        {showUndeterminedPeriodProjectsOnly && projectsWithUndeterminedPeriod.length !== displayProjectStats.length
                          ? ` / 기간 미정 ${projectsWithUndeterminedPeriod.length}`
                          : ''}
                        )
                      </span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {projectsWithUndeterminedPeriod.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowUndeterminedPeriodProjectsOnly((v) => !v)}
                          className={cn(
                            'px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors inline-flex items-center gap-1',
                            showUndeterminedPeriodProjectsOnly
                              ? 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                          )}
                          title="시작일 또는 종료일이 비어 있는 프로젝트만 표시"
                          aria-pressed={showUndeterminedPeriodProjectsOnly}
                        >
                          <Calendar size={12} aria-hidden />
                          기간 미정만
                          {showUndeterminedPeriodProjectsOnly && <Check size={11} strokeWidth={3} aria-hidden />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={toggleMyAndFavOnly}
                        className={cn(
                          'px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors inline-flex items-center gap-1',
                          myAndFavActive
                            ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                        )}
                        title="내가 포함된 프로젝트(소유자·멤버·담당자) 또는 즐겨찾기(★)한 프로젝트만 표시. 다시 누르면 전체."
                        aria-pressed={myAndFavActive}
                      >
                        <User size={12} aria-hidden />
                        <span aria-hidden className={cn('text-[11px] leading-none', myAndFavActive ? 'text-amber-300' : 'text-amber-500')}>
                          ★
                        </span>
                        내 프로젝트·즐겨찾기
                        {myAndFavActive && <Check size={11} strokeWidth={3} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupProjectsByDivision((v) => !v)}
                        className={cn(
                          'px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors inline-flex items-center gap-1',
                          groupProjectsByDivision
                            ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                        )}
                        title="프로젝트를 소속 부서(사업부)별로 묶어서 표시"
                        aria-pressed={groupProjectsByDivision}
                      >
                        <Building2 size={12} aria-hidden />
                        부서별
                        {groupProjectsByDivision && <Check size={11} strokeWidth={3} aria-hidden />}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 -mt-1 mb-1">
                    카드를 누르면 해당 프로젝트의 <strong className="font-semibold text-slate-600">작업 표</strong>로 이동합니다.
                  </p>
                  <div className="space-y-2">
                    {groupProjectsByDivision && projectStatsGroupedByDivision.length > 0 ? (
                      <div className="space-y-4">
                        {projectStatsGroupedByDivision.map((group) => (
                          <div key={group.name}>
                            <h3 className="text-sm font-bold text-[var(--color-ink)] mb-1.5 flex items-center gap-1.5">
                              <Building2 size={13} className="text-[var(--color-accent)] shrink-0" aria-hidden />
                              {group.name}
                              <span className="text-xs font-normal text-slate-400">({group.projects.length})</span>
                            </h3>
                            {group.projects.length > 0 ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                                {group.projects.map(renderProjectCard)}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-400 bg-slate-50/70 border border-dashed border-slate-200 rounded-lg px-3 py-2.5">
                                등록된 프로젝트가 없습니다.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                        {displayProjectStats.length === 0 ? (
                          <div className="col-span-full text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
                            {showUndeterminedPeriodProjectsOnly
                              ? '현재 필터 조건에서 기간 미지정 프로젝트가 없습니다. 「기간 미정만」을 해제하거나 다른 필터를 확인해 주세요.'
                              : projects.length > 0 && projectsEligibleForDashboard.length === 0
                                ? dashboardIncludedKinds.size === 0
                                  ? '대시보드 상단「구분」에서 집계에 넣을 구분을 하나 이상 선택해 주세요.'
                                  : '집계에 포함되는 프로젝트가 없습니다. 프로젝트 설정의「대시보드에 반영」을 켜거나, 상단「구분」에서 해당 구분을 포함해 주세요.'
                                : projectsEligibleForDashboard.length > 0 && projectsForDashboard.length === 0
                                  ? '접근 가능한 프로젝트가 모두 집계에서 제외되어 있습니다. 상단의「집계 제외 → 프로젝트 선택」에서 제외를 해제해 주세요.'
                                  : visibleProjectStats.length === 0
                                    ? '작업이 있는 프로젝트가 없습니다.'
                                    : showMyOnly
                                      ? '내가 포함된 프로젝트가 없습니다. [내가 포함된 프로젝트만] 토글을 해제하세요.'
                                      : '상단의 대시보드 표시에서 프로젝트를 선택하세요. (또는 필터 초기화)'}
                          </div>
                        ) : (
                          displayProjectStats.map(renderProjectCard)
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* 번다운 차트: 일시 숨김 처리 (관리자에게도 비표시) */}
            </div>
          </>
        )}
      </div>

      <BaseModal
        isOpen={Boolean(detailKind && !divisionDetailId)}
        onClose={clearDashboardDetailParams}
        showCloseButton={false}
        size="full"
        bodyClassName="p-0"
      >
        {detailKind && !divisionDetailId && (
          <div
            className={cn(
              'max-w-[min(100%,96rem)] mx-auto p-3 pb-6 sm:p-4 md:p-5 animate-in fade-in slide-in-from-bottom-4 duration-500',
              mobileReadabilityMode ? 'space-y-6' : 'space-y-8',
            )}
          >
            <DashboardDetailPage
              kind={detailKind}
              projectId={detailKind === 'project' ? (detailProjectId ?? undefined) : undefined}
              onBack={clearDashboardDetailParams}
              onOpenProjectTable={onNavigate ? openTableProject : undefined}
              onOpenTaskInTable={onOpenTaskInTable}
              onOpenAllTasksTable={onNavigate ? openTableAll : undefined}
              projectsForDashboard={projectsForDashboard}
              allTasksForDashboard={allTasksForDashboard}
              projectMap={projectMap}
              wbsSettings={wbsSettings}
              assigneeDisplayMetaByName={assigneeDisplayMetaByName}
              registeredMemberDisplayNames={registeredMemberDisplayNames}
              profileMap={profileMap}
              summary={summary}
              memberCount={memberCount}
              visitorStats={visitorStats}
              issueTasksAll={issueTasksAll}
              actionTasksAll={actionTasksFiltered}
              actionDueDateFilter={actionDueDateFilter}
              onActionDueDateFilterChange={setActionDueDateFilter}
              actionTasksWithDueDateCount={actionTasksWithDueDate.length}
              milestonesAll={milestones}
              projectStatsRows={projectStats}
              dashboardFiltersActive={dashboardFiltersActive}
              updateTask={updateTask}
              doneStatusId={doneStatusId}
              todoStatusId={todoStatusId}
              doneStatusIds={doneStatusIds}
              isActionTaskCompleted={isActionTaskCompleted}
              dashboardExcludedCount={dashboardExcludedIds.size}
              totalProjectsInAccount={projects.length}
              ownerDepartmentByUserId={ownerDepartmentByUserId}
            />
          </div>
        )}
      </BaseModal>

      <BaseModal
        isOpen={Boolean(selectedProjectCard)}
        onClose={() => setSelectedProjectCardId(null)}
        showCloseButton={false}
        size="full"
        bodyClassName="p-2 sm:p-4 bg-slate-100/40"
      >
        {selectedProjectCard ? (
          <DashboardProjectCardDetailPanel
            project={selectedProjectCard}
            tasks={tasksForSelectedProjectCard}
            wbsSettings={wbsSettings}
            assigneeDisplayMetaByName={assigneeDisplayMetaByName}
            profileMap={profileMap}
            orgMemberLabelByName={dashboardOrgMemberLabelByName}
            doneStatusIds={doneStatusIds}
            projectGroupName={selectedProjectCard.groupId ? groupNameByProjectGroupId.get(selectedProjectCard.groupId) : undefined}
            effortDisplayUnit={effortUnitForProjectCardPanel}
            onIncludeInDashboardChange={(include) => updateProject(selectedProjectCard.id, { includeInDashboard: include })}
            onClose={() => setSelectedProjectCardId(null)}
            onOpenDashboardProjectDetail={() => openDashboardDetail('project', { projectId: selectedProjectCard.id })}
            onNavigateToTable={onNavigate ? (projectId) => onNavigate('table', { projectId, status: 'all', assignee: '' }) : undefined}
            onOpenTaskInTable={onOpenTaskInTable}
          />
        ) : null}
      </BaseModal>
    </>
  );
}
