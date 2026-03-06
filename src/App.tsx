import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WBSTable } from './components/WBSTable';
import { GanttChart } from './components/GanttChart';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { WBSProvider, useWBS } from './context/WBSContext';
import { List, Plus, Download, Upload, ChevronDown, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2, PieChart, Loader2, Check, MessageSquare, Tag, Table, BarChart3 } from 'lucide-react';
import { cn } from './lib/utils';
import { Task, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcel } from './lib/excel';
import { exportBackupToJson, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { Dashboard } from './components/Dashboard';
import { ShortcutsSidebar } from './components/ShortcutsSidebar';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { WBSSettingsModal } from './components/WBSSettingsModal';
import { VersionManager } from './components/VersionManager';
import { PasswordGuard } from './components/PasswordGuard';

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
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
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

  const [importConfirm, setImportConfirm] = useState<{ isOpen: boolean; tasks: Task[] }>({
    isOpen: false,
    tasks: [],
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
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const importedTasks = await parseExcel(file as any);
      setImportConfirm({ isOpen: true, tasks: importedTasks });
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
    importTasks(importConfirm.tasks);
    setImportConfirm({ isOpen: false, tasks: [] });
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
            </div>

            <div className="relative mt-1 group">
              <button
                onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
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
            <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<PieChart size={14} />} label="대시보드" />
            <NavButton active={view === 'list'} onClick={() => setView('list')} icon={<List size={14} />} label="전체" title="표 + 간트 분할 보기" />
            <NavButton active={view === 'table'} onClick={() => setView('table')} icon={<Table size={14} />} label="표만" title="표만 보기" />
            <NavButton active={view === 'gantt'} onClick={() => setView('gantt')} icon={<BarChart3 size={14} />} label="간트만" title="간트차트만 보기" />
            <NavButton active={view === 'kanban'} onClick={() => setView('kanban')} icon={<Columns size={14} />} label="칸반" />
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <div className="flex items-center">
            <button
              onClick={() => setIsAIModalOpen(true)}
              className="p-2 hover:bg-stone-100 rounded-lg text-purple-500 hover:text-purple-600 transition-colors"
              title="AI 프로젝트 분석"
            >
              <Sparkles size={16} />
            </button>
            <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors" title="설정"><Settings2 size={15} /></button>
            <button
              onClick={() => setIsShortcutsVisible(!isShortcutsVisible)}
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
            onClick={() => setFilterOn(v => !v)}
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
                onClick={() => setIsImportMenuOpen(!isImportMenuOpen)}
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
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
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

            <button onClick={() => setIsDeleteAllConfirmOpen(true)} className="p-2 hover:bg-red-50 rounded-lg text-red-300 hover:text-red-500 transition-colors" title="모든 작업 삭제"><Trash2 size={15} /></button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-[var(--color-ink)] text-white rounded-lg hover:bg-stone-800 transition-all shadow-sm">
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
      <AIAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
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
      <VersionManager isOpen={isVersionHistoryOpen} onClose={() => setIsVersionHistoryOpen(false)} currentVersion="1.2.0" />

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
      <ConfirmDialog isOpen={importConfirm.isOpen} onClose={() => setImportConfirm({ ...importConfirm, isOpen: false })} onConfirm={executeImport} title="데이터 가져오기" message={`${importConfirm.tasks.length}개의 작업을 가져오시겠습니까?`} confirmLabel="가져오기" isDanger={true} />
      <ConfirmDialog isOpen={backupConfirm.isOpen} onClose={() => setBackupConfirm({ ...backupConfirm, isOpen: false })} onConfirm={executeRestoreBackup} title="전체 백업 복원" message="애플리케이션의 현재 모든 데이터가 백업 내용으로 덮어씌워집니다." confirmLabel="전체 복원" isDanger={true} />
      <ConfirmDialog isOpen={multiMergeConfirm.isOpen} onClose={() => setMultiMergeConfirm({ ...multiMergeConfirm, isOpen: false })} onConfirm={executeMultiMerge} title="다중 프로젝트 가져오기" message={`선택한 ${multiMergeConfirm.fileCount}개의 파일을 가져오시겠습니까?`} confirmLabel="가져오기" isDanger={false} />
      <ConfirmDialog isOpen={errorAlert.isOpen} onClose={() => setErrorAlert({ isOpen: false, message: '' })} onConfirm={() => setErrorAlert({ isOpen: false, message: '' })} title="오류" message={errorAlert.message} confirmLabel="확인" isDanger={false} />

      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
      <input type="file" ref={backupInputRef} onChange={handleBackupFileChange} accept=".json" multiple className="hidden" />
      <input type="file" ref={mergeInputRef} onChange={handleMergeFileChange} accept=".json" multiple className="hidden" />

      <footer className="bg-white border-t border-[var(--color-line)] p-4 text-center mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-bold text-stone-500">지엠티 운영기술개발실</p>
            <div className="h-3 w-px bg-stone-200" />
            <button
              onClick={() => setIsVersionHistoryOpen(true)}
              className="text-[10px] font-mono text-stone-400 hover:text-blue-500 hover:bg-blue-50 px-1.5 py-0.5 rounded transition-all flex items-center gap-1.5 group"
            >
              <Tag size={10} className="text-stone-300 group-hover:text-blue-400" />
              <span>v1.2.0</span>
            </button>
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
      <PasswordGuard>
        <WBSApp />
      </PasswordGuard>
    </WBSProvider>
  );
}
