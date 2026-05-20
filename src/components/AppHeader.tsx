import React, { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { useMatchMedia } from '../hooks/useMatchMedia';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Tag,
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
  FolderOpen,
  Briefcase,
  Share2,
  Copy,
  Edit,
  LayoutDashboard,
  CheckSquare,
  Columns2,
  Target,
  MoreHorizontal,
  Sun,
  Moon,
  Monitor,
  Star,
  EyeOff,
  Layers,
} from 'lucide-react';
import { NavButton } from './NavButton';
import { ProjectNameLabel } from './ProjectNameLabel';
import { getProjectKindBadgeClass, groupProjectsByKind } from '../lib/projectKind';
import { WbsFilterBar } from './FilterBar';
import type { Project, Task } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import type { PresenceUser } from '../hooks/usePresence';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface AppHeaderProps {
  wbsSettings: WBSSettings;
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (v: boolean) => void;
  requestRefresh: () => void;
  logo: string;
  appVersion: string;
  formatCommitDate: (d: string) => string;
  formatCommitDateDateOnly: (d: string) => string;
  appCommitDate: string;
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
  signOut: () => void;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: (v: boolean) => void;
  setIsWeeklyReportOpen: (v: boolean) => void;
  setIsOrganizationOpen: (v: boolean) => void;
  /** 승인된 사용자 여부. 조직 현황 메뉴 노출 조건. */
  userApproved: boolean;
  handleImportClick: () => void;
  setIsExportModalOpen: (v: boolean) => void;
  setIsSettingsModalOpen: (v: boolean) => void;
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
}

