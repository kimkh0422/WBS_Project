import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { WBSTable } from './components/WBSTable';
import { NavButton } from './components/NavButton';
import { AppHeader } from './components/AppHeader';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SearchModal } from './components/SearchModal';
import { NotificationBell } from './components/NotificationBell';
import { ProjectModal } from './components/ProjectModal';
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
  Keyboard,
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
  AlertTriangle,
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
import { useModalStates } from './hooks/useModalStates';
import {
  useFileImportExport,
  type ImportPreviewState,
  type BackupConfirmState,
  type MultiMergeConfirmState,
  type LastExportPrefs,
} from './hooks/useFileImportExport';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useScrollSync } from './hooks/useScrollSync';
import { useResizablePane } from './hooks/useResizablePane';
import { computeWorkloadOverloads, fixOverloadByExtending } from './lib/workload';
import { cn } from './lib/utils';
import { Task, Project, FilterState, TaskStatus, SortConfig } from './types';
import { clearAllLocalData } from './lib/persist';
import {
  acceptInvite,
  checkIsAdmin,
  fetchProfiles,
  getProfileStatus,
  getProjectOwnerDisplayNames,
  getMyProjectMemberProjectIds,
  getMyEditableProjectIds,
} from './lib/db';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { LoginScreen } from './components/LoginScreen';
import { SupabaseSetupScreen } from './components/SupabaseSetupScreen';
import { useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/Toast';
import { ExcelImportPreviewModal } from './components/ExcelImportPreviewModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { ShareModal } from './components/ShareModal';
import { MembersModal } from './components/MembersModal';
import { ProjectAccessRequestBanner } from './components/ProjectAccessRequestBanner';
import { AdminPasswordModal } from './components/AdminPasswordModal';
import type { ExportScope, ExportFormat } from './components/ExportModal';
import { v4 as uuidv4 } from 'uuid';
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns';
import logo from './assets/logo.png';

const GanttChart = React.lazy(() => import('./components/GanttChart').then((m) => ({ default: m.GanttChart })));
const KanbanBoard = React.lazy(() => import('./components/KanbanBoard').then((m) => ({ default: m.KanbanBoard })));
const MindMapView = React.lazy(() => import('./components/MindMapView').then((m) => ({ default: m.MindMapView })));
const Dashboard = React.lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const ProjectsPage = React.lazy(() => import('./components/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const AllocationOverviewPage = React.lazy(() =>
  import('./components/AllocationOverviewPage').then((m) => ({ default: m.AllocationOverviewPage })),
);
const AIAnalysisModal = React.lazy(() => import('./components/AIAnalysisModal').then((m) => ({ default: m.AIAnalysisModal })));
const WBSSettingsModal = React.lazy(() => import('./components/WBSSettingsModal').then((m) => ({ default: m.WBSSettingsModal })));
const VersionManager = React.lazy(() => import('./components/VersionManager').then((m) => ({ default: m.VersionManager })));
const AuditLogModal = React.lazy(() => import('./components/AuditLogModal').then((m) => ({ default: m.AuditLogModal })));
const ExportModal = React.lazy(() => import('./components/ExportModal').then((m) => ({ default: m.ExportModal })));
const WeeklyReportModal = React.lazy(() => import('./components/WeeklyReportModal').then((m) => ({ default: m.WeeklyReportModal })));
const OrganizationModal = React.lazy(() => import('./components/OrganizationModal').then((m) => ({ default: m.OrganizationModal })));

const WBS_INITIAL_DB_SYNC_ONCE_KEY = 'wbs.initial-db-sync.once.done';

function formatCommitDate(value: string) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return value;
  }
}

