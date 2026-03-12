import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WBSTable } from './components/WBSTable';
import { GanttChart } from './components/GanttChart';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { useWBS, WBSProvider } from './context/WBSContext';
import { List, Plus, Download, Upload, ChevronDown, ChevronUp, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2, PieChart, Loader2, Check, MessageSquare, Tag, Table, BarChart3, Share2, Undo2, Redo2, Maximize2, Minimize2, Flag, AlertTriangle, LogOut, Users, Copy, History, Clock, Eye, Bug } from 'lucide-react';
import { usePresence } from './hooks/usePresence';
import { computeWorkloadOverloads, fixOverloadByExtending } from './lib/workload';
import { cn } from './lib/utils';
import { Task, Project, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcelWithMeta, ExcelImportMeta } from './lib/excel';
import { exportBackupToJson, exportToMarkdown, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { acceptInvite, checkIsAdmin, fetchProfiles, getProfileStatus, getProjectOwnerDisplayNames } from './lib/db';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { Dashboard } from './components/Dashboard';
import { ProjectsPage } from './components/ProjectsPage';
import { AllocationOverviewPage } from './components/AllocationOverviewPage';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { WBSSettingsModal } from './components/WBSSettingsModal';
import { VersionManager } from './components/VersionManager';
import { LoginScreen } from './components/LoginScreen';
import { SupabaseSetupScreen } from './components/SupabaseSetupScreen';
import { useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './components/Toast';
import { ExcelImportPreviewModal } from './components/ExcelImportPreviewModal';
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { ShareModal } from './components/ShareModal';
import { MembersModal } from './components/MembersModal';
import { AuditLogModal } from './components/AuditLogModal';
import { AdminPasswordModal } from './components/AdminPasswordModal';
import { ExportModal } from './components/ExportModal';
import { v4 as uuidv4 } from 'uuid';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import logo from './assets/logo.png';

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

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
}

function NavButton({ active, onClick, icon, label, title }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "nav-pill",
        active ? "nav-pill-active" : "nav-pill-inactive"
      )}
      title={title}
    >
      <span className="shrink-0">{icon}</span>
      <span className="inline whitespace-nowrap">{label}</span>
    </button>
  );
}

interface WBSAppProps {
  isAdmin: boolean;
  userApproved: boolean;
  onMembersUpdated?: () => void;
}

