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
import { ProjectNameLabel } from './components/ProjectNameLabel';
import { AppSkeleton } from './components/AppSkeleton';
import { AppFilterBar } from './components/AppFilterBar';
import { AppLayout } from './components/AppLayout';
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
import { useAppRouting, type ViewType } from './hooks/useAppRouting';
import {
  useFileImportExport,
  type ImportPreviewState,
  type BackupConfirmState,
  type MultiMergeConfirmState,
  type LastExportPrefs,
} from './hooks/useFileImportExport';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useMatchMedia } from './hooks/useMatchMedia';
import { computeWorkloadOverloads, fixOverloadByExtending } from './lib/workload';
import { cn, formatTodayKoLongWithWeekday, formatReleaseDateDotKo } from './lib/utils';
import { formatProjectDisplayName, isPrivateProjectHiddenFromViewer } from './lib/projectKind';
import { isProjectMineForUserListFilter } from './lib/projectMineFilter';
import { isInternalCompanyEmail } from './lib/emailDomain';
import { useOrganization } from './context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, buildProfileDisplayById, formatAssigneeDisplay, formatPersonDisplay } from './lib/assigneeOptions';
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
import { fetchCooperationRequests } from './lib/db/cooperationRequests';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { isDevAuthBypass } from './lib/devAuthBypass';
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
import { AdminAccessRequestModal } from './components/AdminAccessRequestModal';
import { ProjectEditAccessRequestModal } from './components/ProjectEditAccessRequestModal';
import type { ExportScope, ExportFormat } from './components/ExportModal';
import { v4 as uuidv4 } from 'uuid';
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns';
import logo from './assets/logo.png';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { GUIDED_TOUR_STEPS, TOUR_INDEX } from './lib/guidedTourSteps';

