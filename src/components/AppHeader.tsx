import React, { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Tag,
  Plus,
  Download,
  Upload,
  Settings2,
  Keyboard,
  Trash2,
  RotateCcw,
  Users,
  User,
  LogOut,
  Network,
  History,
  Map as MapIcon,
  Sparkles,
  FolderPlus,
  FolderOpen,
  Briefcase,
  Share2,
  Copy,
  Edit,
  LayoutDashboard,
  LayoutList,
  CheckSquare,
  Target,
  MoreHorizontal,
  Sun,
  Moon,
  Monitor,
  Star,
} from 'lucide-react';
import { NavButton } from './NavButton';
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
  setIsVersionHistoryOpen: (v: boolean) => void;
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
  presenceOthers: PresenceUser[];
  selectProject: (id: string) => void;
  allTasks: Task[];
  projectsSortedByName: Project[];
  taskCountByProject: Record<string, number>;
  /** 프로젝트 목록에 없는 소속 작업 수(합계 불일치 시 안내) */
  orphanAndUnassignedTaskCount?: number;
  isAdmin: boolean;
  /** undefined: 로딩 전에는 프로젝트별 메뉴 표시(기존 동작) */
  myEditableProjectIds: string[] | undefined;
  setIsShareOpen: (v: boolean) => void;
  copyProject: (id: string) => void;
  setEditingProject: (p: Project | null) => void;
  setIsProjectModalOpen: (v: boolean) => void;
  setProjectToDelete: (p: Project | null) => void;
  setIsDeleteProjectConfirmOpen: (v: boolean) => void;
  setAuditLogProjectId: (id: string) => void;
  setIsAuditLogOpen: (v: boolean) => void;
  setView: (v: string) => void;
  undo: () => void;
  canUndo: boolean;
  redo: () => void;
  canRedo: boolean;
  hiddenViews: Set<string>;
  view: string;
  navigateWithTip: (v: string) => void;
  filterOn: boolean;
  setFilterOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  tipOnce: (key: string, msg: string) => void;
  currentUserDisplay: string;
  signOut: () => void;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: (v: boolean) => void;
  isAIBusy: boolean;
  setIsAIModalOpen: (v: boolean) => void;
  setIsWeeklyReportOpen: (v: boolean) => void;
  setIsOrganizationOpen: (v: boolean) => void;
  /** 승인된 사용자 여부. 조직 현황 메뉴 노출 조건. */
  userApproved: boolean;
  handleImportClick: () => void;
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
}

