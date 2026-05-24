import React, { useCallback, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project, FilterState } from '../types';
import { BackupData } from '../lib/export';
import { exportToExcel, parseExcelWithMeta, type ExcelImportMeta } from '../lib/excel';
import { exportBackupToJson, exportToMarkdown, parseBackupJson, parseMultipleBackupJsons } from '../lib/export';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import { v4 as uuidv4 } from 'uuid';
import type { ExportScope, ExportFormat } from '../components/ExportModal';

export interface ImportPreviewState {
  isOpen: boolean;
  tasks: Task[];
  files: { fileName: string; taskCount: number; meta: ExcelImportMeta }[];
}

export interface BackupConfirmState {
  isOpen: boolean;
  data: BackupData | null;
}

export interface MultiMergeConfirmState {
  isOpen: boolean;
  dataArray: BackupData[];
  fileCount: number;
}

export interface LastExportPrefs {
  scope: ExportScope;
  format: ExportFormat;
  projectIds: string[];
}

interface FileImportExportDeps {
  projects: Project[];
  allTasks: Task[];
  currentProjectId: string;
  wbsMap: Map<string, string>;
  pushToast: (message: string, opts?: Record<string, unknown>) => void;
  importTasks: (tasks: Task[], targetProjectId?: string, newProjectName?: string) => Promise<void>;
  restoreBackup: (data: BackupData) => void;
  mergeBackups: (backups: BackupData[]) => { addedProjects: number; addedTasks: number };
  exportFullBackup: () => BackupData;
  setCurrentProjectId: (id: string) => void;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  setImportPreview: Dispatch<SetStateAction<ImportPreviewState>>;
  setBackupConfirm: Dispatch<SetStateAction<BackupConfirmState>>;
  setMultiMergeConfirm: Dispatch<SetStateAction<MultiMergeConfirmState>>;
  setErrorAlert: Dispatch<SetStateAction<{ isOpen: boolean; message: string }>>;
  setIsExportModalOpen: (open: boolean) => void;
  lastExportPrefs: LastExportPrefs | null;
  setLastExportPrefs: (prefs: LastExportPrefs) => void;
  importPreview: ImportPreviewState;
  backupConfirm: BackupConfirmState;
  multiMergeConfirm: MultiMergeConfirmState;
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>;
}

