import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '../lib/utils';
import { useMatchMedia } from '../hooks/useMatchMedia';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  Download,
  Upload,
  Settings2,
  ShieldCheck,
  Shield,
  Trash2,
  RotateCcw,
  Users,
  User,
  LogOut,
  History,
  Map as MapIcon,
  FolderPlus,
  Briefcase,
  Share2,
  Copy,
  Edit,
  LayoutDashboard,
  CheckSquare,
  Columns2,
  LayoutPanelLeft,
  Target,
  MoreHorizontal,
  Sun,
  Moon,
  Monitor,
  Star,
  EyeOff,
  Network,
  Keyboard,
  FileDown,
  TrendingUp,
  FileText,
  ClipboardList,
  BookOpen,
  Route,
  Search,
} from 'lucide-react';
import { NavButton } from './NavButton';
import { ProjectNameLabel } from './ProjectNameLabel';
import { groupProjectsForKindListView } from '../lib/projectKind';
import {
  PROJECT_LIST_LAYOUT_LS_KEY,
  buildOrgChartProjectListBlocks,
  collectOrgExpandKeysForBlocks,
  countProjectsInOrgBranch,
  groupProjectsByParticipantCount,
  type OrgChartGroupBranch,
  type ProjectListLayoutMode,
} from '../lib/projectListOrgGrouping';
import { useOrganization } from '../context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, formatPersonDisplay } from '../lib/assigneeOptions';
import { WbsFilterBar } from './FilterBar';
import type { Project, Task } from '../types';
import { isProjectMineForUserListFilter } from '../lib/projectMineFilter';
import type { WBSSettings } from '../lib/wbsSettings';
import type { PresenceUser } from '../hooks/usePresence';
import type { User as SupabaseUser } from '@supabase/supabase-js';

/** 대시보드가 숨겨진 배포에서만 로고가 대체할 첫 탭 — `MAIN_NAV_VIEW_ORDER`와 동일 우선순위 */
const LOGO_FALLBACK_VIEW_ORDER = [
  'dashboard',
  'projects',
  'allocation',
  'tablegantt',
  'tablekanban',
  'table',
  'gantt',
  'kanban',
  'mindmap',
] as const;

export interface AppHeaderProps {
  wbsSettings: WBSSettings;
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (v: boolean) => void;
  requestRefresh: () => void;
  logo: string;
  isProjectDropdownOpen: boolean;
  setIsProjectDropdownOpen: (v: boolean) => void;
  currentProjectId: string;
  currentProject: Project | null;
  user: SupabaseUser | null;
  effectiveIsAdmin: boolean;
  profileMap: Record<string, string>;
  /** 표시 전용(소속·이름·직급). 없으면 profileMap 사용 */
  profileDisplayById?: Record<string, string>;
  presenceOthers: PresenceUser[];
  selectProject: (id: string) => void;
  allTasks: Task[];
  projectsSortedByName: Project[];
  taskCountByProject: Record<string, number>;
  /** 프로젝트 목록에 없는 소속 작업 수(합계 불일치 시 안내) */
  orphanAndUnassignedTaskCount?: number;
  isAdmin: boolean;
  /** DB profiles.is_admin 외에 비밀번호 관리자 모드 진입 여부(화면 전환 가능 대상) */
  adminOverride?: boolean;
  /** undefined: 로딩 전에는 프로젝트별 메뉴 표시(기존 동작) */
  myEditableProjectIds: string[] | undefined;
  setIsShareOpen: (v: boolean) => void;
  setEditingProject: (p: Project | null) => void;
  setIsProjectModalOpen: (v: boolean) => void;
  setProjectToDelete: (p: Project | null) => void;
  setIsDeleteProjectConfirmOpen: (v: boolean) => void;
  setProjectToCopy: (p: Project | null) => void;
  setIsCopyProjectConfirmOpen: (v: boolean) => void;
  setView: (v: string) => void;
  undo: () => void;
  canUndo: boolean;
  redo: () => void;
  canRedo: boolean;
  hiddenViews: Set<string>;
  view: string;
  /** 상단 탭에서 대시보드 버튼 라벨(기본: "대시보드"). 프로젝트 현황 전용 배포 시 "프로젝트 현황" 등 */
  dashboardNavLabel?: string;
  navigateWithTip: (v: string) => void;
  filterOn: boolean;
  setFilterOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** 대시보드일 때 true — 필터 버튼이 WBS 대신 대시보드 표시 범위(부서·프로젝트)를 안내 */
  dashboardFilterBarMode?: boolean;
  dashboardFiltersActive?: boolean;
  /** 대시보드 표시 도구줄이 펼쳐진 상태(헤더 필터 버튼으로 토글) */
  showDashboardFilterToolbar?: boolean;
  onDashboardFilterToolbarClick?: () => void;
  tipOnce: (key: string, msg: string) => void;
  currentUserDisplay: string;
  /** 프로필 본명 등. 「내 프로젝트만」에서 PM 이름과 비교 */
  currentUserPlainName?: string;
  signOut: () => void;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: (v: boolean) => void;
  setIsWeeklyReportOpen: (v: boolean) => void;
  setIsOrganizationOpen: (v: boolean) => void;
  /** 승인된 사용자 여부. 조직 현황 메뉴 노출 조건. */
  userApproved: boolean;
  handleImportClick: () => void;
  /** 프로젝트 등록현황 요약 PDF 저장(대시보드 집계 기준) */
  onSaveProjectRegistrationPdf?: () => void | Promise<void>;
  setIsExportModalOpen: (v: boolean) => void;
  setIsSettingsModalOpen: (v: boolean) => void;
  isShortcutsVisible: boolean;
  setIsShortcutsVisible: (v: boolean) => void;
  setIsMembersModalOpen: (v: boolean) => void;
  setIsResetConfirmOpen: (v: boolean) => void;
  setIsDeleteChoiceOpen: (v: boolean) => void;
  canEditCurrentProject: boolean;
  setIsModalOpen: (v: boolean) => void;
  isDemoBannerDismissed?: boolean;
  setIsDemoBannerDismissed?: (v: boolean) => void;
  isBackupBannerDismissed?: boolean;
  setIsBackupBannerDismissed?: (v: boolean) => void;
  themeMode?: 'light' | 'dark' | 'system';
  onThemeModeChange?: (mode: 'light' | 'dark' | 'system') => void;
  onFavoriteProjectsChange?: (ids: string[]) => void;
  /** 알림 벨 등 헤더 우측에 추가할 슬롯 */
  headerRightSlot?: React.ReactNode;
  /** 관리자가 회원 화면을 체험 중인 상태 — 모든 관리자 전용 UI를 숨김 */
  memberPreview?: boolean;
  setMemberPreview?: (v: boolean) => void;
  /** 시스템 관리자가 아니어도 true이면 회원 관리 메뉴 표시 (조직 책임자) */
  canOpenMembersManagement?: boolean;
  /** DB 관리자가 아닌 운영자용: 비밀번호로 관리자 모드(adminOverride) 진입 */
  setIsAdminPasswordModalOpen?: (v: boolean) => void;
  /** DB 시스템 관리자 권한 요청 모달 */
  setIsAdminAccessRequestModalOpen?: (v: boolean) => void;
  /** 현재 프로젝트 편집(editor) 권한 요청 모달 */
  setIsProjectEditAccessRequestModalOpen?: (v: boolean) => void;
  /** 프로젝트 소유자 id → profiles.department. PM이 조직 인원과 매칭되지 않을 때 조직도 분류 보조 */
  ownerDepartmentByUserId?: Record<string, string | null | undefined>;
  /** ⋮ 메뉴 「사용 설명서」 — 텍스트 튜토리얼 모달 열기 */
  onOpenTutorial?: () => void;
  /** ⋮ 메뉴 「따라하기 투어」 — 신규 프로젝트→첫 작업 흐름을 실제 화면 위에서 안내(데스크톱 전용) */
  onStartTour?: () => void;
  /** ⋮ 관리자 메뉴 「작업 로그」 — 회원들의 프로젝트·작업 생성·수정·삭제 변경 이력(전체)을 조회. 운영자(realIsAdmin)에게만 노출 */
  onOpenAuditLog?: () => void;
}

