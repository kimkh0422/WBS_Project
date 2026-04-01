import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { WBSTable } from './components/WBSTable';
import { NavButton } from './components/NavButton';
import { AppHeader } from './components/AppHeader';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { useWBS, WBSProvider } from './context/WBSContext';
import type { DbSyncSummaryByProject } from './context/wbsContextTypes';
import { List, Plus, Download, Upload, ChevronDown, ChevronUp, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2, PieChart, Loader2, RefreshCw, MessageSquare, Tag, Table, BarChart3, Share2, Undo2, Redo2, Maximize2, Minimize2, Flag, AlertTriangle, LogOut, Users, User, Copy, History, Clock, Eye, Bug, RotateCcw, Network, MoreHorizontal } from 'lucide-react';
import { usePresence } from './hooks/usePresence';
import { useModalStates } from './hooks/useModalStates';
import { computeWorkloadOverloads, fixOverloadByExtending } from './lib/workload';
import { cn } from './lib/utils';
import { Task, Project, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcelWithMeta, ExcelImportMeta } from './lib/excel';
import { exportBackupToJson, exportToMarkdown, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { clearAllLocalData } from './lib/persist';
import { acceptInvite, checkIsAdmin, fetchProfiles, getProfileStatus, getProjectOwnerDisplayNames, getMyProjectMemberProjectIds, getMyEditableProjectIds } from './lib/db';
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

const GanttChart = React.lazy(() => import('./components/GanttChart').then(m => ({ default: m.GanttChart })));
const KanbanBoard = React.lazy(() => import('./components/KanbanBoard').then(m => ({ default: m.KanbanBoard })));
const MindMapView = React.lazy(() => import('./components/MindMapView').then(m => ({ default: m.MindMapView })));
const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const ProjectsPage = React.lazy(() => import('./components/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const AllocationOverviewPage = React.lazy(() => import('./components/AllocationOverviewPage').then(m => ({ default: m.AllocationOverviewPage })));
const AIAnalysisModal = React.lazy(() => import('./components/AIAnalysisModal').then(m => ({ default: m.AIAnalysisModal })));
const WBSSettingsModal = React.lazy(() => import('./components/WBSSettingsModal').then(m => ({ default: m.WBSSettingsModal })));
const VersionManager = React.lazy(() => import('./components/VersionManager').then(m => ({ default: m.VersionManager })));
const AuditLogModal = React.lazy(() => import('./components/AuditLogModal').then(m => ({ default: m.AuditLogModal })));
const ExportModal = React.lazy(() => import('./components/ExportModal').then(m => ({ default: m.ExportModal })));
const WeeklyReportModal = React.lazy(() => import('./components/WeeklyReportModal').then(m => ({ default: m.WeeklyReportModal })));

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
  onMembersUpdated?: () => void;
}

function WBSApp({ isAdmin, myEditableProjectIds, userApproved, onMembersUpdated }: WBSAppProps) {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'list' | 'table' | 'gantt' | 'kanban' | 'mindmap' | 'dashboard' | 'projects' | 'allocation'>('table');
  const modals = useModalStates();
  const {
    isModalOpen, setIsModalOpen, isProjectModalOpen, setIsProjectModalOpen,
    isAIModalOpen, setIsAIModalOpen, isAIBusy, setIsAIBusy,
    isSettingsModalOpen, setIsSettingsModalOpen, isShortcutsVisible, setIsShortcutsVisible,
    isVersionHistoryOpen, setIsVersionHistoryOpen,
    isExportModalOpen, setIsExportModalOpen,
    exportSelectedProjectIds, setExportSelectedProjectIds,
    isDeleteProjectConfirmOpen, setIsDeleteProjectConfirmOpen,
    projectToDelete, setProjectToDelete,
    isDeleteAllProjectsConfirmOpen, setIsDeleteAllProjectsConfirmOpen,
    editingProject, setEditingProject,
    isShareOpen, setIsShareOpen, isAuditLogOpen, setIsAuditLogOpen,
    auditLogProjectId, setAuditLogProjectId,
    isMembersModalOpen, setIsMembersModalOpen,
    isAdminPasswordModalOpen, setIsAdminPasswordModalOpen,
    isResetConfirmOpen, setIsResetConfirmOpen,
    isWeeklyReportOpen, setIsWeeklyReportOpen,
    isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen,
    isDeleteChoiceOpen, setIsDeleteChoiceOpen,
    lastExportPrefs, setLastExportPrefs,
    importPreview, setImportPreview,
    backupConfirm, setBackupConfirm,
    multiMergeConfirm, setMultiMergeConfirm,
    errorAlert, setErrorAlert,
  } = modals;
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isDbSyncing, setIsDbSyncing] = useState(false);
  const [dbSyncStep, setDbSyncStep] = useState<{ pct: number; msg: string } | null>(null);
  const [isDbPushInProgress, setIsDbPushInProgress] = useState(false);
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null; approved?: boolean }[]>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [myMemberProjectIds, setMyMemberProjectIds] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLocalSaveBannerDismissed, setIsLocalSaveBannerDismissed] = useState(
    () => localStorage.getItem('wbs-local-save-banner-dismissed') === '1'
  );
  const [isBackupBannerDismissed, setIsBackupBannerDismissed] = useState(
    () => localStorage.getItem('wbs-backup-banner-dismissed') === '1'
  );
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  // 메뉴(탭) 숨김: 기본은 모두 표시. Vite 환경변수 `VITE_HIDDEN_VIEWS`에 "dashboard,allocation" 처럼 지정하면 해당 탭 숨김.
  const hiddenViews = React.useMemo(() => {
    const raw = import.meta.env.VITE_HIDDEN_VIEWS as string | undefined;
    const value = typeof raw === 'string' ? raw.trim() : '';
    return new Set(
      value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
  }, []);

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
    wbsSettings,
    expandToLevel,
    setTreeExpandLevel,
    isLoading,
    canEditCurrentProject,
    hasLocalChangesSinceSync,
    pushChangesToDb,
    collabPushNonce,
  } = useWBS();

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
          // 보기 전용·비멤버 프로젝트: 자동 저장은 계속 시도되어도 같은 에러 토스트를 반복하지 않음
          if (!/편집 권한이 없습니다/.test(msg)) {
            pushToast(msg, { variant: 'error', durationMs: 6000, id: `db-push:${msg}` });
          }
        } finally {
          setIsDbPushInProgress(false);
        }
      })();
    }, 2000);
    return () => window.clearTimeout(id);
  }, [collabPushNonce, hasLocalChangesSinceSync, isSupabaseConfigured, pushToast]);
  const prevAIBusyRef = useRef(false);
  const initialDbSyncDoneRef = useRef(false);

  const effectiveIsAdmin = isAdmin || adminOverride;

  // 프로젝트가 0개가 되면(전체 삭제 등) 빈 상태 페이지로 이동
  useEffect(() => {
    if (isLoading) return;
    if (projects.length === 0) {
      setView('projects');
      setIsProjectDropdownOpen(false);
      setFilters(prev => ({ ...prev, projectIds: 'all' }));
    }
  }, [isLoading, projects.length]);

  // 숨겨진 메뉴(view)로 진입한 경우 안전하게 기본 화면(표만)으로 이동
  useEffect(() => {
    if (hiddenViews.has(view)) setView('table');
  }, [hiddenViews, view]);

  // 마인드맵은 전체 공개 — 관리자 전용 제한 없음

  // 회원(프로필) 목록 로드: 관리자는 전체, 일반 사용자는 본인 프로필만 (현재 로그인 사용자 표시용)
  useEffect(() => {
    if (!user?.id) return;
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [user?.id]);

  // 접근 가능한 프로젝트 소유자 표시명 보강 (RLS로 프로필 미조회 시에도 이름 표시)
  useEffect(() => {
    if (!user?.id || !projects.length) {
      setOwnerDisplayNames({});
      return;
    }
    const knownIds = new Set(profiles.map(p => p.id));
    const ownerIds: string[] = projects
      .map(p => p.ownerId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const uniqueOwnerIds = Array.from(new Set(ownerIds));
    const missingOwnerIds = uniqueOwnerIds.filter(id => !knownIds.has(id));
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
    getMyProjectMemberProjectIds().then(setMyMemberProjectIds).catch(() => setMyMemberProjectIds([]));
  }, [user?.id]);

  const profileMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach(p => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

  /** 대시보드 인원별 투입 현황에 표시할 등록 회원 표시명 집합 (profiles 기준) */
  const registeredMemberDisplayNames = React.useMemo(() => {
    const names = new Set<string>();
    profiles.forEach(p => {
      const name = (p.full_name && String(p.full_name).trim()) || p.email || '(이메일 없음)';
      names.add(name);
    });
    return names;
  }, [profiles]);

  const currentUserDisplay = React.useMemo(() => {
    if (!user) return '';
    const profile = profiles.find(p => p.id === user.id) as { full_name?: string | null } | undefined;
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return (name && String(name).trim()) || user.email || '사용자';
  }, [user, profiles]);

  // 동시에 이 프로젝트를 보고 있는 다른 사용자 (Supabase Presence)
  const { others: presenceOthers } = usePresence(
    currentProjectId === 'all' ? '' : currentProjectId,
    user?.id,
    currentUserDisplay
  );

  const taskCountByProject = React.useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach(p => { m[p.id] = 0; });
    allTasks.forEach(t => {
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
    return projects.filter(p => {
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
    // 작업이 있는 프로젝트만 표시. 목록 순서 통일을 위해 projectsSortedByName 기준으로 필터
    return projectsSortedByName.filter(p => (taskCountByProject[p.id] ?? 0) > 0);
  }, [projectsSortedByName, taskCountByProject]);

  // Shift+F12: 관리자 모드 전환
  useEffect(() => {
    const handleAdminHotkey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.shiftKey && e.key === 'F12') {
        e.preventDefault();
        setIsAdminPasswordModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleAdminHotkey);
    return () => window.removeEventListener('keydown', handleAdminHotkey);
  }, []);

  // 초대 링크 수락 (?invite=token)
  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    acceptInvite(token).then(result => {
      if (result.success && result.projectId) {
        setCurrentProjectId(result.projectId);
        pushToast('프로젝트에 참여했습니다.', { variant: 'success' });
      } else {
        pushToast(result.error || '초대 수락에 실패했습니다.', { variant: 'error' });
      }
      params.delete('invite');
      const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }).catch(() => {
      pushToast('초대 수락에 실패했습니다.', { variant: 'error' });
      params.delete('invite');
      window.history.replaceState({}, '', window.location.pathname);
    });
  }, [isLoading, setCurrentProjectId, pushToast]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll sync refs for split-view
  const wbsScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const [sharedRowHeight, setSharedRowHeight] = useState(20);
  const [rowHeights, setRowHeights] = useState<number[]>([]);
  const isSyncingScroll = useRef(false);

  // 표·간트 스크롤 동기화: ref가 준비될 때까지 재시도 (간트가 빈 상태에서 작업 목록이 뜨면 ref가 나중에 붙음)
  const [scrollSyncRetry, setScrollSyncRetry] = useState(0);
  const scrollSyncRetryCountRef = useRef(0);

  useEffect(() => {
    if (view !== 'list') {
      scrollSyncRetryCountRef.current = 0;
      return;
    }
    const wbs = wbsScrollRef.current;
    const gantt = ganttScrollRef.current;
    if (!wbs || !gantt) {
      if (scrollSyncRetryCountRef.current < 30) {
        scrollSyncRetryCountRef.current += 1;
        const t = setTimeout(() => setScrollSyncRetry((r) => r + 1), 80);
        return () => clearTimeout(t);
      }
      return;
    }
    scrollSyncRetryCountRef.current = 0;

    const syncFromWbs = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const top = (e.target as HTMLDivElement).scrollTop;
      gantt.scrollTop = top;
      // 플래그를 한 프레임 뒤에 해제해, gantt.scrollTop 설정으로 인한 scroll 이벤트가 역동기화하지 않도록 함
      requestAnimationFrame(() => { isSyncingScroll.current = false; });
    };
    const syncFromGantt = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      const top = (e.target as HTMLDivElement).scrollTop;
      wbs.scrollTop = top;
      requestAnimationFrame(() => { isSyncingScroll.current = false; });
    };

    wbs.addEventListener('scroll', syncFromWbs, { passive: true });
    gantt.addEventListener('scroll', syncFromGantt, { passive: true });
    // 표 스크롤 위치에 맞춰 간트도 동일 위치로 초기 맞춤
    gantt.scrollTop = wbs.scrollTop;

    return () => {
      wbs.removeEventListener('scroll', syncFromWbs);
      gantt.removeEventListener('scroll', syncFromGantt);
    };
  }, [view, scrollSyncRetry]);

  // Resizable Panes State
  const WBS_TABLE_WIDTH_STORAGE_KEY = 'wbs.split.wbsTableWidth';
  const DEFAULT_WBS_TABLE_WIDTH = 75; // 좌측 패널 기본 너비 (이전 50%의 1.5배)
  const [wbsTableWidth, setWbsTableWidth] = useState(() => {
    try {
      const saved = window.localStorage.getItem(WBS_TABLE_WIDTH_STORAGE_KEY);
      const parsed = saved ? Number(saved) : NaN;
      if (!Number.isFinite(parsed)) return DEFAULT_WBS_TABLE_WIDTH;
      return Math.min(80, Math.max(20, parsed));
    } catch {
      return DEFAULT_WBS_TABLE_WIDTH;
    }
  });
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(WBS_TABLE_WIDTH_STORAGE_KEY, String(wbsTableWidth));
    } catch {
      // ignore
    }
  }, [wbsTableWidth]);

  useEffect(() => {
    document.title = wbsSettings.appTitle;
  }, [wbsSettings.appTitle]);

  useEffect(() => {
    const prev = prevAIBusyRef.current;
    if (prev && !isAIBusy) {
      pushToast('AI 분석이 완료되었습니다. AI 버튼을 눌러 결과를 확인하세요.', { variant: 'success', id: 'ai-done' });
    }
    prevAIBusyRef.current = isAIBusy;
  }, [isAIBusy, pushToast]);

  const navigateWithTip = useCallback((nextView: typeof view) => {
    setView(nextView);
    if (nextView === 'dashboard') tipOnce('nav.dashboard', '대시보드에서 프로젝트/상태별 현황을 빠르게 확인할 수 있어요.');
    if (nextView === 'projects') tipOnce('nav.projects', '프로젝트를 생성·편집·공유·삭제할 수 있습니다.');
    if (nextView === 'allocation') tipOnce('nav.allocation', '프로젝트별·인원별로 투입 비율을 한눈에 확인할 수 있어요.');
    if (nextView === 'list') tipOnce('nav.all', '표+간트: 표와 간트를 동시에 보며 관리합니다. 가운데 바를 드래그해 폭 조절이 가능합니다.');
    if (nextView === 'table') tipOnce('nav.table', '표만: 작업을 빠르게 편집/정렬/복사·붙여넣기 할 때 유용합니다.');
    if (nextView === 'gantt') tipOnce('nav.gantt', '간트만: 일정 흐름을 보며 날짜를 드래그로 조정할 수 있어요.');
    if (nextView === 'kanban') tipOnce('nav.kanban', '칸반: 상태별로 작업을 옮기며 진행을 관리합니다.');
    if (nextView === 'mindmap') tipOnce('nav.mindmap', '마인드맵: WBS 계층을 가지로 보고, 노드를 눌러 작업을 편집할 수 있어요.');
  }, [tipOnce, setView, view]);

  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    setIsDraggingResizer(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDraggingResizer(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isDraggingResizer && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidthPx = mouseMoveEvent.clientX - containerRect.left;
        const newWidthPercent = (newWidthPx / containerRect.width) * 100;

        if (newWidthPercent > 20 && newWidthPercent < 80) {
          setWbsTableWidth(newWidthPercent);
        }
      }
    },
    [isDraggingResizer]
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    const handleUndoRedo = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleUndoRedo);
    return () => window.removeEventListener('keydown', handleUndoRedo);
  }, [undo, redo]);

  useEffect(() => {
    const handleExpandLevelHotkey = (e: KeyboardEvent) => {
      // Ctrl+Alt+1..9 (Win/Linux), Cmd+Option+1..9 (macOS)
      if (!(e.altKey && (e.ctrlKey || e.metaKey))) return;

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;

      if (!/^[1-9]$/.test(e.key)) return;
      const level = parseInt(e.key, 10);
      e.preventDefault();
      setTreeExpandLevel(level);
      expandToLevel(level);
    };

    window.addEventListener('keydown', handleExpandLevelHotkey);
    return () => window.removeEventListener('keydown', handleExpandLevelHotkey);
  }, [expandToLevel, setTreeExpandLevel]);

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

  const selectProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId);
    setView('list'); // 프로젝트 선택 시 기본 "전체" 보기로 전환
  }, [setCurrentProjectId]);

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

  const currentProject = projects.find(p => p.id === currentProjectId);

  const handleSaveTask = (taskData: Partial<Task>) => addTask(taskData);

  const handleSaveProject = (
    name: string,
    description: string,
    startDate?: string,
    endDate?: string,
    assignments?: Project['assignments'],
    minWorkEffortDays?: number,
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

  const handleExportFromModal = (params: { scope: ExportScope; formats: ExportFormat[]; projectIds: string[] }) => {
    const { formats, projectIds, scope } = params;
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filteredProjects = projects.filter(p => projectIds.includes(p.id));
    const filteredTasks = allTasks.filter(t => t.projectId && projectIds.includes(t.projectId));

    const doExport = (format: ExportFormat) => {
      if (format === 'excel') {
        const fileName = filteredProjects.length === 1
          ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.xlsx`
          : `wbs_export_${timestamp}.xlsx`;
        exportToExcel(filteredTasks, wbsMap, fileName, filteredProjects);
      } else if (format === 'markdown') {
        const fileName = filteredProjects.length === 1
          ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.md`
          : `wbs_export_${timestamp}.md`;
        exportToMarkdown(filteredTasks, wbsMap, fileName, filteredProjects);
      } else if (format === 'csv') {
        const fileName = filteredProjects.length === 1
          ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.csv`
          : `wbs_export_${timestamp}.csv`;
        const projectMap = new Map(filteredProjects.map(p => [p.id, p.name]));
        const header = ['WBS','프로젝트','작업명','담당자','상태','진행률','시작일','종료일','공수'];
        const escape = (v: string) => {
          if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
          return v;
        };
        const rows = filteredTasks.map(t => [
          wbsMap.get(t.id) ?? '',
          projectMap.get(t.projectId) ?? '',
          t.name,
          t.assignee ?? '',
          t.status,
          String(t.progress ?? 0),
          t.startDate ?? '',
          t.endDate ?? '',
          t.workEffort != null ? String(t.workEffort) : '',
        ].map(escape).join(','));
        const bom = '\uFEFF';
        const csv = bom + [header.join(','), ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
      } else {
        const fullBackup = exportFullBackup();
        const partialBackup: BackupData = {
          ...fullBackup,
          projects: filteredProjects,
          tasks: filteredTasks,
        };
        const fileName = filteredProjects.length === 1
          ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_backup_${timestamp}.json`
          : `wbs_backup_${timestamp}.json`;
        exportBackupToJson(partialBackup, fileName);
      }
    };

    formats.forEach(doExport);

    pushToast('내보내기가 완료되었습니다.');
    // 마지막 내보내기 설정 저장 (빠른 내보내기용) - 첫 번째 형식을 기준으로 저장
    const primaryFormat = formats[0] ?? 'excel';
    const prefs = { scope, format: primaryFormat as ExportFormat, projectIds };
    setLastExportPrefs(prefs);
    try {
      window.localStorage.setItem('wbs.lastExportPrefs', JSON.stringify(prefs));
    } catch {
      // ignore
    }
  };

  const handleQuickExport = () => {
    if (!lastExportPrefs) {
      // 이전 설정이 없으면 일반 내보내기 모달을 열어서 한 번 세팅하게 함
      setIsExportModalOpen(true);
      return;
    }
    const availableProjectIds = projects.map(p => p.id);
    const projectIds =
      lastExportPrefs.scope === 'all'
        ? availableProjectIds
        : lastExportPrefs.projectIds.filter(id => availableProjectIds.includes(id));
    if (projectIds.length === 0) {
      // 더 이상 존재하지 않는 프로젝트만 포함된 경우 → 모달로 유도
      setIsExportModalOpen(true);
      return;
    }
    handleExportFromModal({
      scope: lastExportPrefs.scope,
      formats: [lastExportPrefs.format],
      projectIds,
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportBackupClick = () => {
    backupInputRef.current?.click();
  };

  const handleMergeImportClick = () => {
    mergeInputRef.current?.click();
  };

  const executeDbSync = useCallback(async (scope: 'current' | 'all'): Promise<boolean> => {
    setIsDbSyncing(true);
    setDbSyncStep({ pct: 0, msg: '시작…' });
    pushToast('DB 동기화\n시작…', { variant: 'info', id: 'db-sync', durationMs: 300000, progress: 0 });
    try {
      const snap = await syncWithDb(scope, (pct, message) => {
        setDbSyncStep({ pct, msg: message });
        pushToast(`DB 동기화\n${message}`, { variant: 'info', id: 'db-sync', durationMs: 300000, progress: pct });
      });
      const s = snap.summary;
      const lines: string[] = [
        '동기화 완료',
        `↑ 업로드: 프로젝트 ${s.uploadedProjects} · 작업 ${s.uploadedTasks} · 표·상태 설정 1건 · DB 작업 삭제 ${s.uploadedTaskDeletions}건 · DB 프로젝트 삭제 ${s.uploadedProjectDeletions}건`,
        `↓ 내려받기: 프로젝트 ${s.downloadedProjects} · 작업 ${s.downloadedTasks} · 설정 ${s.downloadedSettings ? '반영' : '없음'}`,
      ];
      const byProjectEntries = Object.entries(s.byProject ?? {}) as [string, DbSyncSummaryByProject][];
      if (byProjectEntries.length > 0) {
        lines.push(''); // 빈 줄 후 프로젝트별 요약
        for (const [, info] of byProjectEntries) {
          const upParts = [
            info.uploadedProjects > 0 && '프로젝트 정보 1건',
            info.uploadedTasks > 0 && `작업 ${info.uploadedTasks}건`,
          ].filter(Boolean) as string[];
          const downParts = [
            info.appliedProjects > 0 && '프로젝트 정보 1건',
            info.appliedTasks > 0 && `작업 ${info.appliedTasks}건`,
          ].filter(Boolean) as string[];
          const upStr = upParts.length ? `↑ ${upParts.join(', ')}` : '';
          const downStr = downParts.length ? `↓ ${downParts.join(', ')}` : '';
          const part = [upStr, downStr].filter(Boolean).join(' · ') || '변경 없음';
          lines.push(`${info.projectName}: ${part}`);
        }
      }
      pushToast(
        lines.join('\n'),
        { variant: 'success', id: 'db-sync', durationMs: 8000, progress: 100 }
      );
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'DB 동기화에 실패했습니다.';
      pushToast(msg, { variant: 'error', id: 'db-sync', durationMs: 8000 });
      return false;
    } finally {
      setIsDbSyncing(false);
      setDbSyncStep(null);
    }
  }, [syncWithDb, pushToast]);

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

  // Ctrl+Shift+1~7: 뷰 전환 단축키
  useEffect(() => {
    const VIEW_SHORTCUTS: Record<string, typeof view> = {
      'Digit1': 'dashboard',
      'Digit2': 'allocation',
      'Digit3': 'list',
      'Digit4': 'table',
      'Digit5': 'gantt',
      'Digit6': 'kanban',
      'Digit7': 'mindmap',
    };
    const handleViewShortcut = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      const nextView = VIEW_SHORTCUTS[e.code];
      if (!nextView) return;
      if (hiddenViews.has(nextView)) return;
      e.preventDefault();
      navigateWithTip(nextView);
    };
    window.addEventListener('keydown', handleViewShortcut);
    return () => window.removeEventListener('keydown', handleViewShortcut);
  }, [navigateWithTip, effectiveIsAdmin, hiddenViews]);

  // ?: 단축키 사이드바 토글 (Shift+/ 포함)
  useEffect(() => {
    const handleShortcutsToggle = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const isQuestion = e.key === '?' || (e.key === '/' && e.shiftKey);
      if (!isQuestion) return;
      e.preventDefault();
      setIsShortcutsVisible((prev) => !prev);
    };
    window.addEventListener('keydown', handleShortcutsToggle);
    return () => window.removeEventListener('keydown', handleShortcutsToggle);
  }, []);

  // Ctrl+S: 즉시 서버 반영(자동 저장과 동일 경로, 토스트 없음)
  // 캡처 단계: 표 셀 input이 keydown에서 stopPropagation 하므로 버블 리스너로는 도달하지 않음
  useEffect(() => {
    const handleSaveHotkey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 's') return;
      if (!isSupabaseConfigured) return;

      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const el = document.activeElement as HTMLElement | null;
        const inTable =
          el &&
          /^INPUT|TEXTAREA|SELECT$/i.test(el.tagName) &&
          el.closest?.('[data-wbs-table]');
        if (inTable) {
          el.blur();
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        }
        setIsDbPushInProgress(true);
        try {
          await pushChangesToDbRef.current('all');
        } finally {
          setIsDbPushInProgress(false);
        }
      };
      void run().catch((err: unknown) => {
        setIsDbPushInProgress(false);
        pushToast(err instanceof Error ? err.message : '서버 반영 실패', { variant: 'error' });
      });
    };
    window.addEventListener('keydown', handleSaveHotkey, true);
    return () => window.removeEventListener('keydown', handleSaveHotkey, true);
  }, [isSupabaseConfigured, pushToast]);

  const importFromExcelFiles = async (files: File[]) => {
    const remapIdsWithinFile = (tasksInFile: Task[]): Task[] => {
      const idMap = new Map<string, string>();
      tasksInFile.forEach(t => idMap.set(t.id, uuidv4()));
      return tasksInFile.map(t => ({
        ...t,
        id: idMap.get(t.id)!,
        parentId: t.parentId && idMap.has(t.parentId) ? idMap.get(t.parentId)! : null,
        dependencies: (t.dependencies ?? []).filter(depId => idMap.has(depId)).map(depId => idMap.get(depId)!),
        expanded: true,
      }));
    };

    const parsed = await Promise.all(files.map(f => parseExcelWithMeta(f)));

    const perFileTasks = parsed.map(p => p.tasks);
    const importedTasks = files.length > 1
      ? perFileTasks.flatMap(remapIdsWithinFile)
      : perFileTasks.flat();

    setImportPreview({
      isOpen: true,
      tasks: importedTasks,
      files: parsed.map((p, idx) => ({
        fileName: files[idx]?.name || `file-${idx + 1}`,
        taskCount: p.tasks.length,
        meta: p.meta,
      })),
    });
  };

  const importFromBackupJsonFiles = async (files: File[]) => {
    if (files.length === 1) {
      const parsedData = await parseBackupJson(files[0] as File);
      setBackupConfirm({ isOpen: true, data: parsedData });
    } else {
      const parsedDataArray = await parseMultipleBackupJsons(files as File[]);
      setMultiMergeConfirm({ isOpen: true, dataArray: parsedDataArray, fileCount: files.length });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const firstExt = files[0].name.split('.').pop()?.toLowerCase() ?? '';

    try {
      if (firstExt === 'xlsx' || firstExt === 'xls' || firstExt === 'xlsm') {
        await importFromExcelFiles(files as File[]);
      } else if (firstExt === 'json') {
        await importFromBackupJsonFiles(files as File[]);
      } else if (firstExt === 'md') {
        setErrorAlert({
          isOpen: true,
          message: 'Markdown(.md) 파일 가져오기는 아직 지원되지 않습니다. Excel(.xlsx) 또는 백업 JSON(.json) 파일을 선택해주세요.',
        });
      } else {
        setErrorAlert({
          isOpen: true,
          message: '지원하지 않는 파일 형식입니다. Excel(.xlsx) 또는 백업 JSON(.json) 파일만 선택할 수 있습니다.',
        });
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    try {
      await importFromBackupJsonFiles(files as File[]);
    } catch (error: unknown) {
      setErrorAlert({ isOpen: true, message: error instanceof Error ? error.message : '백업 파일을 읽는 중 오류 발생' });
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const handleMergeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const parsedDataArray = await parseMultipleBackupJsons(files as File[]);
      setMultiMergeConfirm({ isOpen: true, dataArray: parsedDataArray, fileCount: files.length });
    } catch (error: unknown) {
      setErrorAlert({ isOpen: true, message: error instanceof Error ? error.message : '오류 발생' });
    } finally {
      if (mergeInputRef.current) mergeInputRef.current.value = '';
    }
  };

  const executeMultiMerge = () => {
    mergeBackups(multiMergeConfirm.dataArray);
    setMultiMergeConfirm({ isOpen: false, dataArray: [], fileCount: 0 });
  };

  const executeImport = async (targetProjectId: string, newProjectName?: string) => {
    try {
      await importTasks(importPreview.tasks, targetProjectId, newProjectName);
      if (targetProjectId !== '__new__') setCurrentProjectId(targetProjectId);
      setFilters(prev => ({ ...prev, projectIds: 'all' }));
      setImportPreview({ isOpen: false, tasks: [], files: [] });
      pushToast('가져오기가 완료되었습니다.', { variant: 'success' });
    } catch {
      // 에러 토스트는 WBSProvider(onDbError)에서 처리되므로 여기서는 추가 처리만 최소화
    }
  };

  const executeRestoreBackup = () => {
    if (backupConfirm.data) restoreBackup(backupConfirm.data);
    setBackupConfirm({ isOpen: false, data: null });
  };

  const executeRestoreBackupIntoProject = async (targetProjectId: string) => {
    if (!backupConfirm.data) return;
    const idMap = new Map<string, string>();
    const remappedTasks = backupConfirm.data.tasks.map(t => {
      const newId = uuidv4();
      idMap.set(t.id, newId);
      return { ...t, id: newId };
    }).map(t => ({
      ...t,
      projectId: targetProjectId,
      parentId: t.parentId && idMap.has(t.parentId) ? idMap.get(t.parentId)! : null,
      dependencies: (t.dependencies ?? []).filter(depId => idMap.has(depId)).map(depId => idMap.get(depId)!),
      expanded: true,
    }));
    try {
      await importTasks(remappedTasks, targetProjectId);
      setCurrentProjectId(targetProjectId);
      setBackupConfirm({ isOpen: false, data: null });
      pushToast('가져오기가 완료되었습니다.', { variant: 'success' });
    } catch {
      // onDbError 토스트 사용
    }
  };

  const handleDashboardNavigate = (newView: typeof view, newFilters: Partial<FilterState> & { projectId?: string }) => {
    // 대시보드 카드 클릭 시, 해당 조건으로 필터된 내역을 바로 보여주기 위한 내비게이션
    setView(newView);

    const dashPid = newFilters.projectId;
    const projectIds =
      dashPid && dashPid !== 'all' ? ([dashPid] as string[]) : ('all' as const);
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

  const hasActiveFilters = filterOn && (
    filters.projectIds !== 'all' ||
    filters.status !== 'all' ||
    filters.assignee ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly ||
    (typeof filters.level === 'number') ||
    !!filters.pastDueOnly ||
    !!filters.completedThisWeekOnly ||
    !!filters.searchText
  );
  const allAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  const effectiveFilters: FilterState = filterOn
    ? filters
    : { ...filters, status: 'all', assignee: '', startDate: '', endDate: '', milestoneOnly: false, issueOnly: false, level: 'all', pastDueOnly: false, completedThisWeekOnly: false };

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
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[var(--color-bg)] font-sans text-[var(--color-ink)] gap-5">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-slate-700">데이터를 불러오는 중...</p>
            <p className="text-xs text-slate-400 mt-1">
              {isSupabaseConfigured
                ? '서버(DB)에서 프로젝트·작업을 불러오는 중입니다.'
                : '잠시만 기다려주세요'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900 overflow-hidden", view === 'list' ? "min-h-screen" : "h-screen", isFullscreen && "fixed inset-0 z-50")}>
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
          dbLinkState={{
            linked: isSupabaseConfigured,
            initialSync: isDbSyncing,
            initialSyncPct: dbSyncStep?.pct,
            pushing: isDbPushInProgress && !isDbSyncing,
            pendingSave:
              hasLocalChangesSinceSync && !isDbPushInProgress && !isDbSyncing,
          }}
        />
      )}

      {!isFullscreen && !isLocalSaveBannerDismissed && (
        <div className="bg-sky-50/80 border-b border-sky-200/60 px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 text-sky-800 text-xs">
          <span>
            로그인 시 데이터는 <strong>서버(DB)</strong>를 기준으로 하며, 변경 후 잠시 뒤 <strong>자동 반영</strong>됩니다. 이 기기에도 백업으로 로컬에 저장됩니다. 같은 프로젝트를 연 사람은 실시간으로 갱신됩니다.
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
      {/* 백업 안내 배너 */}
      {!isFullscreen && !isBackupBannerDismissed && (
        <div className="bg-amber-50/80 border-b border-amber-200/60 px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 text-amber-800 text-xs">
          <AlertTriangle size={14} className="shrink-0 text-amber-500" />
          <span>정기적으로 <strong>내보내기</strong>로 백업을 하시기 바랍니다.</span>
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
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="프로젝트별로 작업을 필터링합니다.">프로젝트</span>
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
                    ? uniqueProjects.find((p) => p.id === filters.projectIds[0])?.name ?? '1개'
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
                  const isPartial = Array.isArray(filters.projectIds) && filters.projectIds.length > 0 && filters.projectIds.length < allIds.length;
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
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider" title="상태별로 작업을 필터링합니다.">상태</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setFilters(f => ({ ...f, status: 'all' }))} className={cn("filter-chip", filters.status === 'all' ? "filter-chip-active" : "filter-chip-inactive")} title="모든 상태의 작업 표시">전체</button>
              {wbsSettings.statusConfigs.map(config => (
                <button key={config.id} onClick={() => setFilters(f => ({ ...f, status: config.id }))} className={cn("filter-chip", filters.status === config.id ? "filter-chip-active" : "filter-chip-inactive")} title={`${config.name} 상태인 작업만 표시`}>{config.name}</button>
              ))}
            </div>
          </div>

          {/* 담당자 */}
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-50/70 border border-emerald-100">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider" title="담당자별로 작업을 필터링합니다.">담당자</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setFilters(f => ({ ...f, assignee: '' }))} className={cn("filter-chip", !filters.assignee ? "filter-chip-active" : "filter-chip-inactive")} title="모든 담당자의 작업 표시">전체</button>
              {user?.id && profileMap[user.id] && (
                <button onClick={() => { setFilterOn(true); setFilters(f => ({ ...f, assignee: profileMap[user.id] })); }} className={cn("filter-chip flex items-center gap-1", filters.assignee === profileMap[user.id] ? "filter-chip-active" : "filter-chip-inactive")} title="내가 담당자인 작업만 표시"><User size={10} className="opacity-80" /> 내 업무만</button>
              )}
              {allAssignees.map(a => (
                <button key={a} onClick={() => setFilters(f => ({ ...f, assignee: a }))} className={cn("filter-chip", filters.assignee === a ? "filter-chip-active" : "filter-chip-inactive")} title={`${a} 담당 작업만 표시`}>{a}</button>
              ))}
            </div>
          </div>

          {/* 마일스톤/이슈 (전체·마일스톤만·이슈만 3가지) */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-100">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider" title="마일스톤/이슈 기준으로 작업을 필터링합니다.">
              마일스톤
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    milestoneOnly: false,
                    issueOnly: false,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  !filters.milestoneOnly && !filters.issueOnly ? "filter-chip-active" : "filter-chip-inactive"
                )}
                title="마일스톤/이슈 구분 없이 모든 작업 표시"
              >
                전체
              </button>
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    milestoneOnly: true,
                    issueOnly: false,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  filters.milestoneOnly && !filters.issueOnly ? "filter-chip-active" : "filter-chip-inactive"
                )}
                title="마일스톤으로 지정된 이정표 작업만 표시"
              >
                <Flag size={12} className="opacity-80" /> 마일스톤만
              </button>
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    milestoneOnly: false,
                    issueOnly: true,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  !filters.milestoneOnly && filters.issueOnly ? "filter-chip-active" : "filter-chip-inactive"
                )}
                title="이슈로 지정된 작업만 표시"
              >
                <Bug size={12} className="opacity-80" /> 이슈만
              </button>
            </div>
          </div>

          {/* 기간 */}
          <div className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-violet-50 border border-violet-100">
            <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider" title="기간별로 작업을 필터링합니다.">기간</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setFilters(f => ({ ...f, startDate: '', endDate: '' }))} className={cn("filter-chip", !filters.startDate && !filters.endDate ? "filter-chip-active" : "filter-chip-inactive")} title="기간 제한 없이 모든 작업 표시">전체</button>
              <button
                onClick={() => {
                  const today = format(new Date(), 'yyyy-MM-dd');
                  setFilters(f => ({ ...f, startDate: today, endDate: today }));
                }}
                className={cn("filter-chip", filters.startDate && filters.endDate && filters.startDate === filters.endDate && filters.startDate === format(new Date(), 'yyyy-MM-dd') ? "filter-chip-active" : "filter-chip-inactive")}
                title="오늘과 기간이 겹치는 작업만 표시"
              >
                금일
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
                  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
                  setFilters(f => ({ ...f, startDate: format(weekStart, 'yyyy-MM-dd'), endDate: format(weekEnd, 'yyyy-MM-dd') }));
                }}
                className={cn("filter-chip", filters.startDate && filters.endDate && filters.startDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') && filters.endDate === format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') ? "filter-chip-active" : "filter-chip-inactive")}
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
                  setFilters(f => ({ ...f, startDate: format(nextWeekStart, 'yyyy-MM-dd'), endDate: format(nextWeekEnd, 'yyyy-MM-dd') }));
                }}
                className={cn(
                  "filter-chip",
                  (() => {
                    if (!filters.startDate || !filters.endDate) return "filter-chip-inactive";
                    const now = new Date();
                    const nextWeekBase = addDays(now, 7);
                    const nextWeekStart = startOfWeek(nextWeekBase, { weekStartsOn: 1 });
                    const nextWeekEnd = endOfWeek(nextWeekBase, { weekStartsOn: 1 });
                    const startMatch = filters.startDate === format(nextWeekStart, 'yyyy-MM-dd');
                    const endMatch = filters.endDate === format(nextWeekEnd, 'yyyy-MM-dd');
                    return startMatch && endMatch ? "filter-chip-active" : "filter-chip-inactive";
                  })()
                )}
                title="다음 주(월~일)와 기간이 겹치는 작업만 표시"
              >
                차주
              </button>
            </div>
          </div>

          {/* 금주 완료/기한 지남 (전체·금주 완료·기한 초과 3가지) */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100">
            <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider" title="이번 주 완료/기한 초과 상태로 작업을 필터링합니다.">
              기한/완료
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    pastDueOnly: false,
                    completedThisWeekOnly: false,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  !filters.pastDueOnly && !filters.completedThisWeekOnly ? "filter-chip-active" : "filter-chip-inactive"
                )}
                title="기한/완료 조건 없이 모든 작업 표시"
              >
                전체
              </button>
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    completedThisWeekOnly: true,
                    pastDueOnly: false,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  filters.completedThisWeekOnly && !filters.pastDueOnly ? "filter-chip-active" : "filter-chip-inactive"
                )}
                title="이번 주(월~일)에 완료된 항목만 표시 (상태: 완료, 종료일: 이번 주)"
              >
                금주 완료 항목
              </button>
              <button
                onClick={() =>
                  setFilters(f => ({
                    ...f,
                    pastDueOnly: true,
                    completedThisWeekOnly: false,
                  }))
                }
                className={cn(
                  "filter-chip flex items-center gap-1",
                  filters.pastDueOnly && !filters.completedThisWeekOnly ? "filter-chip-active" : "filter-chip-inactive"
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
                setFilters(f => ({
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
      <main className={cn("min-h-0 overflow-hidden flex flex-row relative", view === 'list' ? "flex-shrink-0" : "flex-1", isFullscreen && "fixed inset-0 z-50 bg-white")}>
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={28} /></div>}>
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
              onRequestSent={() => getMyProjectMemberProjectIds().then(setMyMemberProjectIds).catch(() => { })}
            />
          ) : view === 'list' ? (
            <div ref={containerRef} className={cn("relative flex w-full list-split-view", isDraggingResizer && "cursor-col-resize select-none")}>
              <div className="flex-shrink-0 overflow-hidden flex flex-col min-h-0 list-table-pane" style={{ width: `${wbsTableWidth}%` }}>
                <WBSTable
                  filters={effectiveFilters}
                  sortConfig={sortConfig}
                  syncScrollRef={wbsScrollRef}
                  rowHeight={sharedRowHeight}
                  onRowHeightChange={setSharedRowHeight}
                  onRowHeightsChange={setRowHeights}
                  onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                  onResetFilters={resetWbsFilters}
                  onSort={(key) => {
                    setSortConfig(current => {
                      if (key === 'wbs' && current?.key === 'wbs') return null;
                      if (current?.key === key) {
                        if (current.direction === 'asc') return { key, direction: 'desc' };
                        return null;
                      }
                      return { key, direction: 'asc' };
                    });
                  }} />
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
              <div className="flex-shrink-0 overflow-hidden bg-stone-50/30 list-gantt-pane hidden md:block" style={{ width: `${100 - wbsTableWidth}%` }}>
                <GanttChart filters={effectiveFilters} sortConfig={sortConfig} hideSidebar={true} rowHeight={sharedRowHeight} rowHeights={rowHeights} onRowHeightChange={setSharedRowHeight} syncScrollRef={ganttScrollRef} />
              </div>
            </div>
          ) : view === 'table' ? (
            <div className="h-full overflow-hidden">
              <WBSTable
                fillHeight
                filters={effectiveFilters}
                sortConfig={sortConfig}
                onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
                onResetFilters={resetWbsFilters}
                onSort={(key) => {
                  setSortConfig(current => {
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
          ) : view === 'gantt' ? (
            <GanttChart filters={effectiveFilters} sortConfig={sortConfig} rowHeight={sharedRowHeight} onRowHeightChange={setSharedRowHeight} />
          ) : view === 'dashboard' ? (
            <Dashboard onNavigate={handleDashboardNavigate} registeredMemberDisplayNames={registeredMemberDisplayNames} />
          ) : view === 'projects' ? (
            <ProjectsPage onNavigateToWork={(projectId) => { if (projectId) setCurrentProjectId(projectId); setView('list'); }} />
          ) : view === 'allocation' ? (
            <AllocationOverviewPage
              registeredMemberDisplayNames={registeredMemberDisplayNames}
              onEditProject={(p) => { setEditingProject(p); setIsProjectModalOpen(true); }}
              onNavigateToWork={(projectId) => { setCurrentProjectId(projectId); setView('list'); }}
            />
          ) : view === 'mindmap' ? (
            <MindMapView filters={effectiveFilters} />
          ) : (
            <KanbanBoard filters={effectiveFilters} />
          )}
        </div>
        {isShortcutsVisible && <ShortcutsSidebar onClose={() => setIsShortcutsVisible(false)} />}
        </Suspense>
      </main>

      <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveTask} parentOptions={tasks} defaultAssignee={filterOn && filters.assignee ? filters.assignee : undefined} defaultStartDate={filterOn && filters.startDate ? filters.startDate : undefined} defaultEndDate={filterOn && filters.endDate ? filters.endDate : undefined} />
      <ProjectModal isOpen={isProjectModalOpen} onClose={() => { setIsProjectModalOpen(false); setEditingProject(null); }} onSave={handleSaveProject} project={editingProject} allProjects={projects} />
      <Suspense fallback={null}>
      <WBSSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onRequestReset={() => { setIsSettingsModalOpen(false); setIsResetConfirmOpen(true); }}
      />
      <AIAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        onBusyChange={setIsAIBusy}
        onImport={(newTasks, replace) => {
          if (replace) {
            const { overloads } = computeWorkloadOverloads(newTasks, projects);
            const toImport = overloads.length > 0 ? fixOverloadByExtending(newTasks, projects, overloads) : newTasks;
            importTasks(toImport);
          } else {
            const effectiveProjectId = currentProjectId === 'all' ? (projects[0]?.id || '') : (currentProjectId || projects[0]?.id || '');
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
      <VersionManager
        isOpen={isVersionHistoryOpen}
        onClose={() => setIsVersionHistoryOpen(false)}
        currentVersion={__APP_VERSION__}
      />

      {/* 삭제 유형 선택: 전체 삭제 / 현재 보고 있는 프로젝트 삭제 / 프로젝트 선택 삭제 / 현재 프로젝트 작업만 삭제 */}
      {isDeleteChoiceOpen && (
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
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                삭제 방식을 선택하세요.
              </p>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleteChoiceOpen(false);
                    setIsDeleteAllProjectsConfirmOpen(true);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                >
                  <span className="block font-semibold">전체 삭제</span>
                  <span className="block text-xs text-red-600 mt-0.5">모든 프로젝트/작업을 삭제하고 '새 프로젝트'로 초기화합니다.</span>
                </button>
                {currentProject && (
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
                          소유: {currentProject.ownerId === user?.id ? '내 프로젝트' : (currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? '다른 사용자') : '소유자 없음')}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                {deletableProjects.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 mt-3">프로젝트 선택해서 삭제</p>
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
                              소유: {project.ownerId === user?.id ? '내 프로젝트' : (project.ownerId ? (profileMap[project.ownerId] ?? '다른 사용자') : '소유자 없음')}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {currentProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsDeleteChoiceOpen(false);
                      setIsDeleteAllConfirmOpen(true);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                  >
                    <span className="block font-semibold">현재 프로젝트 작업만 삭제</span>
                    <span className="block text-xs text-red-600 mt-0.5">'{currentProject.name}'의 작업만 삭제하고 프로젝트는 유지합니다.</span>
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
      )}
      <ConfirmDialog isOpen={isDeleteAllConfirmOpen} onClose={() => setIsDeleteAllConfirmOpen(false)} onConfirm={handleDeleteAll} title="모든 작업 삭제" message={currentProjectId === 'all' ? '모든 프로젝트의 작업을 전체 삭제하시겠습니까?' : `'${currentProject?.name}' 프로젝트의 모든 작업을 삭제하시겠습니까?`} confirmLabel="삭제" isDanger={true} />
      <ConfirmDialog isOpen={isDeleteAllProjectsConfirmOpen} onClose={() => setIsDeleteAllProjectsConfirmOpen(false)} onConfirm={handleDeleteAllProjects} title="전체 삭제" message="모든 프로젝트/작업을 삭제하고 '새 프로젝트'로 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다." confirmLabel="전체 삭제" isDanger={true} />
      <ConfirmDialog
        isOpen={isDeleteProjectConfirmOpen}
        onClose={() => { setIsDeleteProjectConfirmOpen(false); setProjectToDelete(null); }}
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
        onClose={() => setImportPreview(prev => ({ ...prev, isOpen: false }))}
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
      <ConfirmDialog isOpen={multiMergeConfirm.isOpen} onClose={() => setMultiMergeConfirm({ ...multiMergeConfirm, isOpen: false })} onConfirm={executeMultiMerge} title="다중 프로젝트 가져오기" message={`선택한 ${multiMergeConfirm.fileCount}개의 파일을 가져오시겠습니까?`} confirmLabel="가져오기" isDanger={false} />
      <ConfirmDialog isOpen={errorAlert.isOpen} onClose={() => setErrorAlert({ isOpen: false, message: '' })} onConfirm={() => setErrorAlert({ isOpen: false, message: '' })} title="오류" message={errorAlert.message} confirmLabel="확인" isDanger={false} />
      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        projectId={currentProject?.id}
        projectName={currentProject?.name}
        isOwner={currentProject?.ownerId === user?.id}
        isAdmin={effectiveIsAdmin}
        profileMap={profileMap}
        profiles={profiles.map(p => ({ id: p.id, full_name: p.full_name ?? null, email: p.email ?? null }))}
        ownerId={currentProject?.ownerId}
      />
      {isAuditLogOpen && (() => {
        const pid = auditLogProjectId ?? (currentProjectId !== 'all' ? currentProjectId : null);
        const proj = pid ? projects.find(p => p.id === pid) : null;
        return pid ? (
          <AuditLogModal
            isOpen={true}
            onClose={() => { setIsAuditLogOpen(false); setAuditLogProjectId(null); }}
            projectId={pid}
            projectName={proj?.name}
          />
        ) : null;
      })()}
      <MembersModal
        isOpen={isMembersModalOpen}
        onClose={() => setIsMembersModalOpen(false)}
        currentUserId={user?.id}
        dbIsAdmin={isAdmin}
        adminOverride={adminOverride}
        projects={projectsSortedByName.map(p => ({ id: p.id, name: p.name, ownerId: p.ownerId }))}
        profileMap={profileMap}
        onDeleted={() => { pushToast('회원이 삭제되었습니다.', { variant: 'success' }); onMembersUpdated?.(); }}
        onApproved={() => { pushToast('회원을 승인했습니다. (전체 프로젝트 목록 조회 등 권한에 반영됩니다.)', { variant: 'success' }); onMembersUpdated?.(); }}
      />
      <AdminPasswordModal
        isOpen={isAdminPasswordModalOpen}
        onClose={() => setIsAdminPasswordModalOpen(false)}
        onSuccess={() => {
          setAdminOverride(true);
          sessionStorage.setItem('wbs-admin-override', 'true');
          setIsAdminPasswordModalOpen(false);
          pushToast('관리자 모드로 전환되었습니다.', { variant: 'success' });
        }}
      />
      <ExportModal
        isOpen={isExportModalOpen}
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

      <WeeklyReportModal
        isOpen={isWeeklyReportOpen}
        onClose={() => setIsWeeklyReportOpen(false)}
        tasks={allTasks}
        projects={projectsSortedByName}
        currentProjectId={currentProjectId}
        currentUserDisplay={currentUserDisplay}
      />
      </Suspense>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".xlsx,.xls,.xlsm,.json,.md"
        multiple
        className="hidden"
      />
      <input type="file" ref={backupInputRef} onChange={handleBackupFileChange} accept=".json" multiple className="hidden" />
      <input type="file" ref={mergeInputRef} onChange={handleMergeFileChange} accept=".json" multiple className="hidden" />

      {!isFullscreen && (
        <footer className="bg-slate-50/50 border-t border-slate-200/50 px-4 py-3 text-center mt-auto safe-bottom">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-1.5">
            <p className="text-[11px] font-semibold text-slate-500">지엠티 운영기술개발실</p>
            <div className="flex items-center gap-2 text-[10px] text-slate-400 whitespace-nowrap">
              <button
                type="button"
                onClick={() => setIsVersionHistoryOpen(true)}
                className="hover:text-indigo-600 hover:underline transition-colors"
                title="버전 히스토리 열기"
              >
                v{__APP_VERSION__} · 변경이력
              </button>
              <span className="text-slate-300" aria-hidden>·</span>
              <span>© 2026 GMT Corporation. All rights reserved.</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function AppWithProviders() {
  const { user, loading } = useAuth();
  const { push: pushToast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userApproved, setUserApproved] = useState(false);
  /** undefined: 로딩 전(편집 제한 미적용). 로드 후 배열로 멤버십 기반 편집 가능 프로젝트 */
  const [myEditableProjectIds, setMyEditableProjectIds] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      setUserApproved(false);
      return;
    }
    getProfileStatus().then(status => {
      if (status) {
        setIsAdmin(status.isAdmin);
        setUserApproved(status.approved);
      }
    }).catch(() => {});
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
      <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-indigo-400" />
          <span className="text-white/60 text-sm font-medium">로딩 중...</span>
        </div>
      </div>
    );
  }
  if (!user) {
    return <LoginScreen />;
  }

  return (
    <WBSProvider
      useLocalOnly={false}
      onConcurrentConflict={() => pushToast('다른 사용자가 동시에 수정했습니다. DB 동기화 버튼을 눌러 최신 데이터를 가져오세요.', { variant: 'warning', durationMs: 8000 })}
      onDbError={(msg) =>
        pushToast(msg, {
          variant: 'error',
          // React StrictMode(DEV)에서 effect가 2번 실행되거나, 동일한 DB 오류가 연속 발생할 때 토스트 중복을 방지
          id: `db-error:${msg}`,
        })
      }
      editableProjectIds={myEditableProjectIds}
    >
      <WBSApp
        isAdmin={isAdmin}
        myEditableProjectIds={myEditableProjectIds}
        userApproved={userApproved}
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