function WBSApp({ isAdmin, userApproved, onMembersUpdated }: WBSAppProps) {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'list' | 'table' | 'gantt' | 'kanban' | 'dashboard' | 'projects' | 'allocation'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isAIBusy, setIsAIBusy] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isShortcutsVisible, setIsShortcutsVisible] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSelectedProjectIds, setExportSelectedProjectIds] = useState<string[]>([]);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isDbSyncing, setIsDbSyncing] = useState(false);
  const [isDeleteProjectConfirmOpen, setIsDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<any>(null);
  const [isDeleteAllProjectsConfirmOpen, setIsDeleteAllProjectsConfirmOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [auditLogProjectId, setAuditLogProjectId] = useState<string | null>(null);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isAdminPasswordModalOpen, setIsAdminPasswordModalOpen] = useState(false);
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null; approved?: boolean }[]>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLocalSaveBannerDismissed, setIsLocalSaveBannerDismissed] = useState(() => sessionStorage.getItem('wbs-local-save-banner-dismissed') === '1');
  const [isBackupBannerDismissed, setIsBackupBannerDismissed] = useState(() => sessionStorage.getItem('wbs-backup-banner-dismissed') === '1');
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  // 메뉴(탭) 숨김: 기본으로 2개(대시보드/투입현황) 숨김.
  // 필요 시 Vite 환경변수 `VITE_HIDDEN_VIEWS`에 "dashboard,allocation" 처럼 지정해 덮어쓸 수 있음.
  const hiddenViews = React.useMemo(() => {
    const raw = (import.meta as any)?.env?.VITE_HIDDEN_VIEWS as string | undefined;
    const value = typeof raw === 'string' && raw.trim().length > 0 ? raw : 'dashboard,allocation';
    return new Set(
      value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
  }, []);

  const {
    addTask,
    addTasks,
    tasks,
    allTasks,
    importTasks,
    syncToDb,
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
  } = useWBS();

  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const initialSnapshotRef = useRef<{ projects: Project[]; allTasks: Task[] } | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!initialSnapshotRef.current) {
      initialSnapshotRef.current = { projects, allTasks };
      return;
    }
    if (initialSnapshotRef.current.projects !== projects || initialSnapshotRef.current.allTasks !== allTasks) {
      setHasUnsyncedChanges(true);
    }
  }, [projects, allTasks, isLoading]);

  const { push: pushToast, tipOnce } = useToast();
  const prevAIBusyRef = useRef(false);

  const effectiveIsAdmin = isAdmin || adminOverride;

  // 프로젝트가 0개가 되면(전체 삭제 등) 빈 상태 페이지로 이동
  useEffect(() => {
    if (isLoading) return;
    if (projects.length === 0) {
      setView('projects');
      setIsProjectDropdownOpen(false);
      setFilters(prev => ({ ...prev, projectId: 'all' }));
    }
  }, [isLoading, projects.length]);

  // 숨겨진 메뉴(view)로 진입한 경우 안전하게 기본 화면으로 이동
  useEffect(() => {
    if (hiddenViews.has(view)) setView('list');
  }, [hiddenViews, view]);

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

  const profileMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach(p => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

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

  const deletableProjects = React.useMemo(() => {
    // "프로젝트 선택해서 삭제"는 실제로 '프로젝트+소속 작업 삭제'이므로,
    // 작업이 있는 프로젝트만 표시 (작업이 0개면 삭제할 게 없음)
    return projects.filter(p => (taskCountByProject[p.id] ?? 0) > 0);
  }, [projects, taskCountByProject]);

  // 프로젝트 목록: id 기준으로만 표시 (이름+소유자로 묶지 않음 → 사용자별 복사본이 원본과 합쳐지지 않음)
  const uniqueProjects = React.useMemo(() => {
    const seen = new Set<string>();
    return projects.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [projects]);

  // 0개인 프로젝트는 제외(단, 현재 선택 중인 프로젝트는 유지), 인원(소유자)별 그룹
  const projectsGroupedByOwner = React.useMemo(() => {
    const filtered = uniqueProjects.filter(
      p => (taskCountByProject[p.id] ?? 0) > 0 || p.id === currentProjectId
    );
    const groupMap = new Map<string, { label: string; ownerId: string | null; projects: Project[] }>();
    for (const p of filtered) {
      const ownerId = p.ownerId ?? null;
      const key = ownerId ?? 'null';
      const label = ownerId === user?.id ? '내 프로젝트' : (ownerId ? (profileMap[ownerId] ?? '다른 사용자') : '소유자 없음');
      if (!groupMap.has(key)) groupMap.set(key, { label, ownerId, projects: [] });
      groupMap.get(key)!.projects.push(p);
    }
    const myId = user?.id;
    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.ownerId === myId) return -1;
      if (b.ownerId === myId) return 1;
      return a.label.localeCompare(b.label, 'ko');
    });
  }, [uniqueProjects, taskCountByProject, currentProjectId, user?.id, profileMap]);

  // Shift+F12: 관리자 모드 전환
  useEffect(() => {
    const handleAdminHotkey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
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

  // Sync vertical scroll between WBSTable and GanttChart (행만 스크롤되므로 scrollTop 1:1 동기화)
  useEffect(() => {
    if (view !== 'list') return;
    const wbs = wbsScrollRef.current;
    const gantt = ganttScrollRef.current;
    if (!wbs || !gantt) return;

    const syncFromWbs = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      gantt.scrollTop = (e.target as HTMLDivElement).scrollTop;
      isSyncingScroll.current = false;
    };
    const syncFromGantt = (e: Event) => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;
      wbs.scrollTop = (e.target as HTMLDivElement).scrollTop;
      isSyncingScroll.current = false;
    };

    wbs.addEventListener('scroll', syncFromWbs);
    gantt.addEventListener('scroll', syncFromGantt);
    // 초기 위치 맞춤
    const top = wbs.scrollTop;
    gantt.scrollTop = top;

    return () => {
      wbs.removeEventListener('scroll', syncFromWbs);
      gantt.removeEventListener('scroll', syncFromGantt);
    };
  }, [view]);

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
    if (!prev && isAIBusy) {
      pushToast('AI 분석 중입니다. 창을 닫아도 백그라운드에서 계속 진행됩니다.', { variant: 'info', id: 'ai-busy' });
    } else if (prev && !isAIBusy) {
      pushToast('AI 분석이 완료되었습니다. AI 버튼을 눌러 결과를 확인하세요.', { variant: 'success', id: 'ai-done' });
    }
    prevAIBusyRef.current = isAIBusy;
  }, [isAIBusy, pushToast]);

  const navigateWithTip = useCallback((nextView: typeof view) => {
    setView(nextView);
    if (nextView === 'dashboard') tipOnce('nav.dashboard', '대시보드에서 프로젝트/상태별 현황을 빠르게 확인할 수 있어요.');
    if (nextView === 'projects') tipOnce('nav.projects', '프로젝트를 생성·편집·공유·삭제할 수 있습니다.');
    if (nextView === 'allocation') tipOnce('nav.allocation', '프로젝트별·인원별로 투입 비율을 한눈에 확인할 수 있어요.');
    if (nextView === 'list') tipOnce('nav.all', '전체: 표와 간트를 동시에 보며 관리합니다. 가운데 바를 드래그해 폭 조절이 가능합니다.');
    if (nextView === 'table') tipOnce('nav.table', '표만: 작업을 빠르게 편집/정렬/복사·붙여넣기 할 때 유용합니다.');
    if (nextView === 'gantt') tipOnce('nav.gantt', '간트만: 일정 흐름을 보며 날짜를 드래그로 조정할 수 있어요.');
    if (nextView === 'kanban') tipOnce('nav.kanban', '칸반: 상태별로 작업을 옮기며 진행을 관리합니다.');
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

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
    projectId: 'all',
    status: 'all',
    assignee: '',
    startDate: '',
    endDate: '',
    milestoneOnly: false,
    issueOnly: false,
    level: 'all',
    pastDueOnly: false,
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'wbs', direction: 'asc' });
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeleteChoiceOpen, setIsDeleteChoiceOpen] = useState(false);

  const selectProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId);
    setView('list'); // 프로젝트 선택 시 기본 "전체" 보기로 전환
  }, [setCurrentProjectId]);

  // Filter on/off (when on, filter bar and filters apply)
  const [filterOn, setFilterOn] = useState(false);

  const [importPreview, setImportPreview] = useState<{
    isOpen: boolean;
    tasks: Task[];
    files: { fileName: string; taskCount: number; meta: ExcelImportMeta }[];
  }>({
    isOpen: false,
    tasks: [],
    files: [],
  });

  const [backupConfirm, setBackupConfirm] = useState<{ isOpen: boolean; data: BackupData | null }>({
    isOpen: false,
    data: null,
  });

  const [multiMergeConfirm, setMultiMergeConfirm] = useState<{ isOpen: boolean; dataArray: BackupData[]; fileCount: number }>({
    isOpen: false,
    dataArray: [],
    fileCount: 0,
  });

  const [errorAlert, setErrorAlert] = useState<{ isOpen: boolean; message: string }>({
    isOpen: false,
    message: '',
  });

  const currentProject = projects.find(p => p.id === currentProjectId);

  const handleSaveTask = (taskData: any) => addTask(taskData);

  const handleSaveProject = (name: string, description: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number) => {
    if (editingProject) {
      updateProject(editingProject.id, { name, description, startDate, endDate, assignments, minWorkEffortDays });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, endDate, assignments, minWorkEffortDays);
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

  const handleExportFromModal = (params: { scope: 'all' | 'selected'; format: 'excel' | 'json' | 'markdown'; projectIds: string[] }) => {
    const { format, projectIds } = params;
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filteredProjects = projects.filter(p => projectIds.includes(p.id));
    const filteredTasks = allTasks.filter(t => t.projectId && projectIds.includes(t.projectId));

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
    pushToast('내보내기가 완료되었습니다.');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
    setIsImportMenuOpen(false);
  };

  const handleImportBackupClick = () => {
    backupInputRef.current?.click();
    setIsImportMenuOpen(false);
  };

  const handleMergeImportClick = () => {
    mergeInputRef.current?.click();
    setIsImportMenuOpen(false);
  };

  const executeDbSync = async (scope: 'current' | 'all') => {
    setIsDbSyncing(true);
    pushToast('DB에 반영 중입니다...', { variant: 'info', id: 'db-sync', durationMs: 8000 });
    try {
      await syncToDb(scope);
      pushToast('DB에 반영되었습니다.', { variant: 'success', id: 'db-sync', durationMs: 4000 });
      setHasUnsyncedChanges(false);
      initialSnapshotRef.current = { projects, allTasks };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'DB 반영에 실패했습니다.';
      pushToast(msg, { variant: 'error', id: 'db-sync', durationMs: 8000 });
    } finally {
      setIsDbSyncing(false);
    }
  };

  // Ctrl+S: DB 반영 (로컬 저장은 자동, 단축키는 공유/반영용)
  useEffect(() => {
    const handleSaveHotkey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 's') return;

      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (isDbSyncing) return;

      e.preventDefault();
      const scope: 'current' | 'all' = currentProjectId === 'all' || !currentProjectId ? 'all' : 'current';
      void executeDbSync(scope);
    };
    window.addEventListener('keydown', handleSaveHotkey);
    return () => window.removeEventListener('keydown', handleSaveHotkey);
  }, [currentProjectId, isDbSyncing, executeDbSync]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    try {
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

      const parsed = await Promise.all(files.map(f => parseExcelWithMeta(f as any)));

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
    } catch (error) {
      setErrorAlert({ isOpen: true, message: '파일을 읽는 중 오류가 발생했습니다.' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    try {
      if (files.length === 1) {
        const parsedData = await parseBackupJson(files[0] as File);
        setBackupConfirm({ isOpen: true, data: parsedData });
      } else {
        const parsedDataArray = await parseMultipleBackupJsons(files as File[]);
        setMultiMergeConfirm({ isOpen: true, dataArray: parsedDataArray, fileCount: files.length });
      }
    } catch (error: any) {
      setErrorAlert({ isOpen: true, message: error.message || '백업 파일을 읽는 중 오류 발생' });
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
    } catch (error: any) {
      setErrorAlert({ isOpen: true, message: error.message || '오류 발생' });
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
      setFilters(prev => ({ ...prev, projectId: 'all' }));
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

  const handleDashboardNavigate = (newView: any, newFilters: Partial<FilterState>) => {
    // 대시보드 카드 클릭 시, 해당 조건으로 필터된 내역을 바로 보여주기 위한 내비게이션
    setView(newView);

    // 기존 필터를 초기 상태로 리셋한 뒤 대시보드에서 전달된 필터만 적용
    setFilters(() => ({
      projectId: 'all',
      status: 'all',
      assignee: '',
      startDate: '',
      endDate: '',
      ...newFilters,
    }));

    // 특정 프로젝트 카드일 경우, 현재 프로젝트도 함께 전환
    if (newFilters.projectId && newFilters.projectId !== 'all') {
      setCurrentProjectId(newFilters.projectId);
    }

    // 대시보드에서 들어온 경우에는 필터를 항상 켜서 바로 반영
    setFilterOn(true);
  };

  // keep filters.projectId aligned with currentProjectId (project selection is global)
  useEffect(() => {
    setFilters(prev => {
      const nextProjectId = currentProjectId || 'all';
      if (prev.projectId === nextProjectId) return prev;
      return { ...prev, projectId: nextProjectId };
    });
  }, [currentProjectId]);

  const hasActiveFilters = filterOn && (
    filters.projectId !== 'all' ||
    filters.status !== 'all' ||
    filters.assignee ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly ||
    (typeof filters.level === 'number') ||
    !!filters.pastDueOnly
  );
  const allAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  const effectiveFilters: FilterState = filterOn
    ? filters
    : { ...filters, status: 'all', assignee: '', startDate: '', endDate: '', milestoneOnly: false, issueOnly: false, level: 'all', pastDueOnly: false };

  const [isRefreshConfirmOpen, setIsRefreshConfirmOpen] = useState(false);

  const requestRefresh = useCallback(() => {
    if (hasUnsyncedChanges) {
      setIsRefreshConfirmOpen(true);
    } else {
      window.location.reload();
    }
  }, [hasUnsyncedChanges]);

  useEffect(() => {
    if (!hasUnsyncedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsyncedChanges]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg)] font-sans text-[var(--color-ink)] gap-5">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-slate-700">데이터를 불러오는 중...</p>
            <p className="text-xs text-slate-400 mt-1">잠시만 기다려주세요</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900", isFullscreen && "overflow-hidden")}>
      {!isFullscreen && (
      <header className={cn("bg-white/90 backdrop-blur-xl border-b border-slate-200/60 z-50 safe-top transition-all duration-200", isHeaderCollapsed ? "py-2 px-3 md:py-3 md:px-6" : "px-4 md:px-6 py-3")} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)' }}>
        {/* 모바일 접힌 상태: 최소 바 */}
        <div className={cn("flex md:hidden items-center justify-between gap-2", !isHeaderCollapsed && "hidden")}>
          <div className="flex items-center gap-2 min-w-0">
            <button type="button" onClick={requestRefresh} className="shrink-0">
              <img src={logo} alt="GMT Logo" className="w-14 h-14 object-contain" />
            </button>
            <span className="font-bold text-sm truncate">{wbsSettings.appTitle}</span>
          </div>
          <button
            onClick={() => setIsHeaderCollapsed(false)}
            className="p-2.5 -mr-1 rounded-lg hover:bg-stone-100 text-stone-500 shrink-0"
            title="메뉴 펼치기"
          >
            <ChevronDown size={20} />
          </button>
        </div>
        {/* 전체 헤더: 모바일에서 접혀 있으면 숨김 */}
        <div className={cn("flex flex-col md:flex-row justify-between items-start md:items-center gap-4", isHeaderCollapsed && "hidden md:flex")}>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            onClick={requestRefresh}
            title="새로고침: 페이지를 다시 불러와 최신 데이터를 확인합니다."
          >
            <img src={logo} alt="GMT Logo" className="w-16 h-16 object-contain" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight leading-none">{wbsSettings.appTitle}</h1>
              <button
                onClick={() => {
                  setIsVersionHistoryOpen(true);
                  tipOnce('menu.version', '버전 정보를 클릭하면 변경 이력(버전 히스토리)을 확인할 수 있어요.');
                }}
                className="text-[10px] font-mono text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-all flex items-center gap-1.5 group"
                title={`버전 정보 (수정일: ${formatCommitDate(__APP_COMMIT_DATE__)})`}
              >
                <Tag size={10} className="text-slate-300 group-hover:text-indigo-400" />
                <span>v{__APP_VERSION__}</span>
                <span className="hidden 2xl:inline text-[10px] text-slate-300 group-hover:text-indigo-300 font-medium">
                  · 수정일 {formatCommitDateDateOnly(__APP_COMMIT_DATE__)}
                </span>
              </button>
            </div>

            <div className="relative mt-1 group">
              <button
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-2 px-2.5 py-2 hover:bg-slate-50 rounded-xl transition-all border border-transparent hover:border-slate-200/80"
                title="프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다."
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">프로젝트</span>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                    <span className="max-w-[140px] sm:max-w-[200px] truncate">{currentProjectId === 'all' ? '전체 프로젝트' : (currentProject?.name || '프로젝트 선택')}</span>
                    <ChevronDown size={14} className={cn("text-slate-400 transition-transform duration-200", isProjectDropdownOpen && "rotate-180")} />
                  </div>
                  {currentProject?.ownerId && (currentProject.ownerId === user?.id || effectiveIsAdmin) && (
                    <span className="text-[9px] text-slate-400 truncate max-w-[200px] mt-0.5" title={currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? currentProject.ownerId) : undefined}>
                      {currentProject.ownerId === user?.id ? '내 프로젝트' : (currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? '다른 사용자') : '소유자 없음')}
                    </span>
                  )}
                </div>
              </button>
              {presenceOthers.length > 0 && currentProjectId !== 'all' && (
                <div
                  className="absolute left-0 top-full mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200/80 text-amber-800 text-xs"
                  title="다른 사용자가 이 프로젝트를 보고 있습니다. 동시에 수정하면 충돌할 수 있어 저장 후 새로고침됩니다."
                >
                  <Eye size={12} className="shrink-0 text-amber-600" />
                  <span className="font-medium">
                    {presenceOthers.length}명이 보고 있음:
                  </span>
                  <span className="truncate max-w-[180px]" title={presenceOthers.map(o => o.displayName).join(', ')}>
                    {presenceOthers.map(o => o.displayName).join(', ')}
                  </span>
                </div>
              )}
              {isProjectDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 dropdown-menu" style={{ boxShadow: 'var(--shadow-xl)' }}>
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wider" title="선택한 프로젝트의 작업만 표시합니다. 전체를 선택하면 모든 프로젝트를 한눈에 볼 수 있어요.">프로젝트 목록</div>
                      <div
                        className={cn(
                          "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                          currentProjectId === 'all' ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                        )}
                        onClick={() => {
                          selectProject('all');
                          setIsProjectDropdownOpen(false);
                        }}
                        title="모든 프로젝트의 작업을 한 화면에서 확인합니다."
                      >
                        <span className="truncate flex-1">전체</span>
                        <span className="text-[10px] text-stone-400 shrink-0">({allTasks.length}개)</span>
                      </div>
                      <div className="h-px bg-stone-100 my-1 mx-2" />
                      {projectsGroupedByOwner.map(group => (
                        <div key={group.ownerId ?? 'null'} className="mb-2">
                          <div
                            className={cn(
                              "px-3 py-2 mt-1 first:mt-0 rounded-md border-l-2 text-xs font-bold tracking-wide",
                              group.ownerId === user?.id
                                ? "bg-teal-50/80 border-teal-400 text-teal-800"
                                : "bg-stone-100 border-stone-300 text-stone-600"
                            )}
                            title={group.ownerId === user?.id ? "내가 만든 프로젝트" : "다른 사용자의 프로젝트"}
                          >
                            {group.label}
                          </div>
                          {group.projects.map(project => (
                            <div
                              key={project.id}
                              className={cn(
                                "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                                currentProjectId === project.id ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                              )}
                              onClick={() => {
                                selectProject(project.id);
                                setIsProjectDropdownOpen(false);
                              }}
                            >
                              <div className="truncate flex-1 min-w-0 flex flex-col">
                                <span className="truncate flex items-center gap-1.5">
                                  {project.name}
                                  <span className="text-[10px] text-stone-400 shrink-0">({taskCountByProject[project.id] ?? 0}개)</span>
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={(e) => { e.stopPropagation(); setCurrentProjectId(project.id); setIsShareOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-teal-600 p-1 rounded" title="프로젝트 공유"><Share2 size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); setAuditLogProjectId(project.id); setIsAuditLogOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-amber-600 p-1 rounded" title="변경 이력"><History size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); copyProject(project.id); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-blue-600 p-1 rounded" title="프로젝트 복사"><Copy size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); setEditingProject(project); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-[var(--color-ink)] p-1 rounded" title="프로젝트 편집"><Edit size={12} /></button>
                                {projectsGroupedByOwner.flatMap(g => g.projects).length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProjectToDelete(project);
                                      setIsProjectDropdownOpen(false);
                                      setIsDeleteProjectConfirmOpen(true);
                                    }}
                                    className="text-stone-400 hover:text-red-500 p-1 rounded"
                                    title="프로젝트 삭제"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      <button onClick={() => { setEditingProject(null); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors" title="새 프로젝트를 생성합니다.">
                        <FolderPlus size={14} /> 새 프로젝트
                      </button>
                      <button onClick={() => { setIsProjectDropdownOpen(false); setView('projects'); }} className="w-full text-left px-3 py-2 text-sm text-stone-500 hover:bg-stone-50 rounded-lg flex items-center gap-2 transition-colors" title="프로젝트 관리 페이지로 이동합니다.">
                        <Briefcase size={14} /> 프로젝트 관리
                      </button>
                      {effectiveIsAdmin && !userApproved && !isAdmin && (
                        <p className="px-3 py-2 text-[10px] text-amber-600 bg-amber-50 border-t border-amber-100 mt-1" title="미승인 상태에서는 로컬에 저장된 프로젝트만 표시됩니다.">
                          로컬 전용: DB의 전체 프로젝트를 보려면 관리자 승인 후 다시 로그인하세요.
                        </p>
                      )}
                      {effectiveIsAdmin && userApproved && !isAdmin && (
                        <p className="px-3 py-2 text-[10px] text-amber-600 bg-amber-50 border-t border-amber-100 mt-1" title="비밀번호 관리자 모드는 DB 권한에 반영되지 않습니다.">
                          비밀번호 관리자 모드는 메뉴/승인에만 적용됩니다. 전체 프로젝트를 보려면 회원 관리에서 본인을 &apos;관리자&apos;로 지정하세요.
                        </p>
                      )}
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
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="icon-btn text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="다시 실행 (Ctrl+Shift+Z)"
            >
              <Redo2 size={16} />
            </button>
          </div>
          <div className="toolbar-divider hidden md:block" />
          {/* 모바일: 가로 스크롤 탭 바 (아이콘+텍스트), 데스크톱: 기존 pill 영역 */}
          <div className="flex bg-slate-100/70 p-1 rounded-xl border border-slate-200/60 overflow-x-auto overflow-y-visible md:overflow-visible shrink-0 min-w-0 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent gap-0.5">
            {!hiddenViews.has('dashboard') && (
              <NavButton active={view === 'dashboard'} onClick={() => navigateWithTip('dashboard')} icon={<PieChart size={14} />} label="대시보드" title="프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다." />
            )}
            {!hiddenViews.has('projects') && (
              <NavButton active={view === 'projects'} onClick={() => navigateWithTip('projects')} icon={<Briefcase size={14} />} label="프로젝트" title="프로젝트 관리: 생성·편집·공유·일괄 삭제를 할 수 있습니다." />
            )}
            {!hiddenViews.has('allocation') && (
              <NavButton active={view === 'allocation'} onClick={() => navigateWithTip('allocation')} icon={<Users size={14} />} label="투입현황" title="프로젝트별·인원별 투입 비율을 한눈에 확인합니다." />
            )}
            <NavButton active={view === 'list'} onClick={() => navigateWithTip('list')} icon={<List size={14} />} label="전체" title="표와 간트를 나란히 보며 작업을 편집하고 일정을 확인합니다. 가운데 바를 드래그해 폭을 조절할 수 있어요." />
            <NavButton active={view === 'table'} onClick={() => navigateWithTip('table')} icon={<Table size={14} />} label="표만" title="작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다." />
            <NavButton active={view === 'gantt'} onClick={() => navigateWithTip('gantt')} icon={<BarChart3 size={14} />} label="간트만" title="일정 막대를 드래그해 날짜를 조정하고, 선후관계·크리티컬 패스를 확인합니다." />
            <NavButton active={view === 'kanban'} onClick={() => navigateWithTip('kanban')} icon={<Columns size={14} />} label="칸반" title="상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다." />
          </div>

          <div className="toolbar-divider" />

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                setIsAIModalOpen(true);
                tipOnce('menu.ai', 'AI가 프로젝트 내용을 분석해 WBS를 생성합니다. 분석 중에는 창을 닫아도 백그라운드에서 계속 진행돼요.');
              }}
              className={cn("icon-btn transition-colors", isAIBusy ? "text-purple-600 bg-purple-50" : "text-purple-500 hover:text-purple-600 hover:bg-purple-50")}
              title={isAIBusy ? "AI 분석 중..." : "AI 프로젝트 분석"}
            >
              {isAIBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            </button>
            {effectiveIsAdmin && (
              <button
                onClick={() => setIsMembersModalOpen(true)}
                className="icon-btn text-slate-400 hover:text-teal-600 hover:bg-teal-50"
                title="회원 관리"
              >
                <Users size={15} />
              </button>
            )}
            <span
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-200/60 ml-1"
              title={`로그인: ${currentUserDisplay}${user?.email && currentUserDisplay !== user.email ? ` (${user.email})` : ''}`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" aria-hidden />
              {currentUserDisplay}
            </span>
            <button
              onClick={() => signOut()}
              className="icon-btn text-slate-400 hover:text-red-500 hover:bg-red-50"
              title={`로그아웃 (${user?.email ?? '사용자'})`}
            >
              <LogOut size={15} />
            </button>
            <button
              onClick={() => {
                setIsSettingsModalOpen(true);
                tipOnce('menu.settings', '설정에서 WBS 표시, 상태/진척도, 표 컬럼(표시·순서) 등을 변경할 수 있어요.');
              }}
              className="icon-btn text-slate-400 hover:text-[var(--color-ink)]"
              title="설정"
            >
              <Settings2 size={15} />
            </button>
            <button
              onClick={() => {
                setIsShortcutsVisible(!isShortcutsVisible);
                tipOnce('menu.shortcuts', '단축키 패널을 켜/끄는 버튼입니다. (표: Ctrl+A → Del로 일괄 삭제)');
              }}
              className={cn(
                "icon-btn",
                isShortcutsVisible ? "text-[var(--color-accent)] bg-indigo-50" : "text-slate-400 hover:text-[var(--color-ink)]"
              )}
              title="단축키"
            >
              <Keyboard size={15} />
            </button>
          </div>

          <div className="toolbar-divider" />

          {/* Filter On/Off Toggle */}
          <button
            onClick={() => {
              setFilterOn(v => !v);
              tipOnce('menu.filter', '필터를 켜면 상태/담당자/기간으로 작업을 좁혀 볼 수 있어요.');
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all shrink-0",
              filterOn
                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/25"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
            )}
            title={filterOn ? "필터 끄기" : "필터 켜기"}
          >
            <Filter size={14} />
            <span>필터</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md", filterOn ? "bg-white/20" : "bg-slate-100 text-slate-400")}>{filterOn ? "On" : "Off"}</span>
          </button>

          <div className="flex gap-1.5">
            <div className="relative">
              <button
                onClick={() => {
                  setIsImportMenuOpen(!isImportMenuOpen);
                  tipOnce('menu.import', '가져오기: Excel/JSON 데이터를 불러와 작업을 추가하거나 복원할 수 있어요.');
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all"
                title="가져오기"
              >
                <Upload size={13} /> <span>가져오기</span> <ChevronDown size={11} className={cn("opacity-50 transition-transform", isImportMenuOpen && "rotate-180")} />
              </button>
              {isImportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsImportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-60 bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 dropdown-menu" style={{ boxShadow: 'var(--shadow-lg)' }}>
                    <div className="p-1">
                      <button onClick={handleImportClick} className="w-full text-left px-3 py-2.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors font-medium">Excel 가져오기 (.xlsx)</button>
                      <button onClick={handleMergeImportClick} className="w-full text-left px-3 py-2.5 text-xs text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors font-medium">프로젝트 추가 (JSON)</button>
                      <button onClick={handleImportBackupClick} className="w-full text-left px-3 py-2.5 text-xs text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors font-medium">전체 백업 복원 (JSON)</button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => {
                if (isDbSyncing) return;
                const scope: 'current' | 'all' = currentProjectId === 'all' || !currentProjectId ? 'all' : 'current';
                void executeDbSync(scope);
              }}
              disabled={isDbSyncing}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-all",
                isDbSyncing
                  ? "bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed"
                  : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300"
              )}
              title="로컬 데이터를 DB(Supabase)에 반영합니다."
            >
              {isDbSyncing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              <span>DB 반영</span>
            </button>

            <button
              onClick={() => {
                setIsExportModalOpen(true);
                tipOnce('menu.export', '내보내기: 범위와 파일 형식(Excel/JSON/Markdown)을 선택할 수 있어요.');
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all"
              title="내보내기"
            >
              <Download size={13} /> <span>내보내기</span>
            </button>

            <button
              onClick={() => {
                setIsDeleteChoiceOpen(true);
                tipOnce('menu.deleteAll', '전체 삭제, 현재 보고 있는 프로젝트 삭제, 프로젝트 선택 삭제, 현재 프로젝트 작업만 삭제 중 선택할 수 있습니다.');
              }}
              className="icon-btn text-slate-300 hover:text-red-500 hover:bg-red-50"
              title="삭제"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="toolbar-divider" />

          <button
            onClick={() => {
              setIsModalOpen(true);
              tipOnce('menu.newTask', '새 작업을 추가합니다. 표 화면에서는 Enter로도 빠르게 추가할 수 있어요.');
            }}
            className="btn-primary flex items-center gap-1.5"
            title="새 작업 추가"
          >
            <Plus size={15} /> <span>새 작업</span>
          </button>
          <button
            onClick={() => setIsHeaderCollapsed(true)}
            className="md:hidden p-2.5 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
            title="메뉴 접어서 표 넓게 보기"
          >
            <ChevronUp size={18} />
          </button>
        </div>
        </div>
      </header>
      )}

      {!isFullscreen && !isLocalSaveBannerDismissed && (
        <div className="bg-sky-50/80 border-b border-sky-200/60 px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 text-sky-800 text-xs">
          <span>
            기본 저장은 <strong>로컬</strong>입니다. 변경사항을 서버에 공유하려면 <strong>DB 반영</strong> 버튼을 눌러주세요.
          </span>
          <button
            onClick={() => {
              setIsLocalSaveBannerDismissed(true);
              sessionStorage.setItem('wbs-local-save-banner-dismissed', '1');
            }}
            className="ml-1 p-1 rounded-md hover:bg-sky-200/50 text-sky-500 hover:text-sky-800 transition-colors"
            title="닫기"
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
              sessionStorage.setItem('wbs-backup-banner-dismissed', '1');
            }}
            className="ml-1 p-1 rounded-md hover:bg-amber-200/60 text-amber-500 hover:text-amber-800 transition-colors"
            title="닫기"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filter bar: 모바일에서 헤더 접힌 상태면 숨김 */}
      {filterOn && !isFullscreen && view !== 'projects' && view !== 'allocation' && (
        <div className={cn("bg-white/80 backdrop-blur-lg border-b border-slate-200/60 px-4 py-2.5 flex flex-wrap md:flex-nowrap items-center gap-2 overflow-x-auto shrink-0 z-40", isHeaderCollapsed && "hidden md:flex")} style={{ boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.03)' }}>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mr-1 uppercase tracking-wider" title="프로젝트별로 작업을 필터링합니다.">프로젝트</span>
          <div className="shrink-0">
            <select
              value={filters.projectId}
              onChange={(e) => {
                const pid = e.target.value;
                selectProject(pid);
                setFilters(f => ({ ...f, projectId: pid }));
              }}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all max-w-[220px]"
              title="프로젝트 선택: 선택한 프로젝트의 작업만 표시합니다."
            >
              <option value="all">전체</option>
              {projectsGroupedByOwner.map(group => (
                <optgroup key={group.ownerId ?? 'null'} label={group.label}>
                  {group.projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mr-1 uppercase tracking-wider" title="상태별로 작업을 필터링합니다.">상태</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, status: 'all' }))} className={cn("filter-chip", filters.status === 'all' ? "filter-chip-active" : "filter-chip-inactive")} title="모든 상태의 작업 표시">전체</button>
            {wbsSettings.statusConfigs.map(config => (
              <button key={config.id} onClick={() => setFilters(f => ({ ...f, status: config.id }))} className={cn("filter-chip", filters.status === config.id ? "filter-chip-active" : "filter-chip-inactive")} title={`${config.name} 상태인 작업만 표시`}>{config.name}</button>
            ))}
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="담당자별로 작업을 필터링합니다.">담당자</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, assignee: '' }))} className={cn("filter-chip", !filters.assignee ? "filter-chip-active" : "filter-chip-inactive")} title="모든 담당자의 작업 표시">전체</button>
            {allAssignees.map(a => (
              <button key={a} onClick={() => setFilters(f => ({ ...f, assignee: a }))} className={cn("filter-chip", filters.assignee === a ? "filter-chip-active" : "filter-chip-inactive")} title={`${a} 담당 작업만 표시`}>{a}</button>
            ))}
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="마일스톤(이정표) 작업만 보기">마일스톤</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, milestoneOnly: false }))} className={cn("filter-chip flex items-center gap-1", !filters.milestoneOnly ? "filter-chip-active" : "filter-chip-inactive")} title="모든 작업 표시">전체</button>
            <button onClick={() => setFilters(f => ({ ...f, milestoneOnly: true }))} className={cn("filter-chip flex items-center gap-1", filters.milestoneOnly ? "filter-chip-active" : "filter-chip-inactive")} title="마일스톤으로 지정된 이정표 작업만 표시"><Flag size={12} className="opacity-80" /> 마일스톤만</button>
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="이슈로 지정된 작업만 보기">이슈</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, issueOnly: false }))} className={cn("filter-chip flex items-center gap-1", !filters.issueOnly ? "filter-chip-active" : "filter-chip-inactive")} title="모든 작업 표시">전체</button>
            <button onClick={() => setFilters(f => ({ ...f, issueOnly: true }))} className={cn("filter-chip flex items-center gap-1", filters.issueOnly ? "filter-chip-active" : "filter-chip-inactive")} title="이슈로 지정된 작업만 표시"><Bug size={12} className="opacity-80" /> 이슈만</button>
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="WBS 레벨별로 작업만 표시">레벨</span>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <button onClick={() => setFilters(f => ({ ...f, level: 'all' }))} className={cn("filter-chip", (filters.level === 'all' || filters.level === undefined) ? "filter-chip-active" : "filter-chip-inactive")} title="모든 레벨 표시">전체</button>
            {[1, 2, 3, 4, 5].map(lv => (
              <button key={lv} onClick={() => setFilters(f => ({ ...f, level: lv }))} className={cn("filter-chip", filters.level === lv ? "filter-chip-active" : "filter-chip-inactive")} title={`${lv}레벨 작업만 표시`}>{lv}레벨</button>
            ))}
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="기간별로 작업을 필터링합니다.">기간</span>
          <div className="flex items-center gap-1.5 shrink-0">
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
          </div>
          <span className="text-[10px] font-bold text-slate-400 shrink-0 mx-2 uppercase tracking-wider" title="완료 기한이 지났지만 아직 미완료인 작업만 보기">기한 지남</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, pastDueOnly: false }))} className={cn("filter-chip flex items-center gap-1", !filters.pastDueOnly ? "filter-chip-active" : "filter-chip-inactive")} title="모든 작업 표시">전체</button>
            <button onClick={() => setFilters(f => ({ ...f, pastDueOnly: true }))} className={cn("filter-chip flex items-center gap-1", filters.pastDueOnly ? "filter-chip-active" : "filter-chip-inactive")} title="기한이 지난 미완료 작업만 표시"><Clock size={12} className="opacity-80" /> 기한 지난 항목</button>
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setCurrentProjectId('all');
                setFilters(f => ({
                  ...f,
                  projectId: 'all',
                  status: 'all',
                  assignee: '',
                  startDate: '',
                  endDate: '',
                  milestoneOnly: false,
                  issueOnly: false,
                  level: 'all',
                  pastDueOnly: false,
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
      <main className={cn("flex-1 overflow-hidden flex flex-row relative", isFullscreen && "fixed inset-0 z-50 bg-white")}>
        <div className="flex-1 min-w-0 relative bg-white">
          {view === 'list' ? (
            <div ref={containerRef} className={cn("relative flex h-full w-full list-split-view", isDraggingResizer && "cursor-col-resize select-none")}>
              <div className="flex-shrink-0 overflow-hidden h-full flex flex-col list-table-pane" style={{ width: `${wbsTableWidth}%` }}>
                <WBSTable
                  filters={effectiveFilters}
                  sortConfig={sortConfig}
                  syncScrollRef={wbsScrollRef}
                  onRowHeightChange={setSharedRowHeight}
                  onRowHeightsChange={setRowHeights}
                  onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
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
                <span className="w-1 h-16 rounded-full bg-slate-200 group-hover:bg-indigo-400 group-active:bg-indigo-500 transition-all duration-150 pointer-events-none group-hover:w-1.5 group-hover:shadow-sm" />
              </div>
              <div className="flex-shrink-0 overflow-hidden bg-stone-50/30 list-gantt-pane hidden md:block" style={{ width: `${100 - wbsTableWidth}%` }}>
                <GanttChart filters={effectiveFilters} sortConfig={sortConfig} hideSidebar={true} rowHeight={sharedRowHeight} rowHeights={rowHeights} syncScrollRef={ganttScrollRef} />
              </div>
            </div>
          ) : view === 'table' ? (
            <div className="h-full overflow-hidden">
              <WBSTable
                filters={effectiveFilters}
                sortConfig={sortConfig}
                onOpenColumnSettings={() => setIsSettingsModalOpen(true)}
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
            <Dashboard onNavigate={handleDashboardNavigate} />
          ) : view === 'projects' ? (
            <ProjectsPage onNavigateToWork={(projectId) => { if (projectId) setCurrentProjectId(projectId); setView('list'); }} />
          ) : view === 'allocation' ? (
            <AllocationOverviewPage
              onEditProject={(p) => { setEditingProject(p); setIsProjectModalOpen(true); }}
              onNavigateToWork={(projectId) => { setCurrentProjectId(projectId); setView('list'); }}
            />
          ) : (
            <KanbanBoard filters={effectiveFilters} />
          )}
        </div>
        {isShortcutsVisible && <ShortcutsSidebar onClose={() => setIsShortcutsVisible(false)} />}
      </main>

      <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveTask} parentOptions={tasks} />
      <ProjectModal isOpen={isProjectModalOpen} onClose={() => { setIsProjectModalOpen(false); setEditingProject(null); }} onSave={handleSaveProject} project={editingProject} />
      <WBSSettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
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
              (t.assignments ?? []).forEach((a2) => {
                const n = (a2.assignee || '').trim();
                if (n) assigneesFromTasks.add(n);
              });
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
        projects={projects}
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
      <ExcelImportPreviewModal
        isOpen={importPreview.isOpen}
        onClose={() => setImportPreview(prev => ({ ...prev, isOpen: false }))}
        onConfirm={executeImport}
        totalTaskCount={importPreview.tasks.length}
        files={importPreview.files}
        projects={projects}
        currentProjectId={currentProjectId}
      />
      <BackupRestoreModal
        isOpen={backupConfirm.isOpen}
        onClose={() => setBackupConfirm({ ...backupConfirm, isOpen: false })}
        onConfirmFull={executeRestoreBackup}
        onConfirmIntoProject={executeRestoreBackupIntoProject}
        data={backupConfirm.data}
        projects={projects}
        currentProjectId={currentProjectId}
      />
      <ConfirmDialog isOpen={multiMergeConfirm.isOpen} onClose={() => setMultiMergeConfirm({ ...multiMergeConfirm, isOpen: false })} onConfirm={executeMultiMerge} title="다중 프로젝트 가져오기" message={`선택한 ${multiMergeConfirm.fileCount}개의 파일을 가져오시겠습니까?`} confirmLabel="가져오기" isDanger={false} />
      <ConfirmDialog isOpen={errorAlert.isOpen} onClose={() => setErrorAlert({ isOpen: false, message: '' })} onConfirm={() => setErrorAlert({ isOpen: false, message: '' })} title="오류" message={errorAlert.message} confirmLabel="확인" isDanger={false} />
      <ConfirmDialog
        isOpen={isRefreshConfirmOpen}
        onClose={() => setIsRefreshConfirmOpen(false)}
        onConfirm={async () => {
          const scope: 'current' | 'all' = currentProjectId === 'all' || !currentProjectId ? 'all' : 'current';
          try {
            await executeDbSync(scope);
          } finally {
            setIsRefreshConfirmOpen(false);
            window.location.reload();
          }
        }}
        title="새로고침 전 DB 저장"
        message="DB(서버)에 반영되지 않은 변경사항이 있을 수 있습니다. DB에 저장한 뒤 새로고침하시겠습니까? (취소를 누르면 현재 화면에 머무릅니다.)"
        confirmLabel="DB 저장 후 새로고침"
        isDanger={false}
      />
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
        onDeleted={() => { pushToast('회원이 삭제되었습니다.', { variant: 'success' }); onMembersUpdated?.(); }}
        onApproved={() => { pushToast('회원을 승인했습니다. 해당 회원은 다음 로그인부터 DB와 동기화됩니다.', { variant: 'success' }); onMembersUpdated?.(); }}
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
        projects={projects}
        allTasks={allTasks}
        selectedProjectIds={exportSelectedProjectIds}
        onSelectedProjectIdsChange={setExportSelectedProjectIds}
        wbsMap={wbsMap}
        wbsSettings={wbsSettings}
        currentProjectId={currentProjectId !== 'all' ? currentProjectId : undefined}
        onExport={handleExportFromModal}
      />

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls, .xlsm" multiple className="hidden" />
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

  useEffect(() => {
    if (!user?.id) return;
    getProfileStatus().then(status => {
      if (status) {
        setIsAdmin(status.isAdmin);
        setUserApproved(status.approved);
      }
    }).catch(() => { setUserApproved(false); });
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
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
      onConcurrentConflict={() => pushToast('다른 사용자가 수정했습니다. 화면이 자동으로 최신 데이터로 갱신됩니다.', { variant: 'warning', durationMs: 6000 })}
      onDbError={(msg) => pushToast(msg, { variant: 'error' })}
    >
      <WBSApp
        isAdmin={isAdmin}
        userApproved={userApproved}
        onMembersUpdated={() => getProfileStatus().then(s => s && setUserApproved(s.approved))}
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
