import React, { useCallback, useMemo, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project, FilterState } from '../types';
import { BackupData } from '../lib/export';
// xlsx(약 424KB)는 무거우므로 정적 import하지 않는다. 내보내기/가져오기 시점에 동적 로드해
// 첫 화면 진입 경로에서 vendor-xlsx 청크가 eager preload 되지 않도록 한다. (타입만 정적 import)
import type { ExcelImportMeta, ExcelImportFieldId, ExcelImportFieldOverride, ExcelImportCustomColumnInput } from '../lib/excel';
import { exportBackupToJson, exportToMarkdown, parseBackupJson, parseMultipleBackupJsons } from '../lib/export';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import { v4 as uuidv4 } from 'uuid';
import type { ExportScope, ExportFormat } from '../components/ExportModal';

export interface ImportPreviewFile {
  fileName: string;
  taskCount: number;
  meta: ExcelImportMeta;
  /** 원본 파일 — 사용자가 모달에서 컬럼 매핑을 바꿀 때 다시 파싱하기 위해 보관 */
  file: File;
  /** 사용자가 모달에서 직접 지정한 컬럼 매핑(자동 매칭을 덮어씀) */
  overrides: ExcelImportFieldOverride;
  /** 사용자가 미사용 컬럼을 "사용자 정의 컬럼"으로 추가하기로 한 항목들 */
  customColumns: Array<{ id: string; name: string; columnIndex: number }>;
}