export function AppHeader({
  wbsSettings,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  requestRefresh,
  logo,
  appVersion,
  formatCommitDate,
  formatCommitDateDateOnly,
  appCommitDate,
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
  signOut,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  setIsWeeklyReportOpen,
  setIsOrganizationOpen,
  userApproved,
  handleImportClick,
  setIsExportModalOpen,
  setIsSettingsModalOpen,
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

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [expandedOwnerKeys, setExpandedOwnerKeys] = useState<Set<string>>(new Set());
  const wasDropdownOpen = useRef(false);
  /** 목록 필터: 전체 / 내 프로젝트 / 관심 — 서로 토글(같은 버튼 다시 누르면 전체). */
  type ProjectListFilter = 'all' | 'my' | 'favorites';
  const PROJECT_LIST_FILTER_KEY = 'wbs-header-projects-list-filter';
  /** 폴더(조직 그룹) vs 항목 구분(상품·연구·용역·유지·제품·기타) — 그룹이 정의된 경우에만 UI 표시. */
  type ProjectListLayout = 'kind' | 'group';
  const PROJECT_LIST_LAYOUT_KEY = 'wbs-header-projects-list-layout';
  /** 구버전: 필터+그룹 레이아웃이 한 키에 묶여 있었음 → 최초 로드 시 분리 마이그레이션 */
  const PROJECT_LIST_MODE_LEGACY_KEY = 'wbs-header-projects-list-mode';

  const [listFilter, setListFilter] = useState<ProjectListFilter>(() => {
    try {
      const nf = localStorage.getItem(PROJECT_LIST_FILTER_KEY);
      if (nf === 'my' || nf === 'favorites') return nf;
      const legacy = localStorage.getItem(PROJECT_LIST_MODE_LEGACY_KEY);
      if (legacy === 'my') return 'my';
      if (legacy === 'favorites') return 'favorites';
      if (localStorage.getItem('wbs-header-projects-my-only') === '1') return 'my';
      return 'all';
    } catch {
      return 'all';
    }
  });

  const [projectListLayout, setProjectListLayout] = useState<ProjectListLayout>(() => {
    try {
      const nl = localStorage.getItem(PROJECT_LIST_LAYOUT_KEY);
      if (nl === 'group' || nl === 'kind') return nl;
      const legacy = localStorage.getItem(PROJECT_LIST_MODE_LEGACY_KEY);
      if (legacy === 'group') return 'group';
      if (
        localStorage.getItem('wbs-header-projects-group-assigned-only') === '1' ||
        localStorage.getItem('wbs-header-projects-group-layout') === '1' ||
        localStorage.getItem('wbs-header-projects-by-group') === '1'
      ) {
        return 'group';
      }
      return 'kind';
    } catch {
      return 'kind';
    }
  });
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());

  // 관심 프로젝트 (즐겨찾기) — wbsSettings(DB) 동기화
  const favoriteIds = useMemo(() => new Set(wbsSettings.favoriteProjectIds ?? []), [wbsSettings.favoriteProjectIds]);

  const persistListFilter = (next: ProjectListFilter) => {
    setListFilter(next);
    try {
      if (next === 'all') localStorage.removeItem(PROJECT_LIST_FILTER_KEY);
      else localStorage.setItem(PROJECT_LIST_FILTER_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const persistProjectListLayout = (next: ProjectListLayout) => {
    setProjectListLayout(next);
    try {
      localStorage.setItem(PROJECT_LIST_LAYOUT_KEY, next);
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
    if (listFilter === 'my' && user?.id) return base.filter((p) => p.ownerId === user.id);
    if (listFilter === 'favorites') return base.filter((p) => favoriteIds.has(p.id));
    return base;
  }, [projectsSortedByName, listFilter, favoriteIds, user?.id]);

  const projectsByKind = useMemo(() => groupProjectsByKind(displayProjects), [displayProjects]);

  /** 소유자(owner)별 프로젝트 그룹 — 표시명순(내 프로젝트·미지정 처리) */
  const ownerGroups = useMemo(() => {
    type P = (typeof projectsSortedByName)[number];
    const map = new Map<string, P[]>();
    for (const p of projectsSortedByName) {
      const k = p.ownerId ?? '__none__';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ko') || (a.id ?? '').localeCompare(b.id ?? '', 'ko'));
    }
    const entries: [string, P[]][] = [...map.entries()];
    entries.sort(([ka], [kb]) => {
      if (user?.id && ka === user.id) return -1;
      if (user?.id && kb === user.id) return 1;
      if (ka === '__none__') return 1;
      if (kb === '__none__') return -1;
      const na = profileMap[ka] || ka;
      const nb = profileMap[kb] || kb;
      return na.localeCompare(nb, 'ko');
    });
    return entries;
  }, [projectsSortedByName, user?.id, profileMap]);

  /** 사용자 정의 프로젝트 그룹 정렬 */
  const sortedProjectGroups = useMemo(() => {
    const list = wbsSettings.projectGroups ?? [];
    return [...list].sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [wbsSettings.projectGroups]);

  /** 표시할 프로젝트들을 그룹 단위로 묶음. "그룹 미지정"은 마지막 항목으로 자동 추가. */
  const projectsByGroup = useMemo(() => {
    const map = new Map<string, Project[]>();
    sortedProjectGroups.forEach((g) => map.set(g.id, []));
    map.set('__none__', []);
    for (const p of displayProjects) {
      const k = p.groupId && map.has(p.groupId) ? p.groupId : '__none__';
      map.get(k)!.push(p);
    }
    return map;
  }, [displayProjects, sortedProjectGroups]);

  const toggleGroupExpanded = (key: string) => {
    setExpandedGroupKeys((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  // 드롭다운 열릴 때 모든 그룹 자동 펼침 + 현재 프로젝트 소속 그룹 펼침 보장
  useEffect(() => {
    if (isProjectDropdownOpen && projectListLayout === 'group') {
      const next = new Set<string>();
      sortedProjectGroups.forEach((g) => next.add(g.id));
      next.add('__none__');
      setExpandedGroupKeys(next);
    }
  }, [isProjectDropdownOpen, projectListLayout, sortedProjectGroups]);

  const ownerGroupLabel = (ownerKey: string) => {
    if (ownerKey === '__none__') return '소유자 미지정';
    if (user?.id && ownerKey === user.id) return '내 프로젝트';
    return profileDisplayById[ownerKey] ?? profileMap[ownerKey] ?? `사용자 (${ownerKey.slice(0, 8)}…)`;
  };

  // 권한 체크 헬퍼: 시스템 관리자 / 프로젝트 소유자만
  // 정책: 프로젝트는 만든 사람(소유자)과 시스템 관리자만 수정/삭제 가능. editor 멤버여도 수정 불가.
  const isProjectOwner = (p: Project) => !!user?.id && p.ownerId === user.id;
  const canManageProject = (p: Project) => effectiveIsAdmin || isProjectOwner(p);
  const canEditProject = canManageProject;

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

  const dashboardHomeHint = `${dashboardNavLabel}(홈)으로 이동`;

  type MobileNavKey = 'dashboard' | 'table' | 'tablegantt' | 'gantt' | 'kanban';
  const mobileBottomNavItems = useMemo((): { key: MobileNavKey; label: string; title: string; icon: React.ReactNode }[] => {
    const items: { key: MobileNavKey; label: string; title: string; icon: React.ReactNode }[] = [
      { key: 'dashboard', label: dashboardNavLabel, title: dashboardNavLabel, icon: <LayoutDashboard size={14} /> },
      { key: 'table', label: '표', title: '표', icon: <CheckSquare size={14} /> },
      { key: 'tablegantt', label: '표+간', title: '표와 간트 함께 보기', icon: <Columns2 size={14} /> },
      { key: 'gantt', label: '간트', title: '간트', icon: <Target size={14} /> },
      { key: 'kanban', label: '칸반', title: '칸반', icon: <MapIcon size={14} /> },
    ];
    return items.filter((i) => !hiddenViews.has(i.key));
  }, [dashboardNavLabel, hiddenViews]);

  return (
    <header
      className={cn(
        'bg-white/90 backdrop-blur-xl border-b border-slate-200/60 z-50 safe-top transition-all duration-200',
        isHeaderCollapsed ? 'py-1.5 px-3 md:py-2 md:px-6' : 'px-4 md:px-6 py-2',
      )}
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)' }}
    >
      {/* 모바일 접힌 상태: 최소 바 */}
      <div className={cn('flex md:hidden items-center justify-between gap-2', !isHeaderCollapsed && 'hidden')}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigateWithTip('dashboard')}
            className="shrink-0"
            title={dashboardHomeHint}
            aria-label={dashboardHomeHint}
          >
            <img src={logo} alt="GMT Logo" className="w-11 h-11 object-contain dark-logo" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-sm truncate">{wbsSettings.appTitle}</span>
          </div>
        </div>
        <button
          onClick={() => setIsHeaderCollapsed(false)}
          className="p-2.5 -mr-1 rounded-lg hover:bg-stone-100 text-stone-500 shrink-0"
          title="메뉴 펼치기"
          aria-label="메뉴 펼치기"
        >
          <ChevronDown size={20} />
        </button>
      </div>
      {/* 전체 헤더: 모바일에서 접혀 있으면 숨김 */}
      <div
        className={cn(
          'flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-3',
          isHeaderCollapsed && 'hidden md:flex',
        )}
      >
        <div className="flex items-center gap-2.5 md:gap-3">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity shrink-0"
            role="button"
            tabIndex={0}
            onClick={() => navigateWithTip('dashboard')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigateWithTip('dashboard');
              }
            }}
            title={dashboardHomeHint}
            aria-label={dashboardHomeHint}
          >
            <img src={logo} alt="GMT Logo" className="w-12 h-12 md:w-[52px] md:h-[52px] object-contain dark-logo" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <h1 className="text-lg font-bold tracking-tight leading-tight">{wbsSettings.appTitle}</h1>
              {effectiveIsAdmin && (
                <span
                  className="text-[10px] font-mono text-slate-400 px-2 py-0.5 flex items-center gap-1.5"
                  title={`버전 ${appVersion} (수정일: ${formatCommitDate(appCommitDate)})`}
                >
                  <Tag size={10} className="text-slate-300" />
                  <span>v{appVersion}</span>
                  <span className="hidden 2xl:inline text-[10px] text-slate-300 font-medium">
                    · 수정일 {formatCommitDateDateOnly(appCommitDate)}
                  </span>
                </span>
              )}
            </div>

            <div className="relative mt-0.5 group" ref={projectDropdownRef}>
              <button
                data-tourid="tour-project"
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  if (tipOnce) tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-50 rounded-lg transition-all border border-transparent hover:border-slate-200/80"
                title="프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다."
              >
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-0.5">프로젝트</span>
                  <div className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)] leading-tight">
                    <span className="break-words text-left inline-flex flex-wrap items-center gap-1">
                      {currentProjectId === 'all' ? (
                        `전체 프로젝트${allTasks.length > 0 ? ` (${allTasks.length}개)` : ''}`
                      ) : currentProject ? (
                        <ProjectNameLabel project={currentProject} name={currentProject.name} />
                      ) : (
                        '프로젝트 선택'
                      )}
                      {currentProjectId !== 'all' && currentProject && (taskCountByProject[currentProjectId] ?? 0) > 0 && (
                        <span className="text-stone-400 font-semibold"> ({taskCountByProject[currentProjectId]}개)</span>
                      )}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('text-slate-400 transition-transform duration-200', isProjectDropdownOpen && 'rotate-180')}
                    />
                  </div>
                  {currentProject?.ownerId && (currentProject.ownerId === user?.id || effectiveIsAdmin) && (
                    <span
                      className="text-[9px] text-slate-400 truncate max-w-[200px] mt-0.5"
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
                </div>
              </button>
              {presenceOthers && presenceOthers.length > 0 && currentProjectId !== 'all' && (
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
                  <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)}></div>
                  <div
                    className="absolute top-full left-0 mt-2 w-[min(33rem,calc(100vw-1.5rem))] max-w-[100vw] bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 dropdown-menu"
                    style={{ boxShadow: 'var(--shadow-xl)' }}
                  >
                    <div className="p-1">
                      <div
                        className="px-3 py-2 flex items-center justify-between gap-2"
                        title="내 프로젝트·관심은 목록을 좁힙니다. 구분별은 상품·연구·용역·유지·제품·기타로, 그룹별은 설정한 폴더로 묶습니다. 같은 필터 버튼을 다시 누르면 전체로 돌아갑니다."
                      >
                        <span className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">프로젝트 목록</span>
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
                                  : 'text-stone-400 hover:text-emerald-600 border border-transparent hover:border-stone-200',
                              )}
                              title={listFilter === 'my' ? '전체 프로젝트 보기' : '내가 만든 프로젝트만 보기'}
                            >
                              <User size={10} />내 프로젝트만
                            </button>
                          )}
                          {sortedProjectGroups.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  persistProjectListLayout('kind');
                                }}
                                className={cn(
                                  'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                                  projectListLayout === 'kind'
                                    ? 'bg-violet-100 text-violet-800 border border-violet-200'
                                    : 'text-stone-400 hover:text-violet-700 border border-transparent hover:border-stone-200',
                                )}
                                title="상품·연구·용역·유지·제품·기타 구분으로 묶어 보기"
                              >
                                <Layers size={10} />
                                구분별
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  persistProjectListLayout('group');
                                }}
                                className={cn(
                                  'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                                  projectListLayout === 'group'
                                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                    : 'text-stone-400 hover:text-indigo-600 border border-transparent hover:border-stone-200',
                                )}
                                title="프로젝트 그룹(폴더)별로 묶어 보기"
                              >
                                <FolderOpen size={10} />
                                그룹별
                              </button>
                            </>
                          )}
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
                                  : 'text-stone-400 hover:text-amber-600 border border-transparent hover:border-stone-200',
                              )}
                              title={listFilter === 'favorites' ? '전체 프로젝트 보기' : '관심(즐겨찾기) 프로젝트만 보기'}
                            >
                              <Star size={10} className={listFilter === 'favorites' ? 'fill-amber-500' : ''} />
                              {listFilter === 'favorites' ? `관심 ${favoriteIds.size}개` : '관심만'}
                            </button>
                          )}
                          <span className="text-[10px] text-stone-400 shrink-0">{displayProjects.length}개</span>
                        </div>
                      </div>
                      {projectsSortedByName.length >= 25 && (
                        <div
                          className="mx-2 mb-1 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-[10px] text-slate-600 leading-snug"
                          title="관리자 승인 계정은 서버에 등록된 전체 프로젝트를 볼 수 있습니다."
                        >
                          <strong className="text-slate-700">왜 이렇게 많나요?</strong> 승인된 계정은 조직의 <strong>전체 프로젝트</strong>
                          가 표시됩니다. 복사본·테스트 프로젝트까지 합쳐지면 수가 커질 수 있어요. 아래는 <strong>만든 사람(소유자)</strong>
                          별로 묶어 두었습니다.
                        </div>
                      )}
                      <div
                        role="option"
                        aria-selected={currentProjectId === 'all'}
                        className={cn(
                          'px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors border',
                          currentProjectId === 'all'
                            ? 'bg-sky-50 border-sky-200 text-sky-950 font-semibold ring-1 ring-sky-200/80'
                            : 'text-stone-600 hover:bg-stone-50 border-transparent',
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
                        {allTasks.length > 0 && <span className="text-[10px] text-stone-400 shrink-0">({allTasks.length}개)</span>}
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
                      <div className="h-px bg-stone-100 my-1 mx-2" />
                      <div className="max-h-[min(52vh,480px)] overflow-y-auto overscroll-contain pr-0.5">
                        {(() => {
                          const renderProjectRow = (project: Project) => {
                            const ownerLabel = ownerGroupLabel(project.ownerId ?? '__none__');
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
                                    : 'text-stone-600 hover:bg-stone-50 border-transparent',
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
                                    favoriteIds.has(project.id) ? 'text-amber-500' : 'text-stone-300 hover:text-amber-400',
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
                                    <span className="text-[10px] text-stone-400">({ownerLabel})</span>
                                  </span>
                                  {(taskCountByProject[project.id] ?? 0) > 0 && (
                                    <span className="text-[10px] text-stone-400 ml-1">· {taskCountByProject[project.id]}개</span>
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
                                      className="text-stone-400 hover:text-teal-600 p-1 rounded"
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
                                    className="text-stone-400 hover:text-blue-600 p-1 rounded"
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
                                      className="text-stone-400 hover:text-[var(--color-ink)] p-1 rounded"
                                      title="프로젝트 편집"
                                      aria-label="프로젝트 편집"
                                    >
                                      <Edit size={12} />
                                    </button>
                                  )}
                                  {canManageProject(project) && projectsSortedByName.length > 1 && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProjectToDelete(project);
                                        setIsProjectDropdownOpen(false);
                                        setIsDeleteProjectConfirmOpen(true);
                                      }}
                                      className="text-stone-400 hover:text-red-500 p-1 rounded"
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

                          if (projectListLayout === 'group' && sortedProjectGroups.length > 0) {
                            return [...sortedProjectGroups, { id: '__none__', name: '그룹 미지정' }].map((g) => {
                              const list = projectsByGroup.get(g.id) ?? [];
                              if (g.id === '__none__' && list.length === 0) return null;
                              const expanded = expandedGroupKeys.has(g.id);
                              return (
                                <div key={g.id} className="mb-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroupExpanded(g.id)}
                                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-stone-600 hover:bg-stone-50"
                                  >
                                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                    <FolderOpen size={12} className={g.id === '__none__' ? 'text-stone-300' : 'text-amber-500'} />
                                    <span className="text-xs font-semibold flex-1 text-left">{g.name}</span>
                                    <span className="text-[10px] text-stone-400">{list.length}</span>
                                  </button>
                                  {expanded && list.length > 0 && (
                                    <div className="pl-7 border-l border-stone-100 ml-2">{list.map((p) => renderProjectRow(p))}</div>
                                  )}
                                </div>
                              );
                            });
                          }
                          return projectsByKind.map(({ kind, projects: list }) => (
                            <section key={kind} className="mb-2 last:mb-0">
                              <div
                                className={cn(
                                  'sticky top-0 z-[1] flex items-center gap-2 px-2 py-1.5 mb-0.5 rounded-md border',
                                  getProjectKindBadgeClass(kind),
                                )}
                              >
                                <span className="text-xs font-bold">{kind}</span>
                                <span className="text-[10px] font-medium opacity-80 tabular-nums">({list.length}개)</span>
                              </div>
                              {list.map((p) => renderProjectRow(p))}
                            </section>
                          ));
                        })()}
                      </div>
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      {!hiddenViews.has('projects') && (
                        <>
                          <button
                            onClick={() => {
                              setEditingProject(null);
                              setIsProjectModalOpen(true);
                              setIsProjectDropdownOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors"
                            title="새 프로젝트를 생성합니다."
                          >
                            <FolderPlus size={14} /> 새 프로젝트
                          </button>
                          <button
                            onClick={() => {
                              setIsProjectDropdownOpen(false);
                              setView('projects');
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-stone-500 hover:bg-stone-50 rounded-lg flex items-center gap-2 transition-colors"
                            title="프로젝트 관리 페이지로 이동합니다."
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
        </div>

        <div className="hidden md:flex flex-wrap gap-1 items-center w-full md:w-auto overflow-x-auto overflow-y-visible md:overflow-visible md:pb-0 md:mb-0">
          {/* 툴바: 되돌리기 / 다시실행 */}
          <div className="flex items-center gap-0.5 mr-0.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="icon-btn !p-1.5 text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="실행 취소 (Ctrl+Z)"
              aria-label="실행 취소 (Ctrl+Z)"
            >
              <History size={15} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="icon-btn !p-1.5 text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="다시 실행 (Ctrl+Y)"
              aria-label="다시 실행 (Ctrl+Y)"
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="toolbar-divider hidden md:block" />
          {/* 뷰 탭 바(데스크톱 전용): 모바일은 하단 고정 탭바 사용 */}
          <div className="hidden md:flex bg-slate-100/70 p-0.5 rounded-lg border border-slate-200/60 overflow-x-auto overflow-y-visible md:overflow-visible shrink-0 min-w-0 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent gap-0.5">
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
            {!hiddenViews.has('allocation') && (
              <NavButton
                active={view === 'allocation'}
                onClick={() => navigateWithTip('allocation')}
                icon={<Users size={14} />}
                label="투입현황"
                title="프로젝트별·인원별 투입 비율을 한눈에 확인합니다."
                tourId="tour-nav-allocation"
              />
            )}
            {!hiddenViews.has('table') && (
              <NavButton
                active={view === 'table'}
                onClick={() => navigateWithTip('table')}
                icon={<CheckSquare size={14} />}
                label="표만"
                title="작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다."
                tourId="tour-nav-table"
              />
            )}
            {!hiddenViews.has('tablegantt') && (
              <NavButton
                active={view === 'tablegantt'}
                onClick={() => navigateWithTip('tablegantt')}
                icon={<Columns2 size={14} />}
                label="표+간트"
                title="작업표와 간트 차트를 한 화면에서 함께 봅니다. (가로 분할·모바일에서는 위·아래)"
                tourId="tour-nav-tablegantt"
              />
            )}
            {!hiddenViews.has('gantt') && (
              <NavButton
                active={view === 'gantt'}
                onClick={() => navigateWithTip('gantt')}
                icon={<Target size={14} />}
                label="간트만"
                title="일정 막대를 드래그해 날짜를 조정하고, 선후관계를 확인합니다."
                tourId="tour-nav-gantt"
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

          {/* 버그 사항 링크 */}
          <a
            href="https://docs.google.com/document/d/1h_St7qRXMRxGsV6i780uCmNSYax3a4PaazTFZgT2gqQ/edit?tab=t.0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all shrink-0"
            title="버그 사항 시트로 이동"
          >
            <span className="hidden sm:inline">버그 사항</span>
          </a>

          {/* Filter: WBS 작업 필터 | 대시보드는 상단 도구줄(부서·프로젝트 표시)과 연동 */}
          {dashboardFilterBarMode ? (
            <button
              type="button"
              data-tourid="tour-filter"
              onClick={() => onDashboardFilterToolbarClick?.()}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all shrink-0',
                dashboardFiltersActive || showDashboardFilterToolbar
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/25'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
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
                  dashboardFiltersActive || showDashboardFilterToolbar ? 'bg-white/20' : 'bg-slate-100 text-slate-400',
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
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all shrink-0',
                filterOn
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/25'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
              )}
              title={filterOn ? '필터 끄기' : '필터 켜기'}
            >
              <Settings2 size={14} /> {/* Replace Filter */}
              <span className="hidden sm:inline">필터</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md', filterOn ? 'bg-white/20' : 'bg-slate-100 text-slate-400')}>
                {filterOn ? 'On' : 'Off'}
              </span>
            </button>
          )}

          {/* 더보기 — 이전 커밋과 동일 구조 (기능·데이터·설정·관리자·삭제) */}
          <div className="relative shrink-0 z-50 ml-0.5" ref={moreMenuRef}>
            <button
              type="button"
              data-tourid="tour-more"
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className={cn(
                'icon-btn !p-1.5 transition-colors relative shrink-0',
                isMoreMenuOpen ? 'text-[var(--color-ink)] bg-slate-100' : 'text-slate-500 hover:text-[var(--color-ink)] hover:bg-slate-50',
              )}
              title="추가 옵션"
              aria-label="추가 옵션"
            >
              <MoreHorizontal size={17} />
            </button>
            {isMoreMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsMoreMenuOpen(false)} aria-hidden />
                <div
                  className="absolute top-full right-0 mt-2 w-44 bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 shadow-xl dropdown-menu flex flex-col py-1"
                  style={{ boxShadow: 'var(--shadow-xl)' }}
                >
                  {(userApproved || effectiveIsAdmin) && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">조직</div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsOrganizationOpen(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Users size={14} /> 조직 현황
                      </button>
                      <div className="h-px bg-slate-100 my-1 mx-2" />
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
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title={canEditCurrentProject ? '엑셀/JSON 파일 가져오기' : '편집 권한이 있는 프로젝트에서만 가져올 수 있습니다'}
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
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Download size={14} />
                    보내기
                  </button>

                  <div className="h-px bg-slate-100 my-1 mx-2" />
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">설정</div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsSettingsModalOpen(true);
                      tipOnce?.('menu.settings', '환경설정에서 WBS 표시, 상태/진척도, 표 컬럼(표시·순서) 등을 바꿀 수 있어요.');
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Settings2 size={14} /> 환경설정
                  </button>

                  {(allowMembersManagement || showSuperAdminDeleteMenu) && <div className="h-px bg-slate-100 my-1 mx-2" />}

                  {allowMembersManagement && (
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
                      >
                        <Users size={14} /> 회원 관리
                      </button>
                      {/* 일반 사용자 화면 진입은 Shift+F12만 (계정 메뉴에서는 미리보기 중일 때만 관리자 화면으로 복귀) */}
                      {/* 로컬 초기화: 관리자에게도 숨김 처리 */}
                    </>
                  )}

                  {showSuperAdminDeleteMenu && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        setIsDeleteChoiceOpen(true);
                        tipOnce?.('menu.deleteAll', '삭제 및 초기화 메뉴입니다.');
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 mt-1 border-t border-slate-100 pt-2 pb-1"
                    >
                      <Trash2 size={14} /> 부분/전체 삭제
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            data-tourid="tour-new-task"
            onClick={() => {
              if (!canEditCurrentProject) return;
              setIsModalOpen(true);
              if (tipOnce) tipOnce('menu.newTask', '새 작업을 추가합니다. 표 화면에서는 Enter로도 빠르게 추가할 수 있어요.');
            }}
            disabled={!canEditCurrentProject}
            className="btn-primary !py-2 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canEditCurrentProject ? '새 작업 추가' : '보기 권한만 있어 편집할 수 없습니다'}
          >
            <Plus size={14} /> <span>새 작업</span>
          </button>

          {headerRightSlot}

          {user?.id && (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((o) => !o)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 max-w-[140px] sm:max-w-[180px]"
                title={
                  memberPreview && canSwitchAdminMemberView
                    ? '계정: 일반 사용자 화면 모드 (Shift+F12 또는 아래 메뉴에서 관리자 화면으로 전환)'
                    : canSwitchAdminMemberView
                      ? '계정 (Shift+F12로 일반 사용자 화면 전환)'
                      : '계정'
                }
              >
                <User size={14} className="shrink-0 text-slate-500" />
                <span className="truncate">{currentUserDisplay || user?.email || '계정'}</span>
                {memberPreview && canSwitchAdminMemberView && (
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" title="일반 사용자 화면 모드" aria-hidden />
                )}
                <ChevronDown size={12} className={cn('shrink-0 opacity-50', isUserMenuOpen && 'rotate-180')} />
              </button>
              {isUserMenuOpen && (
                <div className="absolute right-0 top-full mt-1 py-1 min-w-[200px] rounded-xl border border-slate-200 bg-white shadow-lg z-[60]">
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
                        title="Shift+F12로도 전환할 수 있습니다."
                      >
                        <EyeOff size={14} /> 관리자 화면으로 전환
                      </button>
                      <div className="h-px bg-slate-100 my-1 mx-2" />
                    </>
                  )}
                  {user?.id && !isAdmin && setIsAdminAccessRequestModalOpen && (
                    <>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setIsAdminAccessRequestModalOpen(true);
                        }}
                        title="기존 시스템 관리자의 승인이 필요합니다."
                      >
                        <Shield size={14} /> 시스템 관리자 권한 요청…
                      </button>
                      <div className="h-px bg-slate-100 my-1 mx-2" />
                    </>
                  )}
                  {user?.id && !isAdmin && !adminOverride && setIsAdminPasswordModalOpen && (
                    <>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          setIsAdminPasswordModalOpen(true);
                        }}
                        title="DB에 관리자로 등록되지 않은 경우, 앱 비밀번호로 관리자 기능을 켤 수 있습니다."
                      >
                        <ShieldCheck size={14} /> 관리자 비밀번호로 전환…
                      </button>
                      <div className="h-px bg-slate-100 my-1 mx-2" />
                    </>
                  )}
                  {/* 테마 선택 영역은 일시적으로 숨김 (라이트 모드 고정) */}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
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
            className="md:hidden p-2 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
            title="메뉴 접어서 표 넓게 보기"
            aria-label="메뉴 접어서 표 넓게 보기"
          >
            <ChevronUp size={17} />
          </button>
        </div>
      </div>
      {/* 모바일 하단 고정 탭바: 숨김 설정에 따라 대시보드 / 표 / … */}
      {!lockMobileToDashboard && mobileBottomNavItems.length > 0 && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[70] border-t border-slate-200/80 bg-white/95 backdrop-blur-xl px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-0.5">
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
