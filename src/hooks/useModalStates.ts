import { useState } from 'react';
import type { Task, Project } from '../types';
import type { BackupData } from '../lib/export';
import type { ExcelImportMeta } from '../lib/excel';
import type { ExportScope, ExportFormat } from '../components/ExportModal';

/** 단축키 사이드바 자동 표시 끔 플래그 — 「다시 보지 않기」 선택 시에만 '1' 기록. X(이번만 닫기)는 세션 동안만 닫힘 */
export const SHORTCUTS_HIDE_KEY = 'wbs.shortcuts.hide';

function readShortcutsHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SHORTCUTS_HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useModalStates() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  // 단축키 사이드바: 기본은 매 세션 표시(ON). 단 「다시 보지 않기」를 선택했으면 자동 표시 안 함.
  // X(닫기)는 그 세션 동안만 닫힘 — 새로고침·재접속 시 다시 ON. 메뉴(단축키)·Shift+? 로 언제든 다시 열 수 있음.
  const [isShortcutsVisible, setIsShortcutsVisible] = useState<boolean>(() => !readShortcutsHidden());
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isDeleteProjectConfirmOpen, setIsDeleteProjectConfirmOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isCopyProjectConfirmOpen, setIsCopyProjectConfirmOpen] = useState(false);
  const [projectToCopy, setProjectToCopy] = useState<Project | null>(null);
  const [isDeleteAllProjectsConfirmOpen, setIsDeleteAllProjectsConfirmOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [auditLogProjectId, setAuditLogProjectId] = useState<string | null>(null);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isAdminPasswordModalOpen, setIsAdminPasswordModalOpen] = useState(false);
  const [isAdminAccessRequestModalOpen, setIsAdminAccessRequestModalOpen] = useState(false);
  const [isProjectEditAccessRequestModalOpen, setIsProjectEditAccessRequestModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isWeeklyReportOpen, setIsWeeklyReportOpen] = useState(false);
  const [isOrganizationOpen, setIsOrganizationOpen] = useState(false);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeleteChoiceOpen, setIsDeleteChoiceOpen] = useState(false);
  const [exportSelectedProjectIds, setExportSelectedProjectIds] = useState<string[]>([]);
  const [lastExportPrefs, setLastExportPrefs] = useState<{
    scope: ExportScope;
    format: ExportFormat;
    projectIds: string[];
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem('wbs.lastExportPrefs');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { scope?: string; format?: string; projectIds?: unknown };
      if (
        (parsed.scope === 'all' || parsed.scope === 'selected') &&
        (parsed.format === 'excel' || parsed.format === 'json' || parsed.format === 'markdown') &&
        Array.isArray(parsed.projectIds)
      ) {
        return {
          scope: parsed.scope,
          format: parsed.format,
          projectIds: parsed.projectIds.filter((id) => typeof id === 'string') as string[],
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  const [importPreview, setImportPreview] = useState<{
    isOpen: boolean;
    tasks: Task[];
    files: { fileName: string; taskCount: number; meta: ExcelImportMeta }[];
  }>({ isOpen: false, tasks: [], files: [] });

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

  return {
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
    exportSelectedProjectIds,
    setExportSelectedProjectIds,
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
  };
}
