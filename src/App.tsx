import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_VERSION, APP_COMMIT_DATE } from './appRelease';
import { NavButton } from './components/NavButton';
import { AppHeader } from './components/AppHeader';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SearchModal } from './components/SearchModal';
import { NotificationBell } from './components/NotificationBell';
import { ProjectModal } from './components/ProjectModal';
import { AppSkeleton } from './components/AppSkeleton';
import { AppFilterBar } from './components/AppFilterBar';
import { AppLayout } from './components/AppLayout';
import { UnsavedProjectSwitchDialog } from './components/UnsavedProjectSwitchDialog';
import { UnsavedViewLeaveDialog } from './components/UnsavedViewLeaveDialog';
import { DeleteScopeDialog } from './components/DeleteScopeDialog';
import { useWBS, WBSProvider } from './context/WBSContext';
import {
  List,
  Plus,
  Download,
  Upload,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Trash2,
  X,
  Filter,
  Briefcase,
  Columns,
  Sparkles,
  Edit,
  Settings2,
  PieChart,
  Loader2,
  RefreshCw,
  MessageSquare,
  Tag,
  Table,
  BarChart3,
  Share2,
  Undo2,
  Redo2,
  Maximize2,
  Minimize2,
  Flag,
  LogOut,
  Users,
  User,
  Copy,
  History,
  Clock,
  Eye,
  Bug,
  RotateCcw,
  Network,
  MoreHorizontal,
} from 'lucide-react';
import { usePresence } from './hooks/usePresence';
import { useModalStates, SHORTCUTS_HIDE_KEY } from './hooks/useModalStates';
import { useAppRouting, type ViewType } from './hooks/useAppRouting';
import {
  useFileImportExport,
  type ImportPreviewState,
  type BackupConfirmState,
  type MultiMergeConfirmState,
  type LastExportPrefs,
} from './hooks/useFileImportExport';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useInitialDbSync } from './hooks/useInitialDbSync';
import { useGuidedTour } from './hooks/useGuidedTour';
import { useExcelImportTour } from './hooks/useExcelImportTour';
import { GUIDED_TOUR_STEPS } from './lib/guidedTourSteps';
import { EXCEL_IMPORT_TOUR_STEPS } from './lib/excelImportTourSteps';
import { useProjectDerivations } from './hooks/useProjectDerivations';
import { useViewerDirectory } from './hooks/useViewerDirectory';
import { useUnsavedChangesGuard } from './hooks/useUnsavedChangesGuard';
import { useViewerStatus } from './hooks/useViewerStatus';
import { useEditableProjectIds } from './hooks/useEditableProjectIds';
import { useExternalPartnerAllowlist } from './hooks/useExternalPartnerAllowlist';
import { useVisitLogging } from './hooks/useVisitLogging';
import { useWbsViewFilters } from './hooks/useWbsViewFilters';
import { useDashboardFilterToolbar } from './hooks/useDashboardFilterToolbar';
import { useMatchMedia } from './hooks/useMatchMedia';
import { cn, formatTodayKoLongWithWeekday, formatReleaseDateDotKo } from './lib/utils';
import { formatProjectDisplayName } from './lib/projectKind';
import { isProjectMineForUserListFilter } from './lib/projectMineFilter';
import { isInternalCompanyEmail } from './lib/emailDomain';
import { useOrganization } from './context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, formatAssigneeDisplay } from './lib/assigneeOptions';
import { Task, Project, FilterState, TaskStatus } from './types';
import { clearAllLocalData } from './lib/persist';
import { acceptInvite, getMyProjectMemberProjectIds } from './lib/db';
import { fetchCooperationRequests } from './lib/db/cooperationRequests';
import { isSupabaseConfigured } from './lib/supabase';
import { isDevAuthBypass } from './lib/devAuthBypass';
import { LoginScreen } from './components/LoginScreen';
import { LoginLockdownScreen } from './components/LoginLockdownScreen';
import { SupabaseSetupScreen } from './components/SupabaseSetupScreen';
import { isLoginLockdownActive } from './constants/loginLockdown';
import { useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/Toast';
import { ExcelImportPreviewModal } from './components/ExcelImportPreviewModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { ShareModal } from './components/ShareModal';
import { MembersModal } from './components/MembersModal';
import { ProjectAccessRequestBanner } from './components/ProjectAccessRequestBanner';
import { AdminPasswordModal } from './components/AdminPasswordModal';
import { WBS_ADMIN_VIEW_RESTORE_PASSWORD } from './constants/adminBypass';
import { AdminAccessRequestModal } from './components/AdminAccessRequestModal';
import { ProjectEditAccessRequestModal } from './components/ProjectEditAccessRequestModal';
import type { ExportScope, ExportFormat } from './components/ExportModal';
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns';
import logo from './assets/logo.png';
import { lazyWithRetry } from './lib/lazyWithRetry';

// WBSTable(+SortableTaskRow 등 대형 트리)·TableGanttSplit은 표/간트 뷰에서만 필요 → 지연 로딩으로 초기(대시보드) 번들에서 분리.
// lazyWithRetry: 배포 직후 옛 청크 해시를 가져오다 실패하면 1회 자동 새로고침으로 새 번들 회수.
const WBSTable = lazyWithRetry(() => import('./components/WBSTable').then((m) => ({ default: m.WBSTable })));
const TableGanttSplit = lazyWithRetry(() => import('./components/TableGanttSplit').then((m) => ({ default: m.TableGanttSplit })));
const TableKanbanSplit = lazyWithRetry(() => import('./components/TableKanbanSplit').then((m) => ({ default: m.TableKanbanSplit })));
const GanttChart = lazyWithRetry(() => import('./components/GanttChart').then((m) => ({ default: m.GanttChart })));
const KanbanBoard = lazyWithRetry(() => import('./components/KanbanBoard').then((m) => ({ default: m.KanbanBoard })));
const MindMapView = lazyWithRetry(() => import('./components/MindMapView').then((m) => ({ default: m.MindMapView })));
const Dashboard = lazyWithRetry(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const ProjectsPage = lazyWithRetry(() => import('./components/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const AllocationOverviewPage = lazyWithRetry(() =>
  import('./components/AllocationOverviewPage').then((m) => ({ default: m.AllocationOverviewPage })),
);
const SalesOutlookPage = lazyWithRetry(() => import('./components/SalesOutlookPage').then((m) => ({ default: m.SalesOutlookPage })));
const WeeklyReportPage = lazyWithRetry(() => import('./components/WeeklyReportPage').then((m) => ({ default: m.WeeklyReportPage })));
const PersonalKanbanPage = lazyWithRetry(() => import('./components/PersonalKanbanPage').then((m) => ({ default: m.PersonalKanbanPage })));
const AuditLogPage = lazyWithRetry(() => import('./components/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const WBSSettingsModal = lazyWithRetry(() => import('./components/WBSSettingsModal').then((m) => ({ default: m.WBSSettingsModal })));
const VersionManager = lazyWithRetry(() => import('./components/VersionManager').then((m) => ({ default: m.VersionManager })));
const AuditLogModal = lazyWithRetry(() => import('./components/AuditLogModal').then((m) => ({ default: m.AuditLogModal })));
const ExportModal = lazyWithRetry(() => import('./components/ExportModal').then((m) => ({ default: m.ExportModal })));
const WeeklyReportModal = lazyWithRetry(() => import('./components/WeeklyReportModal').then((m) => ({ default: m.WeeklyReportModal })));
// 첫 화면(특히 표) 진입 경로에서 분리 — 새 작업/작업 상세 모달을 열 때만 로드(tiptap + yjs 동반).
const TaskModal = lazyWithRetry(() => import('./components/TaskModal').then((m) => ({ default: m.TaskModal })));
const OrganizationModal = lazyWithRetry(() => import('./components/OrganizationModal').then((m) => ({ default: m.OrganizationModal })));
// 초보자 가이드: 사용 설명서(텍스트)와 따라하기 투어(화면 위 단계별 안내) — 열 때만 로드
const TutorialModal = lazyWithRetry(() => import('./components/TutorialModal').then((m) => ({ default: m.TutorialModal })));
const GuidedTour = lazyWithRetry(() => import('./components/GuidedTour').then((m) => ({ default: m.GuidedTour })));

/** `VITE_PROJECT_STATUS_ONLY`: "1" | "true" | "yes"(대소문자 무시)면 true */
function viteEnvTruthy(key: string): boolean {
  const v = (import.meta.env as Record<string, unknown>)[key];
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'yes';
}

const VITE_PROJECT_STATUS_ONLY = viteEnvTruthy('VITE_PROJECT_STATUS_ONLY');

interface WBSAppProps {
  isAdmin: boolean;
  /** undefined: 편집 가능 목록 로딩 전(기존처럼 제한 없음). 배열: 해당 ID만 편집 가능 */
  myEditableProjectIds: string[] | undefined;
  /** 관리자 승인(approved) 회원은 멤버가 아니어도 프로젝트 내용 조회 가능 */
  userApproved: boolean;
  /** 관리자 비밀번호로 임시 진입한 상태인지 (sessionStorage 기반, AppWithProviders가 보유) */
  adminOverride: boolean;
  setAdminOverride: (v: boolean) => void;
  /** 관리자가 화면을 일반 회원처럼 체험 중인 상태 (sessionStorage 기반) */
  memberPreview: boolean;
  setMemberPreview: (v: boolean) => void;
  /** profiles.managed_org_node_id 가 있으면 팀장·사업부장 등 소속 범위 회원 역할만 변경 */
  isOrgScopedManager: boolean;
  currentUserManagedOrgNodeId: string | null;
  onMembersUpdated?: () => void;
  /** Supabase `get_user_editable_project_ids` 재조회 (권한 요청 후) */
  onEditableProjectIdsRefresh?: () => void;
}

function WBSApp({
  isAdmin,
  myEditableProjectIds,
  userApproved,
  adminOverride,
  setAdminOverride,
  memberPreview,
  setMemberPreview,
  isOrgScopedManager,
  currentUserManagedOrgNodeId,
  onMembersUpdated,
  onEditableProjectIdsRefresh,
}: WBSAppProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 회원 체험 모드(memberPreview)가 켜지면 관리자라도 화면상 비관리자처럼 동작.
  // 단일 게이트로 모든 관리자 전용 UI에 일괄 적용 — 새 관리자 기능 추가 시 별도 처리 불필요.
  // gmtc.kr 사내 회원은 관리자와 동일하게 모든 메뉴·정보 표시(요청사항). 외부 도메인은 기존 권한 유지.
  const effectiveIsAdmin = (isAdmin || adminOverride || isInternalCompanyEmail(user?.email ?? '')) && !memberPreview;
  /**
   * 프로젝트 "삭제" 전용 권한: 만든 사람(소유자)과 운영자(실제 is_admin / 관리자 모드)만.
   * effectiveIsAdmin과 달리 사내(@gmtc.kr) 일반 계정은 제외한다 — 편집은 되어도 삭제는 불가.
   * DB의 projects_delete 정책(is_admin_user() OR owner)과 일치.
   */
  const realIsAdmin = (isAdmin || adminOverride) && !memberPreview;
  /** 조직 책임자는 회원 관리(역할 수정) 진입 허용. 시스템 관리 기능은 effectiveIsAdmin과 구분 */
  const canOpenMembersManagement = effectiveIsAdmin || isOrgScopedManager;

  const { orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  const modals = useModalStates();
  const {
    isModalOpen,
    setIsModalOpen,
    isProjectModalOpen,
    setIsProjectModalOpen,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isVersionHistoryOpen,
    setIsVersionHistoryOpen,
    isShortcutsVisible,
    setIsShortcutsVisible,
    isExportModalOpen,
    setIsExportModalOpen,
    exportSelectedProjectIds,
    setExportSelectedProjectIds,
    isDeleteProjectConfirmOpen,
    setIsDeleteProjectConfirmOpen,
    projectToDelete,
    setProjectToDelete,
    isCopyProjectConfirmOpen,
    setIsCopyProjectConfirmOpen,
    projectToCopy,
    setProjectToCopy,
    isDeleteAllProjectsConfirmOpen,
    setIsDeleteAllProjectsConfirmOpen,
    editingProject,
    setEditingProject,
    isShareOpen,
    setIsShareOpen,
    isAuditLogOpen,
    setIsAuditLogOpen,
    auditLogProjectId,
    setAuditLogProjectId,
    isMembersModalOpen,
    setIsMembersModalOpen,
    isAdminPasswordModalOpen,
    setIsAdminPasswordModalOpen,
    isAdminViewRestoreModalOpen,
    setIsAdminViewRestoreModalOpen,
    isAdminAccessRequestModalOpen,
    setIsAdminAccessRequestModalOpen,
    isProjectEditAccessRequestModalOpen,
    setIsProjectEditAccessRequestModalOpen,
    isResetConfirmOpen,
    setIsResetConfirmOpen,
    isWeeklyReportOpen,
    setIsWeeklyReportOpen,
    isOrganizationOpen,
    setIsOrganizationOpen,
    isDeleteAllConfirmOpen,
    setIsDeleteAllConfirmOpen,
    isDeleteChoiceOpen,
    setIsDeleteChoiceOpen,
    lastExportPrefs,
    setLastExportPrefs,
    importPreview,
    setImportPreview,
    backupConfirm,
    setBackupConfirm,
    multiMergeConfirm,
    setMultiMergeConfirm,
    errorAlert,
    setErrorAlert,
  } = modals;
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const { push: pushToast, tipOnce } = useToast();

  const requestRestoreAdminView = useCallback(() => {
    setIsAdminViewRestoreModalOpen(true);
  }, [setIsAdminViewRestoreModalOpen]);

  const {
    addTask,
    tasks,
    allTasks,
    importTasks,
    syncWithDb,
    projects,
    currentProjectId,
    setCurrentProjectId,
    addProject,
    updateProject,
    updateTask,
    flushProjectTaskRollups,
    deleteProject,
    copyProject,
    deleteAllTasks,
    deleteAllTasksInAllProjects,
    resetAllProjectsToNew,
    wbsMap,
    restoreBackup,
    mergeBackups,
    exportFullBackup,
    undo,
    canUndo,
    redo,
    canRedo,
    selectedTaskIds,
    setSelectedTaskIds,
    wbsSettings,
    updateWbsSettings,
    expandToLevel,
    setTreeExpandLevel,
    isLoading,
    canEditCurrentProject,
    hasLocalChangesSinceSync,
    pushChangesToDb,
    discardUnsavedChangesReloadFromServer,
  } = useWBS();

  const {
    saveNow,
    isDbPushInProgress,
    requestRefresh,
    requestProjectSwitch,
    setCurrentProjectIdGuarded,
    projectSwitchPrompt,
    projectSwitchAction,
    projectSwitchBusy,
    projectSwitchDialogRef,
    projectSwitchTargetLabel,
    handleProjectSwitchSaveAndProceed,
    handleProjectSwitchDiscardProceed,
    handleProjectSwitchCancel,
    bypassViewLeaveGuardOnce,
    requestNavigation,
    viewLeavePrompt,
    viewLeaveAction,
    viewLeaveBusy,
    viewLeaveDialogRef,
    handleViewLeaveSaveAndProceed,
    handleViewLeaveDiscardProceed,
    handleViewLeaveCancel,
  } = useUnsavedChangesGuard({
    currentProjectId,
    projects,
    hasLocalChangesSinceSync,
    pushChangesToDb,
    discardUnsavedChangesReloadFromServer,
    setCurrentProjectId,
    location,
    navigate,
  });

  const {
    view,
    setView: setViewRaw,
    hiddenViews,
    lockMobileToDashboard,
    dashboardMountedOnceRef,
  } = useAppRouting({
    effectiveIsAdmin,
    realIsAdmin,
    userEmail: user?.email,
    isProjectStatusOnly: VITE_PROJECT_STATUS_ONLY,
    bypassViewLeaveGuardOnce,
  });
  const noSplitWorkView = useMemo(() => hiddenViews.has('tablegantt') && hiddenViews.has('tablekanban'), [hiddenViews]);
  const preferredWorkSplitView = useMemo((): ViewType => {
    if (!hiddenViews.has('tablegantt')) return 'tablegantt';
    if (!hiddenViews.has('tablekanban')) return 'tablekanban';
    return 'dashboard';
  }, [hiddenViews]);
  const setView = useCallback(
    (v: ViewType) => {
      requestNavigation(() => setViewRaw(v));
    },
    [requestNavigation, setViewRaw],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState<string | null>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  /** 메인 메뉴(뷰) 전환 시 헤더 프로젝트 선택 팝업 닫기 */
  useEffect(() => {
    setIsProjectDropdownOpen(false);
  }, [view]);

  // 초보자 따라하기 투어 — useGuidedTour로 분리(동작 동일)
  const { isTutorialOpen, setIsTutorialOpen, tour, startGuidedTour, endGuidedTour, handleTourNext } = useGuidedTour({
    projects,
    allTasks,
    isLoading,
    hiddenViews,
    isProjectModalOpen,
    isProjectStatusOnly: VITE_PROJECT_STATUS_ONLY,
    setIsProjectDropdownOpen,
    setIsMoreMenuOpen,
    setIsHeaderCollapsed,
  });

  const { excelTour, startExcelImportTour, endExcelImportTour, handleExcelTourNext, notifySampleDownloaded } = useExcelImportTour({
    projects,
    importPreviewOpen: importPreview.isOpen,
    isMoreMenuOpen,
    setIsMoreMenuOpen,
    setIsHeaderCollapsed,
  });

  // NotificationBell용 메모
  const notifProjectNameMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)])),
    [projects],
  );
  const notifStatusNameMap = React.useMemo(
    () => new Map((wbsSettings.statusConfigs ?? []).map((c) => [c.id, c.name])),
    [wbsSettings.statusConfigs],
  );
  const notifDoneStatusIds = React.useMemo(
    () => new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id)),
    [wbsSettings.statusConfigs],
  );

  // 프로젝트가 0개가 되면(전체 삭제 등) 빈 상태 페이지로 이동 — 프로젝트 현황 전용 모드에서는 대시보드에 머무름
  useEffect(() => {
    if (isLoading) return;
    if (projects.length === 0) {
      if (!VITE_PROJECT_STATUS_ONLY) {
        setView('projects');
      }
      setIsProjectDropdownOpen(false);
      setFilters((prev) => ({ ...prev, projectIds: 'all' }));
    }
  }, [isLoading, projects.length]);

  // URL 세그먼트와 허용 뷰(`view`) 불일치 시 보정(숨김 탭·모바일 제한·북마크 등)
  useEffect(() => {
    const segment = location.pathname.replace(/^\//, '').split('/')[0] || '';
    if (segment !== view) {
      bypassViewLeaveGuardOnce();
      navigate(`/${view}`, { replace: true });
    }
  }, [location.pathname, view, navigate, bypassViewLeaveGuardOnce]);

  // 로그인 사용자·회원 표시명 디렉터리 — useViewerDirectory로 분리(동작 동일)
  const {
    profiles,
    myMemberProjectIds,
    setMyMemberProjectIds,
    profileMap,
    registeredMemberDisplayNames,
    profileDisplayById,
    ownerDepartmentByUserId,
    currentUserPlainName,
    currentUserDisplay,
  } = useViewerDirectory({ user, projects, orgMembers, assigneeDisplayMetaByName });

  // 협조 요청 — NotificationBell 알림 생성용. 대시보드 섹션과는 별도 fetch지만 정렬 결과 동일.
  const [cooperationRequests, setCooperationRequests] = useState<Awaited<ReturnType<typeof fetchCooperationRequests>>>([]);
  useEffect(() => {
    if (!user?.id) {
      setCooperationRequests([]);
      return;
    }
    let alive = true;
    fetchCooperationRequests()
      .then((rows) => {
        if (alive) setCooperationRequests(rows);
      })
      .catch(() => {
        if (alive) setCooperationRequests([]);
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  // 동시에 이 프로젝트를 보고 있는 다른 사용자 (Supabase Presence)
  const { others: presenceOthers } = usePresence(currentProjectId === 'all' ? '' : currentProjectId, user?.id, currentUserDisplay);

  // 프로젝트 목록 파생값 — useProjectDerivations로 분리(동작 동일)
  const { taskCountByProject, orphanAndUnassignedTaskCount, uniqueProjects, projectsSortedByName, deletableProjects } =
    useProjectDerivations({ projects, allTasks, userId: user?.id, realIsAdmin });

  // 초대 링크 수락 (?invite=token)
  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    acceptInvite(token)
      .then((result) => {
        if (result.success && result.projectId) {
          requestProjectSwitch(result.projectId, () => {
            setCurrentProjectId(result.projectId);
            pushToast('프로젝트에 참여했습니다.', { variant: 'success' });
          });
        } else {
          pushToast(result.error || '초대 수락에 실패했습니다.', { variant: 'error' });
        }
        params.delete('invite');
        const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      })
      .catch(() => {
        pushToast('초대 수락에 실패했습니다.', { variant: 'error' });
        params.delete('invite');
        window.history.replaceState({}, '', window.location.pathname);
      });
  }, [isLoading, setCurrentProjectId, pushToast, requestProjectSwitch]);

  const [sharedRowHeight, setSharedRowHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 25;
    const saved = Number(window.localStorage.getItem('wbs.rowHeight'));
    return Number.isFinite(saved) && saved >= 15 && saved <= 64 ? saved : 25; // 기본 25px. 슬라이더로 바꾼 값은 기억된다.
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('wbs.rowHeight', String(sharedRowHeight));
    } catch {
      /* ignore quota */
    }
  }, [sharedRowHeight]);

  useEffect(() => {
    document.title = wbsSettings.appTitle;
  }, [wbsSettings.appTitle]);

  // Theme — 일시적으로 라이트 모드 고정. 테마 토글 UI는 헤더에서 숨김 처리됨.
  // 다시 사용 가능하게 하려면 아래 강제 라이트 적용 useEffect를 제거하고
  // 이전 localStorage 기반 로직을 복원하면 된다.
  const activeThemeMode: 'light' | 'dark' | 'system' = 'light';
  const handleThemeModeChange = useCallback((_mode: 'light' | 'dark' | 'system') => {
    // 테마 기능 비활성화 중: 변경 요청 무시
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    // 이전에 저장된 다크 선호가 있어도 라이트로 강제. 토글 UI가 다시 켜질 때
    // 사용자가 새로 선택하도록 기존 저장값은 그대로 둔다(영구 삭제 X).
  }, []);

  const navigateWithTip = useCallback(
    (nextView: typeof view) => {
      setView(nextView);
      if (nextView === 'dashboard')
        tipOnce(
          'nav.dashboard',
          VITE_PROJECT_STATUS_ONLY
            ? '프로젝트 현황에서 사업·PM·일정 요약을 확인할 수 있어요.'
            : '대시보드에서 프로젝트/상태별 현황을 빠르게 확인할 수 있어요.',
        );
      if (nextView === 'projects') tipOnce('nav.projects', '프로젝트를 생성·편집·공유·삭제할 수 있습니다.');
      if (nextView === 'allocation')
        tipOnce('nav.allocation', '투입 인원·프로젝트별 투입 비율·WBS 공수를 한 화면에서 확인·편집할 수 있어요.');
      if (nextView === 'table') tipOnce('nav.table', '표만: 작업을 빠르게 편집/정렬/복사·붙여넣기 할 때 유용합니다.');
      if (nextView === 'gantt') tipOnce('nav.gantt', '간트만: 일정 흐름을 보며 날짜를 드래그로 조정할 수 있어요.');
      if (nextView === 'kanban') tipOnce('nav.kanban', '칸반: 상태별로 작업을 옮기며 진행을 관리합니다.');
      if (nextView === 'tablegantt') tipOnce('nav.tablegantt', '표+간트: 작업표와 간트 차트를 한 화면에서 함께 봅니다.');
      if (nextView === 'tablekanban')
        tipOnce('nav.tablekanban', '표+칸반: 작업표와 상태별 칸반을 한 화면에서 보며, 세로 스크롤이 함께 움직입니다.');
      if (nextView === 'mindmap') tipOnce('nav.mindmap', '마인드맵: WBS 계층을 가지로 보고, 노드를 눌러 작업을 편집할 수 있어요.');
    },
    [tipOnce, setView, view],
  );

  // Keyboard shortcuts — extracted to useAppKeyboardShortcuts
  useAppKeyboardShortcuts({
    undo,
    redo,
    expandToLevel,
    setTreeExpandLevel,
    setIsShortcutsVisible,
    canToggleAdminMemberView: (isAdmin || adminOverride) && !!user?.id,
    memberPreview,
    setMemberPreview,
    onRequestRestoreAdminView: requestRestoreAdminView,
    pushToast,
  });

  // Ctrl+K: 검색 모달
  useEffect(() => {
    const handleSearchHotkey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleSearchHotkey);
    return () => window.removeEventListener('keydown', handleSearchHotkey);
  }, []);

  // 작업 보기 필터·정렬 상태 — useWbsViewFilters로 분리(동작 동일)
  const {
    filters,
    setFilters,
    sortConfig,
    setSortConfig,
    filterOn,
    setFilterOn,
    isProjectFilterDropdownOpen,
    setIsProjectFilterDropdownOpen,
    projectFilterDropdownRef,
    projectFilterAllCheckboxRef,
    headerProjectFilterSyncKey,
    hasActiveFilters,
    allAssignees,
    effectiveFilters,
  } = useWbsViewFilters({ tasks, currentProjectId });
  // 대시보드 필터 도구줄 표시 상태 — useDashboardFilterToolbar로 분리(동작 동일)
  const { dashboardFiltersActive, showDashboardFilterToolbar, onDashboardFilterToolbarClick } = useDashboardFilterToolbar(view);

  const selectProject = useCallback(
    (projectId: string) => {
      requestProjectSwitch(projectId, () => {
        setCurrentProjectId(projectId);
        // 이미 작업 보기(표/간트/칸반/마인드맵/전체)에 있으면 그대로 유지.
        // 대시보드·프로젝트·투입현황 등 비-작업 보기에서만 기본 "전체" 보기로 전환.
        const taskViews: ViewType[] = ['table', 'tablegantt', 'tablekanban', 'gantt', 'kanban', 'mindmap'];
        if (!taskViews.includes(viewRef.current)) {
          setView(lockMobileToDashboard ? 'dashboard' : preferredWorkSplitView);
        }
      });
    },
    [requestProjectSwitch, setCurrentProjectId, setView, lockMobileToDashboard, preferredWorkSplitView],
  );

  /** 대시보드 마운트 시 등록 — ⋮ 메뉴에서 프로젝트 등록현황 PDF */
  const projectRegistrationPdfRef = useRef<(() => Promise<void>) | null>(null);

  const handleSaveProjectRegistrationPdf = useCallback(async () => {
    setIsMoreMenuOpen(false);
    if (hiddenViews.has('dashboard')) {
      pushToast('이 화면 구성에서는 프로젝트 등록현황 PDF를 사용할 수 없습니다.', { variant: 'info' });
      return;
    }
    const fn = projectRegistrationPdfRef.current;
    if (fn) {
      try {
        await fn();
      } catch (e) {
        console.error(e);
        pushToast('PDF 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.', { variant: 'error' });
      }
      return;
    }
    try {
      sessionStorage.setItem('wbs-pending-project-registration-pdf', '1');
    } catch {
      /* ignore */
    }
    navigateWithTip('dashboard');
  }, [hiddenViews, pushToast, navigateWithTip]);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  const handleSaveTask = (taskData: Partial<Task>) => addTask(taskData);

  /** 특정 작업의 모든 조상을 펼쳐서 해당 작업이 보이게 함 */
  const expandAncestors = useCallback(
    (taskId: string) => {
      const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));
      let current = taskMap.get(taskId);
      while (current?.parentId) {
        const parent = taskMap.get(current.parentId);
        if (parent && !parent.expanded) {
          updateTask(parent.id, { expanded: true }, { skipCascade: true });
        }
        current = parent;
      }
    },
    [allTasks, updateTask],
  );

  /** 검색/알림에서 작업 선택 시 공통 동작 */
  const navigateToTask = useCallback(
    (taskId: string, projectId: string) => {
      requestProjectSwitch(projectId, () => {
        if (lockMobileToDashboard || noSplitWorkView) {
          setCurrentProjectId(projectId);
          setView('dashboard');
          pushToast(
            lockMobileToDashboard
              ? '모바일 화면에서는 대시보드만 제공됩니다. 작업 상세·편집은 PC에서 이용해 주세요.'
              : '현재 화면에서는 프로젝트 현황(대시보드)만 제공됩니다. 작업 표는 사용할 수 없습니다.',
            {
              variant: 'default',
              durationMs: 5000,
              id: lockMobileToDashboard ? 'mobile-dashboard-only' : 'project-status-only',
            },
          );
          return;
        }
        setCurrentProjectId(projectId);
        setSelectedTaskIds([taskId]);
        expandAncestors(taskId);
        setScrollToTaskId(taskId);
        setView(preferredWorkSplitView);
        // 스크롤 완료 후 scrollToTaskId 해제 + 테이블에 포커스 (키보드 단축키 동작)
        setTimeout(() => {
          setScrollToTaskId(null);
          const table = document.querySelector<HTMLElement>('[data-wbs-table]');
          table?.focus();
        }, 500);
      });
    },
    [
      requestProjectSwitch,
      setCurrentProjectId,
      setSelectedTaskIds,
      expandAncestors,
      setView,
      lockMobileToDashboard,
      noSplitWorkView,
      preferredWorkSplitView,
      pushToast,
    ],
  );

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
      // 신규 프로젝트 생성 직후: addProject 내부에서 currentProjectId가 새 프로젝트로 잡힘 → 표+간트 화면으로 이동.
      // 모바일은 작업 화면 편집이 막혀 있으므로 대시보드 유지.
      if (!lockMobileToDashboard) setView(preferredWorkSplitView);
    }
    setIsProjectModalOpen(false);
  };

  const handleDeleteAll = () => {
    deleteAllTasks();
    setIsDeleteAllConfirmOpen(false);
    setIsProjectDropdownOpen(false);
  };

  const handleDeleteAllProjects = () => {
    // 요청사항: 전체 삭제 시 프로젝트도 전부 제거하고 새 프로젝트로 리셋
    resetAllProjectsToNew();
    setIsDeleteAllProjectsConfirmOpen(false);
    setIsDeleteChoiceOpen(false);
    setIsProjectDropdownOpen(false);
  };

  const handleDeleteProject = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      setProjectToDelete(null);
      // 삭제 후 currentProjectId는 남은 프로젝트로 자동 전환되지만 작업 화면에 그대로 머물면 혼란 → 대시보드로 이동
      setView('dashboard');
    }
    setIsDeleteProjectConfirmOpen(false);
  };

  const handleCopyProject = () => {
    if (projectToCopy) {
      copyProject(projectToCopy.id);
      setProjectToCopy(null);
      // 복사 직후: copyProject 내부에서 새 복사본이 currentProjectId로 잡힘 → 표+간트 작업 화면으로 이동.
      // 모바일은 작업 화면 편집이 막혀 있으므로 대시보드 유지.
      if (!lockMobileToDashboard) setView(preferredWorkSplitView);
    }
    setIsCopyProjectConfirmOpen(false);
    setIsProjectDropdownOpen(false);
  };

  // File import/export — extracted to useFileImportExport hook
  const fileIO = useFileImportExport({
    projects,
    allTasks,
    currentProjectId,
    wbsMap,
    wbsSettings,
    pushToast,
    importTasks,
    restoreBackup,
    mergeBackups,
    exportFullBackup,
    updateTask,
    flushProjectTaskRollups,
    setCurrentProjectId,
    setFilters,
    setImportPreview,
    setBackupConfirm,
    setMultiMergeConfirm,
    setErrorAlert,
    setIsExportModalOpen,
    onImportComplete: () => {
      bypassViewLeaveGuardOnce();
      setViewRaw(preferredWorkSplitView);
    },
    lastExportPrefs,
    setLastExportPrefs,
    importPreview,
    backupConfirm,
    multiMergeConfirm,
    assigneeDisplayMetaByName,
    statusConfigs: wbsSettings.statusConfigs ?? [],
    onSampleTemplateDownloaded: notifySampleDownloaded,
  });
  const {
    fileInputRef,
    backupInputRef,
    mergeInputRef,
    handleExportFromModal,
    handleImportClick,
    handleDownloadSampleTemplate,
    handleFileChange,
    handleBackupFileChange,
    handleMergeFileChange,
    handleImportMappingChange,
    handleImportCustomColumnToggle,
    handleImportCustomColumnsSet,
    executeMultiMerge,
    executeImport,
    executeRestoreBackup,
    executeRestoreBackupIntoProject,
  } = fileIO;

  // 최초 접속 시 DB 자동 동기화(1회) — useInitialDbSync로 분리
  useInitialDbSync({ isLoading, syncWithDb });

  // View switch, Ctrl+S preventDefault — now in useAppKeyboardShortcuts

  // importFromExcelFiles ~ executeRestoreBackupIntoProject — now in useFileImportExport

  const handleDashboardNavigate = (newView: typeof view, newFilters: Partial<FilterState> & { projectId?: string }) => {
    // 대시보드 카드 클릭 시, 해당 조건으로 필터된 내역을 바로 보여주기 위한 내비게이션
    const dashPid = newFilters.projectId;
    const projectIds = dashPid && dashPid !== 'all' ? ([dashPid] as string[]) : ('all' as const);
    const { projectId: _omit, ...rest } = newFilters;

    requestNavigation(() => {
      setViewRaw(newView);
      setFilters(() => ({
        status: 'all',
        assignee: '',
        startDate: '',
        endDate: '',
        milestoneOnly: false,
        issueOnly: false,
        level: 'all',
        pastDueOnly: false,
        completedThisWeekOnly: false,
        notStartedYetOnly: false,
        ...rest,
        projectIds,
      }));
      if (dashPid && dashPid !== 'all') {
        setCurrentProjectId(dashPid);
      }
    });

    // 대시보드 진입 시 필터를 자동으로 켜지 않는다(사용자 요청).
    // 필터 값(상태/담당자 등)은 setFilters로 스테이트에는 들어가 있지만,
    // 필터 토글이 꺼져 있으면 effectiveFilters가 무시하므로 화면에는 반영되지 않는다.
    // 사용자가 필요하면 필터 토글을 직접 켜서 미리 채워진 조건을 적용할 수 있다.
  };

  if (isLoading) {
    return <AppSkeleton isSupabaseConfigured={isSupabaseConfigured} />;
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden h-screen',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      {projectSwitchPrompt && (
        <UnsavedProjectSwitchDialog
          dialogRef={projectSwitchDialogRef}
          targetLabel={projectSwitchTargetLabel}
          busy={projectSwitchBusy}
          action={projectSwitchAction}
          onCancel={handleProjectSwitchCancel}
          onDiscard={() => void handleProjectSwitchDiscardProceed()}
          onSave={() => void handleProjectSwitchSaveAndProceed()}
        />
      )}
      {viewLeavePrompt && (
        <UnsavedViewLeaveDialog
          dialogRef={viewLeaveDialogRef}
          mode={viewLeavePrompt.mode}
          targetLabel={viewLeavePrompt.targetLabel}
          busy={viewLeaveBusy}
          action={viewLeaveAction}
          onCancel={handleViewLeaveCancel}
          onDiscard={() => void handleViewLeaveDiscardProceed()}
          onSave={() => void handleViewLeaveSaveAndProceed()}
        />
      )}
      {/* 데스크톱 대시보드는 집계 화면이라 플로팅 저장을 숨긴다. 모바일 대시보드 전용(lock)일 때는 표로 못 가므로 버튼 유지. */}
      {isSupabaseConfigured && hasLocalChangesSinceSync && (view !== 'dashboard' || lockMobileToDashboard) && (
        <button
          type="button"
          data-tourid="tour-save"
          onClick={() => void saveNow()}
          disabled={isDbPushInProgress}
          title="변경사항을 서버에 저장합니다"
          className={cn(
            'fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition',
            'bg-indigo-600 hover:bg-indigo-700 active:translate-y-px disabled:opacity-70',
          )}
        >
          <span className={cn('inline-block h-2 w-2 rounded-full', isDbPushInProgress ? 'animate-pulse bg-white/70' : 'bg-amber-300')} />
          {isDbPushInProgress ? '저장 중…' : '저장'}
        </button>
      )}
      {!isFullscreen && (
        <AppHeader
          wbsSettings={wbsSettings}
          isHeaderCollapsed={isHeaderCollapsed}
          setIsHeaderCollapsed={setIsHeaderCollapsed}
          requestRefresh={requestRefresh}
          logo={logo}
          isProjectDropdownOpen={isProjectDropdownOpen}
          setIsProjectDropdownOpen={setIsProjectDropdownOpen}
          currentProjectId={currentProjectId}
          currentProject={currentProject}
          user={user}
          effectiveIsAdmin={effectiveIsAdmin}
          profileMap={profileMap}
          profileDisplayById={profileDisplayById}
          presenceOthers={presenceOthers}
          selectProject={selectProject}
          allTasks={allTasks}
          projectsSortedByName={projectsSortedByName}
          taskCountByProject={taskCountByProject}
          orphanAndUnassignedTaskCount={orphanAndUnassignedTaskCount}
          isAdmin={isAdmin}
          adminOverride={adminOverride}
          myEditableProjectIds={myEditableProjectIds}
          setIsShareOpen={setIsShareOpen}
          setEditingProject={setEditingProject}
          setIsProjectModalOpen={setIsProjectModalOpen}
          setProjectToDelete={setProjectToDelete}
          setIsDeleteProjectConfirmOpen={setIsDeleteProjectConfirmOpen}
          setProjectToCopy={setProjectToCopy}
          setIsCopyProjectConfirmOpen={setIsCopyProjectConfirmOpen}
          setView={setView}
          undo={undo}
          canUndo={canUndo}
          redo={redo}
          canRedo={canRedo}
          hiddenViews={hiddenViews}
          view={view}
          dashboardNavLabel={VITE_PROJECT_STATUS_ONLY ? '프로젝트 현황' : '대시보드'}
          navigateWithTip={navigateWithTip}
          filterOn={filterOn}
          setFilterOn={setFilterOn}
          dashboardFilterBarMode={view === 'dashboard'}
          dashboardFiltersActive={dashboardFiltersActive}
          showDashboardFilterToolbar={showDashboardFilterToolbar}
          onDashboardFilterToolbarClick={onDashboardFilterToolbarClick}
          tipOnce={tipOnce}
          currentUserDisplay={currentUserDisplay}
          currentUserPlainName={currentUserPlainName}
          signOut={signOut}
          isMoreMenuOpen={isMoreMenuOpen}
          setIsMoreMenuOpen={setIsMoreMenuOpen}
          setIsWeeklyReportOpen={setIsWeeklyReportOpen}
          setIsOrganizationOpen={setIsOrganizationOpen}
          userApproved={userApproved}
          handleImportClick={handleImportClick}
          handleDownloadSampleTemplate={handleDownloadSampleTemplate}
          onSaveProjectRegistrationPdf={handleSaveProjectRegistrationPdf}
          setIsExportModalOpen={setIsExportModalOpen}
          setIsSettingsModalOpen={setIsSettingsModalOpen}
          isShortcutsVisible={isShortcutsVisible}
          setIsShortcutsVisible={setIsShortcutsVisible}
          setIsMembersModalOpen={setIsMembersModalOpen}
          setIsResetConfirmOpen={setIsResetConfirmOpen}
          setIsDeleteChoiceOpen={setIsDeleteChoiceOpen}
          onOpenAuditLog={() => setView('worklog')}
          canEditCurrentProject={canEditCurrentProject}
          setIsModalOpen={setIsModalOpen}
          themeMode={activeThemeMode}
          onThemeModeChange={handleThemeModeChange}
          onFavoriteProjectsChange={(ids) => updateWbsSettings({ favoriteProjectIds: ids })}
          headerRightSlot={
            <NotificationBell
              allTasks={allTasks}
              currentUserDisplay={currentUserDisplay}
              projectNameMap={notifProjectNameMap}
              statusNameMap={notifStatusNameMap}
              doneStatusIds={notifDoneStatusIds}
              onSelectTask={navigateToTask}
              cooperationRequests={cooperationRequests}
              currentUserPlainName={currentUserPlainName}
              onSelectCooperation={() => {
                // 협조 요청은 대시보드의 섹션으로 통합되어 있어 클릭 시 대시보드로 이동.
                setView('dashboard');
              }}
            />
          }
          memberPreview={memberPreview}
          setMemberPreview={setMemberPreview}
          onRequestRestoreAdminView={requestRestoreAdminView}
          canOpenMembersManagement={canOpenMembersManagement}
          setIsAdminPasswordModalOpen={setIsAdminPasswordModalOpen}
          setIsAdminAccessRequestModalOpen={isSupabaseConfigured ? setIsAdminAccessRequestModalOpen : undefined}
          setIsProjectEditAccessRequestModalOpen={isSupabaseConfigured ? setIsProjectEditAccessRequestModalOpen : undefined}
          ownerDepartmentByUserId={ownerDepartmentByUserId}
          onOpenTutorial={() => setIsTutorialOpen(true)}
          onStartTour={hiddenViews.has('projects') ? undefined : startGuidedTour}
          onStartExcelImportTour={hiddenViews.has('projects') ? undefined : startExcelImportTour}
        />
      )}

      {!isFullscreen && view === 'dashboard' && (
        <div
          id="dashboard-filter-toolbar-host"
          className={cn(
            'bg-white/80 backdrop-blur-lg border-b border-slate-200/60 px-4 py-2.5 flex flex-wrap items-center gap-2 shrink-0 z-40 min-h-[48px]',
            !showDashboardFilterToolbar && 'hidden',
          )}
          style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.03)' }}
        />
      )}

      {/* Filter bar */}
      <AppFilterBar
        filterOn={filterOn}
        isFullscreen={isFullscreen}
        view={view}
        filters={filters}
        setFilters={setFilters}
        setFilterOn={setFilterOn}
        wbsSettings={wbsSettings}
        user={user}
        profileMap={profileMap}
        allAssignees={allAssignees}
        assigneeDisplayMetaByName={assigneeDisplayMetaByName}
        setCurrentProjectId={setCurrentProjectIdGuarded}
        selectProject={selectProject}
        projectsSortedByName={projectsSortedByName}
        uniqueProjects={uniqueProjects}
        hasActiveFilters={hasActiveFilters}
        projectFilterDropdownRef={projectFilterDropdownRef}
        isProjectFilterDropdownOpen={isProjectFilterDropdownOpen}
        setIsProjectFilterDropdownOpen={setIsProjectFilterDropdownOpen}
        projectFilterAllCheckboxRef={projectFilterAllCheckboxRef}
        headerProjectFilterSyncKey={headerProjectFilterSyncKey}
      />

      {isFullscreen && (
        <div className="absolute top-3 right-3 z-[60] flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(false)}
            className="px-3 py-2 rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200/80 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-all flex items-center gap-1.5"
            style={{ boxShadow: 'var(--shadow-md)' }}
          >
            <Minimize2 size={14} />
            전체화면 해제
          </button>
        </div>
      )}
      <main
        className={cn(
          'min-h-0 overflow-hidden flex flex-row relative flex-1',
          lockMobileToDashboard ? 'pb-0' : 'pb-[72px] md:pb-0',
          isFullscreen && 'fixed inset-0 z-50 bg-[var(--color-surface)]',
        )}
      >
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" size={28} />
            </div>
          }
        >
          <div className="flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden">
            <div className="flex-1 min-h-0 min-w-0 h-full flex flex-col overflow-hidden relative bg-white">
              {dashboardMountedOnceRef.current && (
                <div className={cn('flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden', view !== 'dashboard' && 'hidden')}>
                  <ErrorBoundary viewName="대시보드">
                    <Dashboard
                      mobileReadabilityMode={lockMobileToDashboard}
                      projectRegistrationPdfRef={projectRegistrationPdfRef}
                      onNavigate={lockMobileToDashboard || noSplitWorkView ? undefined : handleDashboardNavigate}
                      onOpenTaskInTable={navigateToTask}
                      registeredMemberDisplayNames={registeredMemberDisplayNames}
                      myInvolvedProjectIds={
                        user?.id
                          ? (() => {
                              const ids = new Set<string>();
                              for (const p of projects) {
                                if (isProjectMineForUserListFilter(p, user.id, currentUserPlainName)) ids.add(p.id);
                              }
                              for (const id of myMemberProjectIds) ids.add(id);
                              const myName = (currentUserPlainName || '').trim();
                              if (myName) {
                                for (const t of allTasks) {
                                  if (t.assignee && t.assignee.trim() === myName) ids.add(t.projectId);
                                }
                              }
                              return ids;
                            })()
                          : undefined
                      }
                      currentUserDisplay={currentUserDisplay}
                      currentUserPlainName={currentUserPlainName}
                      profileMap={profileMap}
                      currentUserId={user?.id}
                      ownerDepartmentByUserId={ownerDepartmentByUserId}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {view !== 'dashboard' &&
                (!effectiveIsAdmin &&
                currentProjectId &&
                currentProjectId !== 'all' &&
                currentProject &&
                currentProject.ownerId !== user?.id &&
                !myMemberProjectIds.includes(currentProjectId) &&
                !userApproved &&
                (view === 'table' ||
                  view === 'tablegantt' ||
                  view === 'tablekanban' ||
                  view === 'gantt' ||
                  view === 'kanban' ||
                  view === 'mindmap') ? (
                  <ProjectAccessRequestBanner
                    projectId={currentProjectId}
                    projectName={formatProjectDisplayName(currentProject.name, currentProject.projectKind)}
                    onRequestSent={() =>
                      getMyProjectMemberProjectIds()
                        .then(setMyMemberProjectIds)
                        .catch(() => {})
                    }
                  />
                ) : view === 'tablekanban' ? (
                  <ErrorBoundary viewName="표+칸반">
                    <TableKanbanSplit
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                      scrollToTaskId={scrollToTaskId}
                      sharedRowHeight={sharedRowHeight}
                      onRowHeightChange={setSharedRowHeight}
                      onSort={(key) => {
                        setSortConfig((current) => {
                          if (key === 'wbs' && current?.key === 'wbs') return null;
                          if (current?.key === key) {
                            if (current.direction === 'asc') return { key, direction: 'desc' };
                            return null;
                          }
                          return { key, direction: 'asc' };
                        });
                      }}
                    />
                  </ErrorBoundary>
                ) : view === 'tablegantt' ? (
                  <ErrorBoundary viewName="표+간트">
                    <TableGanttSplit
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                      scrollToTaskId={scrollToTaskId}
                      sharedRowHeight={sharedRowHeight}
                      onRowHeightChange={setSharedRowHeight}
                      onSort={(key) => {
                        setSortConfig((current) => {
                          if (key === 'wbs' && current?.key === 'wbs') return null;
                          if (current?.key === key) {
                            if (current.direction === 'asc') return { key, direction: 'desc' };
                            return null;
                          }
                          return { key, direction: 'asc' };
                        });
                      }}
                    />
                  </ErrorBoundary>
                ) : view === 'table' ? (
                  <ErrorBoundary viewName="표">
                    <div className="h-full overflow-hidden">
                      <WBSTable
                        fillHeight
                        autoFitColumnsOnMount
                        filters={effectiveFilters}
                        sortConfig={sortConfig}
                        rowHeight={sharedRowHeight}
                        onRowHeightChange={setSharedRowHeight}
                        onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                        scrollToTaskId={scrollToTaskId}
                        onSort={(key) => {
                          setSortConfig((current) => {
                            if (key === 'wbs' && current?.key === 'wbs') return null;
                            if (current?.key === key) {
                              if (current.direction === 'asc') return { key, direction: 'desc' };
                              return null;
                            }
                            return { key, direction: 'asc' };
                          });
                        }}
                      />
                    </div>
                  </ErrorBoundary>
                ) : view === 'gantt' ? (
                  <ErrorBoundary viewName="간트차트">
                    <GanttChart
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      rowHeight={sharedRowHeight}
                      onRowHeightChange={setSharedRowHeight}
                    />
                  </ErrorBoundary>
                ) : view === 'projects' ? (
                  <ErrorBoundary viewName="프로젝트 관리">
                    <ProjectsPage
                      onNavigateToWork={(projectId) => {
                        const apply = () => {
                          if (projectId) setCurrentProjectId(projectId);
                          if (lockMobileToDashboard || noSplitWorkView) {
                            pushToast(
                              lockMobileToDashboard
                                ? '모바일 화면에서는 대시보드만 제공됩니다. 작업 편집은 PC에서 이용해 주세요.'
                                : '현재 화면에서는 프로젝트 현황만 제공됩니다.',
                              {
                                variant: 'default',
                                durationMs: 5000,
                                id: lockMobileToDashboard ? 'mobile-dashboard-only' : 'project-status-only',
                              },
                            );
                            setView('dashboard');
                          } else {
                            setView(preferredWorkSplitView);
                          }
                        };
                        if (projectId) requestProjectSwitch(projectId, apply);
                        else apply();
                      }}
                      onNavigateToDashboard={() => setView('dashboard')}
                    />
                  </ErrorBoundary>
                ) : view === 'allocation' ? (
                  <ErrorBoundary viewName="투입현황">
                    <AllocationOverviewPage
                      registeredMemberDisplayNames={registeredMemberDisplayNames}
                      onEditProject={(p) => {
                        setEditingProject(p);
                        setIsProjectModalOpen(true);
                      }}
                      onCreateProject={() => {
                        setEditingProject(null);
                        setIsProjectModalOpen(true);
                      }}
                      onNavigateToWork={(projectId) => {
                        requestProjectSwitch(projectId, () => {
                          setCurrentProjectId(projectId);
                          setView(noSplitWorkView ? 'dashboard' : preferredWorkSplitView);
                        });
                      }}
                    />
                  </ErrorBoundary>
                ) : view === 'outlook' ? (
                  <ErrorBoundary viewName="영업 아웃룩">
                    <SalesOutlookPage />
                  </ErrorBoundary>
                ) : view === 'weekreport' ? (
                  <ErrorBoundary viewName="주간업무보고">
                    <WeeklyReportPage userId={user?.id ?? ''} currentUserDisplay={currentUserDisplay} />
                  </ErrorBoundary>
                ) : view === 'todo' ? (
                  <ErrorBoundary viewName="칸반">
                    <PersonalKanbanPage userId={user?.id ?? ''} />
                  </ErrorBoundary>
                ) : view === 'mindmap' ? (
                  <ErrorBoundary viewName="마인드맵">
                    <MindMapView filters={effectiveFilters} />
                  </ErrorBoundary>
                ) : view === 'worklog' ? (
                  <ErrorBoundary viewName="작업 로그">
                    <AuditLogPage
                      isOperator={realIsAdmin}
                      projectNameMap={Object.fromEntries(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]))}
                    />
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary viewName="칸반">
                    <KanbanBoard filters={effectiveFilters} />
                  </ErrorBoundary>
                ))}
            </div>
            {isShortcutsVisible && view !== 'dashboard' && (
              <ShortcutsSidebar
                view={
                  view === 'outlook' || view === 'weekreport' || view === 'todo' || view === 'worklog'
                    ? 'dashboard'
                    : view === 'tablekanban'
                      ? 'tablegantt'
                      : view
                }
                onClose={() => setIsShortcutsVisible(false)}
                onNeverShow={() => {
                  // 다시 보지 않기: 자동 표시 끔 플래그 기록 후 닫기. 메뉴(단축키)·Shift+? 로는 계속 열 수 있음.
                  try {
                    window.localStorage.setItem(SHORTCUTS_HIDE_KEY, '1');
                  } catch {
                    /* ignore */
                  }
                  setIsShortcutsVisible(false);
                  pushToast('단축키 패널을 다시 띄우지 않아요. 메뉴 → 「단축키」 또는 Shift+? 로 언제든 다시 열 수 있어요.', {
                    variant: 'info',
                    durationMs: 5000,
                  });
                }}
              />
            )}
          </div>
        </Suspense>
      </main>

      {isSearchOpen && (
        <SearchModal
          isOpen
          onClose={() => setIsSearchOpen(false)}
          onSelectTask={navigateToTask}
          onSelectProject={(projectId) => {
            requestProjectSwitch(projectId, () => {
              setCurrentProjectId(projectId);
              if (lockMobileToDashboard || noSplitWorkView) {
                setView('dashboard');
                pushToast(
                  lockMobileToDashboard
                    ? '모바일 화면에서는 대시보드만 제공됩니다. 작업 편집은 PC에서 이용해 주세요.'
                    : '현재 화면에서는 프로젝트 현황만 제공됩니다.',
                  {
                    variant: 'default',
                    durationMs: 5000,
                    id: lockMobileToDashboard ? 'mobile-dashboard-only' : 'project-status-only',
                  },
                );
              } else {
                setView(preferredWorkSplitView);
              }
            });
          }}
        />
      )}

      {isModalOpen && (
        <React.Suspense fallback={null}>
          <TaskModal
            isOpen
            onClose={() => setIsModalOpen(false)}
            onSave={handleSaveTask}
            parentOptions={tasks}
            defaultAssignee={filterOn && filters.assignee ? filters.assignee : undefined}
            defaultStartDate={filterOn && filters.startDate ? filters.startDate : undefined}
            defaultEndDate={filterOn && filters.endDate ? filters.endDate : undefined}
          />
        </React.Suspense>
      )}
      {isProjectModalOpen && (
        <ProjectModal
          isOpen
          onClose={() => {
            setIsProjectModalOpen(false);
            setEditingProject(null);
          }}
          onSave={handleSaveProject}
          project={editingProject}
          allProjects={projects}
          defaultPmNameForNewProject={currentUserPlainName}
          currentUserId={user?.id}
          canDelete={!!editingProject && projects.length > 1 && (realIsAdmin || (!!user?.id && editingProject.ownerId === user.id))}
          onDelete={() => {
            if (!editingProject) return;
            const target = editingProject;
            setIsProjectModalOpen(false);
            setEditingProject(null);
            setProjectToDelete(target);
            setIsDeleteProjectConfirmOpen(true);
          }}
        />
      )}
      {isTutorialOpen && (
        <Suspense fallback={null}>
          <TutorialModal
            isOpen
            onClose={() => setIsTutorialOpen(false)}
            onStartTour={
              hiddenViews.has('projects')
                ? undefined
                : () => {
                    setIsTutorialOpen(false);
                    startGuidedTour();
                  }
            }
            onStartExcelImportTour={
              hiddenViews.has('projects')
                ? undefined
                : () => {
                    setIsTutorialOpen(false);
                    startExcelImportTour();
                  }
            }
          />
        </Suspense>
      )}
      {tour.run && (
        <Suspense fallback={null}>
          <GuidedTour
            steps={GUIDED_TOUR_STEPS}
            stepIndex={tour.step}
            onNext={handleTourNext}
            onFinish={() => endGuidedTour('completed')}
            onSkip={() => endGuidedTour('skipped')}
            onNeverShow={() => endGuidedTour('never')}
          />
        </Suspense>
      )}
      {excelTour.run && (
        <Suspense fallback={null}>
          <GuidedTour
            steps={EXCEL_IMPORT_TOUR_STEPS}
            tourName="Excel 가져오기"
            stepIndex={excelTour.step}
            onNext={handleExcelTourNext}
            onFinish={() => endExcelImportTour('completed')}
            onSkip={() => endExcelImportTour('skipped')}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        {isSettingsModalOpen && (
          <WBSSettingsModal
            isOpen
            onClose={() => setIsSettingsModalOpen(false)}
            onRequestReset={() => {
              setIsSettingsModalOpen(false);
              setIsResetConfirmOpen(true);
            }}
          />
        )}
        {isVersionHistoryOpen && <VersionManager isOpen onClose={() => setIsVersionHistoryOpen(false)} currentVersion={APP_VERSION} />}

        {isDeleteChoiceOpen && (
          <DeleteScopeDialog
            currentProject={currentProject}
            userId={user?.id}
            realIsAdmin={realIsAdmin}
            canEditCurrentProject={canEditCurrentProject}
            deletableProjects={deletableProjects}
            profileMap={profileMap}
            onClose={() => setIsDeleteChoiceOpen(false)}
            onChooseDeleteAllProjects={() => {
              setIsDeleteChoiceOpen(false);
              setIsDeleteAllProjectsConfirmOpen(true);
            }}
            onChooseDeleteProject={(project) => {
              setIsDeleteChoiceOpen(false);
              setProjectToDelete(project);
              setIsDeleteProjectConfirmOpen(true);
            }}
            onChooseDeleteCurrentTasks={() => {
              setIsDeleteChoiceOpen(false);
              setIsDeleteAllConfirmOpen(true);
            }}
          />
        )}
        <ConfirmDialog
          isOpen={isDeleteAllConfirmOpen}
          onClose={() => setIsDeleteAllConfirmOpen(false)}
          onConfirm={handleDeleteAll}
          title="모든 작업 삭제"
          message={
            currentProjectId === 'all'
              ? '모든 프로젝트의 작업을 전체 삭제하시겠습니까?'
              : `'${currentProject?.name}' 프로젝트의 모든 작업을 삭제하시겠습니까?`
          }
          confirmLabel="삭제"
          isDanger={true}
        />
        <ConfirmDialog
          isOpen={isDeleteAllProjectsConfirmOpen}
          onClose={() => setIsDeleteAllProjectsConfirmOpen(false)}
          onConfirm={handleDeleteAllProjects}
          title="전체 삭제"
          message="모든 프로젝트/작업을 삭제하고 '새 프로젝트'로 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다."
          confirmLabel="전체 삭제"
          isDanger={true}
        />
        <ConfirmDialog
          isOpen={isDeleteProjectConfirmOpen}
          onClose={() => {
            setIsDeleteProjectConfirmOpen(false);
            setProjectToDelete(null);
          }}
          onConfirm={handleDeleteProject}
          title="프로젝트 삭제"
          message={`'${projectToDelete?.name}' 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          isDanger={true}
        />
        <ConfirmDialog
          isOpen={isCopyProjectConfirmOpen}
          onClose={() => {
            setIsCopyProjectConfirmOpen(false);
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
          isOpen={isResetConfirmOpen}
          onClose={() => setIsResetConfirmOpen(false)}
          onConfirm={async () => {
            await clearAllLocalData();
            setIsResetConfirmOpen(false);
            pushToast('로컬 데이터·설정이 초기화되었습니다. 페이지를 새로고침합니다.', { variant: 'success' });
            window.location.reload();
          }}
          title="로컬 초기화"
          message="로컬에 저장된 모든 데이터·설정을 지우고, 작업 없는 빈 '새 프로젝트'만 표시합니다. (알파 등 데모/서버 프로젝트는 이때 보이지 않습니다.) 이후 페이지를 새로고침하면 서버 데이터가 다시 내려옵니다. 되돌릴 수 없습니다. 계속하시겠습니까?"
          confirmLabel="초기화"
          isDanger={true}
        />
        <ExcelImportPreviewModal
          isOpen={importPreview.isOpen}
          onClose={() => setImportPreview((prev) => ({ ...prev, isOpen: false }))}
          onConfirm={executeImport}
          totalTaskCount={importPreview.tasks.length}
          files={importPreview.files}
          projects={projectsSortedByName}
          currentProjectId={currentProjectId}
          onMappingChange={handleImportMappingChange}
          onCustomColumnToggle={handleImportCustomColumnToggle}
          onCustomColumnsSet={handleImportCustomColumnsSet}
          onDownloadSampleTemplate={handleDownloadSampleTemplate}
        />
        <BackupRestoreModal
          isOpen={backupConfirm.isOpen}
          onClose={() => setBackupConfirm({ ...backupConfirm, isOpen: false })}
          onConfirmFull={executeRestoreBackup}
          onConfirmIntoProject={executeRestoreBackupIntoProject}
          data={backupConfirm.data}
          projects={projectsSortedByName}
          currentProjectId={currentProjectId}
        />
        <ConfirmDialog
          isOpen={multiMergeConfirm.isOpen}
          onClose={() => setMultiMergeConfirm({ ...multiMergeConfirm, isOpen: false })}
          onConfirm={executeMultiMerge}
          title="다중 프로젝트 가져오기"
          message={`선택한 ${multiMergeConfirm.fileCount}개의 파일을 가져오시겠습니까?`}
          confirmLabel="가져오기"
          isDanger={false}
        />
        <ConfirmDialog
          isOpen={errorAlert.isOpen}
          onClose={() => setErrorAlert({ isOpen: false, message: '' })}
          onConfirm={() => setErrorAlert({ isOpen: false, message: '' })}
          title="오류"
          message={errorAlert.message}
          confirmLabel="확인"
          isDanger={false}
        />
        {isShareOpen && (
          <ShareModal
            isOpen
            onClose={() => setIsShareOpen(false)}
            projectId={currentProject?.id}
            projectName={currentProject ? formatProjectDisplayName(currentProject.name, currentProject.projectKind) : undefined}
            isOwner={currentProject?.ownerId === user?.id}
            isAdmin={effectiveIsAdmin}
            profileMap={profileMap}
            profileDisplayById={profileDisplayById}
            profiles={profiles.map((p) => ({ id: p.id, full_name: p.full_name ?? null, email: p.email ?? null }))}
            ownerId={currentProject?.ownerId}
          />
        )}
        {isAuditLogOpen &&
          (() => {
            // pid가 null이면 '전체 변경 이력' 모드(관리자가 admin 메뉴에서 진입). 그 외에는 특정 프로젝트.
            const pid = auditLogProjectId;
            const proj = pid ? projects.find((p) => p.id === pid) : null;
            const projectNameMap = Object.fromEntries(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]));
            return (
              <AuditLogModal
                isOpen={true}
                onClose={() => {
                  setIsAuditLogOpen(false);
                  setAuditLogProjectId(null);
                }}
                projectId={pid}
                projectName={proj ? formatProjectDisplayName(proj.name, proj.projectKind) : undefined}
                projectNameMap={projectNameMap}
              />
            );
          })()}
        {isMembersModalOpen && (
          <MembersModal
            isOpen
            onClose={() => setIsMembersModalOpen(false)}
            currentUserId={user?.id}
            dbIsAdmin={isAdmin}
            adminOverride={adminOverride}
            isOrgScopedManager={isOrgScopedManager}
            managedOrgNodeIdForViewer={currentUserManagedOrgNodeId}
            projects={projectsSortedByName.map((p) => ({
              id: p.id,
              name: p.name,
              ownerId: p.ownerId,
              projectKind: p.projectKind,
            }))}
            profileMap={profileMap}
            profileDisplayById={profileDisplayById}
            onNavigateToProject={(projectId) => {
              requestProjectSwitch(projectId, () => {
                setCurrentProjectId(projectId);
                setIsMembersModalOpen(false);
                if (lockMobileToDashboard || noSplitWorkView) {
                  setView('dashboard');
                } else {
                  setView(preferredWorkSplitView);
                }
              });
            }}
            onDeleted={() => {
              pushToast('회원이 삭제되었습니다.', { variant: 'success' });
              onMembersUpdated?.();
            }}
            onApproved={() => {
              pushToast('회원을 승인했습니다. (전체 프로젝트 목록 조회 등 권한에 반영됩니다.)', { variant: 'success' });
              onMembersUpdated?.();
            }}
          />
        )}
        {isSupabaseConfigured && isAdminAccessRequestModalOpen && (
          <AdminAccessRequestModal
            isOpen
            onClose={() => setIsAdminAccessRequestModalOpen(false)}
            onSubmitted={() => {
              pushToast('시스템 관리자 권한 요청을 보냈습니다. 관리자 승인을 기다려 주세요.', { variant: 'success' });
            }}
          />
        )}
        {isSupabaseConfigured &&
          isProjectEditAccessRequestModalOpen &&
          currentProjectId &&
          currentProjectId !== 'all' &&
          currentProject && (
            <ProjectEditAccessRequestModal
              isOpen
              projectId={currentProjectId}
              projectName={formatProjectDisplayName(currentProject.name, currentProject.projectKind)}
              onClose={() => setIsProjectEditAccessRequestModalOpen(false)}
              onSubmitted={(state) => {
                onEditableProjectIdsRefresh?.();
                if (state === 'already_pending') {
                  pushToast('이미 편집 권한 요청이 대기 중입니다.', { variant: 'info' });
                } else if (state === 'upgraded') {
                  pushToast('요청을 편집 권한으로 변경했습니다. 승인을 기다려 주세요.', { variant: 'success' });
                } else {
                  pushToast('편집 권한 요청을 보냈습니다. 소유자 또는 관리자 승인 후 편집할 수 있습니다.', { variant: 'success' });
                }
              }}
            />
          )}
        {isAdminPasswordModalOpen && (
          <AdminPasswordModal
            isOpen
            onClose={() => setIsAdminPasswordModalOpen(false)}
            onSuccess={() => {
              setAdminOverride(true);
              sessionStorage.setItem('wbs-admin-override', 'true');
              setIsAdminPasswordModalOpen(false);
              pushToast('관리자 모드로 전환되었습니다.', { variant: 'success' });
            }}
          />
        )}
        {isAdminViewRestoreModalOpen && (
          <AdminPasswordModal
            isOpen
            heading="관리자 화면으로 전환"
            description="관리자 화면으로 복귀하려면 비밀번호를 입력하세요."
            expectedPassword={WBS_ADMIN_VIEW_RESTORE_PASSWORD}
            onClose={() => setIsAdminViewRestoreModalOpen(false)}
            onSuccess={() => {
              setMemberPreview(false);
              setIsAdminViewRestoreModalOpen(false);
              pushToast('관리자 화면으로 전환했습니다.', { variant: 'success' });
            }}
          />
        )}
        {isExportModalOpen && (
          <ExportModal
            isOpen
            onClose={() => setIsExportModalOpen(false)}
            projects={projectsSortedByName}
            allTasks={allTasks}
            selectedProjectIds={exportSelectedProjectIds}
            onSelectedProjectIdsChange={setExportSelectedProjectIds}
            wbsMap={wbsMap}
            wbsSettings={wbsSettings}
            currentUserId={user?.id}
            currentUserPlainName={currentUserPlainName}
            currentProjectId={currentProjectId !== 'all' ? currentProjectId : undefined}
            onExport={handleExportFromModal}
          />
        )}

        {isWeeklyReportOpen && effectiveIsAdmin && (
          <WeeklyReportModal
            isOpen
            onClose={() => setIsWeeklyReportOpen(false)}
            tasks={allTasks}
            projects={projectsSortedByName}
            currentProjectId={currentProjectId}
            currentUserDisplay={currentUserDisplay}
          />
        )}

        {isOrganizationOpen && (userApproved || effectiveIsAdmin) && (
          <OrganizationModal isOpen onClose={() => setIsOrganizationOpen(false)} />
        )}
      </Suspense>

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx,.xls,.xlsm,.json,.md" multiple className="hidden" />
      <input type="file" ref={backupInputRef} onChange={handleBackupFileChange} accept=".json" multiple className="hidden" />
      <input type="file" ref={mergeInputRef} onChange={handleMergeFileChange} accept=".json" multiple className="hidden" />

      {!isFullscreen && (
        <footer className="bg-slate-50/50 border-t border-slate-200/50 px-4 py-3 text-center mt-auto safe-bottom">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-1.5">
            <p className="text-[11px] font-semibold text-slate-500">지엠티 운영기술개발실</p>
            <div
              className="flex items-center gap-2 text-[10px] text-slate-400 whitespace-nowrap flex-wrap justify-center md:justify-end"
              title={`오늘 ${formatTodayKoLongWithWeekday()} (로컬) · v${APP_VERSION} (${formatReleaseDateDotKo(APP_COMMIT_DATE)})`}
            >
              <span className="text-slate-500 tabular-nums">오늘 {formatTodayKoLongWithWeekday()}</span>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span className="text-slate-600 font-medium tabular-nums">
                v{APP_VERSION} ({formatReleaseDateDotKo(APP_COMMIT_DATE)})
              </span>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span>© 2026 GMT Corporation. All rights reserved.</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function AppWithProviders() {
  const { user, loading, isResettingPassword } = useAuth();
  const { push: pushToast } = useToast();
  const { error: orgDataLoadError } = useOrganization();
  const orgDataErrorToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!orgDataLoadError) {
      orgDataErrorToastRef.current = null;
      return;
    }
    if (orgDataErrorToastRef.current === orgDataLoadError) return;
    orgDataErrorToastRef.current = orgDataLoadError;
    pushToast(`조직 정보를 DB에서 불러오지 못했습니다. 기본 조직도를 사용합니다.\n(${orgDataLoadError})`, {
      variant: 'warning',
      durationMs: 10000,
      id: 'wbs-org-db-fallback',
    });
  }, [orgDataLoadError, pushToast]);
  /** 관리자 비밀번호로 임시 관리자 모드에 진입한 상태 (sessionStorage 기반) */
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  /** 관리자가 회원 화면을 체험 중인 상태 (sessionStorage 기반). 켜져 있으면 관리자라도 화면상 비관리자처럼 동작. */
  const [memberPreview, setMemberPreviewState] = useState(() => sessionStorage.getItem('wbs-member-preview') === 'true');
  const setMemberPreview = useCallback((v: boolean) => {
    setMemberPreviewState(v);
    if (v) sessionStorage.setItem('wbs-member-preview', 'true');
    else sessionStorage.removeItem('wbs-member-preview');
  }, []);

  // 로그인 사용자 권한 상태(관리자·승인·외주·조직 책임자) — useViewerStatus로 분리(동작 동일)
  const { isAdmin, userApproved, isExternalPartner, isOrgScopedManager, currentUserManagedOrgNodeId } = useViewerStatus(user?.id);

  // 관리자 회원 체험 모드(memberPreview)는 sessionStorage에 남을 수 있어, 비관리자 로그인 시 해제한다.
  useEffect(() => {
    if (!user?.id || isAdmin || adminOverride) return;
    setMemberPreview(false);
  }, [user?.id, isAdmin, adminOverride, setMemberPreview]);

  // WBSProvider 콜백은 useCallback으로 안정화 — 인라인 함수면 매 렌더마다 새 참조가 되어
  // Provider 내부의 데이터 로딩 effect가 재실행되고 스켈레톤이 깜빡임.
  const handleConcurrentConflict = useCallback(() => {
    pushToast('다른 사용자가 동시에 수정했습니다. DB 동기화 버튼을 눌러 최신 데이터를 가져오세요.', {
      variant: 'warning',
      durationMs: 8000,
    });
  }, [pushToast]);
  const handleProviderDbError = useCallback(
    (msg: string) => {
      const localFallback = msg.includes('이 기기에 저장된 데이터를 표시') || msg.includes('로컬에 반영') || msg.includes('로컬 데이터');
      pushToast(msg, {
        variant: localFallback ? 'warning' : 'error',
        durationMs: localFallback ? 12000 : 8000,
        id: 'wbs-provider-db-error',
      });
    },
    [pushToast],
  );
  // gmtc.kr 사내 회원은 관리자와 동일 노출(요청사항) — WBSProvider.isAdmin으로 전파되어 컴포넌트 전반에 동일 적용.
  const effectiveIsAdminGlobal = (isAdmin || adminOverride || isInternalCompanyEmail(user?.email ?? '')) && !memberPreview;

  // 편집 가능 프로젝트 ID + 탭 복귀·포커스 재조회 — useEditableProjectIds로 분리(동작 동일)
  const { myEditableProjectIds, refreshEditableProjectIds } = useEditableProjectIds(user?.id);
  // 외주 계정 클라이언트 allowlist — useExternalPartnerAllowlist로 분리(동작 동일)
  const clientProjectAllowlist = useExternalPartnerAllowlist({ userId: user?.id, isExternalPartner, effectiveIsAdminGlobal });

  // 접속 기록·현재 접속자 하트비트 — useVisitLogging으로 분리(동작 동일)
  useVisitLogging(user?.id);

  if (!isSupabaseConfigured) {
    return <SupabaseSetupScreen />;
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--color-bg)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
          <span className="text-[var(--color-ink-muted)] text-sm font-medium">로딩 중...</span>
        </div>
      </div>
    );
  }
  if (isLoginLockdownActive() && !isDevAuthBypass()) {
    return <LoginLockdownScreen />;
  }
  if (!user || isResettingPassword) {
    return <LoginScreen />;
  }

  return (
    <WBSProvider
      useLocalOnly={isDevAuthBypass()}
      onConcurrentConflict={handleConcurrentConflict}
      onDbError={handleProviderDbError}
      onLocalPersistIssue={(m) => pushToast(m, { variant: 'warning', durationMs: 12000, id: 'wbs-local-persist' })}
      onUndoRedoToast={(m) => pushToast(m, { variant: 'info', id: 'wbs-undo-redo', durationMs: 3500 })}
      editableProjectIds={myEditableProjectIds}
      isAdmin={effectiveIsAdminGlobal}
      clientProjectAllowlist={clientProjectAllowlist}
    >
      <WBSApp
        isAdmin={isAdmin}
        myEditableProjectIds={myEditableProjectIds}
        userApproved={userApproved}
        adminOverride={adminOverride}
        setAdminOverride={setAdminOverride}
        memberPreview={memberPreview}
        setMemberPreview={setMemberPreview}
        isOrgScopedManager={isOrgScopedManager}
        currentUserManagedOrgNodeId={currentUserManagedOrgNodeId}
        onMembersUpdated={() => {}}
        onEditableProjectIdsRefresh={refreshEditableProjectIds}
      />
    </WBSProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppWithProviders />
    </ToastProvider>
  );
}
