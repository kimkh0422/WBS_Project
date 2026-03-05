import React, { useState, useRef, useEffect, useCallback } from 'react';
import { WBSTable } from './components/WBSTable';
import { GanttChart } from './components/GanttChart';
import { KanbanBoard } from './components/KanbanBoard';
import { TaskModal } from './components/TaskModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ProjectModal } from './components/ProjectModal';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { WBSProvider, useWBS } from './context/WBSContext';
import { List, Plus, Download, Upload, ChevronDown, FolderPlus, Trash2, X, Filter, Briefcase, Keyboard, Columns, Sparkles, Edit, Settings2 } from 'lucide-react';
import { cn } from './lib/utils';
import { Task, FilterState, TaskStatus, SortConfig } from './types';
import { exportToExcel, parseExcel } from './lib/excel';
import { exportBackupToJson, parseBackupJson, parseMultipleBackupJsons, BackupData } from './lib/export';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { WBSSettingsModal } from './components/WBSSettingsModal';

function WBSApp() {
  const [view, setView] = useState<'list' | 'gantt' | 'kanban'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
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
    canUndo
  } = useWBS();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resizable Panes State
  const [wbsTableWidth, setWbsTableWidth] = useState(50);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);

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

        // Constrain width between 20% and 80%
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
        // Only undo if no input/textarea is focused
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleUndo);
    return () => window.removeEventListener('keydown', handleUndo);
  }, [undo]);

  // Filter State
  const [filters, setFilters] = useState<FilterState>({
    status: 'all',
    assignee: '',
    startDate: '',
    endDate: '',
  });

  // Sort State
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const handleSort = (key: keyof Task) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        if (current.direction === 'asc') return { key, direction: 'desc' };
        return null; // Reset
      }
      return { key, direction: 'asc' };
    });
  };

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);

  // Import Confirmation State
  const [importConfirm, setImportConfirm] = useState<{ isOpen: boolean; tasks: Task[] }>({
    isOpen: false,
    tasks: [],
  });

  const [backupConfirm, setBackupConfirm] = useState<{ isOpen: boolean; data: BackupData | null }>({
    isOpen: false,
    data: null,
  });

  const [mergeConfirm, setMergeConfirm] = useState<{ isOpen: boolean; backups: BackupData[]; summary: { projects: number; tasks: number } }>({
    isOpen: false,
    backups: [],
    summary: { projects: 0, tasks: 0 },
  });

  const [multiMergeConfirm, setMultiMergeConfirm] = useState<{ isOpen: boolean; dataArray: BackupData[]; fileCount: number }>({
    isOpen: false,
    dataArray: [],
    fileCount: 0,
  });

  // Error Alert State
  const [errorAlert, setErrorAlert] = useState<{ isOpen: boolean; message: string }>({
    isOpen: false,
    message: '',
  });

  const currentProject = projects.find(p => p.id === currentProjectId);

  const handleSaveTask = (taskData: any) => {
    addTask(taskData);
  };

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

  const handleMergeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const parsedDataArray = await parseMultipleBackupJsons(files);
      setMultiMergeConfirm({
        isOpen: true,
        dataArray: parsedDataArray,
        fileCount: files.length,
      });
    } catch (error: any) {
      console.error(error);
      setErrorAlert({
        isOpen: true,
        message: error.message || '백업 파일을 읽는 중 오류가 발생했습니다.\n유효한 JSON 백업 파일인지 확인해주세요.',
      });
    } finally {
      if (mergeInputRef.current) mergeInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const importedTasks = await parseExcel(file);
      setImportConfirm({
        isOpen: true,
        tasks: importedTasks,
      });
    } catch (error) {
      console.error(error);
      setErrorAlert({
        isOpen: true,
        message: '파일을 읽는 중 오류가 발생했습니다.\n올바른 엑셀 파일인지 확인해주세요.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      if (files.length === 1) {
        // Single file: full restore behavior
        const parsedData = await parseBackupJson(files[0]);
        setBackupConfirm({ isOpen: true, data: parsedData });
      } else {
        // Multiple files: merge as separate projects
        const parsedDataArray = await parseMultipleBackupJsons(files);
        setMultiMergeConfirm({
          isOpen: true,
          dataArray: parsedDataArray,
          fileCount: files.length,
        });
      }
    } catch (error: any) {
      console.error(error);
      setErrorAlert({
        isOpen: true,
        message: error.message || '백업 파일을 읽는 중 오류가 발생했습니다.\n유효한 JSON 백업 파일인지 확인해주세요.',
      });
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const executeMergeImport = () => {
    mergeBackups(mergeConfirm.backups);
    setMergeConfirm({ isOpen: false, backups: [], summary: { projects: 0, tasks: 0 } });
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
    if (backupConfirm.data) {
      restoreBackup(backupConfirm.data);
    }
    setBackupConfirm({ isOpen: false, data: null });
  };

  const hasActiveFilters = filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate;
  const allAssignees = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean)));

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] font-sans text-[var(--color-ink)]">
      {/* Top Bar */}
      <header className="bg-white border-b border-[var(--color-line)] px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm z-50 sticky top-0">
        <div className="flex items-center gap-4">
          <div className="bg-[var(--color-ink)] text-white p-2 rounded-lg">
            <Briefcase size={20} />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight leading-none">지엠티 WBS 매니저</h1>
              <span className="text-[10px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                v{__APP_VERSION__}
              </span>
            </div>

            <div className="relative mt-1">
              <button
                onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                className="flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-[var(--color-ink)] transition-colors"
              >
                <span>{currentProject?.name || '프로젝트 선택'}</span>
                <ChevronDown size={12} />
              </button>

              {/* Dropdown Menu */}
              {isProjectDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsProjectDropdownOpen(false)}
                  ></div>
                  <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-left">
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wider">프로젝트 목록</div>
                      {projects.map(project => (
                        <div
                          key={project.id}
                          className={cn(
                            "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                            currentProjectId === project.id
                              ? "bg-stone-100 text-[var(--color-ink)] font-medium"
                              : "text-stone-600 hover:bg-stone-50"
                          )}
                          onClick={() => {
                            setCurrentProjectId(project.id);
                            setIsProjectDropdownOpen(false);
                          }}
                        >
                          <span className="truncate flex-1">{project.name}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProject(project);
                                setIsProjectModalOpen(true);
                                setIsProjectDropdownOpen(false);
                              }}
                              className="text-stone-400 hover:text-[var(--color-ink)] p-1"
                              title="프로젝트 수정"
                            >
                              <Edit size={12} />
                            </button>
                            {projects.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteProject(project.id);
                                }}
                                className="text-stone-400 hover:text-red-500 p-1"
                                title="프로젝트 삭제"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      <button
                        onClick={() => {
                          setEditingProject(null);
                          setIsProjectModalOpen(true);
                          setIsProjectDropdownOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors"
                      >
                        <FolderPlus size={14} />
                        새 프로젝트
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          {/* View Switcher */}
          <div className="flex bg-stone-100 p-0.5 rounded-lg border border-[var(--color-line)]">
            {([
              { key: 'list', icon: <List size={14} />, label: '목록', title: '리스트 뷰' },
              { key: 'kanban', icon: <Columns size={14} />, label: '칸반', title: '칸반 보드' },
            ] as const).map(({ key, icon, label, title }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  "px-2.5 py-1.5 rounded-md transition-all text-xs font-medium flex items-center gap-1.5",
                  view === key ? "bg-white shadow-sm text-[var(--color-ink)]" : "text-stone-500 hover:text-[var(--color-ink)]"
                )}
                title={title}
              >
                {icon}
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          {/* Utility icon buttons */}
          <div className="flex items-center">
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors"
              title="WBS ID 설정"
            >
              <Settings2 size={15} />
            </button>
            <button
              onClick={() => setIsShortcutsOpen(true)}
              className="p-2 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-[var(--color-ink)] transition-colors"
              title="키보드 단축키"
            >
              <Keyboard size={15} />
            </button>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={cn(
                "p-2 hover:bg-stone-100 rounded-lg transition-colors relative",
                hasActiveFilters ? "text-[var(--color-accent)]" : "text-stone-400 hover:text-[var(--color-ink)]"
              )}
              title="필터"
            >
              <Filter size={15} />
              {hasActiveFilters && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              )}
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx, .xls" className="hidden" />
          <input type="file" ref={backupInputRef} onChange={handleBackupFileChange} accept=".json" className="hidden" />

          <button
            onClick={() => setIsShortcutsOpen(true)}
            className="btn-secondary flex items-center gap-2"
            title="키보드 단축키"
          >
            <Keyboard size={14} />
            <span className="hidden sm:inline">단축키</span>
          </button>

          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={cn(
              "btn-secondary flex items-center gap-2",
              (isFilterOpen || hasActiveFilters) && "bg-stone-100 border-stone-300"
            )}
          >
            <Filter size={14} />
            <span className="hidden sm:inline">필터</span>
            {hasActiveFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"></span>
            )}
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx, .xls"
            className="hidden"
          />
          <input
            type="file"
            ref={backupInputRef}
            onChange={handleBackupFileChange}
            accept=".json"
            multiple
            className="hidden"
          />
          <input
            type="file"
            ref={mergeInputRef}
            onChange={handleMergeFileChange}
            accept=".json"
            multiple
            className="hidden"
          />

          <div className="flex gap-2">
            <div className="relative">
              <button
                onClick={() => setIsImportMenuOpen(!isImportMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[var(--color-line)] text-stone-600 hover:bg-stone-50 rounded-lg transition-all active:scale-95"
              >
                <Upload size={13} />
                <span>가져오기</span>
                <ChevronDown size={11} className="opacity-50" />
              </button>
              {isImportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsImportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                    <button onClick={handleImportClick} className="w-full text-left px-4 py-2.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors">
                      현재 작업 가져오기 (Excel)
                    </button>
                    <button
                      onClick={handleMergeImportClick}
                      className="w-full text-left px-4 py-2 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors border-t border-[var(--color-line)]"
                    >
                      프로젝트 추가 가져오기 (JSON)
                    </button>
                    <button
                      onClick={handleImportBackupClick}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 transition-colors border-t border-[var(--color-line)]"
                    >
                      JSON 파일 가져오기 (다중 선택 가능)
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[var(--color-line)] text-stone-600 hover:bg-stone-50 rounded-lg transition-all active:scale-95"
              >
                <Download size={13} />
                <span>내보내기</span>
                <ChevronDown size={11} className="opacity-50" />
              </button>
              {isExportMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)}></div>
                  <div className="absolute top-full right-0 mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-[var(--color-line)] overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                    <button
                      onClick={() => { handleExport(); setIsExportMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors"
                    >
                      현재 프로젝트 (Excel)
                    </button>
                    <button onClick={handleExportBackup} className="w-full text-left px-4 py-2.5 text-xs text-[var(--color-accent)] hover:bg-blue-50 transition-colors border-t border-[var(--color-line)]">
                      전체 데이터 백업 (JSON)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setIsDeleteAllConfirmOpen(true)}
              className="p-2 hover:bg-red-50 rounded-lg text-red-300 hover:text-red-500 transition-colors"
              title="모든 작업 삭제"
            >
              <Trash2 size={15} />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--color-line)] mx-0.5" />

          {/* AI Analysis */}
          <button
            onClick={() => setIsAIModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors"
            title="AI 분석"
          >
            <Sparkles size={13} />
            <span>AI 분석</span>
          </button>

          {/* Primary CTA */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-[var(--color-ink)] text-white rounded-lg hover:bg-stone-800 transition-all active:scale-95 shadow-sm"
          >
            <Plus size={15} />
            <span>새 작업</span>
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      {isFilterOpen && (
        <div className="bg-stone-50 border-b border-[var(--color-line)] p-4 animate-in slide-in-from-top-2 duration-200 shadow-inner">
          <div className="flex flex-wrap gap-4 items-end max-w-7xl mx-auto">
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">상태</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as TaskStatus | 'all' })}
                className="input-field min-w-[140px]"
              >
                <option value="all">전체 상태</option>
                <option value="todo">할 일</option>
                <option value="in-progress">진행 중</option>
                <option value="done">완료</option>
                <option value="blocked">지연됨</option>
              </select>
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">담당자</label>
              <select
                value={filters.assignee}
                onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}
                className="input-field min-w-[160px]"
              >
                <option value="">모든 담당자</option>
                {allAssignees.map(assignee => (
                  <option key={assignee} value={assignee}>{assignee}</option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">시작일</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="input-field"
              />
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">종료일</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="input-field"
              />
            </div>

            {hasActiveFilters && (
              <button
                onClick={() => setFilters({
                  status: 'all',
                  assignee: '',
                  startDate: '',
                  endDate: '',
                })}
                className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg flex items-center gap-1 transition-colors ml-auto sm:ml-0"
              >
                <X size={14} /> 초기화
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 overflow-auto">
          <div className="min-w-full min-h-full bg-white">
            {view === 'list' ? (
              <div
                ref={containerRef}
                className={cn(
                  "flex h-full w-full",
                  isDraggingResizer && "cursor-col-resize select-none"
                )}
              >
                <div
                  className="flex-shrink-0 overflow-auto"
                  style={{ width: `${wbsTableWidth}%` }}
                >
                  <WBSTable
                    filters={filters}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                  />
                </div>

                {/* Resizer Handle */}
                <div
                  className="w-1 bg-[var(--color-line)] hover:bg-blue-400 hover:w-1.5 active:bg-blue-500 cursor-col-resize transition-all z-10 flex-shrink-0 flex flex-col justify-center items-center group/resizer"
                  onMouseDown={startResizing}
                >
                  <div className="h-8 w-[2px] bg-stone-300 group-hover/resizer:bg-white rounded-full transition-colors hidden md:block" />
                </div>

                <div className="flex-1 overflow-auto bg-stone-50/30">
                  <GanttChart
                    filters={filters}
                    sortConfig={sortConfig}
                    hideSidebar={true}
                  />
                </div>
              </div>
            ) : view === 'gantt' ? (
              <GanttChart
                filters={filters}
                sortConfig={sortConfig}
              />
            ) : (
              <KanbanBoard />
            )}
          </div>
        </div>
      </main>

      <TaskModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveTask}
        parentOptions={tasks}
      />

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

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        onSave={handleSaveProject}
        project={editingProject}
      />

      <ShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <ConfirmDialog
        isOpen={isDeleteAllConfirmOpen}
        onClose={() => setIsDeleteAllConfirmOpen(false)}
        onConfirm={handleDeleteAll}
        title="모든 작업 삭제"
        message="이 프로젝트의 모든 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="전체 삭제"
        isDanger={true}
      />

      <ConfirmDialog
        isOpen={importConfirm.isOpen}
        onClose={() => setImportConfirm({ ...importConfirm, isOpen: false })}
        onConfirm={executeImport}
        title="데이터 가져오기"
        message={`${importConfirm.tasks.length}개의 작업을 가져오시겠습니까?\n\n경고: 현재 프로젝트의 모든 기존 작업이 대체됩니다.`}
        confirmLabel="가져오기"
        isDanger={true}
      />

      <ConfirmDialog
        isOpen={backupConfirm.isOpen}
        onClose={() => setBackupConfirm({ ...backupConfirm, isOpen: false })}
        onConfirm={executeRestoreBackup}
        title="전체 백업 복원"
        message={`정말로 전체 데이터를 복원하시겠습니까? (프로젝트 ${backupConfirm.data?.projects.length}개, 작업 ${backupConfirm.data?.tasks.length}개 포함)\n\n경고: 애플리케이션의 현재 모든 데이터가 백업 내용으로 덮어씌워지며 복구할 수 없습니다!`}
        confirmLabel="전체 복원"
        isDanger={true}
      />

      <ConfirmDialog
        isOpen={mergeConfirm.isOpen}
        onClose={() => setMergeConfirm({ ...mergeConfirm, isOpen: false })}
        onConfirm={executeMergeImport}
        title="프로젝트 추가 가져오기"
        message={`${mergeConfirm.backups.length}개의 파일에서 프로젝트 ${mergeConfirm.summary.projects}개, 작업 ${mergeConfirm.summary.tasks}개를 추가로 가져옵니다.\n\n각 파일의 프로젝트가 현재 데이터에 병합되며, 기존 데이터는 유지됩니다.`}
        confirmLabel="추가 가져오기"
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

      <AIAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        onImport={importTasks}
        currentProjectId={currentProjectId}
        existingTasks={tasks}
      />

      <WBSSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <WBSProvider>
      <WBSApp />
    </WBSProvider>
  );
}
