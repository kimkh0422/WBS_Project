import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WBSTable } from './components/WBSTable';
import { GanttChart } from './components/GanttChart';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { WBSProvider, useWBS } from './context/WBSContext';
import { List, Plus, Download, Upload, ChevronDown, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2, PieChart, Loader2, Check, MessageSquare, Tag, Table, BarChart3, HelpCircle } from 'lucide-react';
import { cn } from './lib/utils';
import { Task, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcelWithMeta, ExcelImportMeta } from './lib/excel';
import { exportBackupToJson, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { Dashboard } from './components/Dashboard';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { WBSSettingsModal } from './components/WBSSettingsModal';
import { VersionManager } from './components/VersionManager';
import { PasswordGuard } from './components/PasswordGuard';
import { TutorialModal } from './components/TutorialModal';
import { ToastProvider, useToast } from './components/Toast';
import { ExcelImportPreviewModal } from './components/ExcelImportPreviewModal';
import { v4 as uuidv4 } from 'uuid';

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
  const [view, setView] = useState<'list' | 'table' | 'gantt' | 'kanban' | 'dashboard'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isAIBusy, setIsAIBusy] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isShortcutsVisible, setIsShortcutsVisible] = useState(true);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [isDeleteProjectConfirmOpen, setIsDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<any>(null);
  const [editingProject, setEditingProject] = useState<any>(null);

  const {
    addTask,
    addTasks,
    tasks,
    importTasks,
    projects,
    currentProjectId,
    setCurrentProjectId,
    addProject,
    updateProject,
    deleteProject,
    deleteAllTasks,
    wbsMap,
    restoreBackup,
    mergeBackups,
    exportFullBackup,
    undo,
    canUndo,
    wbsSettings,
    expandToLevel,
    setTreeExpandLevel,
  } = useWBS();

  const { push: pushToast, tipOnce } = useToast();
  const prevAIBusyRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll sync refs for split-view
  const wbsScrollRef = useRef<HTMLDivElement>(null);
  const ganttScrollRef = useRef<HTMLDivElement>(null);
  const [sharedRowHeight, setSharedRowHeight] = useState(34);
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
    const handleUndo = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleUndo);
    return () => window.removeEventListener('keydown', handleUndo);
  }, [undo]);

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
  });

  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);

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

  const handleSaveProject = (name: string, description: string, startDate?: string) => {
    if (editingProject) {
      updateProject(editingProject.id, { name, description, startDate });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate);
    }
    setIsProjectModalOpen(false);
  };

  const handleDeleteAll = () => {
    deleteAllTasks();
    setIsDeleteAllConfirmOpen(false);
  };

  const handleDeleteProject = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    }
    setIsDeleteProjectConfirmOpen(false);
  };

  const handleExport = () => {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = currentProject
      ? `wbs_${currentProject.name.replace(/\s+/g, '_')}_${timestamp}.xlsx`
      : `wbs_export_${timestamp}.xlsx`;
    exportToExcel(tasks, wbsMap, fileName);
  };

  const handleExportBackup = () => {
    const backupData = exportFullBackup();
    const fileName = currentProject
      ? `wbs_${currentProject.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`
      : `wbs_full_backup_${new Date().toISOString().split('T')[0]}.json`;
    exportBackupToJson(backupData, fileName);
    setIsExportMenuOpen(false);
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
    setView(newView);
    setFilters(prev => ({ ...prev, ...newFilters }));
    if (newFilters.projectId && newFilters.projectId !== 'all') {
      setCurrentProjectId(newFilters.projectId);
    }
  };

  const hasActiveFilters = filterOn && (filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate);
  const allAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));
  const effectiveFilters: FilterState = filterOn ? filters : { ...filters, status: 'all', assignee: '', startDate: '', endDate: '' };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)]">
      <header className="bg-white border-b border-[var(--color-line)] px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm z-50 sticky top-0">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => window.location.reload()}
            title="새로고침"
          >
            <img src="/src/assets/logo.png" alt="GMT Logo" className="w-8 h-8 object-contain" />
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
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider leading-none mb-1">현재 프로젝트</span>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                    <span className="max-w-[200px] truncate">{currentProjectId === 'all' ? '전체 프로젝트' : (currentProject?.name || '프로젝트 선택')}</span>
                    <ChevronDown size={14} className="text-stone-400" />
                  </div>
                </div>
              </button>

              {isProjectDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-left">
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wider">프로젝트 목록</div>
                      <div
                        className={cn(
                          "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                          currentProjectId === 'all' ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                        )}
                        onClick={() => {
                          setCurrentProjectId('all');
                          setIsProjectDropdownOpen(false);
                        }}
                      >
                        <span className="truncate flex-1">전체</span>
                      </div>
                      <div className="h-px bg-stone-100 my-1 mx-2" />
                      {projects.map(project => (
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
                          <span className="truncate flex-1">{project.name}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); setEditingProject(project); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-[var(--color-ink)] p-1"><Edit size={12} /></button>
                            {projects.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setProjectToDelete(project);
                                  setIsDeleteProjectConfirmOpen(true);
                                }}
                                className="text-stone-400 hover:text-red-500 p-1"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      <button onClick={() => { setEditingProject(null); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors">
                        <FolderPlus size={14} /> 새 프로젝트
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          <div className="flex bg-stone-100 p-0.5 rounded-lg border border-[var(--color-line)]">
            <NavButton active={view === 'dashboard'} onClick={() => navigateWithTip('dashboard')} icon={<PieChart size={14} />} label="대시보드" />
            <NavButton active={view === 'list'} onClick={() => navigateWithTip('list')} icon={<List size={14} />} label="전체" title="표 + 간트 분할 보기" />
            <NavButton active={view === 'table'} onClick={() => navigateWithTip('table')} icon={<Table size={14} />} label="표만" title="표만 보기" />
            <NavButton active={view === 'gantt'} onClick={() => navigateWithTip('gantt')} icon={<BarChart3 size={14} />} label="간트만" title="간트차트만 보기" />
            <NavButton active={view === 'kanban'} onClick={() => navigateWithTip('kanban')} icon={<Columns size={14} />} label="칸반" />
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <div className="flex items-center">
            <button
              onClick={() => {
                setIsAIModalOpen(true);
                tipOnce('menu.ai', 'AI가 프로젝트 내용을 분석해 WBS를 생성합니다. 분석 중에는 창을 닫아도 백그라운드에서 계속 진행돼요.');
              }}
              className="p-2 hover:bg-stone-100 rounded-lg text-purple-500 hover:text-purple-600 transition-colors"
              title={isAIBusy ? "AI 분석 중 (백그라운드)" : "AI 프로젝트 분석"}
            >
              {isAIBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            </button>
            <button
              onClick={() => {
                setIsSettingsModalOpen(true);
                tipOnce('menu.settings', '설정에서 WBS 표시, 상태/진척도, 표 컬럼(표시·순서) 등을 변경할 수 있어요.');
              }}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors"
              title="설정"
            >
              <Settings2 size={15} />
            </button>
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
            <button
              onClick={() => {
                setIsShortcutsVisible(!isShortcutsVisible);
                tipOnce('menu.shortcuts', '단축키 패널을 켜/끄는 버튼입니다. (표: Ctrl+A → Del로 일괄 삭제)');
              }}
              className={cn(
                "p-2 hover:bg-stone-100 rounded-lg transition-colors",
                isShortcutsVisible ? "text-[var(--color-accent)] bg-blue-50" : "text-stone-400 hover:text-[var(--color-ink)]"
              )}
              title="단축키 표시 설정"
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
            title={filterOn ? "필터 끄기" : "필터 켜기"}
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
              >
                <Upload size={13} /> <span>가져오기</span> <ChevronDown size={11} className="opacity-50" />
              </button>
              {isImportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsImportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50">
                    <button onClick={handleImportClick} className="w-full text-left px-4 py-2.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors">현재 작업 가져오기 (Excel)</button>
                    <button onClick={handleMergeImportClick} className="w-full text-left px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors border-t border-[var(--color-line)]">프로젝트 추가 가져오기 (JSON)</button>
                    <button onClick={handleImportBackupClick} className="w-full text-left px-4 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 transition-colors border-t border-[var(--color-line)]">전체 백업 데이터 가져오기 (JSON)</button>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setIsExportMenuOpen(!isExportMenuOpen);
                  tipOnce('menu.export', '내보내기: Excel로 내보내거나 전체 데이터를 JSON 백업으로 저장할 수 있어요.');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[var(--color-line)] rounded-lg hover:bg-stone-50 transition-all"
              >
                <Download size={13} /> <span>내보내기</span> <ChevronDown size={11} className="opacity-50" />
              </button>
              {isExportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50">
                    <button onClick={() => { handleExport(); setIsExportMenuOpen(false); }} className="w-full text-left px-4 py-2.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors">현재 프로젝트 내보내기 (Excel)</button>
                    <button onClick={handleExportBackup} className="w-full text-left px-4 py-2.5 text-xs text-[var(--color-accent)] hover:bg-blue-50 transition-colors border-t border-[var(--color-line)]">전체 데이터 백업 (JSON)</button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => {
                setIsDeleteAllConfirmOpen(true);
                tipOnce('menu.deleteAll', '모든 작업 삭제는 현재 프로젝트의 작업을 전체 삭제합니다. (되돌리기: Ctrl+Z)');
              }}
              className="p-2 hover:bg-red-50 rounded-lg text-red-300 hover:text-red-500 transition-colors"
              title="모든 작업 삭제"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <button
            onClick={() => {
              setIsModalOpen(true);
              tipOnce('menu.newTask', '새 작업을 추가합니다. 표 화면에서는 Enter로도 빠르게 추가할 수 있어요.');
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-[var(--color-ink)] text-white rounded-lg hover:bg-stone-800 transition-all shadow-sm"
          >
            <Plus size={15} /> <span>새 작업</span>
          </button>
        </div>
      </header>

      {/* Filter bar: one row of buttons when filter is On */}
      {filterOn && (
        <div className="bg-white border-b border-[var(--color-line)] px-4 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
          <span className="text-[11px] font-bold text-stone-500 shrink-0 mr-1">상태</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, status: 'all' }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.status === 'all' ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}>전체</button>
            {wbsSettings.statusConfigs.map(config => (
              <button key={config.id} onClick={() => setFilters(f => ({ ...f, status: config.id }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.status === config.id ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}>{config.name}</button>
            ))}
          </div>
          <span className="text-[11px] font-bold text-stone-500 shrink-0 mx-2">담당자</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setFilters(f => ({ ...f, assignee: '' }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", !filters.assignee ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}>전체</button>
            {allAssignees.map(a => (
              <button key={a} onClick={() => setFilters(f => ({ ...f, assignee: a }))} className={cn("px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap", filters.assignee === a ? "bg-blue-600 text-white border-blue-600" : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100")}>{a}</button>
            ))}
          </div>
          {hasActiveFilters && (
            <button onClick={() => setFilters(f => ({ ...f, status: 'all', assignee: '', startDate: '', endDate: '' }))} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all shrink-0 ml-auto">
              <X size={10} /> 초기화
            </button>
          )}
        </div>
      )}

      <main className="flex-1 overflow-hidden flex flex-row relative">
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
            <GanttChart filters={effectiveFilters} sortConfig={sortConfig} />
          ) : view === 'dashboard' ? (
            <Dashboard onNavigate={handleDashboardNavigate} />
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
            importTasks(newTasks);
          } else {
            addTasks(newTasks);
          }
        }}
        currentProjectId={currentProjectId}
        existingTasks={tasks}
      />
      <VersionManager
        isOpen={isVersionHistoryOpen}
        onClose={() => setIsVersionHistoryOpen(false)}
        currentVersion={__APP_VERSION__}
      />

      <ConfirmDialog isOpen={isDeleteAllConfirmOpen} onClose={() => setIsDeleteAllConfirmOpen(false)} onConfirm={handleDeleteAll} title="모든 작업 삭제" message={`'${currentProject?.name}' 프로젝트의 모든 작업을 삭제하시겠습니까?`} confirmLabel="전체 삭제" isDanger={true} />
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

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls, .xlsm" multiple className="hidden" />
      <input type="file" ref={backupInputRef} onChange={handleBackupFileChange} accept=".json" multiple className="hidden" />
      <input type="file" ref={mergeInputRef} onChange={handleMergeFileChange} accept=".json" multiple className="hidden" />

      <footer className="bg-white border-t border-[var(--color-line)] p-4 text-center mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-bold text-stone-500">지엠티 운영기술개발실</p>
          </div>
          <p className="text-[10px] text-stone-400 font-medium whitespace-nowrap">© 2026 GMT Corporation. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WBSProvider>
      <ToastProvider>
        <PasswordGuard>
          <WBSApp />
        </PasswordGuard>
      </ToastProvider>
    </WBSProvider>
  );
}
