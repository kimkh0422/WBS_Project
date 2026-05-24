import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVisitorStats, getRegisteredMemberCount } from '../lib/db';
import {
  Briefcase,
  Clock,
  LayoutGrid,
  Flag,
  Loader2,
  Bug,
  Building2,
  Settings2,
  Check,
  User,
  ListChecks,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ban,
  Table2,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { cn, randomUUID, formatPercent1 } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import { PROJECT_KINDS, formatProjectDisplayName, resolveProjectKindOrDefault, type ProjectKind } from '../lib/projectKind';
import { computeProjectAssigneeWorkEffort } from '../lib/personAllocations';
import type { Task, Project } from '../types';
import type { WBSSettings, StatusConfig } from '../lib/wbsSettings';
import {
  readDashboardSectionVisibility,
  type DashboardSectionId,
  WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED,
} from '../lib/dashboardSections';
import {
  readDashboardSectionLayout,
  writeDashboardSectionLayout,
  type DashboardSectionLayoutMode,
  WBS_DASHBOARD_SECTION_LAYOUT_CHANGED,
} from '../lib/dashboardSectionLayout';
import { useOrganization } from '../context/OrganizationContext';
import type { OrgNode } from '../data/organization';
import {
  buildOrgMemberDisplayMetaMap,
  buildOrgMemberLabelMap,
  formatAssigneeDisplay,
  type PersonDisplayMeta,
} from '../lib/assigneeOptions';
import { sortOrgMembersByPosition } from '../lib/orgMemberSort';
import { resolveProjectPmRawDisplayName } from '../lib/projectPmDisplay';
import { hasUndeterminedProjectPeriod } from '../lib/projectPeriod';
import { ProjectPeriodDateText } from './ProjectPeriodDateText';

import { DashboardPersonAllocationSection } from './DashboardPersonAllocationSection';
import { DashboardDivisionDetail } from './DashboardDivisionDetail';
import { DashboardDetailPage, type DashboardDetailKind } from './DashboardDetailPage';
import { DashboardProjectCardDetailPanel } from './DashboardProjectCardDetailPanel';
import { ActionItemDetailModalBody } from './ActionItemDetailModalBody';
import { ActionDueDateCell, ActionDueStatusBadge, actionDueSurfaceClassName, resolveActionDueVisualState } from './ActionItemDueDisplay';
import { BaseModal } from './Base/Modal';
import {
  type ActionDueDateFilter,
  filterActionTasksByDuePeriod,
  getActionTasksWithDueDate,
  sortActionTasksByEndDate,
} from '../lib/actionItemDueFilter';

interface ProjectStats {
  total: number;
  statusCounts: Record<string, number>;
  progress: number;
  assigneeCount: number;
  /** WBS 작업 공수 합(M/D). 투입 M/M 표시·정렬에 사용 */
  inputManDays: number;
}

type ProjectStatusTableSortKey = 'name' | 'pm' | 'po' | 'progress' | 'team' | 'start' | 'end';

const DASHBOARD_DETAIL_KINDS = new Set<DashboardDetailKind>([
  'projects',
  'tasks',
  'members',
  'visitors',
  'issues',
  'actions',
  'milestones',
  'allocation',
  'project',
]);

/** 주어진 task 목록에서 깊이(depth)를 메모이제이션하여 반환하는 getter 생성 */
function buildDepthGetter(taskById: Map<string, Task>): (id: string) => number {
  const memo = new Map<string, number>();
  const get = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const t = taskById.get(id);
    if (!t || !t.parentId || !taskById.has(t.parentId)) {
      memo.set(id, 0);
      return 0;
    }
    const d = get(t.parentId) + 1;
    memo.set(id, d);
    return d;
  };
  return get;
}

/** progress × weight 가중평균(Σw는 임의, Σ(pw)/Σw). 결과 0~100% 클램프 */
function computeWeightedProgress(items: Task[]): number {
  let totalWeight = 0;
  let acc = 0;
  for (const t of items) {
    const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    const w =
      typeof t.weight === 'number' && Number.isFinite(t.weight)
        ? t.weight
        : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
          ? t.workEffort
          : 0;
    totalWeight += w;
    acc += p * w;
  }
  if (totalWeight > 0) return Math.min(100, Math.max(0, Math.round(acc / totalWeight)));
  if (items.length > 0)
    return Math.min(
      100,
      Math.max(0, Math.round(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length)),
    );
  return 0;
}

type DivisionStatRow = {
  projectCount: number;
  total: number;
};