export function AppHeader({
  wbsSettings,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  requestRefresh,
  logo,
  setIsVersionHistoryOpen,
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
  presenceOthers,
  selectProject,
  allTasks,
  projectsSortedByName,
  taskCountByProject,
  orphanAndUnassignedTaskCount = 0,
  isAdmin,
  myEditableProjectIds,
  setIsShareOpen,
  copyProject,
  setEditingProject,
  setIsProjectModalOpen,
  setProjectToDelete,
  setIsDeleteProjectConfirmOpen,
  setAuditLogProjectId,
  setIsAuditLogOpen,
  setView,
  undo,
  canUndo,
  redo,
  canRedo,
  hiddenViews,
  view,
  navigateWithTip,
  filterOn,
  setFilterOn,
  tipOnce,
  currentUserDisplay,
  signOut,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  isAIBusy,
  setIsAIModalOpen,
  setIsWeeklyReportOpen,
  setIsOrganizationOpen,
  userApproved,
  handleImportClick,
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
}: AppHeaderProps) {
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [expandedOwnerKeys, setExpandedOwnerKeys] = useState<Set<string>>(new Set());
  const wasDropdownOpen = useRef(false);
  const [showByGroup, setShowByGroup] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wbs-header-projects-by-group') === '1';
    } catch {
      return false;
    }
  });
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());

  // 관심 프로젝트 (즐겨찾기) — wbsSettings(DB) 동기화
  const favoriteIds = useMemo(() => new Set(wbsSettings.favoriteProjectIds ?? []), [wbsSettings.favoriteProjectIds]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

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
    if (!showFavoritesOnly || favoriteIds.size === 0) return projectsSortedByName;
    return projectsSortedByName.filter((p) => favoriteIds.has(p.id));
  }, [projectsSortedByName, showFavoritesOnly, favoriteIds]);

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
    if (isProjectDropdownOpen && showByGroup) {
      const next = new Set<string>();
      sortedProjectGroups.forEach((g) => next.add(g.id));
      next.add('__none__');
      setExpandedGroupKeys(next);
    }
  }, [isProjectDropdownOpen, showByGroup, sortedProjectGroups]);

  const persistShowByGroup = (v: boolean) => {
    setShowByGroup(v);
    try {
      localStorage.setItem('wbs-header-projects-by-group', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const ownerGroupLabel = (ownerKey: string) => {
    if (ownerKey === '__none__') return '소유자 미지정';
    if (user?.id && ownerKey === user.id) return '내 프로젝트';
    return profileMap[ownerKey] ?? `사용자 (${ownerKey.slice(0, 8)}…)`;
  };

  // 권한 체크 헬퍼: 시스템 관리자 / 프로젝트 소유자 / 편집 멤버
  const isProjectOwner = (p: Project) => !!user?.id && p.ownerId === user.id;
  // canManage: 공유·편집·삭제 등 "다른 사용자에게 영향가는" 작업
  const canManageProject = (p: Project) => effectiveIsAdmin || isProjectOwner(p);
  // canEdit: 작업 CRUD 등 프로젝트 내용 편집 (편집 멤버 포함, 로딩 전에는 fail-open)
  const canEditProject = (p: Project) => canManageProject(p) || myEditableProjectIds === undefined || myEditableProjectIds.includes(p.id);

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
    if (!isMoreMenuOpen && !isUserMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (isMoreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(t)) setIsMoreMenuOpen(false);
      if (isUserMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) setIsUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isMoreMenuOpen, isUserMenuOpen, setIsMoreMenuOpen]);

  return (
    <header
      className={cn(
        'bg-white/90 backdrop-blur-xl border-b border-slate-200/60 z-50 safe-top transition-all duration-200',
        isHeaderCollapsed ? 'py-2 px-3 md:py-3 md:px-6' : 'px-4 md:px-6 py-3',
      )}
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)' }}
    >
      {/* 모바일 접힌 상태: 최소 바 */}
      <div className={cn('flex md:hidden items-center justify-between gap-2', !isHeaderCollapsed && 'hidden')}>
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={requestRefresh} className="shrink-0">
            <img src={logo} alt="GMT Logo" className="w-14 h-14 object-contain dark-logo" />
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
        className={cn('flex flex-col md:flex-row justify-between items-start md:items-center gap-4', isHeaderCollapsed && 'hidden md:flex')}
      >
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            onClick={requestRefresh}
            title="새로고침: 페이지를 다시 불러와 최신 데이터를 확인합니다."
          >
            <img src={logo} alt="GMT Logo" className="w-16 h-16 object-contain dark-logo" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight leading-none">{wbsSettings.appTitle}</h1>
              <button
                onClick={() => {
                  setIsVersionHistoryOpen(true);
                  if (tipOnce) tipOnce('menu.version', '버전 정보를 클릭하면 변경 이력(버전 히스토리)을 확인할 수 있어요.');
                }}
                className="text-[10px] font-mono text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-all flex items-center gap-1.5 group"
                title={`버전 정보 (수정일: ${formatCommitDate(appCommitDate)})`}
              >
                <Tag size={10} className="text-slate-300 group-hover:text-indigo-400" />
                <span>v{appVersion}</span>
                <span className="hidden 2xl:inline text-[10px] text-slate-300 group-hover:text-indigo-300 font-medium">
                  · 수정일 {formatCommitDateDateOnly(appCommitDate)}
                </span>
              </button>
            </div>

            <div className="relative mt-1 group">
              <button
                data-tourid="tour-project"
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  if (tipOnce) tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-2 px-2.5 py-2 hover:bg-slate-50 rounded-xl transition-all border border-transparent hover:border-slate-200/80"
                title="프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다."
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">프로젝트</span>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                    <span className="max-w-[140px] sm:max-w-[200px] truncate">
                      {currentProjectId === 'all'
                        ? `전체 프로젝트${allTasks.length > 0 ? ` (${allTasks.length}개)` : ''}`
                        : currentProject?.name || '프로젝트 선택'}
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
                      title={currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? currentProject.ownerId) : undefined}
                    >
                      {currentProject.ownerId === user?.id
                        ? '내 프로젝트'
                        : currentProject.ownerId
                          ? (profileMap[currentProject.ownerId] ?? '다른 사용자')
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
                    className="absolute top-full left-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] max-w-[100vw] bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 dropdown-menu"
                    style={{ boxShadow: 'var(--shadow-xl)' }}
                  >
                    <div className="p-1">
                      <div
                        className="px-3 py-2 flex items-center justify-between gap-2"
                        title="선택한 프로젝트의 작업만 표시합니다. 전체를 선택하면 모든 프로젝트를 한눈에 볼 수 있어요."
                      >
                        <span className="text-[10px] font-bold uppercase text-stone-400 tracking-wider">프로젝트 목록</span>
                        <div className="flex items-center gap-2">
                          {sortedProjectGroups.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                persistShowByGroup(!showByGroup);
                              }}
                              className={cn(
                                'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                                showByGroup
                                  ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                  : 'text-stone-400 hover:text-indigo-600 border border-transparent hover:border-stone-200',
                              )}
                              title={showByGroup ? '평탄 목록으로 보기' : '그룹별로 묶어 보기'}
                            >
                              <FolderOpen size={10} />
                              그룹별
                            </button>
                          )}
                          {favoriteIds.size > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowFavoritesOnly((prev) => !prev);
                              }}
                              className={cn(
                                'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors',
                                showFavoritesOnly
                                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                  : 'text-stone-400 hover:text-amber-600 border border-transparent hover:border-stone-200',
                              )}
                              title={showFavoritesOnly ? '전체 프로젝트 보기' : '관심 프로젝트만 보기'}
                            >
                              <Star size={10} className={showFavoritesOnly ? 'fill-amber-500' : ''} />
                              {showFavoritesOnly ? `관심 ${favoriteIds.size}개` : '관심만'}
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
                        className={cn(
                          'px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors',
                          currentProjectId === 'all' ? 'bg-stone-100 font-medium' : 'text-stone-600 hover:bg-stone-50',
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
                        <span className="truncate flex-1">전체</span>
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
                            return (
                              <div
                                key={project.id}
                                className={cn(
                                  'px-3 py-1.5 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors',
                                  currentProjectId === project.id ? 'bg-stone-100 font-medium' : 'text-stone-600 hover:bg-stone-50',
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
                                <div className="truncate flex-1 min-w-0">
                                  <span className="truncate">
                                    {project.name}
                                    <span className="text-[10px] text-stone-400 ml-1.5">({ownerLabel})</span>
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
                                      copyProject(project.id);
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
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAuditLogProjectId(project.id);
                                      setIsAuditLogOpen(true);
                                      setIsProjectDropdownOpen(false);
                                    }}
                                    className="text-stone-400 hover:text-amber-600 p-1 rounded"
                                    title="변경 이력"
                                    aria-label="변경 이력"
                                  >
                                    <History size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          };

                          if (showByGroup && sortedProjectGroups.length > 0) {
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
                                  {expanded && list.length > 0 && <div className="pl-2">{list.map((p) => renderProjectRow(p))}</div>}
                                </div>
                              );
                            });
                          }
                          return displayProjects.map((p) => renderProjectRow(p));
                        })()}
                      </div>
                      <div className="border-t border-[var(--color-line)] my-1"></div>
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
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center w-full md:w-auto overflow-x-auto overflow-y-visible md:overflow-visible pb-1 -mb-1 md:pb-0 md:mb-0">
          {/* 툴바: 되돌리기 / 다시실행 */}
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="icon-btn text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="실행 취소 (Ctrl+Z)"
              aria-label="실행 취소 (Ctrl+Z)"
            >
              <History size={16} /> {/* Replace Undo2 */}
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="icon-btn text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="다시 실행 (Ctrl+Shift+Z)"
              aria-label="다시 실행 (Ctrl+Shift+Z)"
            >
              <RotateCcw size={16} /> {/* Replace Redo2 */}
            </button>
          </div>
          <div className="toolbar-divider hidden md:block" />
          {/* 모바일: 가로 스크롤 탭 바 (아이콘+텍스트), 데스크톱: 기존 pill 영역 */}
          <div className="flex bg-slate-100/70 p-1 rounded-xl border border-slate-200/60 overflow-x-auto overflow-y-visible md:overflow-visible shrink-0 min-w-0 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent gap-0.5">
            {!hiddenViews.has('dashboard') && (
              <NavButton
                active={view === 'dashboard'}
                onClick={() => navigateWithTip('dashboard')}
                icon={<LayoutDashboard size={14} />}
                label="대시보드"
                title="프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다."
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
            <NavButton
              active={view === 'list'}
              onClick={() => navigateWithTip('list')}
              icon={<LayoutList size={14} />}
              label="표+간트"
              title="표와 간트를 나란히 보며 작업을 편집하고 일정을 확인합니다. 가운데 바를 드래그해 폭을 조절할 수 있어요."
              tourId="tour-nav-list"
            />
            <NavButton
              active={view === 'table'}
              onClick={() => navigateWithTip('table')}
              icon={<CheckSquare size={14} />}
              label="표만"
              title="작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다."
              tourId="tour-nav-table"
            />
            <NavButton
              active={view === 'gantt'}
              onClick={() => navigateWithTip('gantt')}
              icon={<Target size={14} />}
              label="간트만"
              title="일정 막대를 드래그해 날짜를 조정하고, 선후관계·크리티컬 패스를 확인합니다."
              tourId="tour-nav-gantt"
            />
            <NavButton
              active={view === 'kanban'}
              onClick={() => navigateWithTip('kanban')}
              icon={<MapIcon size={14} />}
              label="칸반"
              title="상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다."
              tourId="tour-nav-kanban"
            />
            {!hiddenViews.has('mindmap') && (
              <NavButton
                active={view === 'mindmap'}
                onClick={() => navigateWithTip('mindmap')}
                icon={<Network size={14} />}
                label="마인드맵"
                title="WBS 계층을 트리 형태로 보고, 노드를 눌러 작업을 편집할 수 있어요."
                tourId="tour-nav-mindmap"
              />
            )}
          </div>

          <div className="toolbar-divider" />

          {/* 버그 사항 링크 */}
          <a
            href="https://docs.google.com/document/d/1h_St7qRXMRxGsV6i780uCmNSYax3a4PaazTFZgT2gqQ/edit?tab=t.0"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all shrink-0"
            title="버그 사항 시트로 이동"
          >
            <span className="hidden sm:inline">버그 사항</span>
          </a>

          {/* Filter On/Off Toggle */}
          <button
            data-tourid="tour-filter"
            onClick={() => {
              setFilterOn((v) => !v);
              if (tipOnce) tipOnce('menu.filter', '필터를 켜면 상태/담당자/기간으로 작업을 좁혀 볼 수 있어요.');
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all shrink-0',
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

          {/* 더보기 — 이전 커밋과 동일 구조 (기능·데이터·설정·관리자·삭제) */}
          <div className="relative shrink-0 z-50 ml-0.5" ref={moreMenuRef}>
            <button
              type="button"
              data-tourid="tour-more"
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              className={cn(
                'icon-btn transition-colors relative shrink-0',
                isMoreMenuOpen ? 'text-[var(--color-ink)] bg-slate-100' : 'text-slate-500 hover:text-[var(--color-ink)] hover:bg-slate-50',
              )}
              title="추가 옵션"
              aria-label="추가 옵션"
            >
              <MoreHorizontal size={18} />
              {isAIBusy && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" aria-hidden />}
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
                  {effectiveIsAdmin && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">기능</div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsAIModalOpen(true);
                          tipOnce?.(
                            'menu.ai',
                            'AI가 프로젝트 내용을 분석해 WBS를 생성합니다. 분석 중에도 창을 닫으면 백그라운드에서 계속 진행돼요.',
                          );
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Sparkles size={14} className={isAIBusy ? 'text-purple-500 animate-pulse' : ''} />
                        AI 분석
                        {isAIBusy && <span className="text-[10px] text-purple-500">(진행중)</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsWeeklyReportOpen(true);
                          tipOnce?.('menu.weeklyReport', '현재 작업을 기준으로 금주실적·차주계획·이슈를 자동으로 정리합니다.');
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <History size={14} /> 주간보고
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
                      tipOnce?.('menu.settings', '설정에서 WBS 표시, 상태/진척도, 표 컬럼(표시·순서) 등을 바꿀 수 있어요.');
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Settings2 size={14} /> 환경설정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setIsShortcutsVisible(!isShortcutsVisible);
                      tipOnce?.('menu.shortcuts', '단축키 패널을 여는 버튼입니다. (예: Ctrl+A, Del로 일괄 삭제)');
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Keyboard size={14} /> 단축키
                  </button>

                  <div className="h-px bg-slate-100 my-1 mx-2" />

                  {effectiveIsAdmin && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">관리자 기능</div>
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
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          setIsResetConfirmOpen(true);
                          tipOnce?.('menu.reset', '로컬 데이터를 모두 초기화합니다.');
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2"
                      >
                        <RotateCcw size={14} /> 로컬 초기화
                      </button>
                    </>
                  )}

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
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canEditCurrentProject ? '새 작업 추가' : '보기 권한만 있어 편집할 수 없습니다'}
          >
            <Plus size={15} /> <span>새 작업</span>
          </button>

          {headerRightSlot}

          {user?.id && (
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((o) => !o)}
                className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 max-w-[140px] sm:max-w-[180px]"
                title="계정"
              >
                <User size={14} className="shrink-0 text-slate-500" />
                <span className="truncate">{currentUserDisplay || user?.email || '계정'}</span>
                <ChevronDown size={12} className={cn('shrink-0 opacity-50', isUserMenuOpen && 'rotate-180')} />
              </button>
              {isUserMenuOpen && (
                <div className="absolute right-0 top-full mt-1 py-1 min-w-[180px] rounded-xl border border-slate-200 bg-white shadow-lg z-[60]">
                  {/* 테마 선택 */}
                  <div className="px-3 py-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">테마</span>
                    <div className="flex items-center gap-1 mt-1.5">
                      {[
                        { mode: 'light' as const, icon: <Sun size={14} />, label: '라이트' },
                        { mode: 'dark' as const, icon: <Moon size={14} />, label: '다크' },
                        { mode: 'system' as const, icon: <Monitor size={14} />, label: '시스템' },
                      ].map(({ mode, icon, label }) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => onThemeModeChange?.(mode)}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg transition-all flex-1 justify-center',
                            themeMode === mode
                              ? 'bg-indigo-100 text-indigo-700 font-semibold'
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
                          )}
                          title={`${label} 모드`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 my-1" />
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
            className="md:hidden p-2.5 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
            title="메뉴 접어서 표 넓게 보기"
            aria-label="메뉴 접어서 표 넓게 보기"
          >
            <ChevronUp size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
