import React, { useState, useEffect, useMemo } from 'react';
import { useWBS } from '../context/WBSContext';
import { ProjectNameLabel } from './ProjectNameLabel';
import { useAuth } from '../context/AuthContext';
import { ProjectModal } from './ProjectModal';
import { ShareModal } from './ShareModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ProjectGroupManagerModal } from './ProjectGroupManagerModal';
import { useToast } from './Toast';
import { useMatchMedia } from '../hooks/useMatchMedia';
import {
  FolderPlus,
  Trash2,
  Edit,
  Share2,
  Copy,
  List,
  ChevronRight,
  ChevronDown,
  Loader2,
  FolderOpen,
  FolderCog,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Network,
  FileDown,
} from 'lucide-react';
import { cn, formatNum2, formatPercent1 } from '../lib/utils';
import { computeProjectAssigneeWorkEffort } from '../lib/personAllocations';
import { manDaysToManMonths } from '../lib/workEffortUnits';
import { Project } from '../types';
import {
  getProjectListKindBadgeMeta,
  groupProjectsForKindListView,
  projectListKindSortRank,
  isPrivateProjectHiddenFromViewer,
  formatProjectDisplayName,
} from '../lib/projectKind';
import { isProjectMineForUserListFilter } from '../lib/projectMineFilter';
import {
  PROJECT_LIST_LAYOUT_LS_KEY,
  buildOrgChartProjectListBlocks,
  countProjectsInOrgBranch,
  flattenOrgChartProjectsForMobile,
  groupProjectsByParticipantCount,
  type OrgChartGroupBranch,
  type ProjectListLayoutMode,
} from '../lib/projectListOrgGrouping';
import { PROJECT_CARD_SORT_LS_KEY, parseProjectCardSortKey, type ProjectCardSortKey } from '../lib/projectCardSort';
import type { ProjectGroup } from '../lib/wbsSettings';
import { computeProjectRollupMetrics } from '../lib/projectRollupStats';
import { downloadProjectManagementPdfReport, type ProjectManagementPdfEntry } from '../lib/projectPdf';
import { useOrganization } from '../context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, buildProfileDisplayById, formatPersonDisplay } from '../lib/assigneeOptions';
import type { ProfileRow } from '../lib/supabase';
import { checkIsAdmin, fetchProfiles, getProjectOwnerDisplayNames } from '../lib/db';

/** 프로젝트 관리 표의 열 정렬 키 */
type ProjectsColumnSortKey = 'name' | 'kind' | 'group' | 'tasks' | 'input' | 'owner' | 'start' | 'end' | 'pm' | 'po';

interface ProjectsPageProps {
  /** preferView: 작업 화면 도착 시 선호 뷰('tablegantt'=표+간트). 미지정 시 기본 작업 화면(표). */
  onNavigateToWork?: (projectId?: string, preferView?: 'table' | 'tablegantt') => void;
  /** 프로젝트 삭제 후 대시보드로 이동 */
  onNavigateToDashboard?: () => void;
}