export function AppHeader({
  wbsSettings,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  requestRefresh,
  logo,
  isProjectDropdownOpen,
  setIsProjectDropdownOpen,
  currentProjectId,
  currentProject,
  user,
  effectiveIsAdmin,
  profileMap,
  profileDisplayById = {},
  presenceOthers,
  selectProject,
  allTasks,
  projectsSortedByName,
  taskCountByProject,
  orphanAndUnassignedTaskCount = 0,
  isAdmin,
  adminOverride = false,
  myEditableProjectIds,
  setIsShareOpen,
  setEditingProject,
  setIsProjectModalOpen,
  setProjectToDelete,
  setIsDeleteProjectConfirmOpen,
  setProjectToCopy,
  setIsCopyProjectConfirmOpen,
  setView,
  undo,
  canUndo,
  redo,
  canRedo,
  hiddenViews,
  view,
  dashboardNavLabel = '대시보드',
  navigateWithTip,
  filterOn,
  setFilterOn,
  dashboardFilterBarMode = false,
  dashboardFiltersActive = false,
  showDashboardFilterToolbar = false,
  onDashboardFilterToolbarClick,
  tipOnce,
  currentUserDisplay,
  currentUserPlainName = '',
  signOut,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  setIsWeeklyReportOpen,
  setIsOrganizationOpen,
  userApproved,
  handleImportClick,
  onSaveProjectRegistrationPdf,
  setIsExportModalOpen,
  setIsSettingsModalOpen,
  isShortcutsVisible,
  setIsShortcutsVisible,
  setIsMembersModalOpen,
  setIsResetConfirmOpen,
  setIsDeleteChoiceOpen,
  canEditCurrentProject,
  setIsModalOpen,
  themeMode = 'system',
  onThemeModeChange,
  onFavoriteProjectsChange,
  headerRightSlot,
  memberPreview = false,
  setMemberPreview,
  canOpenMembersManagement,
  setIsAdminPasswordModalOpen,
  setIsAdminAccessRequestModalOpen,
  setIsProjectEditAccessRequestModalOpen,
  ownerDepartmentByUserId,
  onOpenTutorial,
  onStartTour,
  onOpenAuditLog,
}: AppHeaderProps) {
  /** 관리자로 지정됐거나( DB ) 비밀번호 관리자 모드일 때, 일반 사용자 화면 ↔ 관리자 화면 전환 가능 */
  const canSwitchAdminMemberView = (isAdmin || adminOverride) && !!setMemberPreview && !!user?.id;
  const allowMembersManagement = canOpenMembersManagement ?? effectiveIsAdmin;
  /** DB `is_admin`만 — 비밀번호 관리자 모드·회원 화면 미리보기에서는 숨김 */
  const showSuperAdminDeleteMenu = isAdmin && !memberPreview;
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  /** 프로젝트 드롭다운 영역. 이 범위 밖을 누르면 드롭다운을 닫는다(헤더의 ...·다른 버튼 클릭에도 대응). */
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  /** 768px 미만이면서 대시보드가 숨김 처리되지 않은 경우: 하단 작업 탭 숨김(App에서 대시보드 고정과 동일 조건) */
  const lockMobileToDashboard = useMatchMedia('(max-width: 767px)') && !hiddenViews.has('dashboard');
  const isMobileViewport = useMatchMedia('(max-width: 767px)');

  useEffect(() => {
    if (isMobileViewport) setIsProjectDropdownOpen(false);
  }, [isMobileViewport, setIsProjectDropdownOpen]);

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // 숨김 헤더 항목(투입현황·주간보고·프로젝트 관리 등) 표시 토글 — Shift+F12 (버그 사항 링크는 항상 표시)
  const [showHiddenHeaderItems, setShowHiddenHeaderItems] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wbs.showHiddenHeaderItems') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'F12') {
        e.preventDefault();
        setShowHiddenHeaderItems((prev) => {
          const next = !prev;
          try {
            localStorage.setItem('wbs.showHiddenHeaderItems', next ? '1' : '0');
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [expandedOwnerKeys, setExpandedOwnerKeys] = useState<Set<string>>(new Set());
  const wasDropdownOpen = useRef(false);
  /** 목록 필터: 전체 / 내 프로젝트 / 관심 / 대시보드 반영 — 서로 토글(같은 버튼 다시 누르면 전체). */
  type ProjectListFilter = 'all' | 'my' | 'favorites' | 'dashboardOn';
  const PROJECT_LIST_FILTER_KEY = 'wbs-header-projects-list-filter';
  /** 목록 묶음: 기본은 조직도별(조직 트리), 헤더 버튼으로 항목 구분(상품·연구 등)·인원별로 전환. */
  type ProjectListLayout = ProjectListLayoutMode;
  /** 구버전: 필터+그룹 레이아웃이 한 키에 묶여 있었음 → 최초 로드 시 분리 마이그레이션 */
  const PROJECT_LIST_MODE_LEGACY_KEY = 'wbs-header-projects-list-mode';

  const [listFilter, setListFilter] = useState<ProjectListFilter>(() => {
    try {
      const nf = localStorage.getItem(PROJECT_LIST_FILTER_KEY);
      if (nf === 'all' || nf === 'my' || nf === 'favorites' || nf === 'dashboardOn') return nf;
      if (nf === 'dashboardOff') return 'all';
      const legacy = localStorage.getItem(PROJECT_LIST_MODE_LEGACY_KEY);
      if (legacy === 'my') return 'my';
      if (legacy === 'favorites') return 'favorites';
      if (localStorage.getItem('wbs-header-projects-my-only') === '1') return 'my';
      return 'my';
    } catch {
      return 'my';
    }
  });

  const [projectListLayout, setProjectListLayout] = useState<ProjectListLayout>(() => {
    try {
      const nl = localStorage.getItem(PROJECT_LIST_LAYOUT_LS_KEY);
      if (nl === 'assignees') return 'assignees';
      if (nl === 'org') return 'org';
      if (nl === 'group' || nl === 'kind') return 'kind';
      const legacy = localStorage.getItem(PROJECT_LIST_MODE_LEGACY_KEY);
      if (legacy === 'group') return 'kind';
      if (
        localStorage.getItem('wbs-header-projects-group-assigned-only') === '1' ||
        localStorage.getItem('wbs-header-projects-group-layout') === '1' ||
        localStorage.getItem('wbs-header-projects-by-group') === '1'
      ) {
        return 'kind';
      }
      return 'org';
    } catch {
      return 'org';
    }
  });
  const [expandedOrgNodeKeys, setExpandedOrgNodeKeys] = useState<Set<string>>(new Set());
  /** 프로젝트 드롭다운 목록만 필터(닫을 때 초기화) */
  const [projectListSearch, setProjectListSearch] = useState('');

  const { orgTree, orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const favoriteIds = useMemo(() => new Set(wbsSettings.favoriteProjectIds ?? []), [wbsSettings.favoriteProjectIds]);

  const persistListFilter = (next: ProjectListFilter) => {
    setListFilter(next);
    try {
      localStorage.setItem(PROJECT_LIST_FILTER_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const persistProjectListLayout = (next: ProjectListLayout) => {
    setProjectListLayout(next);
    try {
      localStorage.setItem(PROJECT_LIST_LAYOUT_LS_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const toggleListFilter = (target: Exclude<ProjectListFilter, 'all'>) => {
    persistListFilter(listFilter === target ? 'all' : target);
  };

  const toggleFavorite = (projectId: string) => {
    const next = new Set(favoriteIds);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    const ids = Array.from(next) as string[];
    onFavoriteProjectsChange?.(ids);
    // 디바운스(1초) 전에 새로고침해도 유지되도록 즉시 로컬 저장
    try {
      const raw = localStorage.getItem('wbs-settings');
      const current = raw ? JSON.parse(raw) : {};
      localStorage.setItem('wbs-settings', JSON.stringify({ ...current, favoriteProjectIds: ids }));
    } catch {
      /* ignore */
    }
  };

  const displayProjects = useMemo(() => {
    const base = projectsSortedByName;
    if (listFilter === 'my' && user?.id) return base.filter((p) => isProjectMineForUserListFilter(p, user.id, currentUserPlainName));
    if (listFilter === 'favorites') return base.filter((p) => favoriteIds.has(p.id));
    if (listFilter === 'dashboardOn') return base.filter((p) => p.includeInDashboard !== false);
    return base;
  }, [projectsSortedByName, listFilter, favoriteIds, user?.id, currentUserPlainName]);

  const projectListSearchTrimmed = projectListSearch.trim();
  const displayProjectsForDropdown = useMemo(() => {
    if (!projectListSearchTrimmed) return displayProjects;
    const q = projectListSearchTrimmed.toLowerCase();
    return displayProjects.filter((p) => {
      if ((p.name ?? '').toLowerCase().includes(q)) return true;
      const pmRaw = (p.pmName ?? '').trim();
      if (pmRaw.toLowerCase().includes(q)) return true;
      const pmLabel = pmRaw ? formatPersonDisplay(pmRaw, { orgMetaByName: assigneeDisplayMetaByName }) : '미지정';
      if (pmLabel.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [displayProjects, projectListSearchTrimmed, assigneeDisplayMetaByName]);

  const dashboardExcludedInListCount = useMemo(
    () => projectsSortedByName.filter((p) => p.includeInDashboard === false).length,
    [projectsSortedByName],
  );

  const dashboardIncludedInListCount = useMemo(
    () => projectsSortedByName.filter((p) => p.includeInDashboard !== false).length,
    [projectsSortedByName],
  );

  const projectsByKindSections = useMemo(() => groupProjectsForKindListView(displayProjectsForDropdown), [displayProjectsForDropdown]);

  const projectsByParticipantSections = useMemo(
    () => groupProjectsByParticipantCount(displayProjectsForDropdown, allTasks),
    [displayProjectsForDropdown, allTasks],
  );

  const topLevelDivisions = useMemo(() => orgTree.children?.[0]?.children ?? [], [orgTree]);

  const orgChartListModel = useMemo(
    () => buildOrgChartProjectListBlocks(displayProjectsForDropdown, orgTree, orgMembers, ownerDepartmentByUserId),
    [displayProjectsForDropdown, orgTree, orgMembers, ownerDepartmentByUserId],
  );

  const toggleOrgExpanded = (key: string) => {
    setExpandedOrgNodeKeys((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  useEffect(() => {
    if (!isProjectDropdownOpen) setProjectListSearch('');
  }, [isProjectDropdownOpen]);

  // 드롭다운 열릴 때 조직도 레이아웃: 모든 조직 섹션을 펼친다
  useEffect(() => {
    if (isProjectDropdownOpen && projectListLayout === 'org' && topLevelDivisions.length > 0) {
      const { blocks, unmapped } = orgChartListModel;
      const next = new Set(collectOrgExpandKeysForBlocks(blocks));
      if (unmapped.length > 0) next.add('org:__unmapped__');
      setExpandedOrgNodeKeys(next);
    }
  }, [isProjectDropdownOpen, projectListLayout, topLevelDivisions.length, orgChartListModel]);

  /** 헤더 프로젝트 목록 괄호 안: PM(조직도 기준 소속·직급 보조), 미입력 시 대시보드 카드와 동일하게「미지정」 */
  const projectDropdownPmLabel = (project: Project) => {
    const pm = (project.pmName ?? '').trim();
    if (!pm) return '미지정';
    return formatPersonDisplay(pm, { orgMetaByName: assigneeDisplayMetaByName });
  };

  // 권한 체크 헬퍼: 시스템 관리자 / 프로젝트 소유자만
  // 정책: 프로젝트는 만든 사람(소유자)과 시스템 관리자만 수정/삭제 가능. editor 멤버여도 수정 불가.
  const isProjectOwner = (p: Project) => !!user?.id && p.ownerId === user.id;
  const canManageProject = (p: Project) => effectiveIsAdmin || isProjectOwner(p);
  const canEditProject = canManageProject;
  // 삭제는 편집보다 엄격: 만든 사람(소유자)과 운영자(실제 is_admin / 관리자 모드)만.
  // 사내(@gmtc.kr) 일반 계정은 편집은 되어도 남의 프로젝트를 삭제하지 못한다(DB projects_delete와 일치).
  const realIsAdmin = (isAdmin || adminOverride) && !memberPreview;
  const canDeleteProject = (p: Project) => realIsAdmin || isProjectOwner(p);

  useEffect(() => {
    if (isProjectDropdownOpen && !wasDropdownOpen.current) {
      const next = new Set<string>();
      if (user?.id) next.add(user.id);
      next.add('__none__');
      if (currentProjectId !== 'all' && currentProject) {
        next.add(currentProject.ownerId ?? '__none__');
      }
      setExpandedOwnerKeys(next);
    }
    wasDropdownOpen.current = isProjectDropdownOpen;
  }, [isProjectDropdownOpen, user?.id, currentProjectId, currentProject]);

  const toggleOwnerGroup = (key: string) => {
    setExpandedOwnerKeys((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  useEffect(() => {
    if (!isMoreMenuOpen && !isUserMenuOpen && !isProjectDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (isMoreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(t)) setIsMoreMenuOpen(false);
      if (isUserMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) setIsUserMenuOpen(false);
      // 프로젝트 드롭다운: 드롭다운 영역(트리거 버튼+팝업) 밖을 누르면 닫는다.
      // z-50 인 헤더 버튼들(... 더보기, 사용자 메뉴 등)은 z-40 배경 오버레이를 통과하므로 별도 처리가 필요.
      if (isProjectDropdownOpen && projectDropdownRef.current && !projectDropdownRef.current.contains(t)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isMoreMenuOpen, isUserMenuOpen, isProjectDropdownOpen, setIsMoreMenuOpen, setIsProjectDropdownOpen]);

  const logoFallbackView = useMemo(() => {
    for (const v of LOGO_FALLBACK_VIEW_ORDER) {
      if (!hiddenViews.has(v)) return v;
    }
    return 'dashboard';
  }, [hiddenViews]);

  /** 로고 클릭 목적지 — 기본은 대시보드, 대시보드 탭이 숨김일 때만 첫 허용 뷰 */
  const logoTargetView = useMemo(() => (hiddenViews.has('dashboard') ? logoFallbackView : 'dashboard'), [hiddenViews, logoFallbackView]);

  const logoClickHint = useMemo(() => {
    if (view === logoTargetView) return '페이지를 새로고침합니다';
    return hiddenViews.has('dashboard') ? '홈 화면으로 이동합니다' : '대시보드로 이동합니다';
  }, [view, logoTargetView, hiddenViews]);

  const handleLogoClick = useCallback(() => {
    if (view === logoTargetView) {
      void requestRefresh();
      return;
    }
    navigateWithTip(logoTargetView);
  }, [view, logoTargetView, requestRefresh, navigateWithTip]);

  type MobileNavKey = 'dashboard' | 'todo' | 'table' | 'tablegantt' | 'tablekanban' | 'gantt' | 'kanban';
  const mobileBottomNavItems = useMemo((): { key: MobileNavKey; label: string; title: string; icon: React.ReactNode }[] => {
    const dashboardTitle =
      dashboardNavLabel !== '대시보드'
        ? '사업부·팀·PM·사업 기간 등 프로젝트 현황을 한눈에 봅니다.'
        : '프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다.';
    const items: { key: MobileNavKey; label: string; title: string; icon: React.ReactNode }[] = [
      { key: 'dashboard', label: dashboardNavLabel, title: dashboardTitle, icon: <LayoutDashboard size={14} /> },
      {
        key: 'todo',
        label: '칸반',
        title: '개인 할일 칸반 보드(할일·진행중·완료·기타). 나만 보는 To-Do입니다.',
        icon: <ClipboardList size={14} />,
      },
      {
        key: 'table',
        label: '표',
        title: '작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다.',
        icon: <CheckSquare size={14} />,
      },
      {
        key: 'tablegantt',
        label: '표+간',
        title: '작업표와 간트 차트를 한 화면에서 함께 봅니다. (가로 분할·모바일에서는 위·아래)',
        icon: <Columns2 size={14} />,
      },
      {
        key: 'tablekanban',
        label: '표+칸',
        title: '작업 표와 상태별 칸반을 한 화면에서 보며, 세로 스크롤이 함께 움직입니다.',
        icon: <LayoutPanelLeft size={14} />,
      },
      {
        key: 'gantt',
        label: '간트',
        title: '일정 막대를 드래그해 날짜를 조정하고, 선후관계를 확인합니다.',
        icon: <Target size={14} />,
      },
      {
        key: 'kanban',
        label: '칸반',
        title: '상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다.',
        icon: <MapIcon size={14} />,
      },
    ];
    return items.filter((i) => !hiddenViews.has(i.key));
  }, [dashboardNavLabel, hiddenViews]);

  return (
    <header
      className={cn(
        'border-b border-[var(--color-line)]/50 safe-top transition-all duration-300',
        /* 프로젝트 목록 스크림과 이중 블러되지 않게: 열릴 때는 헤더를 불투명 면으로 */
        isProjectDropdownOpen ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-surface)]/90 backdrop-blur-2xl',
        /* 표+간트 등 본문 sticky(z-60)보다 위: 프로젝트·더보기·계정 드롭다운이 헤더 아래로 펼칠 때 헤더 전체 z 상승 */
        isProjectDropdownOpen || isMoreMenuOpen || isUserMenuOpen ? 'z-[80]' : 'z-50',
        isHeaderCollapsed ? 'py-1 px-3 md:py-1.5 md:px-6' : 'px-3 md:px-6 py-1 md:py-1',
      )}
      style={{ boxShadow: 'var(--shadow-md), inset 0 -1px 0 rgba(0,0,0,0.02)' }}
    >
      {/* 모바일 접힌 상태: 최소 바 */}
      <div className={cn('flex md:hidden items-center justify-between gap-2', !isHeaderCollapsed && 'hidden')}>
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={handleLogoClick} className="shrink-0" title={logoClickHint} aria-label={logoClickHint}>
            <img src={logo} alt="GMT Logo" className="w-9 h-9 object-contain dark-logo" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-sm truncate">{wbsSettings.appTitle}</span>
          </div>
        </div>
        <button
          onClick={() => setIsHeaderCollapsed(false)}
          className="p-2.5 -mr-1 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-ink-subdued)] shrink-0"
          title="메뉴 펼치기"
          aria-label="메뉴 펼치기"
        >
          <ChevronDown size={20} />
        </button>
      </div>
      {/* 전체 헤더: 모바일에서 접혀 있으면 숨김 */}
      <div
        className={cn(
          'flex flex-col md:flex-row justify-between items-start md:items-center gap-1.5 md:gap-2',
          isHeaderCollapsed && 'hidden md:flex',
        )}
      >
        <div className="flex items-center gap-2 md:gap-2.5">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity shrink-0"
            role="button"
            tabIndex={0}
            onClick={handleLogoClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleLogoClick();
              }
            }}
            title={logoClickHint}
            aria-label={logoClickHint}
          >
            <img src={logo} alt="GMT Logo" className="w-9 h-9 md:w-10 md:h-10 object-contain dark-logo" />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5 md:flex-row md:items-center md:gap-2 md:flex-wrap">
            <h1 className="text-base md:text-sm font-bold tracking-tight leading-none md:leading-tight shrink-0">{wbsSettings.appTitle}</h1>

            <div className="relative md:mt-0 group hidden md:block" ref={projectDropdownRef}>
              <button
                data-tourid="tour-project"
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  if (tipOnce) tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 md:py-1 hover:bg-[var(--color-bg)] rounded-md transition-all border border-transparent hover:border-[var(--color-line)]"
                title={
                  dashboardFilterBarMode
                    ? '표·간트 등 작업 화면에서 사용할 프로젝트를 선택합니다. 대시보드 표시 범위는「필터」로 조정합니다.'
                    : '프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다.'
                }
              >
                <div className="flex flex-row flex-wrap items-center gap-x-2 gap-y-0 min-w-0">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none shrink-0">프로젝트</span>
                  <div className="flex items-center gap-1.5 min-w-0 text-sm md:text-base font-extrabold text-[var(--color-ink)] group-hover:text-[var(--color-accent)] leading-snug tracking-tight">
                    <span className="break-words text-left inline-flex flex-wrap items-center gap-1 min-w-0">
                      {dashboardFilterBarMode ? (
                        '프로젝트를 선택하세요'
                      ) : currentProjectId === 'all' ? (
                        `전체 프로젝트${allTasks.length > 0 ? ` (${allTasks.length}개)` : ''}`
                      ) : currentProject ? (
                        <ProjectNameLabel project={currentProject} name={currentProject.name} badgeClassName="text-[11px] px-2 py-0.5" />
                      ) : (
                        '프로젝트 선택'
                      )}
                      {!dashboardFilterBarMode &&
                        currentProjectId !== 'all' &&
                        currentProject &&
                        (taskCountByProject[currentProjectId] ?? 0) > 0 && (
                          <span className="text-slate-400 font-semibold text-xs md:text-sm shrink-0">
                            {' '}
                            ({taskCountByProject[currentProjectId]}개)
                          </span>
                        )}
                      {!dashboardFilterBarMode && currentProject?.ownerId && (currentProject.ownerId === user?.id || effectiveIsAdmin) && (
                        <span
                          className="text-[10px] md:text-xs text-slate-400 font-medium truncate max-w-[140px] border-l border-slate-200 pl-1.5 ml-0.5 shrink-0"
                          title={
                            currentProject.ownerId
                              ? (profileDisplayById[currentProject.ownerId] ?? profileMap[currentProject.ownerId] ?? currentProject.ownerId)
                              : undefined
                          }
                        >
                          {currentProject.ownerId === user?.id
                            ? '내 프로젝트'
                            : currentProject.ownerId
                              ? (profileDisplayById[currentProject.ownerId] ?? profileMap[currentProject.ownerId] ?? '다른 사용자')
                              : '소유자 없음'}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn('text-slate-400 shrink-0 transition-transform duration-200', isProjectDropdownOpen && 'rotate-180')}
                    />
                  </div>
                </div>
              </button>
              {presenceOthers && presenceOthers.length > 0 && currentProjectId !== 'all' && !dashboardFilterBarMode && (
                <div
                  className="absolute left-0 top-full mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200/80 text-amber-800 text-xs"
                  title="다른 사용자가 이 프로젝트를 보고 있습니다. 동시에 수정하면 충돌할 수 있어 저장 후 새로고침됩니다."
                >
                  <Users size={12} className="shrink-0 text-amber-600" />
                  <span className="font-medium">{presenceOthers.length}명이 보고 있음:</span>
                  <span className="truncate max-w-[180px]" title={presenceOthers.map((o) => o.displayName).join(', ')}>
                    {presenceOthers.map((o) => o.displayName).join(', ')}
                  </span>
                </div>
              )}
              {isProjectDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-slate-950/50 dark:bg-black/55 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
                    onClick={() => setIsProjectDropdownOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute top-full left-0 mt-2 w-[min(49.5rem,calc(100vw-1.5rem))] max-w-[100vw] bg-[var(--color-surface)] rounded-xl border-2 border-slate-300/90 dark:border-slate-500/80 overflow-hidden z-50 dropdown-menu shadow-[0_0_0_1px_rgba(15,23,42,0.1),0_28px_60px_-15px_rgba(15,23,42,0.35)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_22px_48px_-8px_rgba(0,0,0,0.72)]">
                    <div
                      className="px-3 py-2.5 flex items-center justify-between gap-2 bg-gradient-to-b from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-600"
                      title="내 프로젝트·관심·대시보드 반영만은 같은 버튼을 다시 누르면 전체 목록으로 돌아갑니다. 조직도별·인원별은 다시 누르면 기본(항목 구분) 목록으로 돌아갑니다."
                    >
                      <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">프로젝트 목록</span>
                      <div className="flex items-center gap-2">
                        {!!user?.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleListFilter('my');
                            }}
                            className={cn(
                              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                              listFilter === 'my'
                                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                : 'text-slate-400 hover:text-emerald-600 border border-transparent hover:border-[var(--color-line)]',
                            )}
                            title={
                              listFilter === 'my'
                                ? '전체 프로젝트 보기'
                                : '내가 소유자이거나, PM 이름이 내 프로필 이름과 같은 프로젝트만 보기'
                            }
                          >
                            <User size={10} />내 프로젝트만
                          </button>
                        )}
                        {topLevelDivisions.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              persistProjectListLayout(projectListLayout === 'org' ? 'kind' : 'org');
                            }}
                            className={cn(
                              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                              projectListLayout === 'org'
                                ? 'bg-teal-100 text-teal-800 border border-teal-200'
                                : 'text-slate-400 hover:text-teal-700 border border-transparent hover:border-[var(--color-line)]',
                            )}
                            title={
                              projectListLayout === 'org'
                                ? '항목 구분(상품·연구 등)별 기본 목록으로 돌아갑니다.'
                                : '조직 현황(조직도)의 부서·팀 구조로 묶습니다. PM 이름이 조직 인원과 같으면 그 부서를 사용하고, 아니면 소유자 회원 정보의 부서를 보조로 씁니다.'
                            }
                            aria-pressed={projectListLayout === 'org'}
                          >
                            <Network size={10} />
                            조직도별
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            persistProjectListLayout(projectListLayout === 'assignees' ? 'kind' : 'assignees');
                          }}
                          className={cn(
                            'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                            projectListLayout === 'assignees'
                              ? 'bg-violet-100 text-violet-900 border border-violet-200'
                              : 'text-slate-400 hover:text-violet-800 border border-transparent hover:border-[var(--color-line)]',
                          )}
                          title={
                            projectListLayout === 'assignees'
                              ? '항목 구분(상품·연구 등)별 기본 목록으로 돌아갑니다.'
                              : '프로젝트 투입 인원과 작업 담당자 이름을 합쳐 참여 인원 수가 같은 프로젝트끼리 묶어 봅니다. (이름이 비어 있으면 제외)'
                          }
                          aria-pressed={projectListLayout === 'assignees'}
                        >
                          <Users size={10} />
                          인원별
                        </button>
                        {favoriteIds.size > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleListFilter('favorites');
                            }}
                            className={cn(
                              'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                              listFilter === 'favorites'
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'text-slate-400 hover:text-amber-600 border border-transparent hover:border-[var(--color-line)]',
                            )}
                            title={listFilter === 'favorites' ? '전체 프로젝트 보기' : '관심(즐겨찾기) 프로젝트만 보기'}
                          >
                            <Star size={10} className={listFilter === 'favorites' ? 'fill-amber-500' : ''} />
                            {listFilter === 'favorites' ? `관심 ${favoriteIds.size}개` : '관심만'}
                          </button>
                        )}
                        <span
                          className="text-[10px] text-slate-400 shrink-0 tabular-nums"
                          title={
                            projectListSearchTrimmed ? '검색 일치 수 / 현재 목록 필터 적용 후 전체' : '현재 목록 필터 적용 후 프로젝트 수'
                          }
                        >
                          {projectListSearchTrimmed
                            ? `${displayProjectsForDropdown.length}/${displayProjects.length}`
                            : `${displayProjects.length}`}
                          개
                        </span>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-600 bg-[var(--color-surface)]">
                      <label htmlFor="wbs-project-list-search" className="sr-only">
                        프로젝트 검색
                      </label>
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                          aria-hidden
                        />
                        <input
                          id="wbs-project-list-search"
                          type="search"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="이름·PM으로 검색…"
                          value={projectListSearch}
                          onChange={(e) => setProjectListSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900/80 py-1.5 pl-8 pr-2 text-xs text-[var(--color-ink)] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                        />
                      </div>
                    </div>
                    <div className="p-1">
                      <div
                        role="option"
                        aria-selected={currentProjectId === 'all'}
                        className={cn(
                          'px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors border',
                          currentProjectId === 'all'
                            ? 'bg-sky-50 border-sky-200 text-sky-950 font-semibold ring-1 ring-sky-200/80'
                            : 'text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] border-transparent',
                        )}
                        onClick={() => {
                          selectProject('all');
                          setIsProjectDropdownOpen(false);
                        }}
                        title={
                          orphanAndUnassignedTaskCount > 0
                            ? `전체 ${allTasks.length}개 중 ${orphanAndUnassignedTaskCount}개는 목록에 없는 프로젝트·미지정 소속입니다.`
                            : '모든 프로젝트의 작업을 한 화면에서 확인합니다.'
                        }
                      >
                        <span className="truncate flex-1 inline-flex items-center gap-2 min-w-0">
                          <span className="truncate">전체</span>
                          {currentProjectId === 'all' && (
                            <span
                              className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-600 text-white"
                              title="지금 작업 중인 범위입니다."
                            >
                              현재
                            </span>
                          )}
                        </span>
                        {allTasks.length > 0 && <span className="text-[10px] text-slate-400 shrink-0">({allTasks.length}개)</span>}
                      </div>
                      {orphanAndUnassignedTaskCount > 0 && (
                        <div
                          className="mx-2 mb-1 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-100 text-[11px] text-amber-900 leading-snug"
                          title="DB·가져오기 불일치 등으로 프로젝트 메타와 어긋난 작업입니다. 필요 시 데이터 점검을 권장합니다."
                        >
                          목록 외·미지정 소속 <strong>{orphanAndUnassignedTaskCount}개</strong>
                          <span className="text-amber-700/90"> (전체 합계와 목록만 합산 시 숫자가 달라질 수 있음)</span>
                        </div>
                      )}
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                      {/* 목록 높이: 뷰포트 기준으로 제한(패널 위 헤더·배너 + 목록 머리줄 + 하단 프로젝트 관리 몫 19rem 예약) — 낮은 화면에서도 패널 하단이 잘리지 않게 */}
                      <div className="max-h-[min(calc(100vh_-_19rem),800px)] overflow-y-auto overscroll-contain pr-0.5">
                        {(() => {
                          if (projectListSearchTrimmed && displayProjectsForDropdown.length === 0) {
                            return (
                              <div className="px-3 py-6 text-center text-xs text-[var(--color-ink-subdued)] leading-relaxed">
                                검색과 일치하는 프로젝트가 없습니다.
                              </div>
                            );
                          }
                          const renderProjectRow = (project: Project) => {
                            const pmLabel = projectDropdownPmLabel(project);
                            const isCurrentProject = currentProjectId === project.id;
                            return (
                              <div
                                key={project.id}
                                role="option"
                                aria-selected={isCurrentProject}
                                className={cn(
                                  'px-3 py-1.5 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors border gap-1',
                                  isCurrentProject
                                    ? 'bg-sky-50 border-sky-200 text-sky-950 font-semibold ring-1 ring-sky-200/80'
                                    : 'text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] border-transparent',
                                )}
                                onClick={() => {
                                  selectProject(project.id);
                                  setIsProjectDropdownOpen(false);
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(project.id);
                                  }}
                                  className={cn(
                                    'shrink-0 p-0.5 rounded transition-colors',
                                    favoriteIds.has(project.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400',
                                  )}
                                  title={favoriteIds.has(project.id) ? '관심 해제' : '관심 프로젝트로 등록'}
                                >
                                  <Star size={12} className={favoriteIds.has(project.id) ? 'fill-amber-500' : ''} />
                                </button>
                                <div className="flex-1 min-w-0 break-words">
                                  <span className="inline-flex flex-wrap items-center gap-1">
                                    <ProjectNameLabel project={project} name={project.name} />
                                    {isCurrentProject && (
                                      <span
                                        className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-sky-600 text-white"
                                        title="지금 작업 중인 프로젝트입니다."
                                      >
                                        현재
                                      </span>
                                    )}
                                    <span className="text-[10px] text-slate-400" title="프로젝트 PM">
                                      ({pmLabel})
                                    </span>
                                  </span>
                                  {(taskCountByProject[project.id] ?? 0) > 0 && (
                                    <span className="text-[10px] text-slate-400 ml-1">· {taskCountByProject[project.id]}개</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {canManageProject(project) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setIsShareOpen(true);
                                        setIsProjectDropdownOpen(false);
                                      }}
                                      className="text-slate-400 hover:text-teal-600 p-1 rounded"
                                      title="프로젝트 공유"
                                      aria-label="프로젝트 공유"
                                    >
                                      <Share2 size={12} />
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProjectToCopy(project);
                                      setIsCopyProjectConfirmOpen(true);
                                      setIsProjectDropdownOpen(false);
                                    }}
                                    className="text-slate-400 hover:text-indigo-600 p-1 rounded"
                                    title="프로젝트 복사 (내 프로젝트로 복사본 생성)"
                                    aria-label="프로젝트 복사"
                                  >
                                    <Copy size={12} />
                                  </button>
                                  {canEditProject(project) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingProject(project);
                                        setIsProjectModalOpen(true);
                                        setIsProjectDropdownOpen(false);
                                      }}
                                      className="text-slate-400 hover:text-[var(--color-ink)] p-1 rounded"
                                      title="프로젝트 편집"
                                      aria-label="프로젝트 편집"
                                    >
                                      <Edit size={12} />
                                    </button>
                                  )}
                                  {canDeleteProject(project) && projectsSortedByName.length > 1 && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectToDelete(project);
                                        setIsProjectDropdownOpen(false);
                                        setIsDeleteProjectConfirmOpen(true);
                                      }}
                                      className="text-slate-400 hover:text-red-500 p-1 rounded"
                                      title="프로젝트 삭제"
                                      aria-label="프로젝트 삭제"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          };

                          if (projectListLayout === 'org' && topLevelDivisions.length > 0) {
                            const { blocks, unmapped } = orgChartListModel;
                            const renderOrgBranch = (divisionId: string, branch: OrgChartGroupBranch): React.ReactNode => {
                              const sub = countProjectsInOrgBranch(branch);
                              if (sub === 0) return null;
                              const ek = `org:${divisionId}:${branch.nodeId}`;
                              const expanded = expandedOrgNodeKeys.has(ek);
                              return (
                                <div key={ek} className="mb-0.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleOrgExpanded(ek)}
                                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)]"
                                    style={{ paddingLeft: 8 + branch.depth * 10 }}
                                  >
                                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    <Network size={12} className="text-teal-600 shrink-0" />
                                    <span className="text-xs font-semibold flex-1 text-left">{branch.title}</span>
                                    <span className="text-[10px] text-slate-400">{sub}</span>
                                  </button>
                                  {expanded && (
                                    <div className={branch.depth === 0 ? 'mt-0.5' : 'pl-2 ml-3 border-l border-[var(--color-line)]'}>
                                      {branch.children.map((c) => renderOrgBranch(divisionId, c))}
                                      {branch.projects.map((p) => renderProjectRow(p))}
                                    </div>
                                  )}
                                </div>
                              );
                            };

                            const nodes: React.ReactNode[] = [];
                            for (const b of blocks) {
                              if (b.totalInBlock === 0) continue;
                              nodes.push(
                                <div key={`org-div-${b.division.id}`} className="mb-2 last:mb-0">
                                  {renderOrgBranch(b.division.id, b.branch)}
                                </div>,
                              );
                            }
                            if (unmapped.length > 0) {
                              const umKey = 'org:__unmapped__';
                              const umEx = expandedOrgNodeKeys.has(umKey);
                              nodes.push(
                                <div key={umKey} className="mb-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleOrgExpanded(umKey)}
                                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)]"
                                  >
                                    {umEx ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    <Network size={12} className="text-slate-400 shrink-0" />
                                    <span className="text-xs font-semibold flex-1 text-left">조직 미매칭</span>
                                    <span className="text-[10px] text-slate-400">{unmapped.length}</span>
                                  </button>
                                  {umEx && (
                                    <div className="pl-7 border-l border-[var(--color-line)] ml-2">
                                      {unmapped.map((p) => renderProjectRow(p))}
                                    </div>
                                  )}
                                </div>,
                              );
                            }
                            if (nodes.length === 0) {
                              return (
                                <div className="px-3 py-2 text-[11px] text-[var(--color-ink-subdued)] leading-relaxed">
                                  조직도에 표시할 프로젝트가 없습니다. PM 이름을 조직 현황 인원과 동일하게 맞추거나, 회원 프로필의 부서가
                                  조직도 부서명과 맞는지 확인해 주세요.
                                </div>
                              );
                            }
                            return nodes;
                          }

                          if (projectListLayout === 'assignees') {
                            if (projectsByParticipantSections.length === 0) {
                              return (
                                <div className="px-3 py-2 text-[11px] text-[var(--color-ink-subdued)] leading-relaxed">
                                  표시할 프로젝트가 없습니다.
                                </div>
                              );
                            }
                            return projectsByParticipantSections.map(({ participantCount, projects: list }) => (
                              <section key={`part-${participantCount}`} className="mb-2 last:mb-0">
                                <div
                                  className={cn(
                                    'sticky top-0 z-[1] flex items-center gap-2 px-2 py-1.5 mb-0.5 rounded-md border',
                                    participantCount === 0
                                      ? 'bg-amber-50 border-amber-100 text-amber-950'
                                      : 'bg-violet-50 border-violet-100 text-violet-950',
                                  )}
                                  title="투입 인원(assignments)과 작업 담당자(assignee) 표시명을 합친 서로 다른 이름 수입니다."
                                >
                                  <span className="text-xs font-bold">
                                    {participantCount === 0 ? '참여 인원 없음' : `참여 인원 ${participantCount}명`}
                                  </span>
                                  <span className="text-[10px] font-medium opacity-80 tabular-nums">({list.length}개)</span>
                                </div>
                                {list.map((p) => renderProjectRow(p))}
                              </section>
                            ));
                          }

                          return projectsByKindSections.map(({ sectionKey, headerLabel, headerBadgeClass, projects: list }) => (
                            <section key={sectionKey} className="mb-2 last:mb-0">
                              <div
                                className={cn(
                                  'sticky top-0 z-[1] flex items-center gap-2 px-2 py-1.5 mb-0.5 rounded-md border',
                                  headerBadgeClass,
                                )}
                              >
                                <span className="text-xs font-bold">{headerLabel}</span>
                                <span className="text-[10px] font-medium opacity-80 tabular-nums">({list.length}개)</span>
                              </div>
                              {list.map((p) => renderProjectRow(p))}
                            </section>
                          ));
                        })()}
                      </div>
                      {/* 프로젝트 관리 — 초보자 동선 단순화를 위해 기본 숨김. Shift+F12(숨김 헤더 항목 표시)로 노출 */}
                      {!hiddenViews.has('projects') && showHiddenHeaderItems && (
                        <>
                          <div className="border-t border-[var(--color-line)] my-1"></div>
                          <button
                            onClick={() => {
                              setIsProjectDropdownOpen(false);
                              setView('projects');
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] rounded-lg flex items-center gap-2 transition-colors"
                            title="프로젝트 관리 페이지로 이동합니다. (Shift+F12로 이 메뉴 표시를 켜고 끕니다)"
                          >
                            <Briefcase size={14} /> 프로젝트 관리
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          {/* 새 프로젝트 — 헤더 상단에 항상 노출. 드롭다운을 열지 않아도 한 번에 생성. */}
          {!hiddenViews.has('projects') && (
            <button
              type="button"
              data-tourid="tour-new-project"
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-accent)] text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors shadow-sm shrink-0"
              title="새 프로젝트를 생성합니다."
            >
              <FolderPlus size={12} />
              <span>새 프로젝트</span>
            </button>
          )}
          {/* 현재 프로젝트 수정·복사 — 특정 프로젝트를 보고 있을 때만. 수정은 소유자·시스템 관리자만(드롭다운 행과 동일). */}
          {!hiddenViews.has('projects') && !dashboardFilterBarMode && currentProjectId !== 'all' && currentProject && (
            <>
              {canEditProject(currentProject) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingProject(currentProject);
                    setIsProjectModalOpen(true);
                  }}
                  className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700 text-[11px] font-semibold hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm shrink-0"
                  title={`프로젝트 '${currentProject.name}' 정보를 수정합니다.`}
                >
                  <Edit size={12} />
                  <span>수정</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setProjectToCopy(currentProject);
                  setIsCopyProjectConfirmOpen(true);
                }}
                className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-indigo-100 bg-indigo-50 text-indigo-800 text-[11px] font-semibold hover:bg-indigo-100 hover:border-indigo-200 transition-colors shadow-sm shrink-0"
                title={`프로젝트 '${currentProject.name}'를 내 프로젝트로 복사합니다.`}
              >
                <Copy size={12} />
                <span>복사</span>
              </button>
            </>
          )}
          {/* 현재 프로젝트 삭제 — 「새 프로젝트」 옆. 특정 프로젝트를 보고 있고 삭제 권한(소유자·운영자)이 있을 때만 노출. */}
          {!hiddenViews.has('projects') &&
            !dashboardFilterBarMode &&
            currentProjectId !== 'all' &&
            currentProject &&
            canDeleteProject(currentProject) &&
            projectsSortedByName.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setProjectToDelete(currentProject);
                  setIsDeleteProjectConfirmOpen(true);
                }}
                className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-600 text-[11px] font-semibold hover:bg-red-100 hover:text-red-700 transition-colors shadow-sm shrink-0"
                title={`현재 프로젝트 '${currentProject.name}'와(과) 소속된 모든 작업을 삭제합니다. 되돌릴 수 없습니다.`}
              >
                <Trash2 size={12} />
                <span>프로젝트 삭제</span>
              </button>
            )}
        </div>

        {/* 모바일 전용: 대시보드 NavButton만 1개 표시. 클릭해도 페이지 전환 없음. */}
        {!hiddenViews.has('dashboard') && (
          <div className="flex md:hidden items-center w-full justify-center">
            <NavButton
              active={view === 'dashboard'}
              onClick={() => {
                /* 모바일: 페이지 전환 없음 (현재 화면 유지) */
              }}
              icon={<LayoutDashboard size={14} />}
              label={dashboardNavLabel}
              title={
                dashboardNavLabel !== '대시보드'
                  ? '사업부·팀·PM·사업 기간 등 프로젝트 현황을 한눈에 봅니다.'
                  : '프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다.'
              }
            />
          </div>
        )}
        <div className="hidden md:flex flex-wrap gap-1 items-center w-full md:w-auto overflow-x-auto overflow-y-visible md:overflow-visible md:pb-0 md:mb-0">
          {/* 툴바: 되돌리기 / 다시실행 */}
          <div className="flex items-center gap-0.5 mr-0.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="icon-btn !p-1 text-[var(--color-ink-subdued)] hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="실행 취소 (Ctrl+Z)"
              aria-label="실행 취소 (Ctrl+Z)"
            >
              <History size={14} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="icon-btn !p-1 text-[var(--color-ink-subdued)] hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="다시 실행 (Ctrl+Y)"
              aria-label="다시 실행 (Ctrl+Y)"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <div className="toolbar-divider hidden md:block" />
          {/* 뷰 탭 바(데스크톱 전용): 모바일은 하단 고정 탭바 사용 */}
          <div className="hidden md:flex bg-[var(--color-bg)]/70 p-px rounded-md border border-[var(--color-line)]/60 overflow-x-auto overflow-y-visible md:overflow-visible shrink-0 min-w-0 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent gap-px">
            {!hiddenViews.has('dashboard') && (
              <NavButton
                active={view === 'dashboard'}
                onClick={() => navigateWithTip('dashboard')}
                icon={<LayoutDashboard size={14} />}
                label={dashboardNavLabel}
                title={
                  dashboardNavLabel !== '대시보드'
                    ? '사업부·팀·PM·사업 기간 등 프로젝트 현황을 한눈에 봅니다.'
                    : '프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다.'
                }
                tourId="tour-nav-dashboard"
              />
            )}
            {showHiddenHeaderItems && !hiddenViews.has('allocation') && (
              <NavButton
                active={view === 'allocation'}
                onClick={() => navigateWithTip('allocation')}
                icon={<Users size={14} />}
                label="투입현황"
                title="투입 인원·투입 비율·프로젝트별 WBS 공수를 확인·편집합니다."
                tourId="tour-nav-allocation"
              />
            )}
            {/* 표 / 표+간트 / 간트 통합 로테이션 버튼: 한 번 클릭마다 다음 모드로 순환(표 → 표+간트 → 간트 → 표 …).
                현재 모드 외 모드 중 hiddenViews에 포함되지 않은 다음 모드로 이동한다. */}
            {(() => {
              const cycle: Array<{
                id: 'table' | 'tablegantt' | 'gantt';
                label: string;
                icon: React.ReactNode;
                title: string;
                tourId: string;
              }> = [
                {
                  id: 'table',
                  label: '표',
                  icon: <CheckSquare size={14} />,
                  title: '작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다.',
                  tourId: 'tour-nav-table',
                },
                {
                  id: 'tablegantt',
                  label: '표+간트',
                  icon: <Columns2 size={14} />,
                  title: '작업표와 간트 차트를 한 화면에서 함께 봅니다. (가로 분할·모바일에서는 위·아래)',
                  tourId: 'tour-nav-tablegantt',
                },
                {
                  id: 'gantt',
                  label: '간트',
                  icon: <Target size={14} />,
                  title: '일정 막대를 드래그해 날짜를 조정하고, 선후관계를 확인합니다.',
                  tourId: 'tour-nav-gantt',
                },
              ];
              const enabled = cycle.filter((c) => !hiddenViews.has(c.id));
              if (enabled.length === 0) return null;
              const currentIdx = enabled.findIndex((c) => c.id === view);
              const isCurrentInCycle = currentIdx >= 0;
              // 작업 화면이 아닐 때(예: 대시보드)는 기본으로 '표+간트'를 표시하고, 클릭 시 표+간트로 진입한다.
              const tableGanttEntry = enabled.find((c) => c.id === 'tablegantt') ?? enabled[0];
              const current = isCurrentInCycle ? enabled[currentIdx] : tableGanttEntry;
              const next = isCurrentInCycle ? enabled[(currentIdx + 1) % enabled.length] : tableGanttEntry;
              return (
                <NavButton
                  active={isCurrentInCycle}
                  onClick={() => navigateWithTip(next.id)}
                  icon={current.icon}
                  label={current.label}
                  title={[current.title, '', `클릭: ${next.label} 모드로 전환`].join('\n')}
                  tourId={current.tourId}
                />
              );
            })()}
            {!hiddenViews.has('tablekanban') && (
              <NavButton
                active={view === 'tablekanban'}
                onClick={() => navigateWithTip('tablekanban')}
                icon={<LayoutPanelLeft size={14} />}
                label="표+칸반"
                title="작업 표와 상태별 칸반을 한 화면에서 보며, 세로 스크롤이 서로 맞춰집니다."
                tourId="tour-nav-tablekanban"
              />
            )}
            {!hiddenViews.has('todo') && (
              <NavButton
                active={view === 'todo'}
                onClick={() => navigateWithTip('todo')}
                icon={<ClipboardList size={14} />}
                label="칸반"
                title="개인 할일 칸반 보드(할일·진행중·완료·기타). 나만 보는 To-Do입니다."
                tourId="tour-nav-todo"
              />
            )}
            {showHiddenHeaderItems && !hiddenViews.has('weekreport') && (
              <NavButton
                active={view === 'weekreport'}
                onClick={() => navigateWithTip('weekreport')}
                icon={<FileText size={14} />}
                label="주간보고"
                title="지엠티 주간업무보고 통합 대시보드. (@gmtc.kr 사내 회원 전용)"
                tourId="tour-nav-weekreport"
              />
            )}
            {!hiddenViews.has('outlook') && (
              <NavButton
                active={view === 'outlook'}
                onClick={() => navigateWithTip('outlook')}
                icon={<TrendingUp size={14} />}
                label="영업 아웃룩"
                title="사업부별 수주·청구 계획과 매출장을 업로드해 조회·집계합니다. (@gmtc.kr 사내 회원 전용)"
                tourId="tour-nav-outlook"
              />
            )}
            {!hiddenViews.has('kanban') && (
              <NavButton
                active={view === 'kanban'}
                onClick={() => navigateWithTip('kanban')}
                icon={<MapIcon size={14} />}
                label="칸반"
                title="상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다."
                tourId="tour-nav-kanban"
              />
            )}
            {/* 마인드맵: 관리자에게도 숨김 처리 */}
          </div>

          <div className="toolbar-divider" />

          {/* 버그 사항 링크 — 항상 표시 */}
          <a
            href="https://docs.google.com/document/d/1h_St7qRXMRxGsV6i780uCmNSYax3a4PaazTFZgT2gqQ/edit?tab=t.0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-subdued)] hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all shrink-0"
            title="버그 사항 시트로 이동"
          >
            <span className="hidden sm:inline">버그 사항</span>
          </a>

          {/* Filter: WBS 작업 필터 | 대시보드는 상단 도구줄(부서·프로젝트 표시)과 연동 — Shift+F12로 표시 토글 */}
          {showHiddenHeaderItems &&
            (dashboardFilterBarMode ? (
              <button
                type="button"
                data-tourid="tour-filter"
                onClick={() => onDashboardFilterToolbarClick?.()}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border transition-all shrink-0',
                  dashboardFiltersActive || showDashboardFilterToolbar
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/25'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:border-slate-300 hover:text-[var(--color-ink)]',
                )}
                title={
                  showDashboardFilterToolbar
                    ? dashboardFiltersActive
                      ? '표시 범위가 적용된 상태입니다. 클릭하면 도구줄을 닫습니다.'
                      : '도구줄이 열려 있습니다. 클릭하면 닫습니다.'
                    : dashboardFiltersActive
                      ? '일부만 표시 중 — 클릭하면 표시 도구줄을 엽니다.'
                      : '대시보드 표시 범위(부서·프로젝트) — 클릭하면 표시 도구줄을 엽니다.'
                }
              >
                <Settings2 size={14} />
                <span className="hidden sm:inline">필터</span>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-md',
                    dashboardFiltersActive || showDashboardFilterToolbar
                      ? 'bg-[var(--color-surface)]/20'
                      : 'bg-[var(--color-bg)] text-slate-400',
                  )}
                >
                  {dashboardFiltersActive || showDashboardFilterToolbar ? 'On' : 'Off'}
                </span>
              </button>
            ) : (
              <button
                data-tourid="tour-filter"
                type="button"
                onClick={() => {
                  setFilterOn((v) => !v);
                  if (tipOnce) tipOnce('menu.filter', '필터를 켜면 상태/담당자/기간으로 작업을 좁혀 볼 수 있어요.');
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border transition-all shrink-0',
                  filterOn
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/25'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:border-slate-300 hover:text-[var(--color-ink)]',
                )}
                title={
                  filterOn
                    ? '필터가 켜져 있습니다. 다시 누르면 필터를 끄고 조건 없이 전체 작업을 표시합니다.'
                    : '상태·담당자·기간 등으로 작업 목록을 좁혀 봅니다. 켜면 필터 바가 나타납니다.'
                }
              >
                <Settings2 size={14} /> {/* Replace Filter */}
                <span className="hidden sm:inline">필터</span>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-md',
                    filterOn ? 'bg-[var(--color-surface)]/20' : 'bg-[var(--color-bg)] text-slate-400',
                  )}
                >
                  {filterOn ? 'On' : 'Off'}
                </span>
              </button>
            ))}

          {/* 더보기 — 이전 커밋과 동일 구조 (기능·데이터·설정·관리자·삭제) */}
          <div className="relative shrink-0 z-50 ml-0.5" ref={moreMenuRef}>
            <button
              type="button"
              data-tourid="tour-more"
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className={cn(
                'icon-btn !p-1 transition-colors relative shrink-0',
                isMoreMenuOpen
                  ? 'text-[var(--color-ink)] bg-[var(--color-bg)]'
                  : 'text-[var(--color-ink-subdued)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)]',
              )}
              title="가져오기·보내기·단축키 등. 사용 설명서·조직·회원 관리·작업 로그·삭제는 Shift+F12 후 ⋮ 또는 상단 관리 메뉴에서 열 수 있습니다."
              aria-label="추가 옵션"
            >
              <MoreHorizontal size={15} />
            </button>
            {isMoreMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-gray-900/30 backdrop-blur-[2px] dark:bg-black/45"
                  onClick={() => setIsMoreMenuOpen(false)}
                  aria-hidden
                />
                <div className="absolute top-full right-0 mt-2 w-44 max-h-[min(calc(100vh_-_11rem),40rem)] bg-[var(--color-surface)] rounded-xl border border-[var(--color-line)] overflow-y-auto overscroll-contain z-50 shadow-[var(--shadow-xl)] ring-1 ring-slate-900/[0.08] dark:ring-white/12 dropdown-menu flex flex-col py-1">
                  {(onStartTour || (onOpenTutorial && showHiddenHeaderItems)) && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">도움말</div>
                      {onOpenTutorial && showHiddenHeaderItems && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            onOpenTutorial();
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                          title="화면 구성·프로젝트·작업·단축키 등 사용법 전체를 글로 정리한 설명서를 엽니다. (Shift+F12로 이 메뉴 표시)"
                        >
                          <BookOpen size={14} /> 사용 설명서
                        </button>
                      )}
                      {onStartTour && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            onStartTour();
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] hidden md:flex items-center gap-2"
                          title="신규 프로젝트 만들기 → 첫 작업 입력 순서를 실제 화면 위에서 단계별로 안내합니다."
                        >
                          <Route size={14} /> 따라하기 투어
                        </button>
                      )}
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                    </>
                  )}
                  {(userApproved || effectiveIsAdmin) && showHiddenHeaderItems && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">조직</div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsOrganizationOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                        title="조직도·부서·인원 구조를 확인하고, 회원과 연동되는 표시 정보를 점검할 수 있는 화면으로 이동합니다. (Shift+F12로 이 메뉴 표시)"
                      >
                        <Users size={14} /> 조직 현황
                      </button>
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                    </>
                  )}
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">데이터</div>
                  <button
                    type="button"
                    disabled={!canEditCurrentProject}
                    onClick={() => {
                      if (!canEditCurrentProject) return;
                      setIsMoreMenuOpen(false);
                      handleImportClick();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title={
                      canEditCurrentProject
                        ? 'Excel 또는 JSON 파일에서 작업표를 불러와 현재 프로젝트에 반영합니다. 형식에 따라 병합·치환 범위를 확인하세요.'
                        : '편집 권한이 있는 프로젝트에서만 가져올 수 있습니다. 소유자·관리자에게 권한을 요청하거나 다른 프로젝트를 선택하세요.'
                    }
                  >
                    <Upload size={14} /> 가져오기
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsExportModalOpen(true);
                      tipOnce?.('menu.export', '보내기: 범위와 파일 형식(Excel/JSON/Markdown)을 선택해 받을 수 있어요.');
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                    title="현재 프로젝트(또는 모달에서 선택한 범위)를 Excel·JSON·Markdown 등으로 보냅니다. 보관·공유·백업에 활용할 수 있습니다."
                  >
                    <Download size={14} />
                    보내기
                  </button>
                  {onSaveProjectRegistrationPdf && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        tipOnce?.(
                          'menu.pdfRegistration',
                          '대시보드에 집계된 프로젝트별 요약(작업 수·진척률·담당자 수)을 PDF로 저장합니다. 세부 작업 목록은 포함되지 않습니다.',
                        );
                        void Promise.resolve(onSaveProjectRegistrationPdf()).catch(() => {});
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                      title="대시보드 집계와 동일한 프로젝트 등록현황 요약을 PDF 파일로 저장합니다. 다른 화면에 있으면 대시보드로 전환한 뒤 저장합니다."
                    >
                      <FileDown size={14} />
                      PDF 저장
                    </button>
                  )}

                  <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">설정</div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsShortcutsVisible(!isShortcutsVisible);
                      tipOnce?.('menu.shortcuts', '오른쪽에 키보드 단축키 패널을 엽니다. (입력란에 포커스가 없을 때 Shift+? 로도 토글)');
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                    title="키보드 단축키 안내 패널을 열거나 닫습니다. Shift+? 로도 토글할 수 있습니다."
                  >
                    <Keyboard size={14} /> 단축키
                  </button>

                  {showHiddenHeaderItems && (allowMembersManagement || showSuperAdminDeleteMenu) && (
                    <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                  )}

                  {showHiddenHeaderItems && allowMembersManagement && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                        {effectiveIsAdmin ? '관리자 기능' : '조직 관리'}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsMembersModalOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-teal-600 hover:bg-teal-50 flex items-center gap-2"
                        title="조직 회원 목록·승인·역할·프로젝트별 접근 권한을 확인하고 수정합니다. 시스템 관리자 또는 조직 책임자만 열 수 있습니다. (Shift+F12로 이 메뉴 표시)"
                      >
                        <Users size={14} /> 회원 관리
                      </button>
                      {/* 작업 로그(변경 이력): 회원들이 언제 무엇을 생성·수정·삭제했는지 전체 조회. 운영자(realIsAdmin)만. */}
                      {realIsAdmin && onOpenAuditLog && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            onOpenAuditLog();
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 flex items-center gap-2"
                          title="회원들이 언제 무엇을 생성·수정·삭제했는지(프로젝트·작업) 전체 변경 이력을 조회합니다. 운영자만 볼 수 있습니다. (Shift+F12로 이 메뉴 표시)"
                        >
                          <History size={14} /> 작업 로그
                        </button>
                      )}
                      {/* 일반 사용자 화면 진입은 Alt+Shift+F12 (계정 메뉴에서는 미리보기 중일 때만 관리자 화면으로 복귀) */}
                      {/* 로컬 초기화: 관리자에게도 숨김 처리 */}
                    </>
                  )}

                  {showHiddenHeaderItems && showSuperAdminDeleteMenu && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setIsDeleteChoiceOpen(true);
                        tipOnce?.('menu.deleteAll', '삭제 및 초기화 메뉴입니다.');
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 mt-1 border-t border-[var(--color-line)] pt-2 pb-1"
                      title="선택한 프로젝트·작업만 삭제하거나, 조직 데이터를 초기화하는 등 되돌리기 어려운 작업을 수행합니다. 실행 전 내용을 반드시 확인하세요. (Shift+F12로 이 메뉴 표시)"
                    >
                      <Trash2 size={14} /> 부분/전체 삭제
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* "+ 새 작업" 헤더 버튼은 제거됨 — 표 화면 하단의 「+ 새 작업 추가」 인라인 행과 단축키(Enter)로 추가한다. */}

          {headerRightSlot}

          {user?.id && (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((o) => !o)}
                className="flex items-center gap-1 px-1.5 py-1 text-[11px] font-medium rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-bg)] max-w-[140px] sm:max-w-[180px]"
                title={
                  memberPreview && canSwitchAdminMemberView
                    ? '계정: 일반 사용자 화면 모드 (Alt+Shift+F12 또는 아래 메뉴에서 관리자 화면으로 전환)'
                    : canSwitchAdminMemberView
                      ? '계정 (Alt+Shift+F12로 일반 사용자 화면 전환)'
                      : '계정'
                }
              >
                <User size={14} className="shrink-0 text-[var(--color-ink-subdued)]" />
                <span className="truncate">{currentUserDisplay || user?.email || '계정'}</span>
                {memberPreview && canSwitchAdminMemberView && (
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" title="일반 사용자 화면 모드" aria-hidden />
                )}
                <ChevronDown size={12} className={cn('shrink-0 opacity-50', isUserMenuOpen && 'rotate-180')} />
              </button>
              {isUserMenuOpen && (
                <div className="absolute right-0 top-full mt-1 py-1 min-w-[200px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)] z-[60]">
                  {canSwitchAdminMemberView && memberPreview && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">사용자·관리자</div>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-amber-900 hover:bg-amber-50 flex items-center gap-2"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setMemberPreview(false);
                        }}
                        title="Alt+Shift+F12로도 전환할 수 있습니다."
                      >
                        <EyeOff size={14} /> 관리자 화면으로 전환
                      </button>
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                    </>
                  )}
                  {user?.id &&
                    !effectiveIsAdmin &&
                    setIsProjectEditAccessRequestModalOpen &&
                    currentProjectId &&
                    currentProjectId !== 'all' &&
                    !canEditCurrentProject &&
                    currentProject &&
                    currentProject.ownerId &&
                    currentProject.ownerId !== user.id && (
                      <>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setIsProjectEditAccessRequestModalOpen(true);
                          }}
                          title="프로젝트 소유자 또는 시스템 관리자가 회원 관리에서 승인하면 편집할 수 있습니다."
                        >
                          <Edit size={14} /> 프로젝트 편집 권한 요청…
                        </button>
                        <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                      </>
                    )}
                  {user?.id && !effectiveIsAdmin && setIsAdminAccessRequestModalOpen && (
                    <>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setIsAdminAccessRequestModalOpen(true);
                        }}
                        title="기존 시스템 관리자의 승인이 필요합니다."
                      >
                        <Shield size={14} /> 시스템 관리자 권한 요청…
                      </button>
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                    </>
                  )}
                  {user?.id && !effectiveIsAdmin && setIsAdminPasswordModalOpen && (
                    <>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-bg)] flex items-center gap-2"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setIsAdminPasswordModalOpen(true);
                        }}
                        title="DB에 관리자로 등록되지 않은 경우, 앱 비밀번호로 관리자 기능을 켤 수 있습니다."
                      >
                        <ShieldCheck size={14} /> 관리자 비밀번호로 전환…
                      </button>
                      <div className="h-px bg-[var(--color-bg)] my-1 mx-2" />
                    </>
                  )}
                  {/* 테마 선택 영역은 일시적으로 숨김 (라이트 모드 고정) */}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    title="현재 계정의 세션을 종료하고 로그인 화면으로 돌아갑니다. 저장되지 않은 변경이 있다면 먼저 저장하세요."
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      void signOut();
                    }}
                  >
                    <LogOut size={14} /> 로그아웃
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setIsHeaderCollapsed(true)}
            className="md:hidden p-2 rounded-lg text-[var(--color-ink-subdued)] hover:bg-[var(--color-bg)] transition-colors"
            title="메뉴 접어서 표 넓게 보기"
            aria-label="메뉴 접어서 표 넓게 보기"
          >
            <ChevronUp size={17} />
          </button>
        </div>
      </div>
      {/* 모바일 하단 고정 탭바: 숨김 설정에 따라 대시보드 / 표 / … */}
      {!lockMobileToDashboard && mobileBottomNavItems.length > 0 && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[70] border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur-xl px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-0.5">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${mobileBottomNavItems.length}, minmax(0, 1fr))` }}>
            {mobileBottomNavItems.map((item) => (
              <NavButton
                key={item.key}
                active={view === item.key}
                onClick={() => navigateWithTip(item.key)}
                icon={item.icon}
                label={item.label}
                title={item.title}
              />
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