export interface ImportPreviewState {
  isOpen: boolean;
  tasks: Task[];
  files: ImportPreviewFile[];
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
  importTasks: (
    tasks: Task[],
    targetProjectId?: string,
    newProjectName?: string,
    addCustomColumns?: Array<{ id: string; name: string }>,
  ) => Promise<void>;
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
  /** 가져오기 완료 직후 호출. 보통 App.tsx에서 setView('tablegantt')로 표+간트 화면으로 이동시키는 데 사용. */
  onImportComplete?: () => void;
  lastExportPrefs: LastExportPrefs | null;
  setLastExportPrefs: (prefs: LastExportPrefs) => void;
  importPreview: ImportPreviewState;
  backupConfirm: BackupConfirmState;
  multiMergeConfirm: MultiMergeConfirmState;
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>;
  /** 상태 id→이름 매핑용(엑셀 내보내기에서 화면과 동일하게 상태 이름 표기) */
  statusConfigs?: Array<{ id: string; name: string }>;
  onSampleTemplateDownloaded?: () => void;
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
    onImportComplete,
    lastExportPrefs,
    setLastExportPrefs,
    importPreview,
    backupConfirm,
    multiMergeConfirm,
    assigneeDisplayMetaByName,
    statusConfigs,
    onSampleTemplateDownloaded,
  } = deps;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  /** 확인 모달과 동일 문구를 토스트로도 표시 */
  const alertUser = useCallback(
    (message: string, opts?: { variant?: 'warning' | 'error' }) => {
      const variant = opts?.variant ?? 'error';
      setErrorAlert({ isOpen: true, message });
      pushToast(message, { variant, durationMs: variant === 'warning' ? 9000 : 10000, id: 'wbs-file-io-user-alert' });
    },
    [setErrorAlert, pushToast],
  );

  const handleExportFromModal = useCallback(
    async (params: { scope: ExportScope; formats: ExportFormat[]; projectIds: string[] }) => {
      try {
        const { formats, projectIds, scope } = params;
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const filteredProjects = projects.filter((p) => projectIds.includes(p.id));
        const filteredTasks = allTasks.filter((t) => t.projectId && projectIds.includes(t.projectId));

        const doExport = async (format: ExportFormat) => {
          if (format === 'excel') {
            const fileName =
              filteredProjects.length === 1
                ? `wbs_${filteredProjects[0].name.replace(/\s+/g, '_')}_${timestamp}.xlsx`
                : `wbs_export_${timestamp}.xlsx`;
            const { exportToExcel } = await import('../lib/excel');
            await exportToExcel(filteredTasks, wbsMap, fileName, filteredProjects, undefined, assigneeDisplayMetaByName, statusConfigs);
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

        for (const format of formats) {
          await doExport(format);
        }

        pushToast('내보내기가 완료되었습니다.');
        const primaryFormat = formats[0] ?? 'excel';
        const prefs = { scope, format: primaryFormat as ExportFormat, projectIds };
        setLastExportPrefs(prefs);
        try {
          window.localStorage.setItem('wbs.lastExportPrefs', JSON.stringify(prefs));
        } catch {
          /* ignore */
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '보내기 중 오류가 발생했습니다.';
        alertUser(msg);
      }
    },
    [projects, allTasks, wbsMap, pushToast, exportFullBackup, setLastExportPrefs, assigneeDisplayMetaByName, statusConfigs, alertUser],
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

  const handleDownloadSampleTemplate = useCallback(async () => {
    try {
      const { exportWbsSampleTemplate } = await import('../lib/excel');
      await exportWbsSampleTemplate('wbs_sample_template.xlsx', statusConfigs);
      onSampleTemplateDownloaded?.();
      pushToast('샘플 WBS 양식을 다운로드했습니다.', { variant: 'success' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '샘플 양식 다운로드에 실패했습니다.';
      alertUser(msg);
    }
  }, [statusConfigs, onSampleTemplateDownloaded, pushToast, alertUser]);

  const handleImportBackupClick = useCallback(() => {
    backupInputRef.current?.click();
  }, []);
  const handleMergeImportClick = useCallback(() => {
    mergeInputRef.current?.click();
  }, []);

  const remapIdsWithinFile = useCallback((tasksInFile: Task[]): Task[] => {
    const idMap = new Map<string, string>();
    tasksInFile.forEach((t) => idMap.set(t.id, uuidv4()));
    return tasksInFile.map((t) => ({
      ...t,
      id: idMap.get(t.id)!,
      parentId: t.parentId && idMap.has(t.parentId) ? idMap.get(t.parentId)! : null,
      dependencies: (t.dependencies ?? []).filter((depId) => idMap.has(depId)).map((depId) => idMap.get(depId)!),
      expanded: true,
    }));
  }, []);

  const importFromExcelFiles = useCallback(
    async (files: File[]) => {
      const { parseExcelWithMeta } = await import('../lib/excel');
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
          file: files[idx],
          overrides: {},
          customColumns: [],
        })),
      });
    },
    [setImportPreview, remapIdsWithinFile],
  );

  /** 파일별 overrides·customColumns로 모든 파일을 재파싱하여 합산 tasks/meta를 갱신하는 공통 헬퍼 */
  const reparseAllFiles = useCallback(
    async (
      currentFiles: ImportPreviewFile[],
      overridesByFile: ExcelImportFieldOverride[],
      customColumnsByFile: Array<Array<{ id: string; name: string; columnIndex: number }>>,
    ) => {
      const { parseExcelWithMeta } = await import('../lib/excel');
      const reparsed = await Promise.all(
        currentFiles.map((f, i) =>
          parseExcelWithMeta(f.file, {
            overrides: overridesByFile[i],
            customColumns: customColumnsByFile[i].map<ExcelImportCustomColumnInput>((c) => ({ id: c.id, columnIndex: c.columnIndex })),
          }),
        ),
      );
      const perFileTasks = reparsed.map((r) => r.tasks);
      const mergedTasks = currentFiles.length > 1 ? perFileTasks.flatMap(remapIdsWithinFile) : perFileTasks.flat();
      return { reparsed, mergedTasks };
    },
    [remapIdsWithinFile],
  );

  /** 사용자가 미리보기 모달에서 특정 필드의 컬럼 매핑을 바꿨을 때 호출 — 모든 파일을 각자의 overrides·customColumns로 재파싱한 뒤 합산 tasks 갱신 */
  const handleImportMappingChange = useCallback(
    async (fileIndex: number, fieldId: ExcelImportFieldId, columnIndex: number) => {
      const currentFiles = importPreview.files;
      if (!currentFiles[fileIndex]) return;
      const overridesByFile: ExcelImportFieldOverride[] = currentFiles.map((f, i) =>
        i === fileIndex ? { ...f.overrides, [fieldId]: columnIndex } : { ...f.overrides },
      );
      const customColumnsByFile = currentFiles.map((f) => f.customColumns);
      const { reparsed, mergedTasks } = await reparseAllFiles(currentFiles, overridesByFile, customColumnsByFile);

      setImportPreview((prev) => ({
        ...prev,
        tasks: mergedTasks,
        files: prev.files.map((f, i) => ({
          ...f,
          meta: reparsed[i].meta,
          taskCount: reparsed[i].tasks.length,
          overrides: overridesByFile[i],
        })),
      }));
    },
    [importPreview.files, setImportPreview, reparseAllFiles],
  );

  /** 파일별 사용자 정의 컬럼 전체를 한 번에 set한 뒤 재파싱하는 공통 헬퍼 — toggle/모두 추가/모두 해제가 공유 */
  const applyCustomColumnsForFile = useCallback(
    async (fileIndex: number, nextForThisFile: Array<{ id: string; name: string; columnIndex: number }>) => {
      const currentFiles = importPreview.files;
      if (!currentFiles[fileIndex]) return;
      const overridesByFile = currentFiles.map((f) => f.overrides);
      const customColumnsByFile = currentFiles.map((f, i) => (i === fileIndex ? nextForThisFile : f.customColumns));
      const { reparsed, mergedTasks } = await reparseAllFiles(currentFiles, overridesByFile, customColumnsByFile);

      setImportPreview((prev) => ({
        ...prev,
        tasks: mergedTasks,
        files: prev.files.map((f, i) => ({
          ...f,
          meta: reparsed[i].meta,
          taskCount: reparsed[i].tasks.length,
          customColumns: customColumnsByFile[i],
        })),
      }));
    },
    [importPreview.files, setImportPreview, reparseAllFiles],
  );

  /** 사용자가 미사용 컬럼 chip을 클릭해 "사용자 정의 컬럼"으로 추가/해제 토글 */
  const handleImportCustomColumnToggle = useCallback(
    async (fileIndex: number, header: string, columnIndex: number) => {
      const cur = importPreview.files[fileIndex];
      if (!cur) return;
      const existsIdx = cur.customColumns.findIndex((c) => c.columnIndex === columnIndex);
      const nextForThisFile =
        existsIdx >= 0
          ? cur.customColumns.filter((_, i) => i !== existsIdx)
          : [...cur.customColumns, { id: `custom:${uuidv4()}`, name: header.trim() || `컬럼 ${columnIndex + 1}`, columnIndex }];
      await applyCustomColumnsForFile(fileIndex, nextForThisFile);
    },
    [importPreview.files, applyCustomColumnsForFile],
  );

  /**
   * 모달의 "모두 추가/모두 해제" 같이 여러 항목을 한 번에 set할 때 사용.
   * items는 최종 customColumns의 columnIndex 목록(헤더 정보 포함). 기존 항목과 columnIndex가 매칭되면 id를 재사용.
   * 이 함수는 단일 호출로 reparse + setState 한 번만 수행하므로 연속 호출 시의 stale state 문제가 없음.
   */
  const handleImportCustomColumnsSet = useCallback(
    async (fileIndex: number, items: Array<{ header: string; columnIndex: number }>) => {
      const cur = importPreview.files[fileIndex];
      if (!cur) return;
      const idByCol = new Map(cur.customColumns.map((c) => [c.columnIndex, c.id]));
      const nameByCol = new Map(cur.customColumns.map((c) => [c.columnIndex, c.name]));
      const nextForThisFile = items.map((it) => ({
        id: idByCol.get(it.columnIndex) ?? `custom:${uuidv4()}`,
        name: (nameByCol.get(it.columnIndex) ?? it.header).trim() || `컬럼 ${it.columnIndex + 1}`,
        columnIndex: it.columnIndex,
      }));
      await applyCustomColumnsForFile(fileIndex, nextForThisFile);
    },
    [importPreview.files, applyCustomColumnsForFile],
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
          alertUser('Markdown(.md) 파일 가져오기는 아직 지원되지 않습니다. Excel(.xlsx) 또는 백업 JSON(.json) 파일을 선택해주세요.', {
            variant: 'warning',
          });
        } else {
          alertUser('지원하지 않는 파일 형식입니다. Excel(.xlsx) 또는 백업 JSON(.json) 파일만 선택할 수 있습니다.', {
            variant: 'warning',
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '파일을 처리하는 중 오류가 발생했습니다.';
        alertUser(msg);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [importFromExcelFiles, importFromBackupJsonFiles, alertUser],
  );

  const handleBackupFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []) as File[];
      if (files.length === 0) return;
      try {
        await importFromBackupJsonFiles(files);
      } catch (error: unknown) {
        alertUser(error instanceof Error ? error.message : '백업 파일을 읽는 중 오류 발생');
      } finally {
        if (backupInputRef.current) backupInputRef.current.value = '';
      }
    },
    [importFromBackupJsonFiles, alertUser],
  );

  const handleMergeFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      try {
        const parsedDataArray = await parseMultipleBackupJsons(files as File[]);
        setMultiMergeConfirm({ isOpen: true, dataArray: parsedDataArray, fileCount: files.length });
      } catch (error: unknown) {
        alertUser(error instanceof Error ? error.message : '오류 발생');
      } finally {
        if (mergeInputRef.current) mergeInputRef.current.value = '';
      }
    },
    [setMultiMergeConfirm, alertUser],
  );

  const executeMultiMerge = useCallback(() => {
    mergeBackups(multiMergeConfirm.dataArray);
    setMultiMergeConfirm({ isOpen: false, dataArray: [], fileCount: 0 });
  }, [mergeBackups, multiMergeConfirm.dataArray, setMultiMergeConfirm]);

  const executeImport = useCallback(
    async (targetProjectId: string, newProjectName?: string) => {
      try {
        // 모든 파일의 사용자 정의 컬럼 정의를 합치고(같은 id는 한 번만), settings에 등록되도록 importTasks로 전달.
        const allCustomColumns = importPreview.files.flatMap((f) => f.customColumns.map((c) => ({ id: c.id, name: c.name })));
        const deduped = Array.from(new Map(allCustomColumns.map((c) => [c.id, c])).values());
        await importTasks(importPreview.tasks, targetProjectId, newProjectName, deduped);
        // importTasks 내부에서 '__new__' 경로면 새 프로젝트 ID로 setCurrentProjectId가 이미 호출됨.
        // 기존 프로젝트 덮어쓰기 경로는 현재 UI에서 제거됐지만 방어적으로 유지.
        if (targetProjectId !== '__new__') setCurrentProjectId(targetProjectId);
        setFilters((prev) => ({ ...prev, projectIds: 'all' }));
        setImportPreview({ isOpen: false, tasks: [], files: [] });
        // 가져오기 직후 새 프로젝트의 표로 이동(다른 뷰에 있었어도 즉시 표 페이지로 전환).
        onImportComplete?.();
        pushToast('가져오기가 완료되었습니다.', { variant: 'success' });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '가져오기에 실패했습니다. 네트워크·저장 권한을 확인한 뒤 다시 시도해 주세요.';
        alertUser(msg);
      }
    },
    [
      importTasks,
      importPreview.tasks,
      importPreview.files,
      setCurrentProjectId,
      setFilters,
      setImportPreview,
      onImportComplete,
      pushToast,
      alertUser,
    ],
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
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '가져오기에 실패했습니다. 네트워크·저장 권한을 확인한 뒤 다시 시도해 주세요.';
        alertUser(msg);
      }
    },
    [backupConfirm.data, importTasks, setCurrentProjectId, setBackupConfirm, pushToast, alertUser],
  );

  return useMemo(
    () => ({
      fileInputRef,
      backupInputRef,
      mergeInputRef,
      handleExportFromModal,
      handleQuickExport,
      handleImportClick,
      handleDownloadSampleTemplate,
      handleImportBackupClick,
      handleMergeImportClick,
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
    }),
    [
      fileInputRef,
      backupInputRef,
      mergeInputRef,
      handleExportFromModal,
      handleQuickExport,
      handleImportClick,
      handleDownloadSampleTemplate,
      handleImportBackupClick,
      handleMergeImportClick,
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
    ],
  );
}