// WBSTable(+SortableTaskRow 등 대형 트리)·TableGanttSplit은 표/간트 뷰에서만 필요 → 지연 로딩으로 초기(대시보드) 번들에서 분리.
// lazyWithRetry: 배포 직후 옛 청크 해시를 가져오다 실패하면 1회 자동 새로고침으로 새 번들 회수.
const WBSTable = lazyWithRetry(() => import('./components/WBSTable').then((m) => ({ default: m.WBSTable })));
const TableGanttSplit = lazyWithRetry(() => import('./components/TableGanttSplit').then((m) => ({ default: m.TableGanttSplit })));
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
const WBS_INITIAL_DB_SYNC_ONCE_KEY = 'wbs.initial-db-sync.once.done';
/** 따라하기 투어 자동 표시 끔 플래그 — 「다시 보지 않기」 선택 또는 완주 시에만 기록. 그냥 닫으면(X·Esc) 다음 접속 때 다시 시작 */
const GUIDED_TOUR_HIDE_KEY = 'wbs.guided-tour.v1.hide';

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

  // 회원 체험 모드(memberPreview)가 켜지면 관리자라도 화면상 비관리자처럼 동작.
  // 단일 게이트로 모든 관리자 전용 UI에 일괄 적용 — 새 관리자 기능 추가 시 별도 처리 불필요.
  // gmtc.kr 사내 회원은 관리자와 동일하게 모든 메뉴·정보 표시(요청사항). 외부 도메인은 기존 권한 유지.
  const effectiveIsAdmin = (isAdmin || adminOverride || isInternalCompanyEmail(user?.email ?? '')) && !memberPreview;
  /** 조직 책임자는 회원 관리(역할 수정) 진입 허용. 시스템 관리 기능은 effectiveIsAdmin과 구분 */
  const canOpenMembersManagement = effectiveIsAdmin || isOrgScopedManager;

  const { view, setView, hiddenViews, lockMobileToDashboard, dashboardMountedOnceRef } = useAppRouting({
    effectiveIsAdmin,
    userEmail: user?.email,
    isProjectStatusOnly: VITE_PROJECT_STATUS_ONLY,
  });

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
  const [isDbSyncing, setIsDbSyncing] = useState(false);
  const [dbSyncStep, setDbSyncStep] = useState<{ pct: number; msg: string } | null>(null);
  const [isDbPushInProgress, setIsDbPushInProgress] = useState(false);

  /** 메인 메뉴(뷰) 전환 시 헤더 프로젝트 선택 팝업 닫기 */
  useEffect(() => {
    setIsProjectDropdownOpen(false);
  }, [view]);

  const { push: pushToast, tipOnce } = useToast();

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
  } = useWBS();

  // URL 라우팅 + 회원(프로필)·소유자 표시명·내 멤버 프로젝트 상태.
  // (아래 라우팅 보정/프로필 로딩 useEffect·메모에서 사용됨 — 선언 누락으로 인한 'navigate is not defined' 등 런타임 크래시 복구)
  const navigate = useNavigate();
  const location = useLocation();
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof fetchProfiles>>>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [myMemberProjectIds, setMyMemberProjectIds] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [scrollToTaskId, setScrollToTaskId] = useState<string | null>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  // ── 초보자 따라하기 투어 ─────────────────────────────────────────────
  // 신규 프로젝트 생성 → 첫 작업 입력 순서를 실제 화면 위에서 안내(GuidedTour).
  // action 단계는 아래 effect가 모달 열림·프로젝트 생성·작업 추가를 감지해 자동 진행한다.
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tour, setTour] = useState<{ run: boolean; step: number }>({ run: false, step: 0 });
  /** 투어 시작 시점의 프로젝트·작업 수 — 생성/추가 감지 기준 */
  const tourBaselineRef = useRef({ projects: 0, tasks: 0 });

  const startGuidedTour = useCallback(() => {
    tourBaselineRef.current = { projects: projects.length, tasks: allTasks.length };
    setIsTutorialOpen(false);
    setIsProjectDropdownOpen(false);
    setIsMoreMenuOpen(false);
    setIsHeaderCollapsed(false); // 접힌 헤더에서는 1단계 대상(프로젝트 메뉴)이 보이지 않음
    setTour({ run: true, step: 0 });
  }, [projects.length, allTasks.length]);

  /**
   * 투어 종료.
   * - completed: 끝까지 봄 → 다음 접속부터 자동 표시 안 함
   * - never: 「다시 보지 않기」 선택 → 자동 표시 안 함
   * - skipped: X·Esc로 이번만 닫음 → 다음 접속 때 다시 자동 시작
   */
  const endGuidedTour = useCallback(
    (mode: 'completed' | 'skipped' | 'never') => {
      setTour({ run: false, step: 0 });
      if (mode !== 'skipped') {
        try {
          localStorage.setItem(GUIDED_TOUR_HIDE_KEY, '1');
        } catch {
          /* 저장 불가(시크릿 모드 등)면 다음 접속에 다시 자동 노출될 뿐 — 무시 */
        }
      }
      if (mode === 'completed') pushToast('투어 완료! 이제 직접 프로젝트를 채워 보세요.', { variant: 'success', durationMs: 4000 });
      else if (mode === 'never')
        pushToast('투어를 다시 자동 표시하지 않습니다. ⋮ 메뉴 → 「따라하기 투어」로 언제든 볼 수 있어요.', {
          variant: 'info',
          durationMs: 4500,
        });
      else
        pushToast('투어를 닫았습니다. 다음 접속 때 다시 안내해요 — 끄려면 투어의 「다시 보지 않기」를 누르세요.', {
          variant: 'info',
          durationMs: 4500,
        });
    },
    [pushToast],
  );

  /** 안내형(next) 단계의 「다음」 — 마지막 단계의 완료는 GuidedTour의 onFinish가 처리 */
  const handleTourNext = useCallback(() => {
    setTour((t) => (t.run && t.step < GUIDED_TOUR_STEPS.length - 1 ? { run: true, step: t.step + 1 } : t));
  }, []);

  // action 단계 자동 진행: 입력창 열림 → 이름 단계 / 닫힘 → 생성됐으면 작업 단계·취소면 버튼 단계로 복귀 / 작업 추가 → 요령 단계
  useEffect(() => {
    if (!tour.run) return;
    if (tour.step <= TOUR_INDEX.newProject && isProjectModalOpen) {
      setTour({ run: true, step: TOUR_INDEX.fillName });
    } else if ((tour.step === TOUR_INDEX.fillName || tour.step === TOUR_INDEX.createProject) && !isProjectModalOpen) {
      setTour({
        run: true,
        step: projects.length > tourBaselineRef.current.projects ? TOUR_INDEX.addTask : TOUR_INDEX.newProject,
      });
    } else if (tour.step === TOUR_INDEX.addTask && allTasks.length > tourBaselineRef.current.tasks) {
      setTour({ run: true, step: TOUR_INDEX.taskTips });
    }
  }, [tour, isProjectModalOpen, projects.length, allTasks.length]);

  // 데스크톱 접속마다 무조건 자동 시작 — 「다시 보지 않기」를 선택했거나 투어를 완주한 사용자만 제외
  const tourAutoStartCheckedRef = useRef(false);
  useEffect(() => {
    if (isLoading || tourAutoStartCheckedRef.current) return;
    tourAutoStartCheckedRef.current = true;
    if (VITE_PROJECT_STATUS_ONLY || hiddenViews.has('projects')) return;
    if (window.matchMedia('(max-width: 767px)').matches) return; // 모바일은 작업 편집 화면이 잠겨 있어 투어 비대상
    try {
      if (localStorage.getItem(GUIDED_TOUR_HIDE_KEY)) return;
    } catch {
      return;
    }
    const timer = setTimeout(() => startGuidedTour(), 1800);
    return () => clearTimeout(timer);
  }, [isLoading, hiddenViews, startGuidedTour]);

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

  const pushChangesToDbRef = useRef(pushChangesToDb);
  pushChangesToDbRef.current = pushChangesToDb;

  /** 저장 모델: 편집마다 자동 DB push 하던 방식을 "수동 저장"으로 전환해 편집 중 렉을 제거한다.
   *  - 로컬 변경은 WBSContext가 즉시 localStorage에 보존하므로 새로고침해도 데이터는 유지된다.
   *  - 서버(DB) 반영은 Ctrl+S 또는 우측 하단 "저장" 버튼으로만 수행한다.
   *  - 미저장 상태로 창을 닫거나 새로고침하면 브라우저 경고로 이탈 전 저장을 유도한다. */
  const hasLocalChangesRef = useRef(hasLocalChangesSinceSync);
  hasLocalChangesRef.current = hasLocalChangesSinceSync;

  /** 표 셀 인라인 편집 값이 React 상태에 커밋된 뒤 DB 동기화를 돌리기 위한 짧은 대기 (Ctrl+S와 동일). */
  const flushInlineCellEditsBeforeSave = useCallback(async () => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
      ae.blur();
    }
    await new Promise<void>((r) => {
      window.setTimeout(r, 60);
    });
  }, []);

  const saveNow = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!hasLocalChangesRef.current) {
      pushToast('변경사항이 없습니다.', { variant: 'info', durationMs: 1500, id: 'manual-save' });
      return;
    }
    setIsDbPushInProgress(true);
    try {
      await flushInlineCellEditsBeforeSave();
      await pushChangesToDbRef.current('all');
      pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
      // 본인 프로젝트는 정상 저장되고 타인 프로젝트만 RLS로 거부될 수 있으므로 권한 메시지는 성공으로 간주.
      if (/편집 권한이 없습니다/.test(msg)) {
        pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
      } else {
        pushToast(msg, { variant: 'error', durationMs: 6000, id: `db-push:${msg}` });
      }
    } finally {
      setIsDbPushInProgress(false);
    }
  }, [pushToast, flushInlineCellEditsBeforeSave]);

  // Ctrl/Cmd+S: 수동 저장(브라우저 기본 저장 대화상자 차단). 편집 중이면 먼저 blur로 입력을 확정한 뒤 저장.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveNow]);

  // 미저장 상태에서 창 닫기/새로고침/이탈 시 브라우저 경고 → 저장하지 않은 변경 손실 방지.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasLocalChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const initialDbSyncDoneRef = useRef(false);

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
      navigate(`/${view}`, { replace: true });
    }
  }, [location.pathname, view, navigate]);

  // 회원(프로필) 목록 로드: 관리자는 전체, 일반 사용자는 본인 프로필만 (현재 로그인 사용자 표시용)
  useEffect(() => {
    if (!user?.id) return;
    fetchProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [user?.id]);

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

  const profileDisplayById = React.useMemo(
    () => buildProfileDisplayById(profiles, orgMembers, ownerDisplayNames),
    [profiles, orgMembers, ownerDisplayNames],
  );

  /** 프로젝트 목록 조직도 보기: 소유자 부서 보조 매칭 */
  const ownerDepartmentByUserId = React.useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const p of profiles) {
      const d = p.department != null ? String(p.department).trim() : '';
      m[p.id] = d.length > 0 ? d : null;
    }
    return m;
  }, [profiles]);

  /** 필터·담당자 매칭·PM 기본값 등 저장/비교용 평문 표시명 */
  const currentUserPlainName = React.useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id) as { full_name?: string | null } | undefined;
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return ((name && String(name).trim()) || user.email || '사용자').trim();
  }, [user, profiles]);

  const currentUserDisplay = React.useMemo(() => {
    if (!user) return '';
    const profile = profiles.find((p) => p.id === user.id) as { full_name?: string | null; department?: string | null } | undefined;
    const plain =
      (profile?.full_name && String(profile.full_name).trim()) ||
      (user.user_metadata as { full_name?: string } | undefined)?.full_name ||
      '';
    const base = (plain && String(plain).trim()) || user.email || '사용자';
    return formatPersonDisplay(base, { orgMetaByName: assigneeDisplayMetaByName, fallbackDepartment: profile?.department });
  }, [user, profiles, assigneeDisplayMetaByName]);

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
      if (isPrivateProjectHiddenFromViewer(p, user?.id)) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [projects, user?.id]);

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
    notStartedYetOnly: false,
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'wbs', direction: 'asc' });

  const selectProject = useCallback(
    (projectId: string) => {
      setCurrentProjectId(projectId);
      // 이미 작업 보기(표/간트/칸반/마인드맵/전체)에 있으면 그대로 유지.
      // 대시보드·프로젝트·투입현황 등 비-작업 보기에서만 기본 "전체" 보기로 전환.
      const taskViews: ViewType[] = ['table', 'tablegantt', 'gantt', 'kanban', 'mindmap'];
      if (!taskViews.includes(view)) {
        setView(lockMobileToDashboard ? 'dashboard' : 'table');
      }
    },
    [setCurrentProjectId, setView, view, lockMobileToDashboard],
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

  const [dashboardFiltersActive, setDashboardFiltersActive] = useState(false);
  /** 대시보드 부서·프로젝트 표시 도구줄: 기본 숨김, 헤더 필터 버튼으로만 표시 */
  const [showDashboardFilterToolbar, setShowDashboardFilterToolbar] = useState(false);
  useEffect(() => {
    if (view !== 'dashboard') {
      setDashboardFiltersActive(false);
      setShowDashboardFilterToolbar(false);
    }
  }, [view]);

  useEffect(() => {
    const h = (e: Event) => {
      const ev = e as CustomEvent<{ active?: boolean }>;
      if (ev.detail && typeof ev.detail.active === 'boolean') setDashboardFiltersActive(ev.detail.active);
    };
    window.addEventListener('wbs-dashboard-filters-active', h as EventListener);
    return () => window.removeEventListener('wbs-dashboard-filters-active', h as EventListener);
  }, []);

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

  const onDashboardFilterToolbarClick = useCallback(() => {
    setShowDashboardFilterToolbar((wasOpen) => {
      const next = !wasOpen;
      if (next) {
        tipOnce('menu.filter.dashboard', '상단 도구줄에서 부서·프로젝트 표시 범위를 조정할 수 있어요.');
        setTimeout(() => {
          document.getElementById('dashboard-filter-toolbar-host')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 0);
      }
      return next;
    });
  }, [tipOnce]);

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
      if (lockMobileToDashboard || hiddenViews.has('table')) {
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
      setView('table');
      // 스크롤 완료 후 scrollToTaskId 해제 + 테이블에 포커스 (키보드 단축키 동작)
      setTimeout(() => {
        setScrollToTaskId(null);
        const table = document.querySelector<HTMLElement>('[data-wbs-table]');
        table?.focus();
      }, 500);
    },
    [setCurrentProjectId, setSelectedTaskIds, expandAncestors, setView, lockMobileToDashboard, hiddenViews, pushToast],
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
      if (!lockMobileToDashboard) setView('tablegantt');
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

  const handleCopyProject = () => {
    if (projectToCopy) {
      copyProject(projectToCopy.id);
      setProjectToCopy(null);
      // 복사 직후: copyProject 내부에서 새 복사본이 currentProjectId로 잡힘 → 표+간트 작업 화면으로 이동.
      // 모바일은 작업 화면 편집이 막혀 있으므로 대시보드 유지.
      if (!lockMobileToDashboard) setView('tablegantt');
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
    onImportComplete: () => setView('table'),
    lastExportPrefs,
    setLastExportPrefs,
    importPreview,
    backupConfirm,
    multiMergeConfirm,
    assigneeDisplayMetaByName,
    statusConfigs: wbsSettings.statusConfigs ?? [],
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
    handleImportMappingChange,
    handleImportCustomColumnToggle,
    handleImportCustomColumnsSet,
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

  // View switch, Ctrl+S preventDefault — now in useAppKeyboardShortcuts

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
      notStartedYetOnly: false,
      ...rest,
      projectIds,
    }));

    // 특정 프로젝트 카드일 경우, 현재 프로젝트도 함께 전환
    if (dashPid && dashPid !== 'all') {
      setCurrentProjectId(dashPid);
    }

    // 대시보드 진입 시 필터를 자동으로 켜지 않는다(사용자 요청).
    // 필터 값(상태/담당자 등)은 setFilters로 스테이트에는 들어가 있지만,
    // 필터 토글이 꺼져 있으면 effectiveFilters가 무시하므로 화면에는 반영되지 않는다.
    // 사용자가 필요하면 필터 토글을 직접 켜서 미리 채워진 조건을 적용할 수 있다.
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
  const allAssignees = Array.from(new Set(tasks.map((t) => t.assignee).filter(Boolean))) as string[];
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
        notStartedYetOnly: false,
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
      notStartedYetOnly: false,
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
    return <AppSkeleton isSupabaseConfigured={isSupabaseConfigured} />;
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden h-screen',
        isFullscreen && 'fixed inset-0 z-50',
      )}
    >
      {isSupabaseConfigured && hasLocalChangesSinceSync && (
        <button
          type="button"
          data-tourid="tour-save"
          onClick={() => void saveNow()}
          disabled={isDbPushInProgress}
          title="변경사항을 서버에 저장합니다 (Ctrl+S)"
          className={cn(
            'fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition',
            'bg-indigo-600 hover:bg-indigo-700 active:translate-y-px disabled:opacity-70',
          )}
        >
          <span className={cn('inline-block h-2 w-2 rounded-full', isDbPushInProgress ? 'animate-pulse bg-white/70' : 'bg-amber-300')} />
          {isDbPushInProgress ? '저장 중…' : '저장 (Ctrl+S)'}
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
          onSaveProjectRegistrationPdf={handleSaveProjectRegistrationPdf}
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
          canOpenMembersManagement={canOpenMembersManagement}
          setIsAdminPasswordModalOpen={setIsAdminPasswordModalOpen}
          setIsAdminAccessRequestModalOpen={isSupabaseConfigured ? setIsAdminAccessRequestModalOpen : undefined}
          setIsProjectEditAccessRequestModalOpen={isSupabaseConfigured ? setIsProjectEditAccessRequestModalOpen : undefined}
          ownerDepartmentByUserId={ownerDepartmentByUserId}
          onOpenTutorial={() => setIsTutorialOpen(true)}
          onStartTour={hiddenViews.has('projects') ? undefined : startGuidedTour}
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
        setCurrentProjectId={setCurrentProjectId}
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
                      onNavigate={lockMobileToDashboard || hiddenViews.has('table') ? undefined : handleDashboardNavigate}
                      onOpenTaskInTable={navigateToTask}
                      registeredMemberDisplayNames={registeredMemberDisplayNames}
                      accessibleProjectIds={
                        effectiveIsAdmin
                          ? undefined
                          : new Set([
                              ...projects.filter((p) => !!user?.id && p.ownerId === user.id).map((p) => p.id),
                              ...myMemberProjectIds,
                            ])
                      }
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
                (view === 'table' || view === 'tablegantt' || view === 'gantt' || view === 'kanban' || view === 'mindmap') ? (
                  <ProjectAccessRequestBanner
                    projectId={currentProjectId}
                    projectName={formatProjectDisplayName(currentProject.name, currentProject.projectKind)}
                    onRequestSent={() =>
                      getMyProjectMemberProjectIds()
                        .then(setMyMemberProjectIds)
                        .catch(() => {})
                    }
                  />
                ) : view === 'tablegantt' ? (
                  <ErrorBoundary viewName="표+간트">
                    <TableGanttSplit
                      filters={effectiveFilters}
                      sortConfig={sortConfig}
                      onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                      onResetFilters={resetWbsFilters}
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
                ) : view === 'projects' ? (
                  <ErrorBoundary viewName="프로젝트 관리">
                    <ProjectsPage
                      onNavigateToWork={(projectId, preferView) => {
                        if (projectId) setCurrentProjectId(projectId);
                        if (lockMobileToDashboard || hiddenViews.has('table')) {
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
                        } else if (preferView === 'tablegantt' && !hiddenViews.has('tablegantt')) {
                          // 복사 등 표+간트 선호 진입
                          setView('tablegantt');
                        } else {
                          setView('table');
                        }
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
                      onCreateProject={() => {
                        setEditingProject(null);
                        setIsProjectModalOpen(true);
                      }}
                      onNavigateToWork={(projectId) => {
                        setCurrentProjectId(projectId);
                        setView(hiddenViews.has('table') ? 'dashboard' : 'table');
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
                ) : (
                  <ErrorBoundary viewName="칸반">
                    <KanbanBoard filters={effectiveFilters} />
                  </ErrorBoundary>
                ))}
            </div>
            {isShortcutsVisible && view !== 'dashboard' && (
              <ShortcutsSidebar
                view={view === 'outlook' || view === 'weekreport' || view === 'todo' ? 'dashboard' : view}
                onClose={() => setIsShortcutsVisible(false)}
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
            setCurrentProjectId(projectId);
            if (lockMobileToDashboard || hiddenViews.has('table')) {
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
              setView('table');
            }
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
        />
      )}
      {isTutorialOpen && (
        <Suspense fallback={null}>
          <TutorialModal
            isOpen
            onClose={() => setIsTutorialOpen(false)}
            onStartTour={hiddenViews.has('projects') ? undefined : startGuidedTour}
          />
        </Suspense>
      )}
      {tour.run && (
        <Suspense fallback={null}>
          <GuidedTour
            stepIndex={tour.step}
            onNext={handleTourNext}
            onFinish={() => endGuidedTour('completed')}
            onSkip={() => endGuidedTour('skipped')}
            onNeverShow={() => endGuidedTour('never')}
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
                              <span className="block font-semibold">
                                <ProjectNameLabel project={project} name={project.name} />
                              </span>
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
              setCurrentProjectId(projectId);
              setIsMembersModalOpen(false);
              if (lockMobileToDashboard || hiddenViews.has('table')) {
                setView('dashboard');
              } else {
                setView('table');
              }
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [userApproved, setUserApproved] = useState(false);
  const [isExternalPartner, setIsExternalPartner] = useState(false);
  /** 관리자 비밀번호로 임시 관리자 모드에 진입한 상태 (sessionStorage 기반) */
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  /** 관리자가 회원 화면을 체험 중인 상태 (sessionStorage 기반). 켜져 있으면 관리자라도 화면상 비관리자처럼 동작. */
  const [memberPreview, setMemberPreviewState] = useState(() => sessionStorage.getItem('wbs-member-preview') === 'true');
  const setMemberPreview = useCallback((v: boolean) => {
    setMemberPreviewState(v);
    if (v) sessionStorage.setItem('wbs-member-preview', 'true');
    else sessionStorage.removeItem('wbs-member-preview');
  }, []);
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
      pushToast(msg, { variant: 'error', id: `db-error:${msg}` });
    },
    [pushToast],
  );
  // gmtc.kr 사내 회원은 관리자와 동일 노출(요청사항) — WBSProvider.isAdmin으로 전파되어 컴포넌트 전반에 동일 적용.
  const effectiveIsAdminGlobal = (isAdmin || adminOverride || isInternalCompanyEmail(user?.email ?? '')) && !memberPreview;
  /** undefined: 로딩 전(편집 제한 미적용). 로드 후 배열로 멤버십 기반 편집 가능 프로젝트 */
  const [myEditableProjectIds, setMyEditableProjectIds] = useState<string[] | undefined>(undefined);

  const refreshEditableProjectIds = useCallback(() => {
    if (!user?.id) return;
    void getMyEditableProjectIds()
      .then((ids) => setMyEditableProjectIds(ids))
      .catch(() => setMyEditableProjectIds(undefined));
  }, [user?.id]);

  const [isOrgScopedManager, setIsOrgScopedManager] = useState(false);
  const [currentUserManagedOrgNodeId, setCurrentUserManagedOrgNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      setUserApproved(false);
      setIsExternalPartner(false);
      setIsOrgScopedManager(false);
      setCurrentUserManagedOrgNodeId(null);
      return;
    }
    getProfileStatus()
      .then((status) => {
        if (status) {
          setIsAdmin(status.isAdmin);
          setIsExternalPartner(status.isExternalPartner);
          // 외주 계정은 승인(approved)이어도 멤버로 공유된 프로젝트만 열람·편집 (전사 탐색·조직도 UI 제외)
          setUserApproved(status.approved && !status.isExternalPartner);
          setIsOrgScopedManager(status.isOrgScopeManager);
          setCurrentUserManagedOrgNodeId(status.managedOrgNodeId);
        }
      })
      .catch(() => {});
  }, [user?.id]);

  /** 외주: 공유(project_members) 프로젝트 ID — RLS/캐시와 무관하게 클라이언트에서 목록·상태를 한 번 더 제한 */
  const [externalPartnerBrowseIds, setExternalPartnerBrowseIds] = useState<string[] | undefined>(undefined);
  const [externalPartnerBrowseLoaded, setExternalPartnerBrowseLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setExternalPartnerBrowseIds(undefined);
      setExternalPartnerBrowseLoaded(false);
      return;
    }
    if (!isExternalPartner || effectiveIsAdminGlobal) {
      setExternalPartnerBrowseIds(undefined);
      setExternalPartnerBrowseLoaded(false);
      return;
    }
    let cancelled = false;
    setExternalPartnerBrowseLoaded(false);
    getMyProjectMemberProjectIds()
      .then((ids) => {
        if (!cancelled) {
          setExternalPartnerBrowseIds(ids);
          setExternalPartnerBrowseLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExternalPartnerBrowseIds([]);
          setExternalPartnerBrowseLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, isExternalPartner, effectiveIsAdminGlobal]);

  const externalBrowseKey = externalPartnerBrowseIds === undefined ? '' : [...externalPartnerBrowseIds].sort().join(',');

  const clientProjectAllowlist = useMemo(() => {
    if (!isExternalPartner || effectiveIsAdminGlobal) return undefined;
    if (!externalPartnerBrowseLoaded) return undefined;
    return externalPartnerBrowseIds ?? [];
  }, [isExternalPartner, effectiveIsAdminGlobal, externalPartnerBrowseLoaded, externalBrowseKey]);

  useEffect(() => {
    if (!user?.id) {
      setMyEditableProjectIds(undefined);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      getMyEditableProjectIds()
        .then((ids) => {
          if (!cancelled) setMyEditableProjectIds(ids);
        })
        .catch(() => {
          if (!cancelled) setMyEditableProjectIds(undefined);
        });
    };
    refresh();
    // 다른 세션·다른 사용자에 의해 권한이 변경됐을 가능성 — 탭 복귀·창 포커스 시 재조회
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id]);

  // 접속 기록: 로그인 후 앱 진입 시 한 번 기록 + 주기적 활동 하트비트(관리자용 현재 접속자 판별)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !user?.id) return;
    let sessionId = sessionStorage.getItem('wbs-visit-session-id');
    if (!sessionId) {
      sessionId = uuidv4();
      sessionStorage.setItem('wbs-visit-session-id', sessionId);
    }
    const sid = sessionId;
    void (async () => {
      try {
        await supabase.rpc('record_visit', { p_session_id: sid });
      } catch {
        // best-effort; ignore visit logging failures
      }
      try {
        await supabase.rpc('pulse_presence', { p_session_id: sid });
      } catch {
        // best-effort; DB에 마이그레이션 전이면 무시
      }
    })();
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          await supabase.rpc('pulse_presence', { p_session_id: sid });
        } catch {
          /* ignore */
        }
      })();
    }, 45_000);
    return () => window.clearInterval(intervalId);
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
      useLocalOnly={isDevAuthBypass()}
      onConcurrentConflict={handleConcurrentConflict}
      onDbError={handleProviderDbError}
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
