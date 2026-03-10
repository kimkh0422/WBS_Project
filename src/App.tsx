import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WBSTable } from './components/WBSTable';
import { GanttChart } from './components/GanttChart';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { useWBS, WBSProvider } from './context/WBSContext';
import { List, Plus, Download, Upload, ChevronDown, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2, PieChart, Loader2, Check, MessageSquare, Tag, Table, BarChart3, HelpCircle, Share2, Undo2, Redo2, Maximize2, Minimize2, Flag, AlertTriangle, LogOut, Users } from 'lucide-react';
import { computeWorkloadOverloads, fixOverloadByExtending } from './lib/workload';
import { cn } from './lib/utils';
import { Task, Project, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcelWithMeta, ExcelImportMeta } from './lib/excel';
import { exportBackupToJson, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { acceptInvite, checkIsAdmin, fetchProfiles } from './lib/db';
import { isSupabaseConfigured } from './lib/supabase';
import { Dashboard } from './components/Dashboard';
import { ProjectsPage } from './components/ProjectsPage';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { WBSSettingsModal } from './components/WBSSettingsModal';
import { VersionManager } from './components/VersionManager';
import { LoginScreen } from './components/LoginScreen';
import { SupabaseSetupScreen } from './components/SupabaseSetupScreen';
import { useAuth } from './context/AuthContext';
import { TutorialModal } from './components/TutorialModal';
import { ToastProvider, useToast } from './components/Toast';
import { ExcelImportPreviewModal } from './components/ExcelImportPreviewModal';
import { ShareModal } from './components/ShareModal';
import { MembersModal } from './components/MembersModal';
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
        "px-2.5 py-1.5 rounded-md transition-all text-xs font-medium flex items-center gap-1.5",
        active ? "bg-white shadow-sm text-[var(--color-ink)]" : "text-stone-500 hover:text-[var(--color-ink)]"
      )}
      title={title}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function WBSApp() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<'list' | 'table' | 'gantt' | 'kanban' | 'dashboard' | 'projects'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isAIBusy, setIsAIBusy] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isShortcutsVisible, setIsShortcutsVisible] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSelectedProjectIds, setExportSelectedProjectIds] = useState<string[]>([]);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isDeleteProjectConfirmOpen, setIsDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<any>(null);
  const [isDeleteAllProjectsConfirmOpen, setIsDeleteAllProjectsConfirmOpen] = useState(false);
  const [isDeleteEverythingConfirmOpen, setIsDeleteEverythingConfirmOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminPasswordModalOpen, setIsAdminPasswordModalOpen] = useState(false);
  const [adminOverride, setAdminOverride] = useState(() => sessionStorage.getItem('wbs-admin-override') === 'true');
  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null }[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const {
    addTask,
    addTasks,
    tasks,
    allTasks,
    importTasks,
    projects,
    currentProjectId,
    setCurrentProjectId,
    addProject,
    updateProject,
    deleteProject,
    deleteAllTasks,
    deleteAllTasksInAllProjects,
    deleteEverything,
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

  const { push: pushToast, tipOnce } = useToast();
  const prevAIBusyRef = useRef(false);

  // 관리자 여부 확인 (DB 또는 Shift+F12 비밀번호 오버라이드)
  useEffect(() => {
    if (!user?.id || isLoading) return;
    checkIsAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [user?.id, isLoading]);

  const effectiveIsAdmin = isAdmin || adminOverride;

  // 회원(프로필) 목록 로드: 관리자는 전체, 일반 사용자는 본인 프로필만 (현재 로그인 사용자 표시용)
  useEffect(() => {
    if (!user?.id) return;
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [user?.id]);

  const profileMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach(p => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    return m;
  }, [profiles]);

  const currentUserDisplay = React.useMemo(() => {
    if (!user) return '';
    const profile = profiles.find(p => p.id === user.id) as { full_name?: string | null } | undefined;
    const name = profile?.full_name || (user.user_metadata as { full_name?: string } | undefined)?.full_name;
    return (name && String(name).trim()) || user.email || '사용자';
  }, [user, profiles]);

  const taskCountByProject = React.useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach(p => { m[p.id] = 0; });
    allTasks.forEach(t => {
      if (t.projectId && m[t.projectId] !== undefined) m[t.projectId]++;
    });
    return m;
  }, [projects, allTasks]);

  // 프로젝트 목록 중복 제거: 동일 (이름, 소유자) 조합은 작업 수가 많은 것 하나만 표시
  const uniqueProjects = React.useMemo(() => {
    const byKey = new Map<string, Project>();
    for (const p of projects) {
      const key = `${p.name}::${p.ownerId ?? ''}`;
      const existing = byKey.get(key);
      const count = taskCountByProject[p.id] ?? 0;
      const existingCount = existing ? (taskCountByProject[existing.id] ?? 0) : 0;
      if (!existing || count > existingCount) byKey.set(key, p);
    }
    return Array.from(byKey.values());
  }, [projects, taskCountByProject]);

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
  const [wbsTableWidth, setWbsTableWidth] = useState(() => {
    try {
      const saved = window.localStorage.getItem(WBS_TABLE_WIDTH_STORAGE_KEY);
      const parsed = saved ? Number(saved) : NaN;
      if (!Number.isFinite(parsed)) return 50;
      return Math.min(80, Math.max(20, parsed));
    } catch {
      return 50;
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
    const handleHelpHotkey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (e.key === 'F1') {
        e.preventDefault();
        setIsTutorialOpen(true);
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
        e.preventDefault();
        setIsTutorialOpen(true);
      }
    };

    window.addEventListener('keydown', handleHelpHotkey);
    return () => window.removeEventListener('keydown', handleHelpHotkey);
  }, []);

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
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'wbs', direction: 'asc' });
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeleteChoiceOpen, setIsDeleteChoiceOpen] = useState(false);

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

  const handleSaveProject = (name: string, description: string, startDate?: string, assignments?: Project['assignments']) => {
    if (editingProject) {
      updateProject(editingProject.id, { name, description, startDate, assignments });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, assignments);
    }
    setIsProjectModalOpen(false);
  };

  const handleDeleteAll = () => {
    deleteAllTasks();
    setIsDeleteAllConfirmOpen(false);
    setIsProjectDropdownOpen(false);
  };

  const handleDeleteAllProjects = () => {
    deleteAllTasksInAllProjects();
    setIsDeleteAllProjectsConfirmOpen(false);
    setIsDeleteChoiceOpen(false);
    setIsProjectDropdownOpen(false);
  };

  const handleDeleteEverything = () => {
    deleteEverything();
    setIsDeleteEverythingConfirmOpen(false);
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

  const handleExportFromModal = (params: { scope: 'all' | 'selected'; format: 'excel' | 'json'; projectIds: string[] }) => {
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

  const executeImport = () => {
    // Ensure imported tasks are visible even when user is on "전체(all)" or has project filter set.
    const effectiveProjectId = currentProjectId === 'all' ? (projects[0]?.id || currentProjectId) : currentProjectId;
    importTasks(importPreview.tasks);
    if (currentProjectId === 'all' && effectiveProjectId && effectiveProjectId !== 'all') {
      setCurrentProjectId(effectiveProjectId);
    }
    setFilters(prev => ({ ...prev, projectId: 'all' }));
    setImportPreview({ isOpen: false, tasks: [], files: [] });
  };

  const executeRestoreBackup = () => {
    if (backupConfirm.data) restoreBackup(backupConfirm.data);
    setBackupConfirm({ isOpen: false, data: null });
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

  const hasActiveFilters = filterOn && (filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate || !!filters.milestoneOnly);
  const allAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  const effectiveFilters: FilterState = filterOn ? filters : { ...filters, status: 'all', assignee: '', startDate: '', endDate: '', milestoneOnly: false };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg)] font-sans text-[var(--color-ink)] gap-4">
        <div className="flex items-center gap-3 text-stone-500">
          <Loader2 size={28} className="animate-spin text-[var(--color-accent)]" />
          <span className="text-lg font-medium">데이터를 불러오는 중...</span>
        </div>
        <p className="text-xs text-stone-400">Supabase DB에서 데이터를 가져오고 있습니다</p>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)] selection:bg-indigo-200 selection:text-indigo-900", isFullscreen && "overflow-hidden")}>
      {!isFullscreen && (
      <header className="bg-glass-elevated border-b border-slate-200/50 px-6 py-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-[0_2px_15px_rgba(0,0,0,0.03)] z-50 sticky top-0">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => window.location.reload()}
            title="새로고침: 페이지를 다시 불러와 최신 데이터를 확인합니다."
          >
            <img src={logo} alt="GMT Logo" className="w-8 h-8 object-contain" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight leading-none">{wbsSettings.appTitle}</h1>
              <button
                onClick={() => {
                  setIsVersionHistoryOpen(true);
                  tipOnce('menu.version', '버전 정보를 클릭하면 변경 이력(버전 히스토리)을 확인할 수 있어요.');
                }}
                className="text-[10px] font-mono text-stone-400 hover:text-blue-500 hover:bg-blue-50 px-1.5 py-0.5 rounded transition-all flex items-center gap-1.5 group"
                title={`버전 정보 (수정일: ${formatCommitDate(__APP_COMMIT_DATE__)})`}
              >
                <Tag size={10} className="text-stone-300 group-hover:text-blue-400" />
                <span>v{__APP_VERSION__}</span>
                <span className="hidden 2xl:inline text-[10px] text-stone-300 group-hover:text-blue-300 font-medium">
                  · 수정일 {formatCommitDate(__APP_COMMIT_DATE__)}
                </span>
              </button>
            </div>

            <div className="relative mt-1 group">
              <button
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-2 p-1.5 hover:bg-stone-50 rounded-lg transition-all"
                title="프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다."
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider leading-none mb-1">현재 프로젝트</span>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                    <span className="max-w-[200px] truncate">{currentProjectId === 'all' ? '전체 프로젝트' : (currentProject?.name || '프로젝트 선택')}</span>
                    <ChevronDown size={14} className="text-stone-400" />
                  </div>
                  {currentProject?.ownerId && (currentProject.ownerId === user?.id || effectiveIsAdmin) && (
                    <span className="text-[9px] text-stone-400 truncate max-w-[200px] mt-0.5" title={profileMap[currentProject.ownerId] ?? currentProject.ownerId}>
                      {currentProject.ownerId === user?.id ? '내 프로젝트' : (profileMap[currentProject.ownerId] ?? '(알 수 없음)')}
                    </span>
                  )}
                </div>
              </button>

              {isProjectDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-left">
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wider" title="선택한 프로젝트의 작업만 표시합니다. 전체를 선택하면 모든 프로젝트를 한눈에 볼 수 있어요.">프로젝트 목록</div>
                      <div
                        className={cn(
                          "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                          currentProjectId === 'all' ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                        )}
                        onClick={() => {
                          setCurrentProjectId('all');
                          setIsProjectDropdownOpen(false);
                        }}
                        title="모든 프로젝트의 작업을 한 화면에서 확인합니다."
                      >
                        <span className="truncate flex-1">전체</span>
                        <span className="text-[10px] text-stone-400 shrink-0">({allTasks.length}개)</span>
                      </div>
                      <div className="h-px bg-stone-100 my-1 mx-2" />
                      {uniqueProjects.map(project => (
                        <div
                          key={project.id}
                          className={cn(
                            "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                            currentProjectId === project.id ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                          )}
                          onClick={() => {
                            setCurrentProjectId(project.id);
                            setIsProjectDropdownOpen(false);
                          }}
                        >
                          <div className="truncate flex-1 min-w-0 flex flex-col">
                            <span className="truncate flex items-center gap-1.5">
                              {project.name}
                              <span className="text-[10px] text-stone-400 shrink-0">({taskCountByProject[project.id] ?? 0}개)</span>
                            </span>
                            {effectiveIsAdmin && project.ownerId && (
                              <span className="text-[10px] text-stone-400 truncate mt-0.5" title={profileMap[project.ownerId] ?? project.ownerId}>
                                {project.ownerId === user?.id ? '내 프로젝트' : (profileMap[project.ownerId] ?? '(알 수 없음)')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setCurrentProjectId(project.id); setIsShareOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-teal-600 p-1 rounded" title="프로젝트 공유: 팀원을 초대하고 멤버를 관리합니다."><Share2 size={12} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setEditingProject(project); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-[var(--color-ink)] p-1 rounded" title="프로젝트 편집: 이름·설명·시작일·투입인원을 수정합니다."><Edit size={12} /></button>
                            {uniqueProjects.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setProjectToDelete(project);
                                  setIsProjectDropdownOpen(false);
                                  setIsDeleteProjectConfirmOpen(true);
                                }}
                                className="text-stone-400 hover:text-red-500 p-1 rounded"
                                title="프로젝트 삭제: 이 프로젝트와 소속된 모든 작업을 삭제합니다."
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      <button onClick={() => { setEditingProject(null); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors" title="새 프로젝트를 생성합니다.">
                        <FolderPlus size={14} /> 새 프로젝트
                      </button>
                      <button onClick={() => { setIsProjectDropdownOpen(false); setView('projects'); }} className="w-full text-left px-3 py-2 text-sm text-stone-500 hover:bg-stone-50 rounded-lg flex items-center gap-2 transition-colors" title="프로젝트 관리 페이지로 이동합니다.">
                        <Briefcase size={14} /> 프로젝트 관리
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          {/* 툴바: 되돌리기 / 다시실행 */}
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="실행 취소: 방금 한 작업을 되돌립니다. (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-[var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="다시 실행: 취소한 작업을 다시 적용합니다. (Ctrl+Shift+Z)"
            >
              <Redo2 size={16} />
            </button>
          </div>
          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />
          <div className="flex bg-slate-100/60 backdrop-blur-sm p-1 rounded-xl border border-slate-200/80 shadow-inner">
            <NavButton active={view === 'dashboard'} onClick={() => navigateWithTip('dashboard')} icon={<PieChart size={14} />} label="대시보드" title="프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다." />
            <NavButton active={view === 'projects'} onClick={() => navigateWithTip('projects')} icon={<Briefcase size={14} />} label="프로젝트" title="프로젝트 관리: 생성·편집·공유·일괄 삭제를 할 수 있습니다." />
            <NavButton active={view === 'list'} onClick={() => navigateWithTip('list')} icon={<List size={14} />} label="전체" title="표와 간트를 나란히 보며 작업을 편집하고 일정을 확인합니다. 가운데 바를 드래그해 폭을 조절할 수 있어요." />
            <NavButton active={view === 'table'} onClick={() => navigateWithTip('table')} icon={<Table size={14} />} label="표만" title="작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다." />
            <NavButton active={view === 'gantt'} onClick={() => navigateWithTip('gantt')} icon={<BarChart3 size={14} />} label="간트만" title="일정 막대를 드래그해 날짜를 조정하고, 선후관계·크리티컬 패스를 확인합니다." />
            <NavButton active={view === 'kanban'} onClick={() => navigateWithTip('kanban')} icon={<Columns size={14} />} label="칸반" title="상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다." />
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <div className="flex items-center">
            <button
              onClick={() => {
                setIsAIModalOpen(true);
                tipOnce('menu.ai', 'AI가 프로젝트 내용을 분석해 WBS를 생성합니다. 분석 중에는 창을 닫아도 백그라운드에서 계속 진행돼요.');
              }}
              className="p-2 hover:bg-stone-100 rounded-lg text-purple-500 hover:text-purple-600 transition-colors"
              title={isAIBusy ? "AI 분석 중: 백그라운드에서 진행됩니다. 완료 시 알림이 표시됩니다." : "AI 프로젝트 분석: 문서를 업로드하면 AI가 WBS 구조와 작업을 자동 생성합니다."}
            >
              {isAIBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            </button>
            {effectiveIsAdmin && (
              <button
                onClick={() => setIsMembersModalOpen(true)}
                className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-teal-600 transition-colors"
                title="회원 관리: 가입한 회원 목록을 확인합니다."
              >
                <Users size={15} />
              </button>
            )}
            <span
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-stone-500 bg-stone-50 rounded-lg border border-stone-100"
              title={`로그인: ${currentUserDisplay}${user?.email && currentUserDisplay !== user.email ? ` (${user.email})` : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden />
              {currentUserDisplay}
            </span>
            <button
              onClick={() => signOut()}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-red-500 transition-colors"
              title={`로그아웃 (${user?.email ?? '사용자'})`}
            >
              <LogOut size={15} />
            </button>
            <button
              onClick={() => {
                setIsSettingsModalOpen(true);
                tipOnce('menu.settings', '설정에서 WBS 표시, 상태/진척도, 표 컬럼(표시·순서) 등을 변경할 수 있어요.');
              }}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors"
              title="설정: 앱 제목, WBS 번호 형식, 상태/진척도, 표 컬럼 표시·순서, 크리티컬 패스 표시 등을 변경합니다."
            >
              <Settings2 size={15} />
            </button>
            {false && (
            <button
              onClick={() => {
                setIsTutorialOpen(true);
                tipOnce('menu.tutorial', '처음이라면 튜토리얼에서 기본 사용 흐름을 빠르게 익힐 수 있어요.');
              }}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors"
              title="사용법 튜토리얼 (F1 또는 ?)"
            >
              <HelpCircle size={15} />
            </button>
            )}
            <button
              onClick={() => {
                setIsShortcutsVisible(!isShortcutsVisible);
                tipOnce('menu.shortcuts', '단축키 패널을 켜/끄는 버튼입니다. (표: Ctrl+A → Del로 일괄 삭제)');
              }}
              className={cn(
                "p-2 hover:bg-stone-100 rounded-lg transition-colors",
                isShortcutsVisible ? "text-[var(--color-accent)] bg-blue-50" : "text-stone-400 hover:text-[var(--color-ink)]"
              )}
              title="단축키: 사용 가능한 키보드 단축키 목록을 표시합니다. (표에서 Ctrl+A 후 Del로 일괄 삭제 등)"
            >
              <Keyboard size={15} />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          {/* Filter On/Off Toggle */}
          <button
            onClick={() => {
              setFilterOn(v => !v);
              tipOnce('menu.filter', '필터를 켜면 상태/담당자/기간으로 작업을 좁혀 볼 수 있어요.');
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shrink-0",
              filterOn
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-stone-500 border-stone-200 hover:border-stone-400 hover:text-stone-700"
            )}
            title={filterOn ? "필터 끄기: 상태·담당자·기간 필터를 비활성화합니다." : "필터 켜기: 상태(할일/진행중/완료), 담당자, 기간, 마일스톤으로 작업을 좁혀 볼 수 있어요."}
          >
            <Filter size={14} />
            <span>필터</span>
            <span className={cn("text-[10px] opacity-80", !filterOn && "text-stone-400")}>{filterOn ? "On" : "Off"}</span>
          </button>

          <div className="flex gap-2">
            <div className="relative">
              <button
                onClick={() => {
                  setIsImportMenuOpen(!isImportMenuOpen);
                  tipOnce('menu.import', '가져오기: Excel/JSON 데이터를 불러와 작업을 추가하거나 복원할 수 있어요.');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[var(--color-line)] rounded-lg hover:bg-stone-50 transition-all"
                title="가져오기: Excel 또는 JSON 파일에서 작업 데이터를 불러옵니다."
              >
                <Upload size={13} /> <span>가져오기</span> <ChevronDown size={11} className="opacity-50" />
              </button>
              {isImportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsImportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-56 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50">
                    <button onClick={handleImportClick} className="w-full text-left px-4 py-2.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors" title="Excel(.xlsx) 파일에서 작업 목록을 가져와 현재 프로젝트에 추가합니다.">현재 작업 가져오기 (Excel)</button>
                    <button onClick={handleMergeImportClick} className="w-full text-left px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors border-t border-[var(--color-line)]" title="여러 JSON 백업 파일을 병합해 기존 프로젝트에 새 프로젝트를 추가합니다.">프로젝트 추가 가져오기 (JSON)</button>
                    <button onClick={handleImportBackupClick} className="w-full text-left px-4 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 transition-colors border-t border-[var(--color-line)]" title="전체 백업 JSON으로 모든 데이터를 복원합니다. 현재 데이터가 덮어씌워집니다.">전체 백업 데이터 가져오기 (JSON)</button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => {
                setIsExportModalOpen(true);
                tipOnce('menu.export', '내보내기: 범위와 파일 형식(Excel/JSON)을 선택할 수 있어요.');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[var(--color-line)] rounded-lg hover:bg-stone-50 transition-all"
              title="내보내기: 전체 또는 프로젝트 선택, Excel 또는 JSON 형식으로 저장합니다."
            >
              <Download size={13} /> <span>내보내기</span>
            </button>

            <button
              onClick={() => {
                setIsDeleteChoiceOpen(true);
                tipOnce('menu.deleteAll', '전체 삭제, 프로젝트 선택 삭제, 현재 프로젝트 작업만 삭제 중 선택할 수 있습니다.');
              }}
              className="p-2 hover:bg-red-50 rounded-lg text-red-300 hover:text-red-500 transition-colors"
              title="삭제: 전체 삭제, 프로젝트 선택 삭제, 현재 프로젝트 작업만 삭제 중 선택합니다."
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 hover:text-[var(--color-ink)] transition-colors"
            title={isFullscreen ? '전체화면 해제: 일반 화면으로 돌아갑니다.' : '전체화면: 헤더·푸터를 숨기고 작업 영역만 크게 표시합니다.'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={() => {
              setIsModalOpen(true);
              tipOnce('menu.newTask', '새 작업을 추가합니다. 표 화면에서는 Enter로도 빠르게 추가할 수 있어요.');
            }}
            className="btn-primary flex items-center gap-1.5"
            title="새 작업: 작업명, 기간, 공수, 담당자, 상태 등을 입력해 새 작업을 추가합니다. 표 화면에서는 Enter로도 추가할 수 있어요."
          >
            <Plus size={15} /> <span>새 작업</span>
          </button>
        </div>
      </header>
      )}

      {/* Filter bar: one row of buttons when filter is On */}
      {filterOn && !isFullscreen && view !== 'projects' && (
        <div className="bg-slate-50/80 backdrop-blur-md border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0 shadow-sm z-40">
          <span className="text-[11px] font-bold text-slate-500 shrink-0 mr-1 uppercase tracking-wide" title="상태별로 작업을 필터링합니다.">상태</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, status: 'all' }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.status === 'all' ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title="모든 상태의 작업 표시">전체</button>
            {wbsSettings.statusConfigs.map(config => (
              <button key={config.id} onClick={() => setFilters(f => ({ ...f, status: config.id }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.status === config.id ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title={`${config.name} 상태인 작업만 표시`}>{config.name}</button>
            ))}
          </div>
          <span className="text-[11px] font-bold text-stone-500 shrink-0 mx-2" title="담당자별로 작업을 필터링합니다.">담당자</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, assignee: '' }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", !filters.assignee ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title="모든 담당자의 작업 표시">전체</button>
            {allAssignees.map(a => (
              <button key={a} onClick={() => setFilters(f => ({ ...f, assignee: a }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.assignee === a ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title={`${a} 담당 작업만 표시`}>{a}</button>
            ))}
          </div>
          <span className="text-[11px] font-bold text-stone-500 shrink-0 mx-2" title="마일스톤(이정표) 작업만 보기">마일스톤</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, milestoneOnly: false }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap flex items-center gap-1", !filters.milestoneOnly ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title="모든 작업 표시">전체</button>
            <button onClick={() => setFilters(f => ({ ...f, milestoneOnly: true }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap flex items-center gap-1", filters.milestoneOnly ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title="마일스톤으로 지정된 이정표 작업만 표시"><Flag size={12} className="opacity-80" /> 마일스톤만</button>
          </div>
          <span className="text-[11px] font-bold text-stone-500 shrink-0 mx-2" title="기간별로 작업을 필터링합니다.">기간</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, startDate: '', endDate: '' }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", !filters.startDate && !filters.endDate ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")} title="기간 제한 없이 모든 작업 표시">전체</button>
            <button
              onClick={() => {
                const today = format(new Date(), 'yyyy-MM-dd');
                setFilters(f => ({ ...f, startDate: today, endDate: today }));
              }}
              className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.startDate && filters.endDate && filters.startDate === filters.endDate && filters.startDate === format(new Date(), 'yyyy-MM-dd') ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}
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
              className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.startDate && filters.endDate && filters.startDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') && filters.endDate === format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd') ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}
              title="이번 주(월~일)와 기간이 겹치는 작업만 표시"
            >
              금주
            </button>
          </div>
          {hasActiveFilters && (
            <button onClick={() => setFilters(f => ({ ...f, status: 'all', assignee: '', startDate: '', endDate: '', milestoneOnly: false }))} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all shrink-0 ml-auto">
              <X size={10} /> 초기화
            </button>
          )}
        </div>
      )}

      {isFullscreen && (
        <div className="absolute top-2 right-2 z-[60] flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(false)}
            className="px-3 py-1.5 rounded-lg bg-white/90 shadow border border-stone-200 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            전체화면 해제
          </button>
        </div>
      )}
      <main className={cn("flex-1 overflow-hidden flex flex-row relative", isFullscreen && "fixed inset-0 z-50 bg-white")}>
        <div className="flex-1 min-w-0 relative bg-white">
          {view === 'list' ? (
            <div ref={containerRef} className={cn("relative flex h-full w-full", isDraggingResizer && "cursor-col-resize select-none")}>
              <div className="flex-shrink-0 overflow-hidden h-full flex flex-col" style={{ width: `${wbsTableWidth}%` }}>
                <WBSTable
                  filters={effectiveFilters}
                  sortConfig={sortConfig}
                  syncScrollRef={wbsScrollRef}
                  onRowHeightChange={setSharedRowHeight}
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
                className="absolute top-0 bottom-0 w-1 bg-stone-200 hover:bg-blue-400 cursor-col-resize transition-all z-10"
                style={{ left: `calc(${wbsTableWidth}% - 2px)` }}
                onMouseDown={startResizing}
              />
              <div className="flex-shrink-0 overflow-hidden bg-stone-50/30" style={{ width: `${100 - wbsTableWidth}%` }}>
                <GanttChart filters={effectiveFilters} sortConfig={sortConfig} hideSidebar={true} rowHeight={sharedRowHeight} syncScrollRef={ganttScrollRef} />
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
          ) : (
            <KanbanBoard filters={effectiveFilters} />
          )}
        </div>
        {isShortcutsVisible && <ShortcutsSidebar onClose={() => setIsShortcutsVisible(false)} />}
      </main>

      <TaskModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveTask} parentOptions={tasks} />
      <ProjectModal isOpen={isProjectModalOpen} onClose={() => { setIsProjectModalOpen(false); setEditingProject(null); }} onSave={handleSaveProject} project={editingProject} />
      <WBSSettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
      <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
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
            addTasks(newTasks);
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

      {/* 삭제 유형 선택: 전체 삭제 / 프로젝트 선택 삭제 / 현재 프로젝트 작업 삭제 */}
      {isDeleteChoiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-red-500" size={20} />
                <h2 className="text-lg font-bold text-[var(--color-ink)]">삭제 유형 선택</h2>
              </div>
              <button onClick={() => setIsDeleteChoiceOpen(false)} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
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
                  <span className="block text-xs text-red-600 mt-0.5">모든 프로젝트의 작업을 전체 삭제합니다. 프로젝트는 유지됩니다.</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleteChoiceOpen(false);
                    setIsDeleteEverythingConfirmOpen(true);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border-2 border-red-300 bg-red-100/80 hover:bg-red-200 text-red-800 font-medium text-sm transition-colors"
                >
                  <span className="block font-semibold">프로젝트 유지 없이 모두 삭제</span>
                  <span className="block text-xs text-red-700 mt-0.5">모든 프로젝트와 작업을 삭제하고, 새 프로젝트 1개만 생성합니다.</span>
                </button>
                {projects.length > 1 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 mt-3">프로젝트 선택해서 삭제</p>
                    {projects.map((project) => (
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
                              소유: {project.ownerId === user?.id ? '내 프로젝트' : (profileMap[project.ownerId] ?? '(알 수 없음)')}
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
      <ConfirmDialog isOpen={isDeleteAllProjectsConfirmOpen} onClose={() => setIsDeleteAllProjectsConfirmOpen(false)} onConfirm={handleDeleteAllProjects} title="전체 삭제" message="모든 프로젝트의 작업을 전체 삭제하시겠습니까? 프로젝트는 유지됩니다." confirmLabel="전체 삭제" isDanger={true} />
      <ConfirmDialog isOpen={isDeleteEverythingConfirmOpen} onClose={() => setIsDeleteEverythingConfirmOpen(false)} onConfirm={handleDeleteEverything} title="프로젝트 유지 없이 모두 삭제" message="모든 프로젝트와 작업을 삭제하고 새 프로젝트 1개만 생성합니다. 이 작업은 되돌릴 수 없습니다." confirmLabel="모두 삭제" isDanger={true} />
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
      />
      <ConfirmDialog isOpen={backupConfirm.isOpen} onClose={() => setBackupConfirm({ ...backupConfirm, isOpen: false })} onConfirm={executeRestoreBackup} title="전체 백업 복원" message="애플리케이션의 현재 모든 데이터가 백업 내용으로 덮어씌워집니다." confirmLabel="전체 복원" isDanger={true} />
      <ConfirmDialog isOpen={multiMergeConfirm.isOpen} onClose={() => setMultiMergeConfirm({ ...multiMergeConfirm, isOpen: false })} onConfirm={executeMultiMerge} title="다중 프로젝트 가져오기" message={`선택한 ${multiMergeConfirm.fileCount}개의 파일을 가져오시겠습니까?`} confirmLabel="가져오기" isDanger={false} />
      <ConfirmDialog isOpen={errorAlert.isOpen} onClose={() => setErrorAlert({ isOpen: false, message: '' })} onConfirm={() => setErrorAlert({ isOpen: false, message: '' })} title="오류" message={errorAlert.message} confirmLabel="확인" isDanger={false} />
      <ShareModal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} projectId={currentProject?.id} projectName={currentProject?.name} isOwner={currentProject?.ownerId === user?.id} />
      <MembersModal
        isOpen={isMembersModalOpen}
        onClose={() => setIsMembersModalOpen(false)}
        currentUserId={user?.id}
        onDeleted={() => pushToast('회원이 삭제되었습니다.', { variant: 'success' })}
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
      <footer className="bg-white border-t border-[var(--color-line)] p-4 text-center mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-bold text-stone-500">지엠티 운영기술개발실</p>
          </div>
          <p className="text-[10px] text-stone-400 font-medium whitespace-nowrap">© 2026 GMT Corporation. All rights reserved.</p>
        </div>
      </footer>
      )}
    </div>
  );
}

function AppWithProviders() {
  const { user, loading } = useAuth();
  const { push: pushToast } = useToast();

  if (!isSupabaseConfigured) {
    return <SupabaseSetupScreen />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-900">
        <div className="text-white/80 text-sm">로딩 중...</div>
      </div>
    );
  }
  if (!user) {
    return <LoginScreen />;
  }
  return (
    <WBSProvider
      onConcurrentConflict={() => pushToast('다른 사용자가 수정했습니다. 새로고침됩니다.', { variant: 'warning' })}
      onDbError={(msg) => pushToast(msg, { variant: 'error' })}
    >
      <WBSApp />
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