export function useFileImportExport(deps: FileImportExportDeps) {
  const {
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
    assigneeDisplayMetaByName,
  } = deps;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  const handleExportFromModal = useCallback(
    (params: { scope: ExportScope; formats: ExportFormat[]; projectIds: string[] }) => {
      const { formats, projectIds, scope } = params;
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const filteredProjects = projects.filter((p) => projectIds.includes(p.id));
      const filteredTasks = allTasks.filter((t) => t.projectId && projectIds.includes(t.projectId));

      const doExport = (format: ExportFormat) => {
        if (format === 'excel') {
          const fileName =
            filteredProjects.length === 1
              ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.xlsx`
              : `wbs_export_${timestamp}.xlsx`;
          exportToExcel(filteredTasks, wbsMap, fileName, filteredProjects, undefined, assigneeDisplayMetaByName);
        } else if (format === 'markdown') {
          const fileName =
            filteredProjects.length === 1
              ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.md`
              : `wbs_export_${timestamp}.md`;
          exportToMarkdown(filteredTasks, wbsMap, fileName, filteredProjects, assigneeDisplayMetaByName);
        } else if (format === 'csv') {
          const fileName =
            filteredProjects.length === 1
              ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.csv`
              : `wbs_export_${timestamp}.csv`;
          const projectMap = new Map(filteredProjects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]));
          const header = ['WBS', '프로젝트', '작업명', '담당자', '상태', '진행률', '시작일', '종료일', '공수'];
          const escape = (v: string) => {
            if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
            return v;
          };
          const taskRow = (t: Task) =>
            [
              wbsMap.get(t.id) ?? '',
              projectMap.get(t.projectId) ?? '',
              t.name,
              formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName),
              t.status,
              String(t.progress ?? 0),
              t.startDate ?? '',
              t.endDate ?? '',
              t.workEffort != null ? String(t.workEffort) : '',
            ]
              .map(escape)
              .join(',');
          const rows: string[] = [];
          for (const p of filteredProjects) {
            const pname = projectMap.get(p.id) ?? '';
            const tasksForP = filteredTasks.filter((t) => t.projectId === p.id);
            if (tasksForP.length === 0) {
              rows.push(['', pname, '(작업 없음)', '', '', '', p.startDate ?? '', p.endDate ?? '', ''].map(escape).join(','));
            } else {
              for (const t of tasksForP) rows.push(taskRow(t));
            }
          }
          const bom = '\uFEFF';
          const csv = bom + [header.join(','), ...rows].join('\r\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const fullBackup = exportFullBackup();
          const partialBackup: BackupData = {
            ...fullBackup,
            projects: filteredProjects,
            tasks: filteredTasks,
          };
          const fileName =
            filteredProjects.length === 1
              ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_backup_${timestamp}.json`
              : `wbs_backup_${timestamp}.json`;
          exportBackupToJson(partialBackup, fileName);
        }
      };

      formats.forEach(doExport);

      pushToast('내보내기가 완료되었습니다.');
      const primaryFormat = formats[0] ?? 'excel';
      const prefs = { scope, format: primaryFormat as ExportFormat, projectIds };
      setLastExportPrefs(prefs);
      try {
        window.localStorage.setItem('wbs.lastExportPrefs', JSON.stringify(prefs));
      } catch {
        /* ignore */
      }
    },
    [projects, allTasks, wbsMap, pushToast, exportFullBackup, setLastExportPrefs, assigneeDisplayMetaByName],
  );

  const handleQuickExport = useCallback(() => {
    if (!lastExportPrefs) {
      setIsExportModalOpen(true);
      return;
    }
    const availableProjectIds = projects.map((p) => p.id);
    const projectIds =
      lastExportPrefs.scope === 'all' ? availableProjectIds : lastExportPrefs.projectIds.filter((id) => availableProjectIds.includes(id));
    if (projectIds.length === 0) {
      setIsExportModalOpen(true);
      return;
    }
    handleExportFromModal({
      scope: lastExportPrefs.scope,
      formats: [lastExportPrefs.format],
      projectIds,
    });
  }, [lastExportPrefs, projects, handleExportFromModal, setIsExportModalOpen]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleImportBackupClick = useCallback(() => {
    backupInputRef.current?.click();
  }, []);
  const handleMergeImportClick = useCallback(() => {
    mergeInputRef.current?.click();
  }, []);

  const importFromExcelFiles = useCallback(
    async (files: File[]) => {
      const remapIdsWithinFile = (tasksInFile: Task[]): Task[] => {
        const idMap = new Map<string, string>();
        tasksInFile.forEach((t) => idMap.set(t.id, uuidv4()));
        return tasksInFile.map((t) => ({
          ...t,
          id: idMap.get(t.id)!,
          parentId: t.parentId && idMap.has(t.parentId) ? idMap.get(t.parentId)! : null,
          dependencies: (t.dependencies ?? []).filter((depId) => idMap.has(depId)).map((depId) => idMap.get(depId)!),
          expanded: true,
        }));
      };

      const parsed = await Promise.all(files.map((f) => parseExcelWithMeta(f)));
      const perFileTasks = parsed.map((p) => p.tasks);
      const importedTasks = files.length > 1 ? perFileTasks.flatMap(remapIdsWithinFile) : perFileTasks.flat();

      setImportPreview({
        isOpen: true,
        tasks: importedTasks,
        files: parsed.map((p, idx) => ({
          fileName: files[idx]?.name || `file-${idx + 1}`,
          taskCount: p.tasks.length,
          meta: p.meta,
        })),
      });
    },
    [setImportPreview],
  );

  const importFromBackupJsonFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 1) {
        const parsedData = await parseBackupJson(files[0] as File);
        setBackupConfirm({ isOpen: true, data: parsedData });
      } else {
        const parsedDataArray = await parseMultipleBackupJsons(files as File[]);
        setMultiMergeConfirm({ isOpen: true, dataArray: parsedDataArray, fileCount: files.length });
      }
    },
    [setBackupConfirm, setMultiMergeConfirm],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []) as File[];
      if (files.length === 0) return;
      const firstExt = files[0].name.split('.').pop()?.toLowerCase() ?? '';
      try {
        if (firstExt === 'xlsx' || firstExt === 'xls' || firstExt === 'xlsm') {
          await importFromExcelFiles(files);
        } else if (firstExt === 'json') {
          await importFromBackupJsonFiles(files);
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
    },
    [importFromExcelFiles, importFromBackupJsonFiles, setErrorAlert],
  );

  const handleBackupFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []) as File[];
      if (files.length === 0) return;
      try {
        await importFromBackupJsonFiles(files);
      } catch (error: unknown) {
        setErrorAlert({ isOpen: true, message: error instanceof Error ? error.message : '백업 파일을 읽는 중 오류 발생' });
      } finally {
        if (backupInputRef.current) backupInputRef.current.value = '';
      }
    },
    [importFromBackupJsonFiles, setErrorAlert],
  );

  const handleMergeFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    },
    [setMultiMergeConfirm, setErrorAlert],
  );

  const executeMultiMerge = useCallback(() => {
    mergeBackups(multiMergeConfirm.dataArray);
    setMultiMergeConfirm({ isOpen: false, dataArray: [], fileCount: 0 });
  }, [mergeBackups, multiMergeConfirm.dataArray, setMultiMergeConfirm]);

  const executeImport = useCallback(
    async (targetProjectId: string, newProjectName?: string) => {
      try {
        await importTasks(importPreview.tasks, targetProjectId, newProjectName);
        if (targetProjectId !== '__new__') setCurrentProjectId(targetProjectId);
        setFilters((prev) => ({ ...prev, projectIds: 'all' }));
        setImportPreview({ isOpen: false, tasks: [], files: [] });
        pushToast('가져오기가 완료되었습니다.', { variant: 'success' });
      } catch {
        /* onDbError handles toast */
      }
    },
    [importTasks, importPreview.tasks, setCurrentProjectId, setFilters, setImportPreview, pushToast],
  );

  const executeRestoreBackup = useCallback(() => {
    if (backupConfirm.data) restoreBackup(backupConfirm.data);
    setBackupConfirm({ isOpen: false, data: null });
  }, [backupConfirm.data, restoreBackup, setBackupConfirm]);

  const executeRestoreBackupIntoProject = useCallback(
    async (targetProjectId: string) => {
      if (!backupConfirm.data) return;
      const idMap = new Map<string, string>();
      const remappedTasks = backupConfirm.data.tasks
        .map((t) => {
          const newId = uuidv4();
          idMap.set(t.id, newId);
          return { ...t, id: newId };
        })
        .map((t) => ({
          ...t,
          projectId: targetProjectId,
          parentId: t.parentId && idMap.has(t.parentId) ? idMap.get(t.parentId)! : null,
          dependencies: (t.dependencies ?? []).filter((depId) => idMap.has(depId)).map((depId) => idMap.get(depId)!),
          expanded: true,
        }));
      try {
        await importTasks(remappedTasks, targetProjectId);
        setCurrentProjectId(targetProjectId);
        setBackupConfirm({ isOpen: false, data: null });
        pushToast('가져오기가 완료되었습니다.', { variant: 'success' });
      } catch {
        /* onDbError handles toast */
      }
    },
    [backupConfirm.data, importTasks, setCurrentProjectId, setBackupConfirm, pushToast],
  );

  return {
    fileInputRef,
    backupInputRef,
    mergeInputRef,
    handleExportFromModal,
    handleQuickExport,
    handleImportClick,
    handleImportBackupClick,
    handleMergeImportClick,
    handleFileChange,
    handleBackupFileChange,
    handleMergeFileChange,
    executeMultiMerge,
    executeImport,
    executeRestoreBackup,
    executeRestoreBackupIntoProject,
  };
}