export function ProjectsPage({ onNavigateToWork, onNavigateToDashboard }: ProjectsPageProps) {
  const { user } = useAuth();
  const { projects, allTasks, addProject, updateProject, deleteProject, copyProject, setCurrentProjectId, wbsSettings } = useWBS();
  const { push: pushToast } = useToast();
  const { orgMembers, orgTree } = useOrganization();

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [shareProjectName, setShareProjectName] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectToCopy, setProjectToCopy] = useState<Project | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isCopyConfirmOpen, setIsCopyConfirmOpen] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [projectSort, setProjectSort] = useState<ProjectCardSortKey>(() => {
    try {
      return parseProjectCardSortKey(localStorage.getItem(PROJECT_CARD_SORT_LS_KEY));
    } catch {
      return 'default';
    }
  });

  const persistProjectSort = (next: ProjectCardSortKey) => {
    try {
      if (next === 'default') localStorage.removeItem(PROJECT_CARD_SORT_LS_KEY);
      else localStorage.setItem(PROJECT_CARD_SORT_LS_KEY, next);
    } catch {
      /* ignore */
    }
    setProjectSort(next);
  };

  const [columnSort, setColumnSort] = useState<{ key: ProjectsColumnSortKey; dir: 'asc' | 'desc' } | null>(null);
  const [groupByOwner, setGroupByOwner] = useState(false);
  const [showMyOnly, setShowMyOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wbs-projects-my-only') === '1';
    } catch {
      return false;
    }
  });
  const toggleShowMyOnly = (v: boolean) => {
    setShowMyOnly(v);
    try {
      localStorage.setItem('wbs-projects-my-only', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const [showDashboardExcludedOnly, setShowDashboardExcludedOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wbs-projects-dashboard-excluded-only') === '1';
    } catch {
      return false;
    }
  });
  const toggleShowDashboardExcludedOnly = (v: boolean) => {
    setShowDashboardExcludedOnly(v);
    try {
      localStorage.setItem('wbs-projects-dashboard-excluded-only', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [pdfListExporting, setPdfListExporting] = useState(false);
  const isMobileProjectList = useMatchMedia('(max-width: 767px)');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wbs-projects-collapsed-groups');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  const toggleGroupCollapsed = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('wbs-projects-collapsed-groups', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const ORG_SECTION_COLLAPSED_LS_KEY = 'wbs-projects-collapsed-org-sections';

  const [collapsedOrgSectionKeys, setCollapsedOrgSectionKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(ORG_SECTION_COLLAPSED_LS_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });

  const toggleOrgSectionCollapsed = (key: string) => {
    setCollapsedOrgSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(ORG_SECTION_COLLAPSED_LS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  type ProjectListLayout = ProjectListLayoutMode;

  const [projectListLayout, setProjectListLayout] = useState<ProjectListLayout>(() => {
    try {
      const nl = localStorage.getItem(PROJECT_LIST_LAYOUT_LS_KEY);
      if (nl === 'assignees' || nl === 'group' || nl === 'kind' || nl === 'org') return nl;
      return 'kind';
    } catch {
      return 'kind';
    }
  });

  const persistProjectListLayout = (next: ProjectListLayout) => {
    setProjectListLayout(next);
    try {
      localStorage.setItem(PROJECT_LIST_LAYOUT_LS_KEY, next);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    checkIsAdmin()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLoadingProfiles(false);
      return;
    }
    setLoadingProfiles(true);
    fetchProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setLoadingProfiles(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !projects.length) {
      setOwnerDisplayNames({});
      return;
    }
    const knownIds = new Set<string>(profiles.map((p) => p.id));
    const missingOwnerIds = [...new Set<string>(projects.map((p) => p.ownerId).filter((id): id is string => !!id))].filter(
      (id) => !knownIds.has(id),
    );
    if (missingOwnerIds.length === 0) {
      setOwnerDisplayNames({});
      return;
    }
    getProjectOwnerDisplayNames(missingOwnerIds).then(setOwnerDisplayNames);
  }, [user?.id, projects, profiles]);

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  const profileDisplayById = useMemo(
    () => buildProfileDisplayById(profiles, orgMembers, ownerDisplayNames),
    [profiles, orgMembers, ownerDisplayNames],
  );

  const currentUserPlainName = useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id);
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return ((name && String(name).trim()) || user.email || '사용자').trim();
  }, [user, profiles]);

  const currentUserDisplay = useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id);
    const plain =
      (profile?.full_name && String(profile.full_name).trim()) ||
      (user.user_metadata as { full_name?: string } | undefined)?.full_name ||
      '';
    const base = (plain && String(plain).trim()) || user.email || '사용자';
    return formatPersonDisplay(base, { orgMetaByName: assigneeDisplayMetaByName, fallbackDepartment: profile?.department });
  }, [user, profiles, assigneeDisplayMetaByName]);

  const effectiveIsAdmin = isAdmin;

  // 권한 헬퍼: 시스템 관리자 / 프로젝트 소유자만
  // 정책: 프로젝트는 만든 사람(소유자)과 시스템 관리자만 수정/삭제 가능. editor 멤버여도 수정 불가.
  const isProjectOwner = (p: Project) => !!user?.id && p.ownerId === user.id;
  const canManageProject = (p: Project) => effectiveIsAdmin || isProjectOwner(p);
  const canEditProject = canManageProject;

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

  /** 프로젝트별 WBS 공수 합(M/D) — 대시보드 카드·「투입 M/M」정렬과 동일 기준 */
  const inputManDaysByProjectId = useMemo(() => {
    const r: Record<string, number> = {};
    for (const p of projects) {
      const wd = computeProjectAssigneeWorkEffort(allTasks, p.id);
      r[p.id] = [...wd.values()].reduce((a, b) => a + b, 0);
    }
    return r;
  }, [projects, allTasks]);

  const effortDisplayUnitForProjectList = useMemo((): 'mm' | 'md' => {
    if (typeof window === 'undefined') return 'mm';
    try {
      const v = window.localStorage.getItem('dashboard-person-allocation-effort-unit');
      if (v === 'md' || v === 'mm') return v;
    } catch {
      /* ignore */
    }
    return 'mm';
  }, []);

  const dashboardExcludedProjectCount = useMemo(() => projects.filter((p) => p.includeInDashboard === false).length, [projects]);

  // id 기준으로만 표시 (사용자별 복사본이 원본과 합쳐지지 않음)
  // showMyOnly가 true면 소유자이거나 PM이 본인 프로필 이름과 같은 프로젝트만 노출.
  const uniqueProjects = useMemo(() => {
    const seen = new Set<string>();
    return projects.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      if (isPrivateProjectHiddenFromViewer(p, user?.id)) return false;
      if (showMyOnly && user?.id && !isProjectMineForUserListFilter(p, user.id, currentUserPlainName)) return false;
      if (showDashboardExcludedOnly && p.includeInDashboard !== false) return false;
      return true;
    });
  }, [projects, showMyOnly, showDashboardExcludedOnly, user?.id, currentUserPlainName]);

  const ownerLabel = (ownerId: string | undefined) => {
    if (!ownerId) return '소유자 미지정';
    if (ownerId === user?.id) return '내 프로젝트';
    return profileDisplayById[ownerId] ?? profileMap[ownerId] ?? `사용자 (${ownerId.slice(0, 8)}…)`;
  };

  const sortedGroups = useMemo<ProjectGroup[]>(() => {
    const list = wbsSettings.projectGroups ?? [];
    return [...list].sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [wbsSettings.projectGroups]);

  const sortedProjects = useMemo(() => {
    if (projectSort === 'default') return uniqueProjects;
    const list = [...uniqueProjects];
    const validGroupIds = new Set(sortedGroups.map((g) => g.id));
    const getEffectiveGroupId = (p: Project) => (p.groupId && validGroupIds.has(p.groupId) ? p.groupId : '__none__');

    if (projectSort === 'group') {
      const groupOrder = new Map<string, number>();
      sortedGroups.forEach((g, i) => groupOrder.set(g.id, i));
      groupOrder.set('__none__', sortedGroups.length);
      list.sort((a, b) => {
        const ga = groupOrder.get(getEffectiveGroupId(a)) ?? 999;
        const gb = groupOrder.get(getEffectiveGroupId(b)) ?? 999;
        if (ga !== gb) return ga - gb;
        const nameCmp = a.name.localeCompare(b.name, 'ko');
        if (nameCmp !== 0) return nameCmp;
        return a.id.localeCompare(b.id);
      });
    } else if (projectSort === 'kind') {
      list.sort((a, b) => {
        const ka = projectListKindSortRank(a);
        const kb = projectListKindSortRank(b);
        if (ka !== kb) return ka - kb;
        const nameCmp = a.name.localeCompare(b.name, 'ko');
        if (nameCmp !== 0) return nameCmp;
        return a.id.localeCompare(b.id);
      });
    } else if (projectSort === 'inputMm') {
      list.sort((a, b) => {
        const da = inputManDaysByProjectId[a.id] ?? 0;
        const db = inputManDaysByProjectId[b.id] ?? 0;
        if (db !== da) return db - da;
        const nameCmp = a.name.localeCompare(b.name, 'ko');
        if (nameCmp !== 0) return nameCmp;
        return a.id.localeCompare(b.id);
      });
    }

    return list;
  }, [uniqueProjects, projectSort, sortedGroups, inputManDaysByProjectId]);

  const orderedProjects = useMemo(() => {
    if (!columnSort) return sortedProjects;
    const list = [...uniqueProjects];
    const mult = columnSort.dir === 'desc' ? -1 : 1;
    const validGroupIds = new Set(sortedGroups.map((g) => g.id));
    const getEffectiveGroupId = (p: Project) => (p.groupId && validGroupIds.has(p.groupId) ? p.groupId : '__none__');
    const groupOrder = new Map<string, number>();
    sortedGroups.forEach((g, i) => groupOrder.set(g.id, i));
    groupOrder.set('__none__', sortedGroups.length);

    const ownerSortStr = (ownerId: string | undefined) => {
      if (!ownerId) return '소유자 미지정';
      if (ownerId === user?.id) return '내 프로젝트';
      return profileDisplayById[ownerId] ?? profileMap[ownerId] ?? ownerId;
    };

    list.sort((a, b) => {
      let c = 0;
      switch (columnSort.key) {
        case 'name':
          c = a.name.localeCompare(b.name, 'ko');
          break;
        case 'kind': {
          c = projectListKindSortRank(a) - projectListKindSortRank(b);
          break;
        }
        case 'group': {
          const ga = groupOrder.get(getEffectiveGroupId(a)) ?? 999;
          const gb = groupOrder.get(getEffectiveGroupId(b)) ?? 999;
          c = ga - gb;
          if (c === 0) c = a.name.localeCompare(b.name, 'ko');
          break;
        }
        case 'tasks':
          c = (taskCountByProject[a.id] ?? 0) - (taskCountByProject[b.id] ?? 0);
          break;
        case 'input':
          c = (inputManDaysByProjectId[a.id] ?? 0) - (inputManDaysByProjectId[b.id] ?? 0);
          break;
        case 'owner':
          c = ownerSortStr(a.ownerId).localeCompare(ownerSortStr(b.ownerId), 'ko');
          break;
        case 'start': {
          const sa = a.startDate ?? '';
          const sb = b.startDate ?? '';
          c = sa.localeCompare(sb);
          break;
        }
        case 'end': {
          const ea = a.endDate ?? '';
          const eb = b.endDate ?? '';
          c = ea.localeCompare(eb);
          break;
        }
        case 'pm': {
          const pa = (a.pmName ?? '').trim() || '\u0000';
          const pb = (b.pmName ?? '').trim() || '\u0000';
          c = pa.localeCompare(pb, 'ko');
          break;
        }
        case 'po': {
          const pa = (a.poName ?? '').trim() || '\u0000';
          const pb = (b.poName ?? '').trim() || '\u0000';
          c = pa.localeCompare(pb, 'ko');
          break;
        }
        default:
          break;
      }
      if (c === 0) return a.id.localeCompare(b.id);
      return c * mult;
    });
    return list;
  }, [
    columnSort,
    sortedProjects,
    uniqueProjects,
    sortedGroups,
    taskCountByProject,
    inputManDaysByProjectId,
    user?.id,
    profileDisplayById,
    profileMap,
  ]);

  const rollupByProjectId = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeProjectRollupMetrics>>();
    for (const p of orderedProjects) {
      const pTasks = allTasks.filter((t) => t.projectId === p.id);
      m.set(p.id, computeProjectRollupMetrics(p, pTasks));
    }
    return m;
  }, [orderedProjects, allTasks]);

  const projectsGroupedByGroup = useMemo(() => {
    const map = new Map<string, Project[]>();
    sortedGroups.forEach((g) => map.set(g.id, []));
    map.set('__none__', []);
    for (const p of orderedProjects) {
      const k = p.groupId && map.has(p.groupId) ? p.groupId : '__none__';
      map.get(k)!.push(p);
    }
    return map;
  }, [orderedProjects, sortedGroups]);

  const projectsByKindSections = useMemo(() => groupProjectsForKindListView(orderedProjects), [orderedProjects]);

  const projectsByParticipantSections = useMemo(
    () => groupProjectsByParticipantCount(orderedProjects, allTasks),
    [orderedProjects, allTasks],
  );

  const assigneeSectionsMobileFlat = useMemo(() => {
    const out: { project: Project; path: string }[] = [];
    for (const s of projectsByParticipantSections) {
      const path = s.participantCount === 0 ? '참여 인원 없음' : `참여 인원 ${s.participantCount}명`;
      for (const p of s.projects) out.push({ project: p, path });
    }
    return out;
  }, [projectsByParticipantSections]);

  const projectsGroupedByOwner = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of orderedProjects) {
      const k = p.ownerId ?? '__none__';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    const entries = [...map.entries()] as [string, Project[]][];
    const ownerSectionLabel = (ownerKey: string) => {
      if (ownerKey === '__none__') return '소유자 미지정';
      if (ownerKey === user?.id) return '내 프로젝트';
      return profileDisplayById[ownerKey] ?? profileMap[ownerKey] ?? `사용자 (${ownerKey.slice(0, 8)}…)`;
    };
    entries.sort(([ka], [kb]) => {
      if (user?.id && ka === user.id) return -1;
      if (user?.id && kb === user.id) return 1;
      if (ka === '__none__') return 1;
      if (kb === '__none__') return -1;
      return ownerSectionLabel(ka).localeCompare(ownerSectionLabel(kb), 'ko');
    });
    return entries;
  }, [orderedProjects, user?.id, profileMap, profileDisplayById]);

  const ownerDepartmentByUserId = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const p of profiles) {
      const d = p.department != null ? String(p.department).trim() : '';
      m[p.id] = d.length > 0 ? d : null;
    }
    return m;
  }, [profiles]);

  const topLevelDivisions = useMemo(() => orgTree.children?.[0]?.children ?? [], [orgTree]);

  const orgChartPageModel = useMemo(
    () => buildOrgChartProjectListBlocks(orderedProjects, orgTree, orgMembers, ownerDepartmentByUserId),
    [orderedProjects, orgTree, orgMembers, ownerDepartmentByUserId],
  );

  const mobileOrgFlat = useMemo(
    () => flattenOrgChartProjectsForMobile(orgChartPageModel.blocks, orgChartPageModel.unmapped),
    [orgChartPageModel],
  );

  const layoutLabelForPdf =
    projectListLayout === 'org'
      ? '조직도별'
      : projectListLayout === 'group'
        ? '그룹별'
        : projectListLayout === 'assignees'
          ? '인원별'
          : '구분별';

  const handleDownloadProjectListPdf = async () => {
    if (pdfListExporting) return;
    setPdfListExporting(true);
    try {
      const entries: ProjectManagementPdfEntry[] = [];
      const seqRef = { n: 0 };
      const pushRow = (p: Project) => {
        seqRef.n++;
        const m = rollupByProjectId.get(p.id);
        if (!m) return;
        const md = m.inputManDays;
        const inputLabel =
          md <= 0 ? '—' : effortDisplayUnitForProjectList === 'md' ? `${formatNum2(md)} M/D` : `${formatNum2(manDaysToManMonths(md))} M/M`;
        entries.push({
          kind: 'row',
          seq: seqRef.n,
          projectName: formatProjectDisplayName(p.name, p.projectKind),
          pm: (p.pmName ?? '').trim() || '—',
          po: (p.poName ?? '').trim() || '—',
          start: p.startDate ?? '—',
          end: p.endDate ?? '—',
          tasks: m.taskCount,
          inputLabel,
          planned: `${formatPercent1(m.planned)}%`,
          progress: `${formatPercent1(m.progress)}%`,
        });
      };

      if (groupByOwner) {
        for (const [ownerKey, list] of projectsGroupedByOwner) {
          entries.push({
            kind: 'section',
            label: `${ownerLabel(ownerKey === '__none__' ? undefined : ownerKey)} · 프로젝트 ${list.length}개`,
          });
          for (const p of list) pushRow(p);
        }
      } else if (projectListLayout === 'org' && topLevelDivisions.length > 0) {
        const flat = flattenOrgChartProjectsForMobile(orgChartPageModel.blocks, orgChartPageModel.unmapped);
        let lastPath = '';
        for (const { project, path } of flat) {
          if (path !== lastPath) {
            entries.push({ kind: 'section', label: path });
            lastPath = path;
          }
          pushRow(project);
        }
      } else {
        for (const p of orderedProjects) pushRow(p);
      }

      const subtitleLines: string[] = [`화면과 동일한 목록 묶음: ${layoutLabelForPdf}`];
      if (showMyOnly) subtitleLines.push('「내 프로젝트만」이 적용된 범위입니다.');
      if (showDashboardExcludedOnly) subtitleLines.push('「대시보드 미반영만」이 적용된 범위입니다.');

      const reportTitle = groupByOwner
        ? '프로젝트 목록 (소유자별)'
        : projectListLayout === 'org' && topLevelDivisions.length > 0
          ? '프로젝트 목록 (조직도)'
          : '프로젝트 목록';
      const fileNamePrefix = groupByOwner
        ? '프로젝트목록_소유자별'
        : projectListLayout === 'org' && topLevelDivisions.length > 0
          ? '프로젝트목록_조직도'
          : '프로젝트목록';

      await downloadProjectManagementPdfReport({ entries, reportTitle, subtitleLines, fileNamePrefix });
      pushToast('PDF를 저장했습니다.', { variant: 'success' });
    } catch (e) {
      console.error(e);
      pushToast('PDF 저장에 실패했습니다.', { variant: 'error' });
    } finally {
      setPdfListExporting(false);
    }
  };

  const handleSaveProject = (
    name: string,
    formalName: string,
    description: string,
    pmName: string,
    poName: string,
    startDate?: string,
    endDate?: string,
    assignments?: Project['assignments'],
    minWorkEffortDays?: number,
    workEffortUnit?: Project['workEffortUnit'],
    projectKind?: Project['projectKind'],
    reportCategory?: string,
    reportAgency?: string,
    reportBudgetThisYear?: string,
    reportTotalPeriod?: string,
    reportNameShort?: string,
    reportNameFull?: string,
    includeInDashboard?: boolean,
  ) => {
    const poTrim = poName.trim();
    const formalTrim = formalName.trim();
    if (editingProject) {
      updateProject(editingProject.id, {
        name,
        formalName: formalTrim || undefined,
        description,
        startDate,
        endDate,
        assignments,
        minWorkEffortDays,
        workEffortUnit,
        projectKind,
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
        pmName,
        poName: poTrim || undefined,
        includeInDashboard,
      });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, endDate, assignments, minWorkEffortDays, {
        formalName: formalTrim || undefined,
        workEffortUnit,
        projectKind,
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
        pmName,
        poName: poTrim || undefined,
        includeInDashboard,
      });
    }
    setIsProjectModalOpen(false);
  };

  const handleDeleteProject = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      setProjectToDelete(null);
      // 삭제 후 대시보드로 이동
      onNavigateToDashboard?.();
    }
    setIsDeleteConfirmOpen(false);
  };

  const handleCopyProject = () => {
    if (projectToCopy) {
      copyProject(projectToCopy.id);
      // 복사 직후: copyProject 내부에서 새 복사본이 currentProjectId로 잡힘 → 표+간트 작업 화면으로 이동.
      onNavigateToWork?.(undefined, 'tablegantt');
      setProjectToCopy(null);
    }
    setIsCopyConfirmOpen(false);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedProjectIds);
    ids.forEach((id) => deleteProject(id));
    setSelectedProjectIds(new Set());
    setIsBulkDeleteConfirmOpen(false);
    pushToast(`${ids.length}개 프로젝트가 삭제되었습니다.`, { variant: 'success' });
    // 삭제 후 대시보드로 이동
    onNavigateToDashboard?.();
  };

  // 일괄 삭제 선택 가능한 프로젝트(소유자·관리자만)
  const manageableProjects = useMemo(() => uniqueProjects.filter((p) => canManageProject(p)), [uniqueProjects, effectiveIsAdmin, user?.id]);
  const showSelectCol = manageableProjects.length > 1;
  const tableColSpan = (showSelectCol ? 1 : 0) + 11;

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProjectIds.size >= manageableProjects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(manageableProjects.map((p) => p.id)));
    }
  };

  const handleOpenShare = (project: Project) => {
    setShareProjectId(project.id);
    setShareProjectName(project.name);
  };

  const selectZeroTaskProjects = () => {
    const emptyIds = manageableProjects.filter((p) => (taskCountByProject[p.id] ?? 0) === 0).map((p) => p.id);
    setSelectedProjectIds(new Set(emptyIds));
  };

  const handleNavigateToWork = (projectId?: string) => {
    if (projectId) setCurrentProjectId(projectId);
    onNavigateToWork?.(projectId);
  };

  const formatListInputEffort = (projectId: string) => {
    const md = inputManDaysByProjectId[projectId] ?? 0;
    if (md <= 0) return '—';
    if (effortDisplayUnitForProjectList === 'md') return `${formatNum2(md)} M/D`;
    return `${formatNum2(manDaysToManMonths(md))} M/M`;
  };

  const handleColumnHeaderClick = (key: ProjectsColumnSortKey) => {
    setColumnSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const defaultDesc = key === 'tasks' || key === 'input';
      return { key, dir: defaultDesc ? 'desc' : 'asc' };
    });
    persistProjectSort('default');
  };

  const renderSortTh = (label: string, sortKey: ProjectsColumnSortKey, className?: string) => (
    <th
      scope="col"
      className={cn(
        'text-left text-xs font-semibold text-slate-600 px-3 py-2.5 border-b border-slate-200 bg-slate-100 whitespace-nowrap cursor-pointer select-none hover:bg-slate-200/90',
        className,
      )}
      onClick={() => handleColumnHeaderClick(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {columnSort?.key === sortKey ? (
          columnSort.dir === 'asc' ? (
            <ArrowUp className="shrink-0 opacity-80" size={14} aria-hidden />
          ) : (
            <ArrowDown className="shrink-0 opacity-80" size={14} aria-hidden />
          )
        ) : (
          <ArrowUpDown className="shrink-0 text-slate-400" size={13} aria-hidden />
        )}
      </span>
    </th>
  );

  const renderTableHead = () => (
    <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgba(0,0,0,0.06)]">
      <tr>
        {showSelectCol && <th scope="col" className="w-10 px-2 py-2.5 border-b border-slate-200 bg-slate-100" aria-label="선택" />}
        {renderSortTh('종류', 'kind', 'min-w-[76px]')}
        {renderSortTh('프로젝트명', 'name', 'min-w-[160px]')}
        {renderSortTh('그룹', 'group', 'min-w-[120px]')}
        {renderSortTh('PM', 'pm', 'min-w-[100px]')}
        {renderSortTh('PO', 'po', 'min-w-[100px]')}
        {renderSortTh('시작', 'start', 'min-w-[88px]')}
        {renderSortTh('종료', 'end', 'min-w-[88px]')}
        {renderSortTh('작업 수', 'tasks', 'min-w-[72px] text-right')}
        {renderSortTh(effortDisplayUnitForProjectList === 'md' ? '투입 M/D' : '투입 M/M', 'input', 'min-w-[88px] text-right')}
        {renderSortTh('소유자', 'owner', 'min-w-[120px]')}
        <th
          scope="col"
          className="text-right text-xs font-semibold text-slate-600 px-3 py-2.5 border-b border-slate-200 bg-slate-100 whitespace-nowrap min-w-[140px]"
        >
          작업
        </th>
      </tr>
    </thead>
  );

  const renderProjectRow = (project: Project) => {
    const canManage = canManageProject(project);
    const canEdit = canEditProject(project);
    const kindBadge = getProjectListKindBadgeMeta(project);
    return (
      <tr
        key={project.id}
        className={cn('bg-white hover:bg-slate-50/90 transition-colors group/row', canEdit && 'cursor-pointer')}
        onDoubleClick={() => {
          if (!canEdit) return;
          setEditingProject(project);
          setIsProjectModalOpen(true);
        }}
        title={canEdit ? '더블클릭: 편집' : '편집 권한이 없습니다'}
      >
        {showSelectCol && (
          <td className="px-2 py-2 align-middle border-b border-slate-100 w-10" onClick={(e) => e.stopPropagation()}>
            {canManage ? (
              <input
                type="checkbox"
                checked={selectedProjectIds.has(project.id)}
                onChange={() => {}}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleProjectSelection(project.id);
                }}
                className="w-4 h-4 rounded border-slate-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)] cursor-pointer"
                title="다중 선택 (삭제 권한이 있는 프로젝트만 선택 가능)"
              />
            ) : null}
          </td>
        )}
        <td className="px-3 py-2 align-middle border-b border-slate-100">
          <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md border inline-block', kindBadge.badgeClass)}>
            {kindBadge.label}
          </span>
        </td>
        <td className="px-3 py-2 align-middle border-b border-slate-100 min-w-0 max-w-[280px]">
          <ProjectNameLabel
            project={project}
            name={project.name}
            showBadge={false}
            nameClassName="font-medium text-[var(--color-ink)] truncate"
          />
        </td>
        <td className="px-3 py-2 align-middle border-b border-slate-100 text-slate-600" onClick={(e) => e.stopPropagation()}>
          {sortedGroups.length > 0 ? (
            canEdit ? (
              <select
                value={project.groupId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  updateProject(project.id, { groupId: val === '' ? undefined : val });
                }}
                className="max-w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                title="그룹 선택"
              >
                <option value="">그룹 미지정</option>
                {sortedGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-slate-500">{sortedGroups.find((g) => g.id === project.groupId)?.name ?? '그룹 미지정'}</span>
            )
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>
        <td
          className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 max-w-[140px] truncate"
          title={project.pmName}
        >
          {(project.pmName ?? '').trim() || '—'}
        </td>
        <td
          className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 max-w-[140px] truncate"
          title={project.poName}
        >
          {(project.poName ?? '').trim() || '—'}
        </td>
        <td className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 tabular-nums whitespace-nowrap">
          {project.startDate ?? '—'}
        </td>
        <td className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 tabular-nums whitespace-nowrap">
          {project.endDate ?? '—'}
        </td>
        <td className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 tabular-nums text-right">
          {taskCountByProject[project.id] ?? 0}
        </td>
        <td
          className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 tabular-nums text-right"
          title="WBS 작업 공수 합(담당자별)"
        >
          {formatListInputEffort(project.id)}
        </td>
        <td
          className="px-3 py-2 align-middle border-b border-slate-100 text-xs text-slate-600 min-w-0 max-w-[200px] truncate"
          title={project.ownerId ? (profileDisplayById[project.ownerId] ?? profileMap[project.ownerId] ?? project.ownerId) : undefined}
        >
          {loadingProfiles && project.ownerId && project.ownerId !== user?.id ? (
            <Loader2 size={14} className="inline-block align-middle animate-spin text-slate-400" />
          ) : (
            ownerLabel(project.ownerId)
          )}
        </td>
        <td className="px-2 py-2 align-middle border-b border-slate-100 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center justify-end gap-0.5">
            <button
              type="button"
              onClick={() => handleNavigateToWork(project.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[var(--color-accent)] transition-colors"
              title="작업 보기"
            >
              <List size={16} />
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => handleOpenShare(project)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-colors"
                title="공유"
              >
                <Share2 size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setProjectToCopy(project);
                setIsCopyConfirmOpen(true);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
              title="프로젝트 복사: 내 프로젝트로 복사해 별도 수정"
            >
              <Copy size={16} />
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setEditingProject(project);
                  setIsProjectModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[var(--color-ink)] transition-colors"
                title="편집"
              >
                <Edit size={16} />
              </button>
            )}
            {uniqueProjects.length > 1 && canManage && (
              <button
                type="button"
                onClick={() => {
                  setProjectToDelete(project);
                  setIsDeleteConfirmOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="삭제"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const renderMobileProjectCard = (project: Project) => {
    const canManage = canManageProject(project);
    const canEdit = canEditProject(project);
    const kindBadge = getProjectListKindBadgeMeta(project);
    const groupLabel = sortedGroups.length > 0 ? (sortedGroups.find((g) => g.id === project.groupId)?.name ?? '그룹 미지정') : null;

    return (
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md border inline-block', kindBadge.badgeClass)}>
              {kindBadge.label}
            </span>
            <ProjectNameLabel
              project={project}
              name={project.name}
              showBadge={false}
              nameClassName="font-semibold text-[var(--color-ink)] text-[15px] leading-snug break-words"
            />
          </div>
          {showSelectCol && canManage && (
            <input
              type="checkbox"
              checked={selectedProjectIds.has(project.id)}
              onChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                toggleProjectSelection(project.id);
              }}
              className="w-4 h-4 mt-1 rounded border-slate-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)] cursor-pointer shrink-0"
              title="다중 선택"
              aria-label={`${project.name} 선택`}
            />
          )}
        </div>

        <dl className="grid gap-2 text-sm text-slate-600">
          {sortedGroups.length > 0 && (
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <dt className="text-slate-400 shrink-0 text-xs font-semibold uppercase tracking-wide">그룹</dt>
              <dd className="min-w-0 sm:text-right" onClick={(e) => e.stopPropagation()}>
                {canEdit ? (
                  <select
                    value={project.groupId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateProject(project.id, { groupId: val === '' ? undefined : val });
                    }}
                    className="w-full max-w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1.5"
                    title="그룹 선택"
                  >
                    <option value="">그룹 미지정</option>
                    {sortedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-700 break-words">{groupLabel}</span>
                )}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">PM</dt>
            <dd className="text-right font-medium text-slate-800 min-w-0 break-words">{(project.pmName ?? '').trim() || '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">PO</dt>
            <dd className="text-right font-medium text-slate-800 min-w-0 break-words">{(project.poName ?? '').trim() || '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">기간</dt>
            <dd className="text-right tabular-nums text-slate-700 text-xs">
              {(project.startDate ?? '—') + ' ~ ' + (project.endDate ?? '—')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">작업 수</dt>
            <dd className="text-right tabular-nums font-medium">{taskCountByProject[project.id] ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">{effortDisplayUnitForProjectList === 'md' ? '투입 M/D' : '투입 M/M'}</dt>
            <dd className="text-right tabular-nums font-medium">{formatListInputEffort(project.id)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400 shrink-0">소유자</dt>
            <dd
              className="text-right min-w-0 break-words text-slate-700 text-xs"
              title={project.ownerId ? (profileDisplayById[project.ownerId] ?? profileMap[project.ownerId] ?? project.ownerId) : undefined}
            >
              {loadingProfiles && project.ownerId && project.ownerId !== user?.id ? (
                <Loader2 size={14} className="inline-block align-middle animate-spin text-slate-400" />
              ) : (
                ownerLabel(project.ownerId)
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap justify-end gap-1 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleNavigateToWork(project.id)}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[var(--color-accent)] transition-colors"
            title="작업 보기"
          >
            <List size={18} />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => handleOpenShare(project)}
              className="p-2 rounded-lg text-slate-500 hover:bg-teal-50 hover:text-teal-600 transition-colors"
              title="공유"
            >
              <Share2 size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setProjectToCopy(project);
              setIsCopyConfirmOpen(true);
            }}
            className="p-2 rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            title="복사"
          >
            <Copy size={18} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditingProject(project);
                setIsProjectModalOpen(true);
              }}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[var(--color-ink)] transition-colors"
              title="편집"
            >
              <Edit size={18} />
            </button>
          )}
          {uniqueProjects.length > 1 && canManage && (
            <button
              type="button"
              onClick={() => {
                setProjectToDelete(project);
                setIsDeleteConfirmOpen(true);
              }}
              className="p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="삭제"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-auto bg-slate-50/50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)]">프로젝트 관리</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              프로젝트를 생성·편집·공유·삭제할 수 있습니다. 표 머리글을 클릭하면 해당 열 기준으로 오름·내림차순 정렬됩니다.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => void handleDownloadProjectListPdf()}
              disabled={pdfListExporting || uniqueProjects.length === 0}
              title="현재 목록·묶음·필터가 반영된 표를 PDF로 저장합니다. (순번·PM·PO·일정·작업수·투입·계획율·진척율)"
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg border transition-colors',
                pdfListExporting || uniqueProjects.length === 0
                  ? 'text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed'
                  : 'text-rose-900 bg-rose-50 border-rose-200 hover:bg-rose-100 hover:border-rose-300',
              )}
            >
              <FileDown size={16} className="shrink-0" aria-hidden />
              {pdfListExporting ? 'PDF 생성 중…' : 'PDF'}
            </button>
            <button
              onClick={() => setIsGroupManagerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors"
              title="프로젝트 그룹 추가·이름변경·삭제·순서 변경 (그룹은 모든 사용자에게 공통으로 보입니다)"
            >
              <FolderCog size={14} /> 그룹 관리
            </button>
            <button
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              className="btn-primary flex items-center gap-2"
              title="새 프로젝트 생성"
            >
              <FolderPlus size={16} /> 새 프로젝트
            </button>
          </div>
        </div>

        {uniqueProjects.length > 0 && uniqueProjects.length < 2 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={groupByOwner}
                onChange={(e) => setGroupByOwner(e.target.checked)}
                className="rounded border-slate-300 text-[var(--color-accent)]"
              />
              소유자별 그룹으로 보기
            </label>
            <>
              <div className="h-4 w-px bg-slate-200/80" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-400 shrink-0">목록 묶음</span>
                <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50/90 p-0.5">
                  <button
                    type="button"
                    onClick={() => persistProjectListLayout('kind')}
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                      projectListLayout === 'kind'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:bg-slate-100/90',
                    )}
                  >
                    구분별
                  </button>
                  {sortedGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => persistProjectListLayout('group')}
                      className={cn(
                        'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                        projectListLayout === 'group'
                          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                          : 'text-slate-600 hover:bg-slate-100/90',
                      )}
                    >
                      그룹별
                    </button>
                  )}
                  {topLevelDivisions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => persistProjectListLayout('org')}
                      className={cn(
                        'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                        projectListLayout === 'org'
                          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                          : 'text-slate-600 hover:bg-slate-100/90',
                      )}
                    >
                      조직도별
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => persistProjectListLayout(projectListLayout === 'assignees' ? 'kind' : 'assignees')}
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                      projectListLayout === 'assignees'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:bg-slate-100/90',
                    )}
                    title="투입 인원과 작업 담당자 이름을 합친 참여 인원 수로 묶습니다."
                  >
                    인원별
                  </button>
                </div>
              </div>
            </>
          </div>
        )}

        {/* 툴바: 전체 선택 / 선택 삭제 (소유자·관리자만 다중 삭제 가능) */}
        {manageableProjects.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 mb-4 px-3 py-2 md:px-4 md:py-2 bg-white rounded-xl border border-slate-200 shadow-sm">
            <button
              onClick={toggleSelectAll}
              className="text-xs font-medium text-slate-500 hover:text-[var(--color-accent)]"
              title={effectiveIsAdmin ? '전체 프로젝트 선택' : '내가 만든 프로젝트만 선택됩니다'}
            >
              {selectedProjectIds.size >= manageableProjects.length ? '선택 해제' : '전체 선택'}
            </button>
            <button
              onClick={selectZeroTaskProjects}
              disabled={manageableProjects.every((p) => (taskCountByProject[p.id] ?? 0) > 0)}
              className={cn(
                'text-xs font-medium',
                manageableProjects.every((p) => (taskCountByProject[p.id] ?? 0) > 0)
                  ? 'text-slate-300 cursor-not-allowed'
                  : 'text-slate-500 hover:text-[var(--color-accent)]',
              )}
              title="작업이 0개인 프로젝트만 선택 (삭제 권한이 있는 항목 중)"
            >
              0개만 선택
            </button>
            <div className="h-4 w-px bg-slate-200/80" />
            <label
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer shrink-0"
              title="내가 소유자이거나, PM 이름이 내 프로필 이름과 같은 프로젝트만 보기"
            >
              <input
                type="checkbox"
                checked={showMyOnly}
                onChange={(e) => toggleShowMyOnly(e.target.checked)}
                className="rounded border-slate-300 text-[var(--color-accent)]"
              />
              내 프로젝트만
            </label>
            <div className="h-4 w-px bg-slate-200/80" />
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={groupByOwner}
                onChange={(e) => setGroupByOwner(e.target.checked)}
                className="rounded border-slate-300 text-[var(--color-accent)]"
              />
              소유자별 그룹
            </label>
            <div className="h-4 w-px bg-slate-200/80" />
            <div className="flex flex-wrap items-center gap-2">
              <ArrowUpDown size={14} className="text-slate-400 shrink-0" aria-hidden />
              <span className="text-xs font-medium text-slate-400 shrink-0">정렬</span>
              <div
                className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50/90 p-0.5"
                role="radiogroup"
                aria-label="프로젝트 정렬"
                title="목록 정렬 프리셋입니다. 표 머리글로 정렬하면 프리셋은 기본으로 맞춰집니다."
              >
                {(
                  [
                    { key: 'default' as const, label: '기본' },
                    { key: 'group' as const, label: '그룹순' },
                    { key: 'kind' as const, label: '종류순' },
                    { key: 'inputMm' as const, label: '투입 M/M' },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={columnSort === null && projectSort === key}
                    onClick={() => {
                      setColumnSort(null);
                      persistProjectSort(key);
                    }}
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                      projectSort === key && columnSort === null
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-800',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-4 w-px bg-slate-200/80" />
            <div className="flex flex-wrap items-center gap-2">
              <Network size={14} className="text-slate-400 shrink-0" aria-hidden />
              <span className="text-xs font-medium text-slate-400 shrink-0">목록 묶음</span>
              <div
                className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50/90 p-0.5"
                role="radiogroup"
                aria-label="프로젝트 목록 묶음 방식"
                title="헤더의 프로젝트 목록과 동일한 설정이 로컬에 저장됩니다."
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={projectListLayout === 'kind'}
                  onClick={() => persistProjectListLayout('kind')}
                  className={cn(
                    'px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                    projectListLayout === 'kind'
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-800',
                  )}
                >
                  구분별
                </button>
                {sortedGroups.length > 0 && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={projectListLayout === 'group'}
                    onClick={() => persistProjectListLayout('group')}
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                      projectListLayout === 'group'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-800',
                    )}
                  >
                    그룹별
                  </button>
                )}
                {topLevelDivisions.length > 0 && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={projectListLayout === 'org'}
                    onClick={() => persistProjectListLayout('org')}
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                      projectListLayout === 'org'
                        ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-800',
                    )}
                  >
                    조직도별
                  </button>
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={projectListLayout === 'assignees'}
                  onClick={() => persistProjectListLayout(projectListLayout === 'assignees' ? 'kind' : 'assignees')}
                  className={cn(
                    'px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                    projectListLayout === 'assignees'
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-800',
                  )}
                  title="투입 인원과 작업 담당자 이름을 합친 참여 인원 수로 묶습니다."
                >
                  인원별
                </button>
              </div>
            </div>
            {selectedProjectIds.size > 0 && (
              <button
                onClick={() => setIsBulkDeleteConfirmOpen(true)}
                className="text-xs font-medium text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 size={12} /> 선택 삭제 ({selectedProjectIds.size}개)
              </button>
            )}
          </div>
        )}

        {/* 프로젝트 목록 (표) */}
        <div>
          {uniqueProjects.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <FolderPlus className="mx-auto text-slate-300 mb-4" size={48} />
              <p className="text-slate-500 font-medium">등록된 프로젝트가 없습니다.</p>
              <p className="text-sm text-slate-400 mt-1">새 프로젝트를 만들어 시작하세요.</p>
              <button onClick={() => setIsProjectModalOpen(true)} className="btn-primary mt-4">
                새 프로젝트 만들기
              </button>
            </div>
          ) : isMobileProjectList ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 px-0.5 leading-relaxed">
                좁은 화면에서는 가로로 밀리지 않도록 카드 목록으로 표시합니다. 정렬·필터는 위 도구줄과 동일하게 적용됩니다.
              </p>
              {projectListLayout === 'org' && topLevelDivisions.length > 0
                ? mobileOrgFlat.map(({ project, path }) => (
                    <div key={project.id} className="space-y-1">
                      <div className="text-[10px] font-semibold text-teal-800/90 px-0.5 leading-snug">{path}</div>
                      {renderMobileProjectCard(project)}
                    </div>
                  ))
                : projectListLayout === 'assignees'
                  ? assigneeSectionsMobileFlat.map(({ project, path }) => (
                      <div key={project.id} className="space-y-1">
                        <div className="text-[10px] font-semibold text-violet-900/90 px-0.5 leading-snug">{path}</div>
                        {renderMobileProjectCard(project)}
                      </div>
                    ))
                  : orderedProjects.map((project) => <React.Fragment key={project.id}>{renderMobileProjectCard(project)}</React.Fragment>)}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm border-collapse">
                {renderTableHead()}
                <tbody>
                  {groupByOwner ? (
                    <>
                      {projectsGroupedByOwner.flatMap(([ownerKey, list]) => [
                        <tr key={`sec-owner-${ownerKey}`} className="bg-slate-100/95">
                          <td colSpan={tableColSpan} className="px-3 py-2.5 text-xs font-bold text-slate-700 border-b border-slate-200">
                            <span>{ownerLabel(ownerKey === '__none__' ? undefined : ownerKey)}</span>
                            <span className="ml-2 font-normal text-slate-500 tabular-nums">프로젝트 {list.length}개</span>
                          </td>
                        </tr>,
                        ...list.map((p) => renderProjectRow(p)),
                      ])}
                    </>
                  ) : projectListLayout === 'org' && topLevelDivisions.length > 0 ? (
                    <>
                      {(() => {
                        const { blocks, unmapped } = orgChartPageModel;
                        const rows: React.ReactNode[] = [];
                        const appendBranch = (divisionId: string, branch: OrgChartGroupBranch) => {
                          const sub = countProjectsInOrgBranch(branch);
                          if (sub === 0) return;
                          const key = `org:${divisionId}:${branch.nodeId}`;
                          const collapsed = collapsedOrgSectionKeys.has(key);
                          rows.push(
                            <tr key={`org-h-${key}`} className="bg-teal-50/50">
                              <td
                                colSpan={tableColSpan}
                                className="px-3 py-2 border-b border-slate-200"
                                style={{ paddingLeft: 10 + branch.depth * 14 }}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleOrgSectionCollapsed(key)}
                                  className="flex flex-wrap items-center gap-2 text-left text-slate-800 hover:text-teal-800 font-bold text-sm w-full min-w-0"
                                  aria-expanded={!collapsed}
                                >
                                  {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                                  <Network size={18} className="text-teal-600 shrink-0" />
                                  <span>{branch.title}</span>
                                  <span className="text-xs font-medium text-slate-500 tabular-nums">프로젝트 {sub}개</span>
                                </button>
                              </td>
                            </tr>,
                          );
                          if (!collapsed) {
                            for (const c of branch.children) appendBranch(divisionId, c);
                            for (const p of branch.projects) rows.push(renderProjectRow(p));
                          }
                        };
                        for (const b of blocks) {
                          if (b.totalInBlock === 0) continue;
                          appendBranch(b.division.id, b.branch);
                        }
                        if (unmapped.length > 0) {
                          const uk = 'org:__unmapped__';
                          const uc = collapsedOrgSectionKeys.has(uk);
                          rows.push(
                            <tr key={`org-h-${uk}`} className="bg-slate-100/95">
                              <td colSpan={tableColSpan} className="px-3 py-2 border-b border-slate-200">
                                <button
                                  type="button"
                                  onClick={() => toggleOrgSectionCollapsed(uk)}
                                  className="flex flex-wrap items-center gap-2 text-left text-slate-800 hover:text-slate-950 font-bold text-sm w-full min-w-0"
                                  aria-expanded={!uc}
                                >
                                  {uc ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                                  <Network size={18} className="text-slate-400 shrink-0" />
                                  <span>조직 미매칭</span>
                                  <span className="text-xs font-medium text-slate-500 tabular-nums">프로젝트 {unmapped.length}개</span>
                                </button>
                              </td>
                            </tr>,
                          );
                          if (!uc) rows.push(...unmapped.map((p) => renderProjectRow(p)));
                        }
                        if (rows.length === 0) {
                          rows.push(
                            <tr key="org-empty-hint">
                              <td
                                colSpan={tableColSpan}
                                className="px-3 py-6 text-xs text-slate-500 text-center border-b border-slate-100 bg-white"
                              >
                                조직도에 표시할 프로젝트가 없습니다. PM 이름을 조직 현황 인원과 맞추거나 회원 부서 정보를 확인해 주세요.
                              </td>
                            </tr>,
                          );
                        }
                        return rows;
                      })()}
                    </>
                  ) : projectListLayout === 'assignees' ? (
                    <>
                      {projectsByParticipantSections.flatMap(({ participantCount, projects: list }) => [
                        <tr key={`sec-part-${participantCount}`} className={participantCount === 0 ? 'bg-amber-50/90' : 'bg-violet-50/90'}>
                          <td colSpan={tableColSpan} className="px-3 py-2 border-b border-slate-200">
                            <span
                              className={cn(
                                'inline-flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg border',
                                participantCount === 0
                                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                                  : 'bg-violet-50 border-violet-200 text-violet-950',
                              )}
                              title="투입 인원(assignments)과 작업 담당자(assignee) 표시명을 합친 서로 다른 이름 수입니다."
                            >
                              {participantCount === 0 ? '참여 인원 없음' : `참여 인원 ${participantCount}명`}
                              <span className="text-xs font-medium opacity-80 tabular-nums">프로젝트 {list.length}개</span>
                            </span>
                          </td>
                        </tr>,
                        ...list.map((p) => renderProjectRow(p)),
                      ])}
                    </>
                  ) : sortedGroups.length > 0 ? (
                    <>
                      {[...sortedGroups, { id: '__none__', name: '그룹 미지정' } as ProjectGroup].flatMap((g) => {
                        const list = projectsGroupedByGroup.get(g.id) ?? [];
                        if (g.id === '__none__' && list.length === 0) return [];
                        const collapsed = collapsedGroupIds.has(g.id);
                        return [
                          <tr key={`sec-grp-${g.id}`} className="bg-slate-100/95">
                            <td colSpan={tableColSpan} className="px-3 py-2 border-b border-slate-200">
                              <button
                                type="button"
                                onClick={() => toggleGroupCollapsed(g.id)}
                                className="flex flex-wrap items-center gap-2 text-left text-slate-800 hover:text-indigo-600 font-bold text-sm w-full min-w-0"
                                aria-expanded={!collapsed}
                              >
                                {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                                <FolderOpen size={18} className={g.id === '__none__' ? 'text-slate-400' : 'text-amber-500 shrink-0'} />
                                <span>{g.name}</span>
                                <span className="text-xs font-medium text-slate-500 tabular-nums">프로젝트 {list.length}개</span>
                              </button>
                            </td>
                          </tr>,
                          ...(collapsed
                            ? []
                            : list.length > 0
                              ? list.map((p) => renderProjectRow(p))
                              : [
                                  <tr key={`empty-grp-${g.id}`}>
                                    <td
                                      colSpan={tableColSpan}
                                      className="px-3 py-3 text-xs text-slate-400 border-b border-slate-100 bg-slate-50/50"
                                    >
                                      소속된 프로젝트가 없습니다.
                                    </td>
                                  </tr>,
                                ]),
                        ];
                      })}
                    </>
                  ) : (
                    <>
                      {projectsByKindSections.flatMap(({ sectionKey, headerLabel, headerBadgeClass, projects: list }) => [
                        <tr key={`sec-kind-${sectionKey}`} className="bg-slate-50">
                          <td colSpan={tableColSpan} className="px-3 py-2 border-b border-slate-200">
                            <span
                              className={cn(
                                'inline-flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg border',
                                headerBadgeClass,
                              )}
                            >
                              {headerLabel}
                              <span className="text-xs font-medium opacity-80 tabular-nums">프로젝트 {list.length}개</span>
                            </span>
                          </td>
                        </tr>,
                        ...list.map((p) => renderProjectRow(p)),
                      ])}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        onSave={handleSaveProject}
        project={editingProject}
        allProjects={projects}
        defaultPmNameForNewProject={currentUserPlainName}
        currentUserId={user?.id}
      />
      <ShareModal
        isOpen={!!shareProjectId}
        onClose={() => {
          setShareProjectId(null);
          setShareProjectName(null);
        }}
        projectId={shareProjectId ?? undefined}
        projectName={shareProjectName ?? undefined}
        isOwner={projects.find((p) => p.id === shareProjectId)?.ownerId === user?.id}
        isAdmin={effectiveIsAdmin}
        profileMap={profileMap}
        profileDisplayById={profileDisplayById}
        profiles={profiles.map((p) => ({ id: p.id, full_name: p.full_name ?? null, email: p.email ?? null }))}
        ownerId={projects.find((p) => p.id === shareProjectId)?.ownerId}
      />
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setProjectToDelete(null);
        }}
        onConfirm={handleDeleteProject}
        title="프로젝트 삭제"
        message={
          projectToDelete ? `'${projectToDelete.name}' 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.` : ''
        }
        confirmLabel="삭제"
        isDanger={true}
      />
      <ConfirmDialog
        isOpen={isCopyConfirmOpen}
        onClose={() => {
          setIsCopyConfirmOpen(false);
          setProjectToCopy(null);
        }}
        onConfirm={handleCopyProject}
        title="프로젝트 복사"
        message={
          projectToCopy
            ? `'${projectToCopy.name}' 프로젝트를 복사하여 내 프로젝트로 새 복사본을 만드시겠습니까?${
                (taskCountByProject[projectToCopy.id] ?? 0) > 0 ? ` (작업 ${taskCountByProject[projectToCopy.id]}개 포함)` : ''
              }`
            : ''
        }
        confirmLabel="복사"
      />
      <ConfirmDialog
        isOpen={isBulkDeleteConfirmOpen}
        onClose={() => setIsBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        title="선택 프로젝트 일괄 삭제"
        message={`선택한 ${selectedProjectIds.size}개 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="일괄 삭제"
        isDanger={true}
      />
      {isGroupManagerOpen && <ProjectGroupManagerModal isOpen onClose={() => setIsGroupManagerOpen(false)} />}
    </div>
  );
}