/** 프로젝트 또는 Task가 하나라도 있는 부서 */
function isActiveDivisionStat(d: DivisionStatRow): boolean {
  return d.projectCount > 0 || d.total > 0;
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
}) {
  const { projects: allProjects, allTasks: allTasksRaw, wbsSettings, updateTask, updateProject } = useWBS();
  // 권한 필터: accessibleProjectIds가 주어지면 그 집합으로 프로젝트와 작업을 좁힘.
  const projects = useMemo(
    () => (accessibleProjectIds ? allProjects.filter((p) => accessibleProjectIds.has(p.id)) : allProjects),
    [allProjects, accessibleProjectIds],
  );
  const allTasks = useMemo(
    () => (accessibleProjectIds ? allTasksRaw.filter((t) => accessibleProjectIds.has(t.projectId)) : allTasksRaw),
    [allTasksRaw, accessibleProjectIds],
  );

  // ─── 대시보드에 집계할 프로젝트 구분(이 브라우저에만 저장). 체크 해제한 구분은 표시·계산에서 제외 ─────────
  const DASHBOARD_INCLUDED_KINDS_KEY = 'wbs-dashboard-included-project-kinds';
  const [dashboardIncludedKinds, setDashboardIncludedKinds] = useState<Set<ProjectKind>>(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_INCLUDED_KINDS_KEY);
      if (raw == null) return new Set(PROJECT_KINDS);
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return new Set(PROJECT_KINDS);
      const next = new Set<ProjectKind>();
      for (const x of arr) {
        if (typeof x === 'string' && PROJECT_KINDS.includes(x as ProjectKind)) next.add(x as ProjectKind);
      }
      return next;
    } catch {
      return new Set(PROJECT_KINDS);
    }
  });
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
    const next = new Set(dashboardIncludedKinds);
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
  const [dashboardExcludedIds, setDashboardExcludedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_EXCLUDED_KEY);
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set<string>(arr.filter((x): x is string => typeof x === 'string')) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
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

  // 공유 파생 데이터 — 여러 useMemo에서 재사용 (집계 제외 반영)
  const projectMap = useMemo(() => new Map(projectsForDashboard.map((p) => [p.id, p])), [projectsForDashboard]);

  // Calculate stats for each project
  const projectStats = useMemo(() => {
    return projectsForDashboard.map((project) => {
      const pTasks = allTasksForDashboard.filter((t) => t.projectId === project.id);
      const total = pTasks.length;

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
      const level1 = pTasks.filter((t) => getDepth(t.id) === 1);
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

      return {
        ...project,
        stats: {
          total,
          statusCounts,
          progress,
          assigneeCount: assignees.length,
          inputManDays,
        },
      };
    });
  }, [projectsForDashboard, allTasksForDashboard, wbsSettings.statusConfigs]);

  // 작업(WBS) 0개인 프로젝트는 대시보드에서 숨김
  const visibleProjectStats = useMemo(() => projectStats.filter((p) => (p?.stats?.total ?? 0) > 0), [projectStats]);

  // ─── 대시보드 표시 프로젝트 사용자 선택 (localStorage 저장) ──────────────
  // null = 모든 프로젝트 표시 (기본). Set = 명시적으로 선택된 프로젝트만 표시.
  const DASHBOARD_VISIBLE_KEY = 'wbs-dashboard-visible-project-ids';
  const [dashboardVisibleIds, setDashboardVisibleIds] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_VISIBLE_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set<string>(arr.filter((x): x is string => typeof x === 'string')) : null;
    } catch {
      return null;
    }
  });
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
    try {
      return localStorage.getItem(MY_ONLY_KEY) === '1';
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

  const [showUndeterminedPeriodProjectsOnly, setShowUndeterminedPeriodProjectsOnly] = useState(false);

  // 사용자 선택 + "내 프로젝트만" + "기간 미정만" 토글 적용한 표시 목록 (정렬 전).
  const baseDisplayProjectStats = useMemo(() => {
    const base = showUndeterminedPeriodProjectsOnly ? projectStats.filter((p) => hasUndeterminedProjectPeriod(p)) : visibleProjectStats;
    if (showMyOnly && myInvolvedProjectIds) {
      return base.filter((p) => myInvolvedProjectIds.has(p.id));
    }
    if (!dashboardVisibleIds) return base;
    return base.filter((p) => dashboardVisibleIds.has(p.id));
  }, [visibleProjectStats, projectStats, showUndeterminedPeriodProjectsOnly, dashboardVisibleIds, showMyOnly, myInvolvedProjectIds]);

  /** 프로젝트별 상태 표: 헤더 클릭 정렬(카드 뷰에서는 적용하지 않음) */
  const [projectStatusTableSort, setProjectStatusTableSort] = useState<{
    key: ProjectStatusTableSortKey;
    direction: 'asc' | 'desc';
  } | null>(null);

  const toggleProjectStatusColumnSort = useCallback((key: ProjectStatusTableSortKey) => {
    setProjectStatusTableSort((cur) => {
      if (cur?.key === key) {
        if (cur.direction === 'asc') return { key, direction: 'desc' };
        return null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  const projectStatusSortIconEl = (key: ProjectStatusTableSortKey) =>
    projectStatusTableSort?.key !== key ? (
      <ArrowUpDown size={12} className="opacity-35 shrink-0" aria-hidden />
    ) : projectStatusTableSort.direction === 'asc' ? (
      <ArrowUp size={12} className="shrink-0 text-indigo-600" aria-hidden />
    ) : (
      <ArrowDown size={12} className="shrink-0 text-indigo-600" aria-hidden />
    );

  /** 프로젝트별 상태 카드/표 행 선택 시 상세 팝업에 표시할 프로젝트 ID */
  const [selectedProjectCardId, setSelectedProjectCardId] = useState<string | null>(null);
  /** 이슈 작업 카드 클릭 시 상세 팝업 */
  const [issueTaskDetailModal, setIssueTaskDetailModal] = useState<Task | null>(null);
  const [actionTaskDetailModal, setActionTaskDetailModal] = useState<Task | null>(null);

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
        issues: 'card',
        actions: 'card',
        divisions: 'card',
        allocation: 'card',
        milestones: 'card',
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

  const displayProjectStats = useMemo(() => {
    type Row = (typeof baseDisplayProjectStats)[number];
    const tieName = (a: Row, b: Row) => a.name.localeCompare(b.name, 'ko');

    const projectsLayout = dashboardSectionLayout.projects;

    if (projectsLayout === 'table' && projectStatusTableSort) {
      const list = [...baseDisplayProjectStats];
      const dir = projectStatusTableSort.direction === 'asc' ? 1 : -1;
      const { key } = projectStatusTableSort;
      list.sort((a, b) => {
        let cmp = 0;
        switch (key) {
          case 'name':
            cmp = formatProjectDisplayName(a.name, a.projectKind).localeCompare(formatProjectDisplayName(b.name, b.projectKind), 'ko');
            break;
          case 'pm': {
            const pa = resolveProjectPmRawDisplayName(a, profileMap);
            const pb = resolveProjectPmRawDisplayName(b, profileMap);
            cmp = pa.localeCompare(pb, 'ko');
            break;
          }
          case 'po': {
            const pa = (a.poName ?? '').trim();
            const pb = (b.poName ?? '').trim();
            cmp = pa.localeCompare(pb, 'ko');
            break;
          }
          case 'progress':
            cmp = a.stats.progress - b.stats.progress;
            break;
          case 'team':
            cmp = a.stats.assigneeCount - b.stats.assigneeCount;
            break;
          case 'start':
            cmp = (a.startDate ?? '').localeCompare(b.startDate ?? '', 'ko');
            break;
          case 'end':
            cmp = (a.endDate ?? '').localeCompare(b.endDate ?? '', 'ko');
            break;
          default:
            break;
        }
        if (cmp !== 0) return dir * cmp;
        return tieName(a, b);
      });
      return list;
    }

    return baseDisplayProjectStats;
  }, [baseDisplayProjectStats, dashboardSectionLayout.projects, projectStatusTableSort, profileMap]);

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

  /** 투입만 있고 작업 0건인 프로젝트는 visibleProjectStats에 없어 제외되므로, assignments가 있으면 함께 집계한다. */
  const displayProjectsForAllocation = useMemo(() => {
    const ids = new Set(displayProjectStats.map((p) => p.id));
    return projectsForDashboard.filter((p) => ids.has(p.id) || (p.assignments?.length ?? 0) > 0);
  }, [projectsForDashboard, displayProjectStats]);

  const displayTasksForAllocation = useMemo(() => {
    const ids = new Set(displayProjectsForAllocation.map((p) => p.id));
    return allTasksForDashboard.filter((t) => ids.has(t.projectId));
  }, [allTasksForDashboard, displayProjectsForAllocation]);

  const summary = useMemo(
    () => ({
      totalProjects: projectsForDashboard.length,
      totalTasks: allTasksForDashboard.length,
    }),
    [projectsForDashboard, allTasksForDashboard],
  );

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
  const issueTasks = useMemo(() => issueTasksAll.slice(0, 50), [issueTasksAll]);

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

  const actionTasks = useMemo(() => actionTasksFiltered.slice(0, 80), [actionTasksFiltered]);

  // 사업부/본부별 작업 현황 집계 (담당자 이름이 그 division의 멤버에 매핑되는 작업들)
  const divisionStats = useMemo(() => {
    const doneStatusIds = new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id));
    const groupNameById = new Map((wbsSettings.projectGroups ?? []).map((g) => [g.id, (g.name || '').trim()] as const));
    const registeredProjectsByDivision = new Map<string, { id: string; label: string }[]>();
    for (const division of topLevelDivisions) registeredProjectsByDivision.set(division.id, []);
    for (const p of projectsForDashboard) {
      const gname = p.groupId ? groupNameById.get(p.groupId) : undefined;
      if (!gname) continue;
      const divId = departmentNameToDivisionId.get(gname);
      if (!divId) continue;
      const list = registeredProjectsByDivision.get(divId);
      if (!list) continue;
      list.push({ id: p.id, label: formatProjectDisplayName(p.name, p.projectKind) });
    }
    for (const list of registeredProjectsByDivision.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    }

    const stats = topLevelDivisions.map((division) => {
      const tasks = allTasksForDashboard.filter((t) => {
        const a = (t.assignee || '').trim();
        return !!a && memberToDivisionId.get(a) === division.id;
      });
      const total = tasks.length;
      const doneCount = tasks.filter((t) => doneStatusIds.has(t.status) || (typeof t.progress === 'number' && t.progress >= 100)).length;
      const issueCount = tasks.filter((t) => t.isIssue).length;
      const inProgressCount = total - doneCount;
      const assigneeSet = new Set(tasks.map((t) => (t.assignee || '').trim()).filter(Boolean));
      const progress = computeWeightedProgress(tasks);
      const memberCount = orgMembers.filter((m) => memberToDivisionId.get(m.name) === division.id).length;
      const registeredProjects = registeredProjectsByDivision.get(division.id) ?? [];
      return {
        id: division.id,
        name: division.name,
        total,
        doneCount,
        issueCount,
        progress,
        assigneeCount: assigneeSet.size,
        memberCount,
        inProgressCount,
        projectCount: registeredProjects.length,
        registeredProjects,
      };
    });
    // 작업이 있는 사업부 우선 + 인원만 있는 사업부도 보여주기
    return stats.sort((a, b) => b.total - a.total || b.assigneeCount - a.assigneeCount);
  }, [
    topLevelDivisions,
    allTasksForDashboard,
    orgMembers,
    memberToDivisionId,
    wbsSettings.statusConfigs,
    wbsSettings.projectGroups,
    projectsForDashboard,
    departmentNameToDivisionId,
  ]);

  // ─── 사업부 표시 필터 (사용자 선택 + 내가 포함된 부서 토글) ─────────────
  const DIVISION_VISIBLE_KEY = 'wbs-dashboard-visible-division-ids';
  const DIVISION_MY_ONLY_KEY = 'wbs-dashboard-division-my-only';
  const DIVISION_ACTIVE_ONLY_KEY = 'wbs-dashboard-division-active-only';
  const [divisionVisibleIds, setDivisionVisibleIds] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(DIVISION_VISIBLE_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set<string>(arr.filter((x): x is string => typeof x === 'string')) : null;
    } catch {
      return null;
    }
  });
  const [showMyDivisionOnly, setShowMyDivisionOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DIVISION_MY_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [showActiveDivisionsOnly, setShowActiveDivisionsOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DIVISION_ACTIVE_ONLY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [isDivisionPickerOpen, setIsDivisionPickerOpen] = useState(false);
  const divisionPickerRef = useRef<HTMLDivElement>(null);
  const allocationScrollAnchorRef = useRef<HTMLElement | null>(null);
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
  const toggleShowActiveDivisionsOnly = () => {
    setShowActiveDivisionsOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.removeItem(DIVISION_ACTIVE_ONLY_KEY);
        else localStorage.setItem(DIVISION_ACTIVE_ONLY_KEY, '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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

  const activeDivisionCount = useMemo(
    () => divisionStatsAfterVisibility.filter(isActiveDivisionStat).length,
    [divisionStatsAfterVisibility],
  );

  // 사용자 선택 + "내 부서만" + "활성 부서만" 토글 적용한 최종 표시 부서 목록.
  const displayDivisionStats = useMemo(() => {
    if (!showActiveDivisionsOnly) return divisionStatsAfterVisibility;
    return divisionStatsAfterVisibility.filter(isActiveDivisionStat);
  }, [divisionStatsAfterVisibility, showActiveDivisionsOnly]);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const divisionDetailIdRaw = searchParams.get('division');
  const divisionDetailId = divisionDetailIdRaw && divisionDetailIdRaw.trim() ? divisionDetailIdRaw.trim() : null;
  const allocationFocusDivisionIdRaw = searchParams.get('allocationFocus');
  const allocationFocusDivisionId =
    allocationFocusDivisionIdRaw && allocationFocusDivisionIdRaw.trim() ? allocationFocusDivisionIdRaw.trim() : null;

  const allocationFocusDivisionLabel = useMemo(() => {
    if (!allocationFocusDivisionId) return null;
    return topLevelDivisions.find((x) => x.id === allocationFocusDivisionId)?.name ?? null;
  }, [allocationFocusDivisionId, topLevelDivisions]);

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

  const openDashboardAllocationForDivision = useCallback(
    (divisionId: string) => {
      const sp = new URLSearchParams();
      sp.set('allocationFocus', divisionId);
      navigate({ pathname: '/dashboard', search: sp.toString(), hash: 'dashboard-allocation' });
    },
    [navigate],
  );

  useLayoutEffect(() => {
    if (hash !== '#dashboard-allocation') return;
    if (!allocationFocusDivisionId) return;
    const id = window.requestAnimationFrame(() => {
      allocationScrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [hash, allocationFocusDivisionId]);

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
    return projectsForDashboard.filter((p) => {
      const gname = p.groupId ? groupNameByProjectGroupId.get(p.groupId) : undefined;
      if (!gname) return false;
      return departmentNameToDivisionId.get(gname) === divisionDetailId;
    });
  }, [divisionDetailId, projectsForDashboard, groupNameByProjectGroupId, departmentNameToDivisionId]);

  const divisionDetailTasks = useMemo(() => {
    if (!divisionDetailId) return [];
    return allTasksForDashboard
      .filter((t) => {
        const a = (t.assignee || '').trim();
        return !!a && memberToDivisionId.get(a) === divisionDetailId;
      })
      .sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));
  }, [divisionDetailId, allTasksForDashboard, memberToDivisionId]);

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
    showMyDivisionOnly ||
    dashboardVisibleIds !== null ||
    divisionVisibleIds !== null ||
    dashboardExcludedIds.size > 0 ||
    dashboardKindsFilterActive;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('wbs-dashboard-filters-active', { detail: { active: dashboardFiltersActive } }));
  }, [dashboardFiltersActive]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('wbs-dashboard-filters-active', { detail: { active: false } }));
    };
  }, []);

  /** 구분·부서·집계 제외 등 — 기본은 접어 두고, 해당 옵션이 켜지면 자동으로 펼침 */
  const dashboardAdvancedFiltersActive =
    dashboardKindsFilterActive ||
    showMyDivisionOnly ||
    showActiveDivisionsOnly ||
    divisionVisibleIds !== null ||
    dashboardExcludedIds.size > 0;
  const [showAdvancedDashboardToolbar, setShowAdvancedDashboardToolbar] = useState(false);
  useEffect(() => {
    if (dashboardAdvancedFiltersActive) setShowAdvancedDashboardToolbar(true);
  }, [dashboardAdvancedFiltersActive]);

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
            onClick={() => setShowAdvancedDashboardToolbar((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
            aria-expanded={showAdvancedDashboardToolbar}
          >
            <ChevronDown
              size={14}
              className={cn('text-stone-500 shrink-0 transition-transform', showAdvancedDashboardToolbar && 'rotate-180')}
              aria-hidden
            />
            고급 (구분·부서·집계 제외)
            {dashboardAdvancedFiltersActive && !showAdvancedDashboardToolbar ? (
              <span className="ml-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">적용 중</span>
            ) : null}
          </button>
        </div>

        {showAdvancedDashboardToolbar ? (
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 w-full">
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50/80 border border-violet-100/80 px-2 py-1.5">
              <span
                className="text-[10px] font-bold text-violet-700 uppercase tracking-wider shrink-0"
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
                          : 'bg-white border-stone-200 text-stone-400 line-through hover:bg-stone-50',
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
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50/80 border border-sky-100/80 px-2 py-1.5">
              <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider shrink-0" title="사업부·부서별 카드">
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
                      : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
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
              <button
                type="button"
                onClick={toggleShowActiveDivisionsOnly}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors',
                  showActiveDivisionsOnly
                    ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
                    : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
                )}
                title="프로젝트·작업이 있는 부서만 표시"
                aria-pressed={showActiveDivisionsOnly}
              >
                <Building2 size={12} />
                활성 부서만
                {showActiveDivisionsOnly && <Check size={11} strokeWidth={3} />}
              </button>
              <div className="relative" ref={divisionPickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsDivisionPickerOpen((v) => !v);
                    setIsProjectPickerOpen(false);
                    setIsExclusionPickerOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 transition-colors"
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
                  <div className="absolute left-0 top-full mt-1.5 w-72 max-h-[60vh] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl z-[60] p-2">
                    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stone-100 mb-1">
                      <span className="text-[11px] font-bold text-stone-500 uppercase whitespace-nowrap">표시할 부서</span>
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
                          className="text-[11px] text-stone-500 hover:text-stone-700 font-medium"
                          title="모든 부서 해제"
                        >
                          모두 해제
                        </button>
                      </div>
                    </div>
                    {divisionStats.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-stone-400 text-center">표시 가능한 부서가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {divisionStats.map((d) => {
                          const checked = divisionVisibleIds === null ? true : divisionVisibleIds.has(d.id);
                          return (
                            <li key={d.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border',
                                    checked ? 'bg-sky-600 border-sky-600 text-white' : 'border-stone-300 bg-white',
                                  )}
                                >
                                  {checked && <Check size={11} strokeWidth={3} />}
                                </span>
                                <input type="checkbox" checked={checked} onChange={() => toggleDivision(d.id)} className="sr-only" />
                                <span className="text-sm text-stone-700 truncate" title={d.name}>
                                  {d.name}
                                </span>
                                <span
                                  className="ml-auto text-[10px] text-stone-400 shrink-0 tabular-nums max-w-[9rem] truncate text-right"
                                  title={
                                    d.registeredProjects.length > 0
                                      ? d.registeredProjects.map((r) => r.label).join('\n')
                                      : `${d.memberCount}명 · 프로젝트 ${d.projectCount}`
                                  }
                                >
                                  {d.memberCount}명 · 프로젝트 {d.projectCount}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="px-2 pt-2 mt-1 border-t border-stone-100">
                      <button
                        type="button"
                        onClick={showAllDivisions}
                        className="w-full text-[11px] text-stone-500 hover:text-sky-700 font-medium py-1"
                        title="필터 해제 (기본 상태로)"
                      >
                        필터 초기화 (기본)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50/80 border border-amber-100/80 px-2 py-1.5">
              <span
                className="text-[10px] font-bold text-amber-800 uppercase tracking-wider shrink-0"
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
                      : 'border-stone-200 bg-white hover:bg-stone-50 text-stone-600',
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
                  <div className="absolute left-0 top-full mt-1.5 w-80 max-h-[60vh] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl z-[60] p-2">
                    <p className="px-2 pb-2 text-[11px] text-stone-500 leading-snug border-b border-stone-100 mb-1">
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
                      <p className="px-3 py-4 text-xs text-stone-400 text-center">프로젝트가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {projectsForExclusionPicker.map((p) => {
                          const excluded = dashboardExcludedIds.has(p.id);
                          return (
                            <li key={p.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border shrink-0',
                                    excluded ? 'bg-amber-500 border-amber-500 text-white' : 'border-stone-300 bg-white',
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
                                  className="text-sm text-stone-700 break-words min-w-0"
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

        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50/70 border border-indigo-100/80 px-2 py-1.5 w-full sm:w-auto">
          <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider shrink-0" title="프로젝트별 카드">
            프로젝트
          </span>
          {myInvolvedProjectIds && (
            <button
              type="button"
              onClick={toggleShowMyOnly}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors',
                showMyOnly
                  ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
              )}
              title="소유자·멤버·작업 담당자(이름 매칭) 중 하나라도 해당하면 포함"
              aria-pressed={showMyOnly}
            >
              <User size={12} />
              내가 포함된 프로젝트만
              {showMyOnly && <Check size={11} strokeWidth={3} />}
            </button>
          )}
          <div className="relative" ref={projectPickerRef}>
            <button
              type="button"
              onClick={() => {
                setIsProjectPickerOpen((v) => !v);
                setIsExclusionPickerOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 transition-colors"
              title="대시보드에 표시할 프로젝트 선택"
            >
              <Settings2 size={12} />
              필터
              {dashboardVisibleIds && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                  {dashboardVisibleIds.size}
                </span>
              )}
            </button>
            {isProjectPickerOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-72 max-h-[60vh] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl z-[60] p-2">
                <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stone-100 mb-1">
                  <span className="text-[11px] font-bold text-stone-500 uppercase whitespace-nowrap">표시할 프로젝트</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => persistDashboardVisible(new Set(visibleProjectStats.map((p) => p.id as string)))}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                      title="모든 프로젝트 선택"
                    >
                      모두 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => persistDashboardVisible(new Set())}
                      className="text-[11px] text-stone-500 hover:text-stone-700 font-medium"
                      title="모든 프로젝트 해제"
                    >
                      모두 해제
                    </button>
                  </div>
                </div>
                {visibleProjectStats.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-stone-400 text-center">표시 가능한 프로젝트가 없습니다.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {visibleProjectStats.map((p) => {
                      const checked = dashboardVisibleIds === null ? true : dashboardVisibleIds.has(p.id);
                      return (
                        <li key={p.id}>
                          <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 cursor-pointer">
                            <span
                              className={cn(
                                'inline-flex items-center justify-center w-4 h-4 rounded border',
                                checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stone-300 bg-white',
                              )}
                            >
                              {checked && <Check size={11} strokeWidth={3} />}
                            </span>
                            <input type="checkbox" checked={checked} onChange={() => toggleDashboardProject(p.id)} className="sr-only" />
                            <span className="text-sm text-stone-700 break-words" title={formatProjectDisplayName(p.name, p.projectKind)}>
                              {formatProjectDisplayName(p.name, p.projectKind)}
                            </span>
                            <span className="ml-auto text-[10px] text-stone-400 shrink-0">{p.stats?.total ?? 0}건</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="px-2 pt-2 mt-1 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={showAllDashboardProjects}
                    className="w-full text-[11px] text-stone-500 hover:text-indigo-700 font-medium py-1"
                    title="필터 해제 (기본 상태로)"
                  >
                    필터 초기화 (기본)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>,
      dashboardToolbarHost,
    );

  const openTableAll = useCallback(() => {
    onNavigate?.('table', { projectId: 'all', status: 'all', assignee: '' });
  }, [onNavigate]);
  const openTableProject = useCallback(
    (projectId: string) => {
      onNavigate?.('table', { projectId, status: 'all', assignee: '' });
    },
    [onNavigate],
  );

  const openAllocationOverview = useCallback(() => {
    onNavigate?.('allocation', { projectId: 'all', status: 'all', assignee: '' });
  }, [onNavigate]);

  const openIssueTaskDetailPopup = useCallback((t: Task) => {
    setIssueTaskDetailModal(t);
  }, []);

  const openActionTaskDetailPopup = useCallback((t: Task) => {
    setActionTaskDetailModal(t);
  }, []);

  useEffect(() => {
    if (detailKind || divisionDetailId) {
      setSelectedProjectCardId(null);
      setIssueTaskDetailModal(null);
      setActionTaskDetailModal(null);
    }
  }, [detailKind, divisionDetailId]);

  return (
    <>
      {!divisionDetailId && !detailKind && dashboardFiltersToolbar}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-[var(--color-bg)] p-4 pb-10 sm:p-6 md:p-8">
        <>
          <div
            className={cn(
              'max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500',
              mobileReadabilityMode ? 'space-y-6' : 'space-y-8',
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
                <div className={cn('flex flex-wrap items-center justify-between gap-2 mb-3 md:mb-4', mobileReadabilityMode && 'mb-3')}>
                  <h2
                    className={cn(
                      'font-bold text-[var(--color-ink)] flex items-center gap-2 m-0',
                      mobileReadabilityMode ? 'text-lg' : 'text-xl',
                    )}
                  >
                    <LayoutGrid className="text-slate-500" size={24} />
                    전체 현황 요약
                  </h2>
                </div>
                {dashboardSectionLayout.summary === 'card' ? (
                  <div className={cn('grid gap-3 md:gap-4', mobileReadabilityMode ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-4')}>
                    <SummaryCard
                      title="등록된 프로젝트 수"
                      value={summary.totalProjects}
                      subtitle={
                        dashboardExcludedIds.size > 0
                          ? `※ 대시보드 집계 제외 ${dashboardExcludedIds.size}개(대시보드 반영 ${projectsEligibleForDashboard.length}개 중)`
                          : ''
                      }
                      compact={mobileReadabilityMode}
                      onClick={() => openDashboardDetail('projects')}
                    />
                    <SummaryCard
                      title="등록된 총 작업 수"
                      value={summary.totalTasks}
                      subtitle={dashboardExcludedIds.size > 0 ? '※ 제외된 프로젝트의 작업은 합계에 포함되지 않음' : ''}
                      compact={mobileReadabilityMode}
                      onClick={() => openDashboardDetail('tasks')}
                    />
                    <SummaryCard
                      title="회원가입자 수"
                      value={loadingMemberCount ? <Loader2 size={14} className="animate-spin text-stone-400" /> : memberCount}
                      subtitle="클릭하여 명단·상세"
                      compact={mobileReadabilityMode}
                      highlight="text-violet-600"
                      onClick={() => openDashboardDetail('members')}
                    />
                    <SummaryCard
                      title="접속자수"
                      compact={mobileReadabilityMode}
                      value={
                        loadingVisitorStats ? (
                          <Loader2 size={14} className="animate-spin text-stone-400" />
                        ) : (
                          <div className="space-y-1.5 not-italic font-normal tracking-normal">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xs font-medium text-slate-400">금일</span>
                              <span className="text-3xl font-bold text-blue-600 tabular-nums">{visitorStats.daily}</span>
                            </div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xs font-medium text-slate-400">누적</span>
                              <span className="text-xl font-bold text-purple-600 tabular-nums">{visitorStats.total}</span>
                            </div>
                          </div>
                        )
                      }
                      subtitle="클릭하여 금일 명단·상세"
                      onClick={() => openDashboardDetail('visitors')}
                    />
                  </div>
                ) : (
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden mb-3 md:mb-4">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-left font-medium px-3 py-2.5">항목</th>
                          <th className="text-left font-medium px-3 py-2.5">값</th>
                          <th className="text-left font-medium px-3 py-2.5 min-w-[40%]">비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                          onClick={() => openDashboardDetail('projects')}
                        >
                          <td className="px-3 py-2.5 font-medium text-stone-700 whitespace-nowrap">등록된 프로젝트 수</td>
                          <td className="px-3 py-2.5 tabular-nums font-bold text-[var(--color-ink)]">{summary.totalProjects}</td>
                          <td className="px-3 py-2.5 text-xs text-stone-500">
                            {dashboardExcludedIds.size > 0
                              ? `집계 제외 ${dashboardExcludedIds.size}개(대시보드 반영 ${projectsEligibleForDashboard.length}개 중)`
                              : '—'}
                          </td>
                        </tr>
                        <tr
                          className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                          onClick={() => openDashboardDetail('tasks')}
                        >
                          <td className="px-3 py-2.5 font-medium text-stone-700 whitespace-nowrap">등록된 총 작업 수</td>
                          <td className="px-3 py-2.5 tabular-nums font-bold text-[var(--color-ink)]">{summary.totalTasks}</td>
                          <td className="px-3 py-2.5 text-xs text-stone-500">
                            {dashboardExcludedIds.size > 0 ? '제외 프로젝트의 작업은 합계에 미포함' : '—'}
                          </td>
                        </tr>
                        <tr
                          className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                          onClick={() => openDashboardDetail('members')}
                        >
                          <td className="px-3 py-2.5 font-medium text-stone-700 whitespace-nowrap">회원가입자 수</td>
                          <td className="px-3 py-2.5 font-bold text-violet-600 tabular-nums">
                            {loadingMemberCount ? <Loader2 size={14} className="animate-spin text-stone-400" /> : memberCount}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-stone-500">클릭하여 명단·상세</td>
                        </tr>
                        <tr
                          className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                          onClick={() => openDashboardDetail('visitors')}
                        >
                          <td className="px-3 py-2.5 font-medium text-stone-700 whitespace-nowrap">접속자수</td>
                          <td className="px-3 py-2.5 text-stone-800">
                            {loadingVisitorStats ? (
                              <Loader2 size={14} className="animate-spin text-stone-400" />
                            ) : (
                              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
                                <span>
                                  <span className="text-[10px] font-medium text-slate-400 mr-1">금일</span>
                                  <span className="font-bold text-blue-600">{visitorStats.daily}</span>
                                </span>
                                <span>
                                  <span className="text-[10px] font-medium text-slate-400 mr-1">누적</span>
                                  <span className="font-bold text-purple-600">{visitorStats.total}</span>
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-stone-500">클릭하여 금일 명단·상세</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* 이슈 작업 목록 — 전체 현황 요약 바로 아래 */}
            {showDashSection('issues') && (
              <section>
                <div className={cn('flex flex-wrap items-end justify-between gap-2 mb-3 md:mb-4', mobileReadabilityMode && 'mb-3')}>
                  <h2
                    className={cn(
                      'font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap m-0',
                      mobileReadabilityMode ? 'text-lg' : 'text-xl',
                    )}
                  >
                    <Bug className="text-rose-500 shrink-0" size={mobileReadabilityMode ? 22 : 24} />
                    이슈 작업
                    <span className="text-sm font-medium text-stone-400">{issueTasksAll.length}건</span>
                  </h2>
                </div>
                {issueTasks.length === 0 ? (
                  <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
                    등록된 이슈 작업이 없습니다.
                  </div>
                ) : dashboardSectionLayout.issues === 'card' ? (
                  <div className="space-y-2.5">
                    {issueTasks.map((t) => {
                      const proj = projectMap.get(t.projectId);
                      return (
                        <div
                          key={t.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openIssueTaskDetailPopup(t)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openIssueTaskDetailPopup(t);
                            }
                          }}
                          className={cn(
                            'rounded-xl border border-stone-200 bg-white p-4 shadow-sm text-left transition-colors',
                            'cursor-pointer hover:border-rose-200 hover:bg-rose-50/35 active:scale-[0.99]',
                          )}
                          title="클릭하여 이슈 작업 상세 팝업"
                        >
                          <div className="flex items-start gap-2.5">
                            <Bug size={18} className="text-rose-500 shrink-0 mt-0.5" aria-hidden />
                            <div className="min-w-0 flex-1 space-y-2.5">
                              <p className="font-semibold text-stone-900 text-[15px] leading-snug break-words">{t.name || '(이름 없음)'}</p>
                              <dl className="space-y-1.5 text-sm text-stone-600">
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">프로젝트</dt>
                                  <dd className="text-right font-medium text-stone-800 break-words min-w-0">
                                    {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">담당자</dt>
                                  <dd className="text-right break-words min-w-0">
                                    {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">종료일</dt>
                                  <dd className="tabular-nums text-stone-700">{t.endDate || '—'}</dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">진척률</dt>
                                  <dd className="tabular-nums font-semibold text-stone-800">
                                    {typeof t.progress === 'number' ? `${formatPercent1(t.progress)}%` : '—'}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-left font-medium px-3 py-2">작업명</th>
                          <th className="text-left font-medium px-3 py-2 w-40">프로젝트</th>
                          <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                          <th className="text-left font-medium px-3 py-2 w-28">종료일</th>
                          <th className="text-right font-medium px-3 py-2 w-20">진척률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issueTasks.map((t) => {
                          const proj = projectMap.get(t.projectId);
                          return (
                            <tr
                              key={t.id}
                              className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                              onClick={() => openIssueTaskDetailPopup(t)}
                              title="클릭하여 이슈 작업 상세 팝업"
                            >
                              <td className="px-3 py-2 text-stone-800">
                                <div className="flex items-center gap-1.5">
                                  <Bug size={12} className="text-rose-500 shrink-0" />
                                  <span className="truncate">{t.name || '(이름 없음)'}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-stone-600 break-words">
                                {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                              </td>
                              <td className="px-3 py-2 text-stone-600 truncate">
                                {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                              </td>
                              <td className="px-3 py-2 text-stone-500 tabular-nums">{t.endDate || '—'}</td>
                              <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
                                {typeof t.progress === 'number' ? `${formatPercent1(t.progress)}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* 액션 항목 — 이슈 목록과 동일 패턴, 완료 체크로 상태·진척률 반영 */}
            {showDashSection('actions') && (
              <section>
                <div className={cn('flex flex-wrap items-end justify-between gap-2 mb-3 md:mb-4', mobileReadabilityMode && 'mb-3')}>
                  <h2
                    className={cn(
                      'font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap m-0',
                      mobileReadabilityMode ? 'text-lg' : 'text-xl',
                    )}
                  >
                    <ListChecks className="text-teal-600 shrink-0" size={mobileReadabilityMode ? 22 : 24} />
                    액션 항목
                    <span className="text-sm font-medium text-stone-400">{actionTasksFiltered.length}건</span>
                    {actionTasksWithDueDate.length > 0 && actionTasksFiltered.length !== actionTasksWithDueDate.length && (
                      <span className="text-xs font-normal text-stone-400 w-full sm:w-auto sm:inline sm:ml-1">
                        (마감일 지정 {actionTasksWithDueDate.length}건 중)
                      </span>
                    )}
                  </h2>
                  {actionTasksWithDueDate.length > 0 && (
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <div
                        className="inline-flex gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shrink-0"
                        role="group"
                        aria-label="액션 항목 마감일 구간"
                      >
                        {(
                          [
                            { id: 'today' as const, label: '금일' },
                            { id: 'thisWeek' as const, label: '금주' },
                            { id: 'overdue' as const, label: '기한초과' },
                          ] as const
                        ).map(({ id, label }) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setActionDueDateFilter(id)}
                            className={cn(
                              'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors',
                              actionDueDateFilter === id ? 'bg-teal-700 text-white' : 'text-stone-600 hover:bg-stone-50',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {actionTasksWithDueDate.length === 0 ? (
                  <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center leading-relaxed">
                    마감일(종료일)이 지정된 액션 항목만 이 목록에 나타납니다.
                    <br />
                    작업 편집에서「액션 항목」을 켜고 종료일을 입력해 주세요.
                  </div>
                ) : actionTasksFiltered.length === 0 ? (
                  <div className="text-sm text-stone-500 bg-white border border-stone-200 rounded-xl p-6 text-center leading-relaxed">
                    선택한 구간(
                    {actionDueDateFilter === 'today' ? '금일' : actionDueDateFilter === 'thisWeek' ? '금주' : '기한초과'}
                    )에 해당하는 액션 항목이 없습니다.
                  </div>
                ) : dashboardSectionLayout.actions === 'card' ? (
                  <div className="space-y-2.5">
                    {actionTasks.map((t) => {
                      const proj = projectMap.get(t.projectId);
                      const done = isActionTaskCompleted(t);
                      const dueState = resolveActionDueVisualState(t.endDate, done);
                      return (
                        <div
                          key={t.id}
                          className={cn(
                            'rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors',
                            'cursor-pointer hover:border-teal-200 hover:bg-teal-50/30 active:scale-[0.99]',
                            actionDueSurfaceClassName(dueState, 'card'),
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={() => openActionTaskDetailPopup(t)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openActionTaskDetailPopup(t);
                            }
                          }}
                          title="클릭하여 액션 상세"
                        >
                          <div className="flex items-start gap-3">
                            <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={done}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const checked = e.target.checked;
                                  if (checked) {
                                    updateTask(t.id, { status: doneStatusId, progress: 100 });
                                  } else {
                                    updateTask(t.id, { status: todoStatusId, progress: 0 });
                                  }
                                }}
                                className={cn(
                                  'rounded border-stone-300 focus:ring-teal-500 h-5 w-5',
                                  dueState === 'overdue' ? 'border-red-300 text-red-600' : 'text-teal-600',
                                )}
                                title={done ? '완료 해제' : '완료 표시'}
                                aria-label={done ? `${t.name} 액션 완료 해제` : `${t.name} 액션 완료`}
                              />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <p
                                className={cn(
                                  'font-semibold text-[15px] leading-snug break-words flex items-start gap-1.5 flex-wrap',
                                  done ? 'line-through text-stone-500' : 'text-stone-900',
                                )}
                              >
                                <ListChecks
                                  size={16}
                                  className={cn('shrink-0 mt-0.5', dueState === 'overdue' ? 'text-red-500' : 'text-teal-600')}
                                  aria-hidden
                                />
                                <span>{t.name || '(이름 없음)'}</span>
                                {dueState === 'completed' && (
                                  <Check size={14} className="text-teal-600 shrink-0 mt-1" strokeWidth={3} aria-hidden />
                                )}
                                <ActionDueStatusBadge state={dueState} />
                              </p>
                              <dl className="space-y-1.5 text-sm text-stone-600">
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">프로젝트</dt>
                                  <dd className="text-right font-medium text-stone-800 break-words min-w-0">
                                    {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">담당자</dt>
                                  <dd className="text-right break-words min-w-0">
                                    {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <dt className="text-stone-400 shrink-0">기한날짜</dt>
                                  <dd className="text-right">
                                    <ActionDueDateCell endDate={t.endDate} isCompleted={done} showBadge={false} />
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-center font-medium px-2 py-2 w-14">완료</th>
                          <th className="text-left font-medium px-3 py-2">액션명</th>
                          <th className="text-left font-medium px-3 py-2 w-40">프로젝트</th>
                          <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                          <th className="text-left font-medium px-3 py-2 w-28">기한날짜</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actionTasks.map((t) => {
                          const proj = projectMap.get(t.projectId);
                          const done = isActionTaskCompleted(t);
                          const dueState = resolveActionDueVisualState(t.endDate, done);
                          return (
                            <tr
                              key={t.id}
                              className={cn(
                                'border-t border-stone-100 cursor-pointer',
                                actionDueSurfaceClassName(dueState, 'row') || 'hover:bg-stone-50/60',
                              )}
                              onClick={() => openActionTaskDetailPopup(t)}
                              title="클릭하여 액션 상세"
                            >
                              <td className="px-2 py-2 align-middle text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={done}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const checked = e.target.checked;
                                    if (checked) {
                                      updateTask(t.id, { status: doneStatusId, progress: 100 });
                                    } else {
                                      updateTask(t.id, { status: todoStatusId, progress: 0 });
                                    }
                                  }}
                                  className={cn(
                                    'rounded border-stone-300 focus:ring-teal-500',
                                    dueState === 'overdue' ? 'border-red-300 text-red-600' : 'text-teal-600',
                                  )}
                                  title={done ? '완료 해제' : '완료 표시'}
                                  aria-label={done ? `${t.name} 액션 완료 해제` : `${t.name} 액션 완료`}
                                />
                              </td>
                              <td className="px-3 py-2 text-stone-800">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <ListChecks
                                    size={12}
                                    className={cn('shrink-0', dueState === 'overdue' ? 'text-red-500' : 'text-teal-600')}
                                    aria-hidden
                                  />
                                  <span className={cn('truncate', done && 'line-through text-stone-500')}>{t.name || '(이름 없음)'}</span>
                                  {dueState === 'completed' && (
                                    <Check size={12} className="text-teal-600 shrink-0" strokeWidth={3} title="완료됨" aria-hidden />
                                  )}
                                  <ActionDueStatusBadge state={dueState} />
                                </div>
                              </td>
                              <td className="px-3 py-2 text-stone-600 break-words">
                                {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                              </td>
                              <td className="px-3 py-2 text-stone-600 truncate">
                                {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                              </td>
                              <td className="px-3 py-2">
                                <ActionDueDateCell endDate={t.endDate} isCompleted={done} showBadge={false} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* 사업부·부서별 현황 */}
            {showDashSection('divisions') && (
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap m-0">
                    <Building2 className="text-sky-500" size={24} />
                    사업부·부서별 현황
                    <span className="text-sm font-normal text-stone-500 ml-1">
                      ({displayDivisionStats.length}
                      {showActiveDivisionsOnly && divisionStatsAfterVisibility.length !== displayDivisionStats.length
                        ? ` / ${divisionStatsAfterVisibility.length}`
                        : (divisionVisibleIds || showMyDivisionOnly) && divisionStats.length !== divisionStatsAfterVisibility.length
                          ? ` / ${divisionStats.length}`
                          : ''}
                      개
                      {showActiveDivisionsOnly && divisionStatsAfterVisibility.length > displayDivisionStats.length && (
                        <span className="text-stone-400">
                          {' '}
                          · 비활성 {divisionStatsAfterVisibility.length - displayDivisionStats.length}개 숨김
                        </span>
                      )}
                      )
                    </span>
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={toggleShowActiveDivisionsOnly}
                      className={cn(
                        'px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors inline-flex items-center gap-1',
                        showActiveDivisionsOnly
                          ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
                          : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
                      )}
                      title="프로젝트·작업이 있는 부서만 표시"
                      aria-pressed={showActiveDivisionsOnly}
                    >
                      활성 부서만
                      {showActiveDivisionsOnly && <Check size={11} strokeWidth={3} aria-hidden />}
                    </button>
                    {!mobileReadabilityMode && (
                      <div
                        className="inline-flex gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shrink-0"
                        role="group"
                        aria-label="사업부·부서별 현황 표 또는 카드 보기"
                      >
                        <button
                          type="button"
                          onClick={() => persistDashboardSectionLayout('divisions', 'table')}
                          className={cn(
                            'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                            dashboardSectionLayout.divisions === 'table' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
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
                            dashboardSectionLayout.divisions === 'card' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
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
                <p className="text-sm text-stone-500 mb-3 m-0 leading-relaxed">
                  카드나 행을 누르면 등록 프로젝트·진척·담당 작업을 상세로 볼 수 있습니다. 상세 안내 버튼으로 아래「사업부별 작업
                  투입공수」으로 이어가면, 그 사업부 소속 인원만 자동으로 걸러 봅니다.
                </p>
                {displayDivisionStats.length === 0 ? (
                  <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
                    {divisionStats.length === 0
                      ? '조직도 데이터를 불러오는 중이거나 매칭되는 부서가 없습니다.'
                      : showMyDivisionOnly
                        ? '내가 포함된 부서가 조직도에서 매칭되지 않습니다. 토글을 해제하세요.'
                        : showActiveDivisionsOnly && divisionStatsAfterVisibility.length > 0
                          ? '프로젝트·작업이 있는 활성 부서가 없습니다. 상단 또는 「활성 부서만」을 해제하면 전체 부서를 볼 수 있습니다.'
                          : '상단의 대시보드 표시에서 부서를 선택하세요. (또는 필터 초기화)'}
                  </div>
                ) : dashboardSectionLayout.divisions === 'card' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {displayDivisionStats.map((d) => (
                      <div
                        key={d.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openDivisionDetail(d.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDivisionDetail(d.id);
                          }
                        }}
                        className="bg-white border border-stone-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer hover:border-indigo-200/80 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
                        title="클릭하여 사업부 상세 보기"
                      >
                        <h3 className="font-semibold text-stone-800 truncate mb-3" title={d.name}>
                          {d.name}
                        </h3>
                        <div className="space-y-3">
                          <div className="rounded-lg bg-sky-50/90 border border-sky-100 px-3 py-2.5">
                            <div className="text-[10px] font-bold text-sky-700/85 uppercase tracking-wide">등록 프로젝트</div>
                            <div className="text-[1.65rem] font-bold text-sky-600 tabular-nums leading-tight mt-0.5">{d.projectCount}</div>
                            {d.registeredProjects.length > 0 && (
                              <ul className="mt-2 pt-2 border-t border-sky-100/90 space-y-1 max-h-[7.5rem] overflow-y-auto text-[11px] font-medium text-sky-900/90 leading-snug">
                                {d.registeredProjects.map((rp) => (
                                  <li key={rp.id} className="truncate" title={rp.label}>
                                    {rp.label}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="flex items-baseline justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wide">전체 진척율</span>
                              <span className="text-2xl font-bold text-indigo-600 tabular-nums leading-none">
                                {formatPercent1(d.progress)}%
                              </span>
                            </div>
                            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, d.progress)}%` }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-center">
                            <div>
                              <div className="text-[10px] text-stone-500 mb-0.5">소속 인원</div>
                              <div className="text-lg font-bold text-stone-800 tabular-nums">{d.memberCount}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-stone-500 mb-0.5">전체 Task</div>
                              <div className="text-lg font-bold text-stone-700 tabular-nums">{d.total}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-stone-500 mb-0.5">진행 중</div>
                              <div className="text-lg font-bold text-violet-600 tabular-nums">{d.inProgressCount}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] text-stone-400">
                            <span>
                              완료 <span className="text-emerald-600 font-semibold tabular-nums">{d.doneCount}</span>
                            </span>
                            <span>
                              이슈 <span className="text-rose-600 font-semibold tabular-nums">{d.issueCount}</span>
                            </span>
                            {d.assigneeCount !== d.memberCount && (
                              <span className="text-stone-400" title="이 사업부 작업에 이름이 올라간 서로 다른 담당자 수">
                                담당자 {d.assigneeCount}명
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-left font-medium px-3 py-2">사업부·본부</th>
                          <th className="text-right font-medium px-2 py-2 w-16">프로젝트</th>
                          <th className="text-right font-medium px-2 py-2 w-20">진척율</th>
                          <th className="text-right font-medium px-2 py-2 w-16">인원</th>
                          <th className="text-right font-medium px-2 py-2 w-16">Task</th>
                          <th className="text-right font-medium px-2 py-2 w-16">진행</th>
                          <th className="text-right font-medium px-2 py-2 w-14">완료</th>
                          <th className="text-right font-medium px-3 py-2 w-14">이슈</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayDivisionStats.map((d) => (
                          <tr
                            key={d.id}
                            className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                            onClick={() => openDivisionDetail(d.id)}
                            title="클릭하여 사업부 상세 보기"
                          >
                            <td className="px-3 py-2 font-medium text-stone-800 max-w-[14rem] truncate" title={d.name}>
                              {d.name}
                            </td>
                            <td
                              className="px-2 py-2 text-right tabular-nums text-sky-700 font-semibold max-w-[12rem]"
                              title={
                                d.registeredProjects.length > 0
                                  ? `등록 프로젝트 (${d.projectCount}개)\n${d.registeredProjects.map((r) => r.label).join('\n')}`
                                  : undefined
                              }
                            >
                              <div className="flex flex-col items-end gap-0.5 min-w-0">
                                <span>{d.projectCount}</span>
                                {d.registeredProjects.length > 0 && (
                                  <span className="text-[10px] font-normal text-sky-600/90 text-left w-full line-clamp-2 break-words hyphens-auto">
                                    {d.registeredProjects.map((r) => r.label).join(' · ')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-indigo-600 font-semibold">
                              {formatPercent1(d.progress)}%
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-700">{d.memberCount}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-stone-700">{d.total}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-violet-600">{d.inProgressCount}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-emerald-600">{d.doneCount}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-600">{d.issueCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {showDashSection('allocation') && (
              <section id="dashboard-allocation" ref={allocationScrollAnchorRef} className="scroll-mt-4">
                <DashboardPersonAllocationSection
                  projects={displayProjectsForAllocation}
                  allTasks={displayTasksForAllocation}
                  profileMap={profileMap}
                  registeredMemberDisplayNames={registeredMemberDisplayNames}
                  showFilterHint={dashboardFiltersActive}
                  assigneeTopDivisionIdByName={memberToDivisionId}
                  topLevelDivisions={topLevelDivisions.map((d) => ({ id: d.id, name: d.name }))}
                  allocationFocusDivisionId={allocationFocusDivisionId}
                  allocationFocusDivisionLabel={allocationFocusDivisionLabel}
                  onNavigateToWork={onNavigate ? (projectId) => onNavigate('table', { projectId, status: 'all', assignee: '' }) : undefined}
                  onOpenAllocationOverview={onNavigate ? openAllocationOverview : undefined}
                  allocationDivisionInfer={{
                    memberToDivisionId,
                    departmentNameToDivisionId,
                    profileMap,
                    ownerDepartmentByUserId,
                  }}
                  narrowScreenLayout={mobileReadabilityMode}
                  sectionLayout={mobileReadabilityMode ? 'card' : dashboardSectionLayout.allocation}
                  onSectionLayoutChange={(mode) => persistDashboardSectionLayout('allocation', mode)}
                  showSectionLayoutToggle={!mobileReadabilityMode}
                  variant="dashboard"
                />
              </section>
            )}

            {/* Milestones */}
            {showDashSection('milestones') && milestones.length > 0 && (
              <section>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
                  <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 m-0">
                    <Flag className="text-amber-500" size={24} />
                    마일스톤
                    <span className="text-sm font-medium text-stone-400">{milestones.length}건</span>
                  </h2>
                </div>
                {dashboardSectionLayout.milestones === 'card' ? (
                  <div className="card-elevated overflow-hidden">
                    <ul className="divide-y divide-slate-100">
                      {milestones.map((task) => (
                        <li
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openDashboardDetail('milestones')}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openDashboardDetail('milestones');
                            }
                          }}
                          className={cn(
                            'flex items-center hover:bg-slate-50/80 cursor-pointer transition-colors',
                            mobileReadabilityMode ? 'gap-3 px-4 py-3.5' : 'gap-4 px-6 py-4',
                          )}
                        >
                          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                            <Flag size={18} className="text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={cn('font-medium text-[var(--color-ink)]', mobileReadabilityMode ? 'break-words' : 'truncate')}>
                              {task.name}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 break-words">
                              {task.projectName} · {task.startDate}
                            </div>
                          </div>
                          {(() => {
                            const sc = wbsSettings.statusConfigs.find((c) => c.id === task.status);
                            const colorProps = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');
                            return (
                              <span
                                className={cn(
                                  'text-xs font-medium px-2.5 py-1 rounded-full border',
                                  colorProps.className,
                                  'text-stone-700',
                                )}
                                style={colorProps.style}
                              >
                                {sc?.name ?? task.status}
                              </span>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200">
                        <tr className="text-xs text-stone-500">
                          <th className="text-left font-medium px-3 py-2">작업명</th>
                          <th className="text-left font-medium px-3 py-2 w-44">프로젝트</th>
                          <th className="text-left font-medium px-3 py-2 w-28">시작일</th>
                          <th className="text-left font-medium px-3 py-2 w-28">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {milestones.map((task) => {
                          const sc = wbsSettings.statusConfigs.find((c) => c.id === task.status);
                          const colorProps = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');
                          return (
                            <tr
                              key={task.id}
                              className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                              onClick={() => openDashboardDetail('milestones')}
                              title="마일스톤 상세로 이동"
                            >
                              <td className="px-3 py-2 text-stone-800">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Flag size={12} className="text-amber-500 shrink-0" aria-hidden />
                                  <span className="truncate font-medium">{task.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-stone-600 truncate">{task.projectName}</td>
                              <td className="px-3 py-2 text-stone-500 tabular-nums">{task.startDate || '—'}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={cn('text-xs font-medium px-2 py-0.5 rounded-full border inline-block', colorProps.className)}
                                  style={colorProps.style}
                                >
                                  {sc?.name ?? task.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Project List */}
            {showDashSection('projects') && (
              <section>
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap">
                    <Briefcase className="text-[var(--color-accent)]" size={24} />
                    프로젝트별 상태
                    <span className="text-sm font-normal text-stone-500 ml-1">
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
                            : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
                        )}
                        title="시작일 또는 종료일이 비어 있는 프로젝트만 표시"
                        aria-pressed={showUndeterminedPeriodProjectsOnly}
                      >
                        <Calendar size={12} aria-hidden />
                        기간 미정만
                        {showUndeterminedPeriodProjectsOnly && <Check size={11} strokeWidth={3} aria-hidden />}
                      </button>
                    )}
                    {!mobileReadabilityMode && (
                      <div
                        className="inline-flex gap-0.5 rounded-lg border border-stone-200 bg-white p-0.5 shrink-0"
                        role="group"
                        aria-label="프로젝트별 상태 표 또는 카드 보기"
                      >
                        <button
                          type="button"
                          onClick={() => persistDashboardSectionLayout('projects', 'table')}
                          className={cn(
                            'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                            dashboardSectionLayout.projects === 'table' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
                          )}
                          title="표로 보기"
                        >
                          <Table2 size={12} aria-hidden />표
                        </button>
                        <button
                          type="button"
                          onClick={() => persistDashboardSectionLayout('projects', 'card')}
                          className={cn(
                            'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors inline-flex items-center gap-1',
                            dashboardSectionLayout.projects === 'card' ? 'bg-slate-700 text-white' : 'text-stone-600 hover:bg-stone-50',
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
                <p className="text-xs text-stone-500 -mt-1 mb-1">
                  {dashboardSectionLayout.projects === 'card'
                    ? '카드를 클릭하면 투입·작업·기한 초과 등 상세 정보가 팝업으로 열립니다. 「대시보드 상세」로 기존 요약 화면도 열 수 있습니다.'
                    : '표의 행을 클릭하면 동일한 상세 정보가 팝업으로 열립니다. 열 머리글을 클릭하면 해당 열 기준으로 정렬합니다(한 번 더 클릭하면 방향 전환·해제). 「대시보드 상세」로 기존 요약 화면도 열 수 있습니다.'}
                </p>
                <div className="space-y-3">
                  {dashboardSectionLayout.projects === 'card' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {displayProjectStats.length === 0 ? (
                        <div className="col-span-full text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
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
                        displayProjectStats.map((project) => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            isSelected={selectedProjectCardId === project.id}
                            onClick={() => setSelectedProjectCardId((prev) => (prev === project.id ? null : project.id))}
                            assigneeDisplayMetaByName={assigneeDisplayMetaByName}
                            profileMap={profileMap}
                          />
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
                      {displayProjectStats.length === 0 ? (
                        <div className="text-sm text-stone-400 p-6 text-center">
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
                        <table className="w-full text-sm min-w-[720px]">
                          <thead className="bg-stone-50 border-b border-stone-200">
                            <tr className="text-xs text-stone-500">
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 cursor-pointer select-none hover:bg-stone-100/90 transition-colors max-w-[16rem]"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('name')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('name');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  프로젝트
                                  {projectStatusSortIconEl('name')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 w-32 cursor-pointer select-none hover:bg-stone-100/90 transition-colors"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('pm')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('pm');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  PM
                                  {projectStatusSortIconEl('pm')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 w-32 cursor-pointer select-none hover:bg-stone-100/90 transition-colors"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('po')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('po');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  PO
                                  {projectStatusSortIconEl('po')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 w-28 cursor-pointer select-none hover:bg-stone-100/90 transition-colors whitespace-nowrap"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('start')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('start');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  시작
                                  {projectStatusSortIconEl('start')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 w-28 cursor-pointer select-none hover:bg-stone-100/90 transition-colors whitespace-nowrap"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('end')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('end');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  종료
                                  {projectStatusSortIconEl('end')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-right font-medium px-2 py-2 w-16 cursor-pointer select-none hover:bg-stone-100/90 transition-colors"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('team')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('team');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center justify-end gap-0.5 w-full">
                                  팀원
                                  {projectStatusSortIconEl('team')}
                                </span>
                              </th>
                              <th
                                scope="col"
                                className="text-left font-medium px-3 py-2 w-36 cursor-pointer select-none hover:bg-stone-100/90 transition-colors"
                                title="클릭하여 정렬"
                                onClick={() => toggleProjectStatusColumnSort('progress')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleProjectStatusColumnSort('progress');
                                  }
                                }}
                                tabIndex={0}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  진척률
                                  {projectStatusSortIconEl('progress')}
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayProjectStats.map((project) => {
                              const s = project.stats;
                              const pmRaw = resolveProjectPmRawDisplayName(project, profileMap);
                              const pmDisplay = pmRaw ? formatAssigneeDisplay(pmRaw, assigneeDisplayMetaByName) : '';
                              const poRaw = (project.poName ?? '').trim();
                              const poDisplay = poRaw ? formatAssigneeDisplay(poRaw, assigneeDisplayMetaByName) : '';
                              const selected = selectedProjectCardId === project.id;
                              return (
                                <tr
                                  key={project.id}
                                  className={cn(
                                    'border-t border-stone-100 cursor-pointer transition-colors',
                                    selected ? 'bg-indigo-50/50 ring-1 ring-inset ring-indigo-200/80' : 'hover:bg-stone-50/60',
                                  )}
                                  onClick={() => setSelectedProjectCardId((prev) => (prev === project.id ? null : project.id))}
                                >
                                  <td className="px-3 py-2 font-medium text-stone-800 max-w-[16rem]">
                                    <div className="truncate" title={formatProjectDisplayName(project.name, project.projectKind)}>
                                      {formatProjectDisplayName(project.name, project.projectKind)}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-stone-600 text-xs truncate max-w-[8rem]" title={pmDisplay || undefined}>
                                    {pmDisplay || <span className="text-stone-400">미지정</span>}
                                  </td>
                                  <td className="px-3 py-2 text-stone-600 text-xs truncate max-w-[8rem]" title={poDisplay || undefined}>
                                    {poDisplay || <span className="text-stone-400">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                                    <ProjectPeriodDateText date={project.startDate} className="text-stone-600" />
                                  </td>
                                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                                    <ProjectPeriodDateText date={project.endDate} className="text-stone-600" />
                                  </td>
                                  <td className="px-2 py-2 text-right tabular-nums text-stone-700">{s.assigneeCount}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-[6rem]">
                                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[3rem]">
                                        <div
                                          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                          style={{ width: `${s.progress}%` }}
                                        />
                                      </div>
                                      <span className="text-xs font-semibold tabular-nums text-stone-800 w-10 text-right shrink-0">
                                        {formatPercent1(s.progress)}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 번다운 차트: 일시 숨김 처리 (관리자에게도 비표시) */}
          </div>
        </>
      </div>

      <BaseModal isOpen={Boolean(divisionDetailId)} onClose={clearDivisionDetail} showCloseButton={false} size="full" bodyClassName="p-0">
        {divisionDetailId && (
          <div
            className={cn(
              'max-w-7xl mx-auto p-4 pb-8 sm:p-6 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500',
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
                  onNavigate?.('table', { projectId, status: 'all', assignee: '' });
                }}
                onOpenAllocationForDivision={
                  divisionDetailStat ? () => openDashboardAllocationForDivision(divisionDetailStat.id) : undefined
                }
                mobileReadabilityMode={mobileReadabilityMode}
              />
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center space-y-4">
                <p className="text-stone-600">요청한 사업부를 찾을 수 없습니다.</p>
                <button
                  type="button"
                  onClick={clearDivisionDetail}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                >
                  사업부·부서별 현황으로 돌아가기
                </button>
              </div>
            )}
          </div>
        )}
      </BaseModal>

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
              'max-w-7xl mx-auto p-4 pb-8 sm:p-6 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500',
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
              onOpenAllocationOverview={onNavigate ? openAllocationOverview : undefined}
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
              displayProjectsForAllocation={displayProjectsForAllocation}
              displayTasksForAllocation={displayTasksForAllocation}
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
        bodyClassName="p-2 sm:p-4 bg-stone-100/40"
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
            localDashboardAggregationExcluded={dashboardExcludedIds.has(selectedProjectCard.id)}
            onToggleLocalDashboardAggregationExclude={() => toggleDashboardExcluded(selectedProjectCard.id)}
            onIncludeInDashboardChange={(include) => updateProject(selectedProjectCard.id, { includeInDashboard: include })}
            onClose={() => setSelectedProjectCardId(null)}
            onOpenDashboardProjectDetail={() => openDashboardDetail('project', { projectId: selectedProjectCard.id })}
            onNavigateToTable={onNavigate ? (projectId) => onNavigate('table', { projectId, status: 'all', assignee: '' }) : undefined}
            onOpenTaskInTable={onOpenTaskInTable}
          />
        ) : null}
      </BaseModal>

      <BaseModal
        isOpen={Boolean(issueTaskDetailModal)}
        onClose={() => setIssueTaskDetailModal(null)}
        title="이슈 작업 상세"
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setIssueTaskDetailModal(null)}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
            >
              닫기
            </button>
            {onOpenTaskInTable && issueTaskDetailModal ? (
              <button
                type="button"
                onClick={() => {
                  onOpenTaskInTable(issueTaskDetailModal.id, issueTaskDetailModal.projectId);
                  setIssueTaskDetailModal(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                WBS 표에서 열기
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  openDashboardDetail('issues');
                  setIssueTaskDetailModal(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                이슈 목록 상세
              </button>
            )}
          </div>
        }
      >
        {issueTaskDetailModal ? (
          <IssueTaskDetailModalBody
            task={issueTaskDetailModal}
            projectMap={projectMap}
            assigneeDisplayMetaByName={assigneeDisplayMetaByName}
          />
        ) : null}
      </BaseModal>

      <BaseModal
        isOpen={Boolean(actionTaskDetailModal)}
        onClose={() => setActionTaskDetailModal(null)}
        title="액션 항목 상세"
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setActionTaskDetailModal(null)}
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
            >
              닫기
            </button>
            {onOpenTaskInTable && actionTaskDetailModal ? (
              <button
                type="button"
                onClick={() => {
                  onOpenTaskInTable(actionTaskDetailModal.id, actionTaskDetailModal.projectId);
                  setActionTaskDetailModal(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              >
                WBS 표에서 열기
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  openDashboardDetail('actions');
                  setActionTaskDetailModal(null);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-teal-700 text-white hover:bg-teal-800"
              >
                액션 전체 목록
              </button>
            )}
          </div>
        }
      >
        {actionTaskDetailModal ? (
          <ActionItemDetailModalBody
            task={actionTaskDetailModal}
            projectMap={projectMap}
            assigneeDisplayMetaByName={assigneeDisplayMetaByName}
            wbsSettings={wbsSettings}
          />
        ) : null}
      </BaseModal>
    </>
  );
}

function IssueTaskDetailModalBody({
  task,
  projectMap,
  assigneeDisplayMetaByName,
}: {
  task: Task;
  projectMap: Map<string, Project>;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
}) {
  const proj = projectMap.get(task.projectId);
  return (
    <div className="space-y-4 text-sm text-stone-700">
      <p className="text-base font-semibold text-stone-900 leading-snug break-words">{task.name || '(이름 없음)'}</p>
      <dl className="space-y-2">
        <div className="flex justify-between gap-3">
          <dt className="text-stone-400 shrink-0">프로젝트</dt>
          <dd className="text-right font-medium text-stone-800 break-words min-w-0">
            {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-stone-400 shrink-0">담당자</dt>
          <dd className="text-right break-words min-w-0">{formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName) || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-stone-400 shrink-0">종료일</dt>
          <dd className="tabular-nums text-stone-700">{task.endDate || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-stone-400 shrink-0">진척률</dt>
          <dd className="tabular-nums font-semibold text-stone-800">
            {typeof task.progress === 'number' ? `${formatPercent1(task.progress)}%` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  highlight,
  compact = false,
  onClick,
}: {
  title: string;
  value: number | React.ReactNode;
  subtitle: string;
  highlight?: string;
  /** 모바일 대시보드: 여백·숫자 크기 축소 */
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'card-elevated flex flex-col justify-center transition-all duration-300 relative overflow-hidden group/card',
        compact ? 'p-4 hover:-translate-y-0' : 'p-6 transform hover:-translate-y-1',
        onClick && 'cursor-pointer hover:border-indigo-200',
      )}
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent group-hover/card:via-indigo-400 transition-colors duration-500 opacity-0 group-hover/card:opacity-100" />
      <div className={cn('font-bold text-slate-500 mb-2 uppercase tracking-wide', compact ? 'text-[10px]' : 'text-xs')}>{title}</div>
      <div className={cn('font-bold tracking-tight', compact ? 'text-2xl' : 'text-3xl', highlight || 'text-[var(--color-ink)]')}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  );
}

function ProjectCard({
  project,
  onClick,
  isSelected,
  assigneeDisplayMetaByName,
  profileMap,
}: {
  project: Project & { stats: ProjectStats };
  onClick?: () => void;
  isSelected?: boolean;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
  profileMap?: Record<string, string>;
}) {
  const s = project.stats;
  const pmRaw = resolveProjectPmRawDisplayName(project, profileMap);
  const pmDisplay = pmRaw ? formatAssigneeDisplay(pmRaw, assigneeDisplayMetaByName) : '';
  const poRaw = (project.poName ?? '').trim();
  const poDisplay = poRaw ? formatAssigneeDisplay(poRaw, assigneeDisplayMetaByName) : '';

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'card flex flex-col overflow-hidden group p-3.5 transition-shadow',
        onClick && 'cursor-pointer hover:border-indigo-200',
        isSelected && 'ring-2 ring-indigo-400 border-indigo-300 shadow-md',
      )}
    >
      <h3
        className="text-sm font-semibold text-[var(--color-ink)] mb-1.5 break-words line-clamp-2 group-hover:text-indigo-600 transition-colors leading-snug"
        title={formatProjectDisplayName(project.name, project.projectKind)}
      >
        {formatProjectDisplayName(project.name, project.projectKind)}
      </h3>
      <div className="flex items-start gap-1.5 text-[11px] text-slate-600 mb-1 min-h-[1.25rem]">
        <span className="text-[10px] font-bold text-violet-600/90 uppercase tracking-wide shrink-0 pt-0.5">PM</span>
        <span className={cn('line-clamp-2 leading-snug', !pmDisplay && 'text-slate-400 font-normal')}>{pmDisplay || '미지정'}</span>
      </div>
      <div className="flex items-start gap-1.5 text-[11px] text-slate-600 mb-2 min-h-[1.25rem]">
        <span className="text-[10px] font-bold text-amber-700/90 uppercase tracking-wide shrink-0 pt-0.5">PO</span>
        <span className={cn('line-clamp-2 leading-snug', !poDisplay && 'text-slate-400 font-normal')}>{poDisplay || '—'}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[10px] font-medium text-slate-400 shrink-0">진척</span>
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000 ease-out"
            style={{ width: `${s.progress}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold text-[var(--color-ink)] w-9 text-right tabular-nums">{formatPercent1(s.progress)}%</span>
      </div>

      <div className="text-[10px] text-slate-400 pt-2 border-t border-slate-100 space-y-1">
        <div className="flex items-start gap-1 min-w-0">
          <Clock size={11} className="text-slate-300 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex flex-col gap-0.5 leading-snug">
            <span>
              시작:{' '}
              <ProjectPeriodDateText date={project.startDate} className="text-slate-500" emptyClassName="text-amber-700 font-medium" />
            </span>
            <span>
              종료: <ProjectPeriodDateText date={project.endDate} className="text-slate-500" emptyClassName="text-amber-700 font-medium" />
            </span>
          </div>
        </div>
        <div className="tabular-nums text-slate-500">
          팀원 <span className="font-semibold text-[var(--color-ink)]">{s.assigneeCount}</span>명
        </div>
      </div>
    </div>
  );
}