function formatCommitDateDateOnly(value: string) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return value;
  }
}

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
}: WBSAppProps) {
  const { user, signOut } = useAuth();

  // URL 기반 뷰 라우팅 — /table, /gantt, /list 등. 뒤로가기/앞으로가기/딥링크 지원
  type ViewType = 'list' | 'table' | 'gantt' | 'kanban' | 'mindmap' | 'dashboard' | 'projects' | 'allocation';
  const VALID_VIEWS = new Set<string>(['list', 'table', 'gantt', 'kanban', 'mindmap', 'dashboard', 'projects', 'allocation']);
  const location = useLocation();
  const navigate = useNavigate();
  const view: ViewType = useMemo(() => {
    const path = location.pathname.replace(/^\//, '').split('/')[0] || '';
    return VALID_VIEWS.has(path) ? (path as ViewType) : 'table';
  }, [location.pathname]);
  const setView = useCallback(
    (v: ViewType) => {
      navigate(`/${v}`, { replace: false });
    },
    [navigate],
  );
  const modals = useModalStates();
  const {
    isModalOpen,
    setIsModalOpen,
    isProjectModalOpen,
    setIsProjectModalOpen,
    isAIModalOpen,
    setIsAIModalOpen,
    isAIBusy,
    setIsAIBusy,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isShortcutsVisible,
    setIsShortcutsVisible,
    isVersionHistoryOpen,
    setIsVersionHistoryOpen,
    isExportModalOpen,
    setIsExportModalOpen,
    exportSelectedProjectIds,
    setExportSelectedProjectIds,
    isDeleteProjectConfirmOpen,
    setIsDeleteProjectConfirmOpen,
    projectToDelete,
    setProjectToDelete,
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
  const [isDbSyncing, setIsDbSyncing] = useState(false);
  const [dbSyncStep, setDbSyncStep] = useState<{ pct: number; msg: string } | null>(null);
  const [isDbPushInProgress, setIsDbPushInProgress] = useState(false);
  // 회원 체험 모드(memberPreview)가 켜지면 관리자라도 화면상 비관리자처럼 동작.
  // 단일 게이트로 모든 관리자 전용 UI에 일괄 적용 — 새 관리자 기능 추가 시 별도 처리 불필요.
  const effectiveIsAdmin = (isAdmin || adminOverride) && !memberPreview;
  /** 조직 책임자는 회원 관리(역할 수정) 진입 허용. 시스템 관리 기능은 effectiveIsAdmin과 구분 */
  const canOpenMembersManagement = effectiveIsAdmin || isOrgScopedManager;
  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null; approved?: boolean }[]>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [myMemberProjectIds, setMyMemberProjectIds] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState<string | null>(null);
  const [isLocalSaveBannerDismissed, setIsLocalSaveBannerDismissed] = useState(
    () => localStorage.getItem('wbs-local-save-banner-dismissed') === '1',
  );
  const [isBackupBannerDismissed, setIsBackupBannerDismissed] = useState(() => localStorage.getItem('wbs-backup-banner-dismissed') === '1');
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  // 메뉴(탭) 숨김: 기본은 모두 표시. Vite 환경변수 `VITE_HIDDEN_VIEWS`에 "dashboard,allocation" 처럼 지정하면 해당 탭 숨김.
  // 비관리자: 대시보드는 노출(본인이 참여하는 프로젝트만 RLS로 자연 필터링됨).
  // 투입현황/마인드맵은 관리자 전용 유지.
  const hiddenViews = React.useMemo(() => {
    const raw = import.meta.env.VITE_HIDDEN_VIEWS as string | undefined;
    const value = typeof raw === 'string' ? raw.trim() : '';
    const set = new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (!effectiveIsAdmin) {
      set.add('allocation');
      set.add('mindmap');
    }
    return set;
  }, [effectiveIsAdmin]);

  const { push: pushToast, tipOnce } = useToast();

  const {
    addTask,
    addTasks,
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
    collabPushNonce,
  } = useWBS();

  // NotificationBell용 메모
  const notifProjectNameMap = React.useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const notifStatusNameMap = React.useMemo(
    () => new Map((wbsSettings.statusConfigs ?? []).map((c) => [c.id, c.name])),
    [wbsSettings.statusConfigs],
  );
  const notifDoneStatusIds = React.useMemo(
    () => new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id)),
    [wbsSettings.statusConfigs],
  );

  const pushChangesToDbRef = useRef(pushChangesToDb);
  pushChangesToDbRef.current = pushChangesToDb;

  /** 로그인 사용자: 편집 후 자동으로 서버에 반영(Realtime로 다른 편집자에게 전달) */
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!hasLocalChangesSinceSync) return;
    const id = window.setTimeout(() => {
      void (async () => {
        setIsDbPushInProgress(true);
        try {
          await pushChangesToDbRef.current('all');
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
          // 자동 sync가 다른 사용자 프로젝트도 upsert 시도해 RLS로 거부될 수 있다.
          // 본인 프로젝트는 정상 저장되므로 "편집 권한 없습니다" 메시지는 무음 처리.
          // 그 외 진짜 에러만 토스트로 표시.
          if (!/편집 권한이 없습니다/.test(msg)) {
            pushToast(msg, { variant: 'error', durationMs: 6000, id: `db-push:${msg}` });
          }
        } finally {
          setIsDbPushInProgress(false);
        }
      })();
    }, 100);
    return () => window.clearTimeout(id);
  }, [collabPushNonce, hasLocalChangesSinceSync, isSupabaseConfigured, pushToast]);
  const prevAIBusyRef = useRef(false);
  const initialDbSyncDoneRef = useRef(false);

  // 프로젝트가 0개가 되면(전체 삭제 등) 빈 상태 페이지로 이동
  useEffect(() => {
    if (isLoading) return;
    if (projects.length === 0) {
      setView('projects');
      setIsProjectDropdownOpen(false);
      setFilters((prev) => ({ ...prev, projectIds: 'all' }));
    }
  }, [isLoading, projects.length]);

  // 숨겨진 메뉴(view)로 진입한 경우 안전하게 기본 화면(표만)으로 이동
  useEffect(() => {
    if (hiddenViews.has(view)) setView('table');
  }, [hiddenViews, view]);

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

  const profileMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

  /** 대시보드 인원별 투입 현황에 표시할 등록 회원 표시명 집합 (profiles 기준) */
  const registeredMemberDisplayNames = React.useMemo(() => {
    const names = new Set<string>();
    profiles.forEach((p) => {
      const name = (p.full_name && String(p.full_name).trim()) || p.email || '(이메일 없음)';
      names.add(name);
    });
    return names;
  }, [profiles]);

  const currentUserDisplay = React.useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id) as { full_name?: string | null } | undefined;
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return (name && String(name).trim()) || user.email || '사용자';
  }, [user, profiles]);

  // 동시에 이 프로젝트를 보고 있는 다른 사용자 (Supabase Presence)
  const { others: presenceOthers } = usePresence(currentProjectId === 'all' ? '' : currentProjectId, user?.id, currentUserDisplay);

  const taskCountByProject = React.useMemo(() => {
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
  const orphanAndUnassignedTaskCount = React.useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    return allTasks.filter((t) => !t.projectId || !ids.has(t.projectId)).length;
  }, [projects, allTasks]);

  // 프로젝트 목록: id 기준으로만 표시 (이름+소유자로 묶지 않음 → 사용자별 복사본이 원본과 합쳐지지 않음)
  const uniqueProjects = React.useMemo(() => {
    const seen = new Set<string>();
    return projects.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [projects]);

  // 권한 등급과 무관하게 동일한 목록: 소유자 그룹 없이 이름순 단일 목록 (이름 같으면 id로 2차 정렬해 순서 고정)
  const projectsSortedByName = React.useMemo(() => {
    return [...uniqueProjects].sort((a, b) => {
      const byName = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
      return byName !== 0 ? byName : (a.id ?? '').localeCompare(b.id ?? '', 'ko');
    });
  }, [uniqueProjects]);

  const deletableProjects = React.useMemo(() => {
    // "프로젝트 선택해서 삭제"는 실제로 '프로젝트+소속 작업 삭제'이므로,
    // 작업이 있는 프로젝트만 표시. 관리자가 아니면 본인이 만든 프로젝트로 한정
    return projectsSortedByName
      .filter((p) => (taskCountByProject[p.id] ?? 0) > 0)
      .filter((p) => effectiveIsAdmin || (user?.id ? p.ownerId === user.id : false));
  }, [projectsSortedByName, taskCountByProject, effectiveIsAdmin, user?.id]);

  // 초대 링크 수락 (?invite=token)
  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    acceptInvite(token)
      .then((result) => {
        if (result.success && result.projectId) {
          setCurrentProjectId(result.projectId);
          pushToast('프로젝트에 참여했습니다.', { variant: 'success' });
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
  }, [isLoading, setCurrentProjectId, pushToast]);

  const [sharedRowHeight, setSharedRowHeight] = useState(20);
  const [rowHeights, setRowHeights] = useState<number[]>([]);

  // Extracted hooks: scroll sync & resizable pane
  const { wbsScrollRef, ganttScrollRef } = useScrollSync(view);
  const { containerRef, wbsTableWidth, isDraggingResizer, startResizing } = useResizablePane();

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

  useEffect(() => {
    const prev = prevAIBusyRef.current;
    if (prev && !isAIBusy) {
      pushToast('AI 분석이 완료되었습니다. AI 버튼을 눌러 결과를 확인하세요.', { variant: 'success', id: 'ai-done' });
    }
    prevAIBusyRef.current = isAIBusy;
  }, [isAIBusy, pushToast]);

  const navigateWithTip = useCallback(
    (nextView: typeof view) => {
      setView(nextView);
      if (nextView === 'dashboard') tipOnce('nav.dashboard', '대시보드에서 프로젝트/상태별 현황을 빠르게 확인할 수 있어요.');
      if (nextView === 'projects') tipOnce('nav.projects', '프로젝트를 생성·편집·공유·삭제할 수 있습니다.');
      if (nextView === 'allocation') tipOnce('nav.allocation', '프로젝트별·인원별로 투입 비율을 한눈에 확인할 수 있어요.');
      if (nextView === 'list')
        tipOnce('nav.all', '표+간트: 표와 간트를 동시에 보며 관리합니다. 가운데 바를 드래그해 폭 조절이 가능합니다.');
      if (nextView === 'table') tipOnce('nav.table', '표만: 작업을 빠르게 편집/정렬/복사·붙여넣기 할 때 유용합니다.');
      if (nextView === 'gantt') tipOnce('nav.gantt', '간트만: 일정 흐름을 보며 날짜를 드래그로 조정할 수 있어요.');
      if (nextView === 'kanban') tipOnce('nav.kanban', '칸반: 상태별로 작업을 옮기며 진행을 관리합니다.');
      if (nextView === 'mindmap') tipOnce('nav.mindmap', '마인드맵: WBS 계층을 가지로 보고, 노드를 눌러 작업을 편집할 수 있어요.');
    },
    [tipOnce, setView, view],
  );

  // startResizing, resize, stopResizing — provided by useResizablePane()

  // Keyboard shortcuts — extracted to useAppKeyboardShortcuts
  useAppKeyboardShortcuts({
    undo,
    redo,
    expandToLevel,
    setTreeExpandLevel,
    navigateWithTip,
    hiddenViews,
    setIsShortcutsVisible,
    setIsAdminPasswordModalOpen,
    pushChangesToDbRef,
    setIsDbPushInProgress,
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

  // Filter State
  const [filters, setFilters] = useState<FilterState>({
    projectIds: 'all',
    status: 'all',
    assignee: '',
    startDate: '',
    endDate: '',
    milestoneOnly: false,
    issueOnly: false,
    level: 'all',
    pastDueOnly: false,
    completedThisWeekOnly: false,
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'wbs', direction: 'asc' });

  const selectProject = useCallback(
    (projectId: string) => {
      setCurrentProjectId(projectId);
      // 이미 작업 보기(표/간트/칸반/마인드맵/전체)에 있으면 그대로 유지.
      // 대시보드·프로젝트·투입현황 등 비-작업 보기에서만 기본 "전체" 보기로 전환.
      const taskViews: ViewType[] = ['list', 'table', 'gantt', 'kanban', 'mindmap'];
      if (!taskViews.includes(view)) {
        setView('list');
      }
    },
    [setCurrentProjectId, setView, view],
  );

  // Filter on/off (when on, filter bar and filters apply)
  const [filterOn, setFilterOn] = useState(false);
  const [isProjectFilterDropdownOpen, setIsProjectFilterDropdownOpen] = useState(false);
  const projectFilterDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isProjectFilterDropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (projectFilterDropdownRef.current && !projectFilterDropdownRef.current.contains(e.target as Node)) {
        setIsProjectFilterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isProjectFilterDropdownOpen]);

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
      setCurrentProjectId(projectId);
      setSelectedTaskIds([taskId]);
      expandAncestors(taskId);
      setScrollToTaskId(taskId);
      setView('table');
      // 스크롤 완료 후 scrollToTaskId 해제 + 테이블에 포커스 (키보드 단축키 동작)
      setTimeout(() => {
        setScrollToTaskId(null);
        const table = document.querySelector<HTMLElement>('[data-wbs-table]');
        table?.focus();
      }, 500);
    },
    [setCurrentProjectId, setSelectedTaskIds, expandAncestors, setView],
  );

  const handleSaveProject = (
    name: string,
    description: string,
    startDate?: string,
    endDate?: string,
    assignments?: Project['assignments'],
    minWorkEffortDays?: number,
    workEffortUnit?: Project['workEffortUnit'],
    reportCategory?: string,
    reportAgency?: string,
    reportBudgetThisYear?: string,
    reportTotalPeriod?: string,
    reportNameShort?: string,
    reportNameFull?: string,
  ) => {
    if (editingProject) {
      updateProject(editingProject.id, {
        name,
        description,
        startDate,
        endDate,
        assignments,
        minWorkEffortDays,
        workEffortUnit,
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
      });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, endDate, assignments, minWorkEffortDays, {
        workEffortUnit,
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
      });
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
    }
    setIsDeleteProjectConfirmOpen(false);
  };

  // File import/export — extracted to useFileImportExport hook
  const fileIO = useFileImportExport({
    projects,
    allTasks,
    currentProjectId,
    wbsMap,
    pushToast,
    importTasks,
    restoreBackup,
    mergeBackups,
    exportFullBackup,
    setCurrentProjectId,
    setFilters,
    setImportPreview,
    setBackupConfirm,
    setMultiMergeConfirm,
    setErrorAlert,
    setIsExportModalOpen,
    lastExportPrefs,
    setLastExportPrefs,
    importPreview,
    backupConfirm,
    multiMergeConfirm,
  });
  const {
    fileInputRef,
    backupInputRef,
    mergeInputRef,
    handleExportFromModal,
    handleImportClick,
    handleFileChange,
    handleBackupFileChange,
    handleMergeFileChange,
    executeMultiMerge,
    executeImport,
    executeRestoreBackup,
    executeRestoreBackupIntoProject,
  } = fileIO;

  const executeDbSync = useCallback(
    async (scope: 'current' | 'all'): Promise<boolean> => {
      // 동기화 진행/완료 토스트는 노이즈가 커서 일시 숨김 처리.
      // 진행률 state(setDbSyncStep)는 다른 UI에서 참조될 수 있어 유지.
      setIsDbSyncing(true);
      setDbSyncStep({ pct: 0, msg: '시작…' });
      try {
        await syncWithDb(scope, (pct, message) => {
          setDbSyncStep({ pct, msg: message });
        });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'DB 동기화에 실패했습니다.';
        // 실패만 사용자에게 알림(같은 id로 누적 디바운스).
        pushToast(msg, { variant: 'error', id: 'db-sync', durationMs: 8000 });
        return false;
      } finally {
        setIsDbSyncing(false);
        setDbSyncStep(null);
      }
    },
    [syncWithDb, pushToast],
  );

  // 최초 페이지 접속 시 DB 자동 동기화 (로그인 + Supabase 설정 완료)
  useEffect(() => {
    if (initialDbSyncDoneRef.current) return;
    if (window.localStorage.getItem(WBS_INITIAL_DB_SYNC_ONCE_KEY) === '1') {
      initialDbSyncDoneRef.current = true;
      return;
    }
    if (!isSupabaseConfigured) return;
    if (isLoading) return;
    initialDbSyncDoneRef.current = true;
    void (async () => {
      const ok = await executeDbSync('all');
      if (ok) window.localStorage.setItem(WBS_INITIAL_DB_SYNC_ONCE_KEY, '1');
      else initialDbSyncDoneRef.current = false;
    })();
  }, [isLoading, executeDbSync, isSupabaseConfigured]);

  // View switch, shortcuts toggle, Ctrl+S — now in useAppKeyboardShortcuts

  // importFromExcelFiles ~ executeRestoreBackupIntoProject — now in useFileImportExport

  const handleDashboardNavigate = (newView: typeof view, newFilters: Partial<FilterState> & { projectId?: string }) => {
    // 대시보드 카드 클릭 시, 해당 조건으로 필터된 내역을 바로 보여주기 위한 내비게이션
    setView(newView);

    const dashPid = newFilters.projectId;
    const projectIds = dashPid && dashPid !== 'all' ? ([dashPid] as string[]) : ('all' as const);
    const { projectId: _omit, ...rest } = newFilters;

    // 기존 필터를 초기 상태로 리셋한 뒤 대시보드에서 전달된 필터만 적용
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
      ...rest,
      projectIds,
    }));

    // 특정 프로젝트 카드일 경우, 현재 프로젝트도 함께 전환
    if (dashPid && dashPid !== 'all') {
      setCurrentProjectId(dashPid);
    }

    // 대시보드에서 들어온 경우에는 필터를 항상 켜서 바로 반영
    setFilterOn(true);
  };

  /** 헤더 프로젝트가 바뀔 때만 필터 동기화 (필터에서 다중 선택한 뒤 헤더는 그대로일 때는 유지) */
  const headerProjectFilterSyncKey = useRef<string | null>(null);
  const projectFilterAllCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = !currentProjectId || currentProjectId === 'all' ? '__all__' : currentProjectId;
    if (headerProjectFilterSyncKey.current === key) return;
    headerProjectFilterSyncKey.current = key;
    setFilters((prev) => ({
      ...prev,
      projectIds: key === '__all__' ? 'all' : [currentProjectId],
    }));
  }, [currentProjectId]);

  const hasActiveFilters =
    filterOn &&
    (filters.projectIds !== 'all' ||
      filters.status !== 'all' ||
      filters.assignee ||
      filters.startDate ||
      filters.endDate ||
      !!filters.milestoneOnly ||
      !!filters.issueOnly ||
      typeof filters.level === 'number' ||
      !!filters.pastDueOnly ||
      !!filters.completedThisWeekOnly ||
      !!filters.searchText);
  const allAssignees = Array.from(new Set(tasks.map((t) => t.assignee).filter(Boolean)));
  const effectiveFilters: FilterState = filterOn
    ? filters
    : {
        ...filters,
        status: 'all',
        assignee: '',
        startDate: '',
        endDate: '',
        milestoneOnly: false,
        issueOnly: false,
        level: 'all',
        pastDueOnly: false,
        completedThisWeekOnly: false,
      };

  const resetWbsFilters = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      projectIds: 'all',
      status: 'all',
      assignee: '',
      assigneeUnassignedOnly: false,
      startDate: '',
      endDate: '',
      milestoneOnly: false,
      issueOnly: false,
      level: 'all',
      pastDueOnly: false,
      completedThisWeekOnly: false,
      searchText: '',
    }));
  }, []);

  const requestRefresh = useCallback(async () => {
    if (hasLocalChangesSinceSync && isSupabaseConfigured) {
      try {
        await pushChangesToDbRef.current('all');
      } catch {
        /* reload anyway */
      }
    }
    window.location.reload();
  }, [hasLocalChangesSinceSync, isSupabaseConfigured]);

  if (isLoading) {
    // 스켈레톤 로딩: 실제 테이블 레이아웃을 모방
    const skeletonPulse = 'animate-pulse bg-[var(--color-line)] rounded';
    return (
      <div className="h-full flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)]">
        {/* 헤더 스켈레톤 */}
        <div className="px-4 md:px-6 py-3 border-b border-[var(--color-line)] flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl ${skeletonPulse}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-48 ${skeletonPulse}`} />
            <div className={`h-3 w-32 ${skeletonPulse}`} />
          </div>
          <div className="hidden md:flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-8 w-16 rounded-lg ${skeletonPulse}`} />
            ))}
          </div>
        </div>
        {/* 요약 바 스켈레톤 */}
        <div className="px-4 py-2 border-b border-[var(--color-line)] flex items-center gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={`h-5 w-24 rounded ${skeletonPulse}`} />
          ))}
        </div>
        {/* 테이블 헤더 스켈레톤 */}
        <div className="px-2 py-2 border-b border-[var(--color-line)] flex items-center gap-3">
          <div className={`h-4 w-8 ${skeletonPulse}`} />
          <div className={`h-4 w-12 ${skeletonPulse}`} />
          {[60, 200, 70, 70, 50, 60, 60, 60].map((w, i) => (
            <div key={i} className={`h-4 rounded ${skeletonPulse}`} style={{ width: w }} />
          ))}
        </div>
        {/* 테이블 행 스켈레톤 */}
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="px-2 py-3 border-b border-[var(--color-line-soft)] flex items-center gap-3"
              style={{ opacity: 1 - i * 0.06 }}
            >
              <div className={`h-4 w-4 rounded ${skeletonPulse}`} />
              <div className={`h-4 w-8 rounded ${skeletonPulse}`} />
              <div className={`h-4 w-12 rounded ${skeletonPulse}`} />
              <div className={`h-4 rounded ${skeletonPulse}`} style={{ width: 140 + (i % 3) * 40 }} />
              {[65, 65, 45, 55, 55, 55].map((w, j) => (
                <div key={j} className={`h-4 rounded ${skeletonPulse}`} style={{ width: w }} />
              ))}
            </div>
          ))}
        </div>
        {/* 하단 로딩 표시 */}
        <div className="py-3 text-center">
          <p className="text-xs text-[var(--color-ink-muted)] flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            {isSupabaseConfigured ? '서버에서 데이터를 불러오는 중...' : '로딩 중...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden h-screen',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      {!isFullscreen && (
        <AppHeader
          wbsSettings={wbsSettings}
          isHeaderCollapsed={isHeaderCollapsed}
          setIsHeaderCollapsed={setIsHeaderCollapsed}
          requestRefresh={requestRefresh}
          logo={logo}
          setIsVersionHistoryOpen={setIsVersionHistoryOpen}
          appVersion={__APP_VERSION__}
          formatCommitDate={formatCommitDate}
          formatCommitDateDateOnly={formatCommitDateDateOnly}
          appCommitDate={__APP_COMMIT_DATE__}
          isProjectDropdownOpen={isProjectDropdownOpen}
          setIsProjectDropdownOpen={setIsProjectDropdownOpen}
          currentProjectId={currentProjectId}
          currentProject={currentProject}
          user={user}
          effectiveIsAdmin={effectiveIsAdmin}
          profileMap={profileMap}
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
          copyProject={copyProject}
          setEditingProject={setEditingProject}
          setIsProjectModalOpen={setIsProjectModalOpen}
          setProjectToDelete={setProjectToDelete}
          setIsDeleteProjectConfirmOpen={setIsDeleteProjectConfirmOpen}
          setAuditLogProjectId={setAuditLogProjectId}
          setIsAuditLogOpen={setIsAuditLogOpen}
          setView={setView}
          undo={undo}
          canUndo={canUndo}
          redo={redo}
          canRedo={canRedo}
          hiddenViews={hiddenViews}
          view={view}
          navigateWithTip={navigateWithTip}
          filterOn={filterOn}
          setFilterOn={setFilterOn}
          tipOnce={tipOnce}
          currentUserDisplay={currentUserDisplay}
          signOut={signOut}
          isMoreMenuOpen={isMoreMenuOpen}
          setIsMoreMenuOpen={setIsMoreMenuOpen}
          isAIBusy={isAIBusy}
          setIsAIModalOpen={setIsAIModalOpen}
          setIsWeeklyReportOpen={setIsWeeklyReportOpen}
          setIsOrganizationOpen={setIsOrganizationOpen}
          userApproved={userApproved}
          handleImportClick={handleImportClick}
          setIsExportModalOpen={setIsExportModalOpen}
          setIsSettingsModalOpen={setIsSettingsModalOpen}
          isShortcutsVisible={isShortcutsVisible}
          setIsShortcutsVisible={setIsShortcutsVisible}
          setIsMembersModalOpen={setIsMembersModalOpen}
          setIsResetConfirmOpen={setIsResetConfirmOpen}
          setIsDeleteChoiceOpen={setIsDeleteChoiceOpen}
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
            />
          }
          memberPreview={memberPreview}
          setMemberPreview={setMemberPreview}
          canOpenMembersManagement={canOpenMembersManagement}
        />
      )}

      {!isFullscreen && !isLocalSaveBannerDismissed && (
        <div className="bg-sky-50/80 border-b border-sky-200/60 px-4 py-2.5 hidden md:flex flex-wrap items-center justify-center gap-2 text-sky-800 text-xs">
          <span>
            로그인 시 데이터는 <strong>서버(DB)</strong>를 기준으로 하며, 변경 후 잠시 뒤 <strong>자동 반영</strong>됩니다. 이 기기에도
            백업으로 로컬에 저장됩니다. 같은 프로젝트를 연 사람은 실시간으로 갱신됩니다.
          </span>
          <button
            onClick={() => {
              setIsLocalSaveBannerDismissed(true);
              localStorage.setItem('wbs-local-save-banner-dismissed', '1');
            }}
            className="ml-1 p-1 rounded-md hover:bg-sky-200/50 text-sky-500 hover:text-sky-800 transition-colors"
            title="닫기 (이 기기에서 다시 표시 안 함)"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* 백업 안내 배너 — 모바일에서는 화면 공간 절약을 위해 숨김 */}
      {!isFullscreen && !isBackupBannerDismissed && (
        <div className="bg-amber-50/80 border-b border-amber-200/60 px-4 py-2.5 hidden md:flex flex-wrap items-center justify-center gap-2 text-amber-800 text-xs">
          <AlertTriangle size={14} className="shrink-0 text-amber-500" />
          <span>
            정기적으로 <strong>내보내기</strong>로 백업을 하시기 바랍니다.
          </span>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="ml-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-200/60 hover:bg-amber-300 text-amber-900 transition-colors"
          >
            내보내기
          </button>
          <button
            onClick={() => {
              setIsBackupBannerDismissed(true);
              localStorage.setItem('wbs-backup-banner-dismissed', '1');
            }}
            className="ml-1 p-1 rounded-md hover:bg-amber-200/60 text-amber-500 hover:text-amber-800 transition-colors"
            title="닫기 (이 기기에서 다시 표시 안 함)"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filter bar: filterOn일 때 항상 표시 (모바일에서도 헤더 접힘과 무관) */}
      {filterOn && !isFullscreen && view !== 'projects' && view !== 'allocation' && (
        <div
          className="bg-white/80 backdrop-blur-lg border-b border-slate-200/60 px-4 py-2.5 flex flex-wrap items-start gap-2 shrink-0 z-40"
          style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.03)' }}
        >
          {/* 프로젝트 (다중 선택) */}
          <div
            ref={projectFilterDropdownRef}
            className="relative inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200"
          >
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="프로젝트별로 작업을 필터링합니다.">
              프로젝트
            </span>
            <button
              type="button"
              onClick={() => setIsProjectFilterDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all min-w-[140px] max-w-[260px] text-left"
              title="프로젝트 다중 선택: 여러 프로젝트 작업을 한 화면에서 볼 수 있습니다."
            >
              <span className="truncate flex-1">
                {filters.projectIds === 'all'
                  ? '전체'
                  : filters.projectIds.length === 1
                    ? (uniqueProjects.find((p) => p.id === filters.projectIds[0])?.name ?? '1개')
                    : `${filters.projectIds.length}개 프로젝트`}
              </span>
              <ChevronDown size={14} className={cn('shrink-0 opacity-60', isProjectFilterDropdownOpen && 'rotate-180')} />
            </button>
            {isProjectFilterDropdownOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-50 min-w-[280px] max-w-[320px] max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-2"
                onMouseDown={(e) => e.preventDefault()}
              >
                {(() => {
                  const allIds = projectsSortedByName.map((x) => x.id);
                  const isAll = filters.projectIds === 'all';
                  const isPartial =
                    Array.isArray(filters.projectIds) && filters.projectIds.length > 0 && filters.projectIds.length < allIds.length;
                  return (
                    <>
                      <label className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-stone-800 hover:bg-slate-50 cursor-pointer border-b border-slate-100">
                        <input
                          ref={(el) => {
                            (projectFilterAllCheckboxRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
                            if (el) el.indeterminate = isPartial;
                          }}
                          type="checkbox"
                          checked={isAll}
                          onChange={() => {
                            if (isAll) {
                              // 전체가 이미 선택된 상태에서 클릭 → 모두 해제
                              setFilters((f) => ({ ...f, projectIds: [] }));
                              headerProjectFilterSyncKey.current = '__none__';
                            } else {
                              // 일부 혹은 없음 상태에서 클릭 → 전체 선택
                              selectProject('all');
                              setFilters((f) => ({ ...f, projectIds: 'all' }));
                              headerProjectFilterSyncKey.current = '__all__';
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        전체 (모든 프로젝트)
                      </label>
                      {projectsSortedByName.map((p) => {
                        const checked = isAll || (Array.isArray(filters.projectIds) && filters.projectIds.includes(p.id));
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                if (filters.projectIds === 'all') {
                                  const excluded = allIds.filter((id) => id !== p.id);
                                  setFilters((f) => ({ ...f, projectIds: excluded }));
                                  headerProjectFilterSyncKey.current = '__partial__';
                                } else {
                                  const set = new Set(filters.projectIds);
                                  if (set.has(p.id)) {
                                    set.delete(p.id);
                                    if (set.size === 0) {
                                      selectProject('all');
                                      setFilters((f) => ({ ...f, projectIds: 'all' }));
                                      headerProjectFilterSyncKey.current = '__all__';
                                    } else {
                                      const arr = Array.from(set);
                                      if (arr.length === 1) selectProject(arr[0]);
                                      setFilters((f) => ({ ...f, projectIds: arr }));
                                    }
                                  } else {
                                    set.add(p.id);
                                    const arr = Array.from(set);
                                    if (arr.length === allIds.length) {
                                      selectProject('all');
                                      setFilters((f) => ({ ...f, projectIds: 'all' }));
                                      headerProjectFilterSyncKey.current = '__all__';
                                    } else {
                                      setFilters((f) => ({ ...f, projectIds: arr }));
                                    }
                                  }
                                }
                              }}
                              className="rounded border-slate-300 text-indigo-600"
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* 상태 */}
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-indigo-50/60 border border-indigo-100">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider" title="상태별로 작업을 필터링합니다.">
              상태
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilters((f) => ({ ...f, status: 'all' }))}
                className={cn('filter-chip', filters.status === 'all' ? 'filter-chip-active' : 'filter-chip-inactive')}
                title="모든 상태의 작업 표시"
              >
                전체
              </button>
              {wbsSettings.statusConfigs.map((config) => (
                <button
                  key={config.id}
                  onClick={() => setFilters((f) => ({ ...f, status: config.id }))}
                  className={cn('filter-chip', filters.status === config.id ? 'filter-chip-active' : 'filter-chip-inactive')}
                  title={`${config.name} 상태인 작업만 표시`}
                >
                  {config.name}
                </button>
              ))}
            </div>
          </div>

          {/* 담당자 */}
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-50/70 border border-emerald-100">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider" title="담당자별로 작업을 필터링합니다.">
              담당자
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilters((f) => ({ ...f, assignee: '' }))}
                className={cn('filter-chip', !filters.assignee ? 'filter-chip-active' : 'filter-chip-inactive')}
                title="모든 담당자의 작업 표시"
              >
                전체
              </button>
              {user?.id && profileMap[user.id] && (
                <button
                  onClick={() => {
                    setFilterOn(true);
                    setFilters((f) => ({ ...f, assignee: profileMap[user.id] }));
                  }}
                  className={cn(
                    'filter-chip flex items-center gap-1',
                    filters.assignee === profileMap[user.id] ? 'filter-chip-active' : 'filter-chip-inactive',
                  )}
                  title="내가 담당자인 작업만 표시"
                >
                  <User size={10} className="opacity-80" /> 내 업무만
                </button>
              )}
              {allAssignees.map((a) => (
                <button
                  key={a}
                  onClick={() => setFilters((f) => ({ ...f, assignee: a }))}
                  className={cn('filter-chip', filters.assignee === a ? 'filter-chip-active' : 'filter-chip-inactive')}
                  title={`${a} 담당 작업만 표시`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* 마일스톤/이슈 (전체·마일스톤만·이슈만 3가지) */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-100">
            <span
              className="text-[10px] font-bold text-amber-600 uppercase tracking-wider"
              title="마일스톤/이슈 기준으로 작업을 필터링합니다."
            >
              마일스톤
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    milestoneOnly: false,
                    issueOnly: false,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  !filters.milestoneOnly && !filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="마일스톤/이슈 구분 없이 모든 작업 표시"
              >
                전체
              </button>
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    milestoneOnly: true,
                    issueOnly: false,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  filters.milestoneOnly && !filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="마일스톤으로 지정된 이정표 작업만 표시"
              >
                <Flag size={12} className="opacity-80" /> 마일스톤만
              </button>
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    milestoneOnly: false,
                    issueOnly: true,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  !filters.milestoneOnly && filters.issueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="이슈로 지정된 작업만 표시"
              >
                <Bug size={12} className="opacity-80" /> 이슈만
              </button>
            </div>
          </div>

          {/* 기간 */}
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-violet-50 border border-violet-100">
            <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider" title="기간별로 작업을 필터링합니다.">
              기간
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilters((f) => ({ ...f, startDate: '', endDate: '' }))}
                className={cn('filter-chip', !filters.startDate && !filters.endDate ? 'filter-chip-active' : 'filter-chip-inactive')}
                title="기간 제한 없이 모든 작업 표시"
              >
                전체
              </button>
              <button
                onClick={() => {
                  const today = format(new Date(), 'yyyy-MM-dd');
                  setFilters((f) => ({ ...f, startDate: today, endDate: today }));
                }}
                className={cn(
                  'filter-chip',
                  filters.startDate &&
                    filters.endDate &&
                    filters.startDate === filters.endDate &&
                    filters.startDate === format(new Date(), 'yyyy-MM-dd')
                    ? 'filter-chip-active'
                    : 'filter-chip-inactive',
                )}
                title="오늘과 기간이 겹치는 작업만 표시"
              >
                금일
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
                  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
                  setFilters((f) => ({ ...f, startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') }));
                }}
                className={cn(
                  'filter-chip',
                  filters.startDate &&
                    filters.endDate &&
                    filters.startDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') &&
                    filters.endDate === format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
                    ? 'filter-chip-active'
                    : 'filter-chip-inactive',
                )}
                title="이번 주(월~일)와 기간이 겹치는 작업만 표시"
              >
                금주
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  const nextWeekBase = addDays(now, 7);
                  const nextWeekStart = startOfWeek(nextWeekBase, { weekStartsOn: 1 });
                  const nextWeekEnd = endOfWeek(nextWeekBase, { weekStartsOn: 1 });
                  setFilters((f) => ({ ...f, startDate: format(nextWeekStart, 'yyyy-MM-dd'), endDate: format(nextWeekEnd, 'yyyy-MM-dd') }));
                }}
                className={cn(
                  'filter-chip',
                  (() => {
                    if (!filters.startDate || !filters.endDate) return 'filter-chip-inactive';
                    const now = new Date();
                    const nextWeekBase = addDays(now, 7);
                    const nextWeekStart = startOfWeek(nextWeekBase, { weekStartsOn: 1 });
                    const nextWeekEnd = endOfWeek(nextWeekBase, { weekStartsOn: 1 });
                    const startMatch = filters.startDate === format(nextWeekStart, 'yyyy-MM-dd');
                    const endMatch = filters.endDate === format(nextWeekEnd, 'yyyy-MM-dd');
                    return startMatch && endMatch ? 'filter-chip-active' : 'filter-chip-inactive';
                  })(),
                )}
                title="다음 주(월~일)와 기간이 겹치는 작업만 표시"
              >
                차주
              </button>
            </div>
          </div>

          {/* 금주 완료/기한 지남 (전체·금주 완료·기한 초과 3가지) */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100">
            <span
              className="text-[10px] font-bold text-teal-700 uppercase tracking-wider"
              title="이번 주 완료/기한 초과 상태로 작업을 필터링합니다."
            >
              기한/완료
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    pastDueOnly: false,
                    completedThisWeekOnly: false,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  !filters.pastDueOnly && !filters.completedThisWeekOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="기한/완료 조건 없이 모든 작업 표시"
              >
                전체
              </button>
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    completedThisWeekOnly: true,
                    pastDueOnly: false,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  filters.completedThisWeekOnly && !filters.pastDueOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="이번 주(월~일)에 완료된 항목만 표시 (상태: 완료, 종료일: 이번 주)"
              >
                금주 완료 항목
              </button>
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    pastDueOnly: true,
                    completedThisWeekOnly: false,
                  }))
                }
                className={cn(
                  'filter-chip flex items-center gap-1',
                  filters.pastDueOnly && !filters.completedThisWeekOnly ? 'filter-chip-active' : 'filter-chip-inactive',
                )}
                title="기한이 지난 미완료 작업만 표시"
              >
                <Clock size={12} className="opacity-80" /> 기한 지난 항목
              </button>
            </div>
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setCurrentProjectId('all');
                setFilters((f) => ({
                  ...f,
                  projectIds: 'all',
                  status: 'all',
                  assignee: '',
                  startDate: '',
                  endDate: '',
                  milestoneOnly: false,
                  issueOnly: false,
                  level: 'all',
                  pastDueOnly: false,
                  completedThisWeekOnly: false,
                  searchText: '',
                }));
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-red-200 text-red-500 bg-red-50/80 hover:bg-red-100 transition-all shrink-0 ml-auto active:scale-95"
            >
              <X size={10} /> 초기화
            </button>
          )}
        </div>
      )}

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
          'min-h-0 overflow-hidden flex flex-row relative flex-1 pb-[72px] md:pb-0',
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
          <div className="flex-1 min-w-0 relative bg-white">
            {!effectiveIsAdmin &&
            currentProjectId &&
            currentProjectId !== 'all' &&
            currentProject &&
            currentProject.ownerId !== user?.id &&
            !myMemberProjectIds.includes(currentProjectId) &&
            !userApproved &&
            (view === 'list' || view === 'table' || view === 'gantt' || view === 'kanban' || view === 'mindmap') ? (
              <ProjectAccessRequestBanner
                projectId={currentProjectId}
                projectName={currentProject.name}
                onRequestSent={() =>
                  getMyProjectMemberProjectIds()
                    .then(setMyMemberProjectIds)
                    .catch(() => {})
                }
              />
            ) : view === 'list' ? (
              <ErrorBoundary viewName="표+간트">
                <div
                  ref={containerRef}
                  className={cn(
                    'relative flex w-full h-full min-h-0 list-split-view',
                    isDraggingResizer && 'cursor-col-resize select-none',
                  )}
                >
                  <div
                    className="flex-shrink-0 overflow-hidden flex flex-col h-full min-h-0 list-table-pane"
                    style={{ width: `${wbsTableWidth}%` }}
                  >
                    <WBSTable
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      syncScrollRef={wbsScrollRef}
                      rowHeight={sharedRowHeight}
                      onRowHeightChange={setSharedRowHeight}
                      onRowHeightsChange={setRowHeights}
                      onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                      onResetFilters={resetWbsFilters}
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
                  <div
                    className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-col-resize z-10 list-resizer hidden md:flex items-center justify-center group"
                    style={{ left: `${wbsTableWidth}%` }}
                    onMouseDown={startResizing}
                    title="드래그하여 패널 너비 조절"
                  >
                    {/* 전체 높이 구분선 */}
                    <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-slate-300 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition-colors duration-150 pointer-events-none" />
                    {/* 중앙 드래그 핸들 (호버 시만 표시) */}
                    <span className="relative z-10 flex flex-col items-center justify-center gap-0.5 h-10 w-4 rounded bg-white border border-indigo-400 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                      <span className="w-0.5 h-3.5 rounded-full bg-indigo-400" />
                    </span>
                  </div>
                  <div
                    className="flex-shrink-0 overflow-hidden h-full min-h-0 bg-stone-50/30 list-gantt-pane hidden md:block"
                    style={{ width: `${100 - wbsTableWidth}%` }}
                  >
                    <GanttChart
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      hideSidebar={true}
                      rowHeight={sharedRowHeight}
                      rowHeights={rowHeights}
                      onRowHeightChange={setSharedRowHeight}
                      syncScrollRef={ganttScrollRef}
                    />
                  </div>
                </div>
              </ErrorBoundary>
            ) : view === 'table' ? (
              <ErrorBoundary viewName="표">
                <div className="h-full overflow-hidden">
                  <WBSTable
                    fillHeight
                    filters={effectiveFilters}
                    sortConfig={sortConfig}
                    onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                    onResetFilters={resetWbsFilters}
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
            ) : view === 'dashboard' ? (
              <ErrorBoundary viewName="대시보드">
                <Dashboard
                  onNavigate={handleDashboardNavigate}
                  registeredMemberDisplayNames={registeredMemberDisplayNames}
                  // 비관리자(또는 회원 체험 모드)는 본인이 참여한 프로젝트만 표시.
                  // 관리자는 undefined → 전체 표시.
                  accessibleProjectIds={
                    effectiveIsAdmin
                      ? undefined
                      : new Set([...projects.filter((p) => !!user?.id && p.ownerId === user.id).map((p) => p.id), ...myMemberProjectIds])
                  }
                />
              </ErrorBoundary>
            ) : view === 'projects' ? (
              <ErrorBoundary viewName="프로젝트 관리">
                <ProjectsPage
                  onNavigateToWork={(projectId) => {
                    if (projectId) setCurrentProjectId(projectId);
                    setView('list');
                  }}
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
                  onNavigateToWork={(projectId) => {
                    setCurrentProjectId(projectId);
                    setView('list');
                  }}
                />
              </ErrorBoundary>
            ) : view === 'mindmap' ? (
              <ErrorBoundary viewName="마인드맵">
                <MindMapView filters={effectiveFilters} />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary viewName="칸반">
                <KanbanBoard filters={effectiveFilters} />
              </ErrorBoundary>
            )}
          </div>
          {isShortcutsVisible && <ShortcutsSidebar onClose={() => setIsShortcutsVisible(false)} />}
        </Suspense>
      </main>

      {isSearchOpen && (
        <SearchModal
          isOpen
          onClose={() => setIsSearchOpen(false)}
          onSelectTask={navigateToTask}
          onSelectProject={(projectId) => {
            setCurrentProjectId(projectId);
            setView('table');
          }}
        />
      )}

      {isModalOpen && (
        <TaskModal
          isOpen
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveTask}
          parentOptions={tasks}
          defaultAssignee={filterOn && filters.assignee ? filters.assignee : undefined}
          defaultStartDate={filterOn && filters.startDate ? filters.startDate : undefined}
          defaultEndDate={filterOn && filters.endDate ? filters.endDate : undefined}
        />
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
        />
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
        {isAIModalOpen && effectiveIsAdmin && (
          <AIAnalysisModal
            isOpen
            onClose={() => setIsAIModalOpen(false)}
            onBusyChange={setIsAIBusy}
            onImport={(newTasks, replace) => {
              if (replace) {
                const { overloads } = computeWorkloadOverloads(newTasks, projects);
                const toImport = overloads.length > 0 ? fixOverloadByExtending(newTasks, projects, overloads) : newTasks;
                importTasks(toImport);
              } else {
                const effectiveProjectId = currentProjectId === 'all' ? projects[0]?.id || '' : currentProjectId || projects[0]?.id || '';
                if (effectiveProjectId) {
                  addTasks(newTasks);
                } else {
                  importTasks(newTasks, '__new__', newTasks[0]?.name || 'AI 생성 프로젝트');
                }
              }
              // AI에서 도출된 담당자를 해당 프로젝트 투입 인원 현황에 자동 추가
              const projectId = newTasks[0]?.projectId;
              if (projectId && newTasks.length > 0 && projects.some((p) => p.id === projectId)) {
                const currentAssignments = projects.find((p) => p.id === projectId)?.assignments ?? [];
                const existingNames = new Set(currentAssignments.map((a) => (a.assignee || '').trim()).filter(Boolean));
                const assigneesFromTasks = new Set<string>();
                newTasks.forEach((t) => {
                  const a = (t.assignee || '').trim();
                  if (a) assigneesFromTasks.add(a);
                });
                const toAdd = [...assigneesFromTasks].filter((name) => !existingNames.has(name));
                if (toAdd.length > 0) {
                  const merged = [...currentAssignments, ...toAdd.map((assignee) => ({ assignee, allocationPercent: 100 }))];
                  updateProject(projectId, { assignments: merged });
                }
              }
            }}
            currentProjectId={currentProjectId}
            existingTasks={tasks}
            projects={projectsSortedByName}
          />
        )}
        {isVersionHistoryOpen && <VersionManager isOpen onClose={() => setIsVersionHistoryOpen(false)} currentVersion={__APP_VERSION__} />}

        {/* 삭제 유형 선택: 전체 삭제(관리자) / 현재 프로젝트 삭제(소유자·관리자) / 프로젝트 선택 삭제(소유자·관리자) / 현재 프로젝트 작업 삭제(편집자) */}
        {isDeleteChoiceOpen &&
          (() => {
            const isCurrentProjectOwner = !!currentProject && !!user?.id && currentProject.ownerId === user.id;
            const canDeleteCurrentProject = !!currentProject && (effectiveIsAdmin || isCurrentProjectOwner);
            const hasAnyOption =
              effectiveIsAdmin || canDeleteCurrentProject || deletableProjects.length > 0 || (!!currentProject && canEditCurrentProject);
            return (
              <div className="modal-overlay">
                <div className="modal-content max-w-md">
                  <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/30">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                        <AlertTriangle className="text-red-500" size={18} />
                      </div>
                      <h2 className="text-lg font-bold text-[var(--color-ink)]">삭제 유형 선택</h2>
                    </div>
                    <button onClick={() => setIsDeleteChoiceOpen(false)} className="icon-btn text-slate-400 hover:text-slate-700">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-6 max-h-[60vh] overflow-y-auto">
                    <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">삭제 방식을 선택하세요.</p>
                    <div className="mt-4 space-y-2">
                      {!hasAnyOption && (
                        <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
                          삭제 권한이 있는 항목이 없습니다. 본인이 만든 프로젝트만 삭제할 수 있어요.
                        </div>
                      )}
                      {effectiveIsAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsDeleteChoiceOpen(false);
                            setIsDeleteAllProjectsConfirmOpen(true);
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                        >
                          <span className="block font-semibold">
                            전체 삭제{' '}
                            <span className="text-[10px] font-bold uppercase ml-1 px-1.5 py-0.5 bg-red-200 text-red-800 rounded">
                              관리자
                            </span>
                          </span>
                          <span className="block text-xs text-red-600 mt-0.5">
                            모든 프로젝트/작업을 삭제하고 '새 프로젝트'로 초기화합니다.
                          </span>
                        </button>
                      )}
                      {canDeleteCurrentProject && currentProject && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsDeleteChoiceOpen(false);
                            setProjectToDelete(currentProject);
                            setIsDeleteProjectConfirmOpen(true);
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors mt-3"
                        >
                          <span className="block font-semibold">현재 보고 있는 프로젝트 삭제</span>
                          <span className="block text-xs text-red-600 mt-0.5">
                            '{currentProject.name}' 프로젝트와 소속된 모든 작업을 삭제합니다.
                            {effectiveIsAdmin && currentProject.ownerId && (
                              <span className="block text-red-500/80 mt-0.5">
                                소유:{' '}
                                {currentProject.ownerId === user?.id
                                  ? '내 프로젝트'
                                  : currentProject.ownerId
                                    ? (profileMap[currentProject.ownerId] ?? '다른 사용자')
                                    : '소유자 없음'}
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                      {deletableProjects.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-slate-500 mt-3">
                            프로젝트 선택해서 삭제 {effectiveIsAdmin ? '(전체)' : '(내 프로젝트)'}
                          </p>
                          {deletableProjects.map((project) => (
                            <button
                              key={project.id}
                              type="button"
                              onClick={() => {
                                setIsDeleteChoiceOpen(false);
                                setProjectToDelete(project);
                                setIsDeleteProjectConfirmOpen(true);
                              }}
                              className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                            >
                              <span className="block font-semibold">{project.name}</span>
                              <span className="block text-xs text-red-600 mt-0.5">
                                프로젝트와 소속된 모든 작업을 삭제합니다.
                                {effectiveIsAdmin && project.ownerId && (
                                  <span className="block text-red-500/80 mt-0.5">
                                    소유:{' '}
                                    {project.ownerId === user?.id
                                      ? '내 프로젝트'
                                      : project.ownerId
                                        ? (profileMap[project.ownerId] ?? '다른 사용자')
                                        : '소유자 없음'}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      {currentProject && canEditCurrentProject && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsDeleteChoiceOpen(false);
                            setIsDeleteAllConfirmOpen(true);
                          }}
                          className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                        >
                          <span className="block font-semibold">현재 프로젝트 작업만 삭제</span>
                          <span className="block text-xs text-red-600 mt-0.5">
                            '{currentProject.name}'의 작업만 삭제하고 프로젝트는 유지합니다.
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end p-5 border-t border-slate-100 bg-slate-50/30">
                    <button type="button" onClick={() => setIsDeleteChoiceOpen(false)} className="btn-ghost">
                      취소
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
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
          message={`'${projectToDelete?.name}' 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까?`}
          confirmLabel="프로젝트 삭제"
          isDanger={true}
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
            projectName={currentProject?.name}
            isOwner={currentProject?.ownerId === user?.id}
            isAdmin={effectiveIsAdmin}
            profileMap={profileMap}
            profiles={profiles.map((p) => ({ id: p.id, full_name: p.full_name ?? null, email: p.email ?? null }))}
            ownerId={currentProject?.ownerId}
          />
        )}
        {isAuditLogOpen &&
          (() => {
            // pid가 null이면 '전체 변경 이력' 모드(관리자가 admin 메뉴에서 진입). 그 외에는 특정 프로젝트.
            const pid = auditLogProjectId;
            const proj = pid ? projects.find((p) => p.id === pid) : null;
            const projectNameMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
            return (
              <AuditLogModal
                isOpen={true}
                onClose={() => {
                  setIsAuditLogOpen(false);
                  setAuditLogProjectId(null);
                }}
                projectId={pid}
                projectName={proj?.name}
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
            projects={projectsSortedByName.map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerId }))}
            profileMap={profileMap}
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
            <div className="flex items-center gap-2 text-[10px] text-slate-400 whitespace-nowrap">
              {effectiveIsAdmin ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsVersionHistoryOpen(true)}
                    className="hover:text-indigo-600 hover:underline transition-colors"
                    title="버전 히스토리 열기"
                  >
                    v{__APP_VERSION__} · 변경이력
                  </button>
                  <span className="text-slate-300" aria-hidden>
                    ·
                  </span>
                </>
              ) : (
                <>
                  <span>v{__APP_VERSION__}</span>
                  <span className="text-slate-300" aria-hidden>
                    ·
                  </span>
                </>
              )}
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [userApproved, setUserApproved] = useState(false);
  /** 관리자 비밀번호로 임시 관리자 모드에 진입한 상태 (sessionStorage 기반) */
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  /** 관리자가 회원 화면을 체험 중인 상태 (sessionStorage 기반). 켜져 있으면 관리자라도 화면상 비관리자처럼 동작. */
  const [memberPreview, setMemberPreviewState] = useState(() => sessionStorage.getItem('wbs-member-preview') === 'true');
  const setMemberPreview = useCallback((v: boolean) => {
    setMemberPreviewState(v);
    if (v) sessionStorage.setItem('wbs-member-preview', 'true');
    else sessionStorage.removeItem('wbs-member-preview');
  }, []);
  const effectiveIsAdminGlobal = (isAdmin || adminOverride) && !memberPreview;
  /** undefined: 로딩 전(편집 제한 미적용). 로드 후 배열로 멤버십 기반 편집 가능 프로젝트 */
  const [myEditableProjectIds, setMyEditableProjectIds] = useState<string[] | undefined>(undefined);

  const [isOrgScopedManager, setIsOrgScopedManager] = useState(false);
  const [currentUserManagedOrgNodeId, setCurrentUserManagedOrgNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      setUserApproved(false);
      setIsOrgScopedManager(false);
      setCurrentUserManagedOrgNodeId(null);
      return;
    }
    getProfileStatus()
      .then((status) => {
        if (status) {
          setIsAdmin(status.isAdmin);
          setUserApproved(status.approved);
          setIsOrgScopedManager(status.isOrgScopeManager);
          setCurrentUserManagedOrgNodeId(status.managedOrgNodeId);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setMyEditableProjectIds(undefined);
      return;
    }
    getMyEditableProjectIds()
      .then(setMyEditableProjectIds)
      .catch(() => setMyEditableProjectIds(undefined));
  }, [user?.id]);

  // 접속 기록: 로그인 후 앱 진입 시 한 번 기록 (대시보드 여부와 무관)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !user?.id) return;
    let sessionId = sessionStorage.getItem('wbs-visit-session-id');
    if (!sessionId) {
      sessionId = uuidv4();
      sessionStorage.setItem('wbs-visit-session-id', sessionId);
    }
    void (async () => {
      try {
        await supabase.rpc('record_visit', { p_session_id: sessionId });
      } catch {
        // best-effort; ignore visit logging failures
      }
    })();
  }, [user?.id]);

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
  if (!user || isResettingPassword) {
    return <LoginScreen />;
  }

  return (
    <WBSProvider
      useLocalOnly={false}
      onConcurrentConflict={() =>
        pushToast('다른 사용자가 동시에 수정했습니다. DB 동기화 버튼을 눌러 최신 데이터를 가져오세요.', {
          variant: 'warning',
          durationMs: 8000,
        })
      }
      onDbError={(msg) =>
        pushToast(msg, {
          variant: 'error',
          // React StrictMode(DEV)에서 effect가 2번 실행되거나, 동일한 DB 오류가 연속 발생할 때 토스트 중복을 방지
          id: `db-error:${msg}`,
        })
      }
      editableProjectIds={myEditableProjectIds}
      isAdmin={effectiveIsAdminGlobal}
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
