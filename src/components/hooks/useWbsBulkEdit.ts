import { useState, useCallback } from 'react';
import type { Task, TaskStatus } from '../../types';
import type { WBSSettings } from '../../lib/wbsSettings';
import { round2 } from '../../lib/utils';

interface UseWbsBulkEditOptions {
  selectedTaskIds: Set<string>;
  tasks: Task[];
  wbsSettings: WBSSettings;
  updateTask: (id: string, updates: Partial<Task>) => void;
  updateTasksBulk: (ids: string[], updates: Partial<Task>) => void;
  setSelection: (next: Set<string>) => void;
  setLastSelectedId: (id: string | null) => void;
}

export function useWbsBulkEdit({
  selectedTaskIds,
  tasks,
  wbsSettings,
  updateTask,
  updateTasksBulk,
  setSelection,
  setLastSelectedId,
}: UseWbsBulkEditOptions) {
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkWorkEffort, setBulkWorkEffort] = useState('');
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');

  const resetBulkFields = useCallback(() => {
    setBulkStatus('');
    setBulkAssignee('');
    setBulkWorkEffort('');
    setBulkProgress('');
    setBulkStartDate('');
    setBulkEndDate('');
  }, []);

  const executeBulkEdit = useCallback(() => {
    const updates: Partial<Task> = {};
    if (bulkStatus) {
      updates.status = bulkStatus;
      const config = (wbsSettings?.statusConfigs ?? []).find((c) => c.id === bulkStatus);
      if (config && config.progress !== undefined) updates.progress = config.progress;
    }
    if (bulkAssignee.trim()) updates.assignee = bulkAssignee.trim();
    if (bulkWorkEffort !== '') {
      const val = parseFloat(bulkWorkEffort);
      if (!isNaN(val) && val >= 0) updates.workEffort = Math.round(val * 10) / 10;
    }
    if (bulkProgress !== '') {
      const val = parseFloat(bulkProgress);
      if (!isNaN(val) && val >= 0 && val <= 100) updates.progress = round2(val);
    }
    if (bulkStartDate.trim()) updates.startDate = bulkStartDate.trim();
    if (bulkEndDate.trim()) updates.endDate = bulkEndDate.trim();
    if (Object.keys(updates).length === 0) return;
    const ids = Array.from(selectedTaskIds);
    // updateTasksBulk는 일정/공수/선행작업 변경 시 스킵하므로, 해당 필드가 있으면 개별 updateTask로 적용
    const hasScheduleField =
      Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
      Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'dependencies');
    if (hasScheduleField) {
      ids.forEach((id) => updateTask(id, updates));
    } else {
      updateTasksBulk(ids, updates);
    }
    resetBulkFields();
  }, [
    bulkStatus,
    bulkAssignee,
    bulkWorkEffort,
    bulkProgress,
    bulkStartDate,
    bulkEndDate,
    wbsSettings,
    selectedTaskIds,
    updateTask,
    updateTasksBulk,
    resetBulkFields,
  ]);

  const executeBulkWorkEffort = useCallback(() => {
    const value = parseFloat(bulkWorkEffort);
    if (isNaN(value) || value < 0) return;
    const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
    for (const id of selectedTaskIds) {
      const prev = taskById.get(id);
      const locked = new Set<NonNullable<Task['userLockedFields']>[number]>(prev?.userLockedFields ?? []);
      locked.add('workEffort');
      updateTask(id, { workEffort: value, userLockedFields: [...locked] });
    }
    setBulkWorkEffort('');
    setSelection(new Set());
    setLastSelectedId(null);
  }, [bulkWorkEffort, tasks, selectedTaskIds, updateTask, setSelection, setLastSelectedId]);

  const executeBulkStatus = useCallback(() => {
    if (!bulkStatus) return;
    const updates: Partial<Task> = { status: bulkStatus };
    // 상태-진척도 연동이 켜져 있을 때만 상태 기준으로 진척률을 자동 설정
    if (wbsSettings.linkStatusAndProgress !== false) {
      const cfg = (wbsSettings.statusConfigs ?? []).find((c) => c.id === bulkStatus);
      if (cfg && typeof cfg.progress === 'number' && Number.isFinite(cfg.progress)) {
        updates.progress = cfg.progress;
      }
    }
    updateTasksBulk(Array.from(selectedTaskIds), updates);
    setBulkStatus('');
    setSelection(new Set());
    setLastSelectedId(null);
  }, [bulkStatus, wbsSettings, selectedTaskIds, updateTasksBulk, setSelection, setLastSelectedId]);

  const executeBulkAssignee = useCallback(() => {
    const value = bulkAssignee.trim();
    if (!value) return;
    updateTasksBulk(Array.from(selectedTaskIds), { assignee: value });
    setBulkAssignee('');
    setSelection(new Set());
    setLastSelectedId(null);
  }, [bulkAssignee, selectedTaskIds, updateTasksBulk, setSelection, setLastSelectedId]);

  const executeBulkClearDependencies = useCallback(() => {
    const taskById = new Map<string, Task>(tasks.map((t) => [t.id, t]));
    for (const id of selectedTaskIds) {
      const prev = taskById.get(id);
      const locked = new Set<NonNullable<Task['userLockedFields']>[number]>(prev?.userLockedFields ?? []);
      locked.add('dependencies');
      updateTask(id, { dependencies: [], userLockedFields: [...locked] });
    }
    setSelection(new Set());
    setLastSelectedId(null);
  }, [tasks, selectedTaskIds, updateTask, setSelection, setLastSelectedId]);

  return {
    bulkStatus,
    setBulkStatus,
    bulkAssignee,
    setBulkAssignee,
    bulkWorkEffort,
    setBulkWorkEffort,
    bulkProgress,
    setBulkProgress,
    bulkStartDate,
    setBulkStartDate,
    bulkEndDate,
    setBulkEndDate,
    resetBulkFields,
    executeBulkEdit,
    executeBulkWorkEffort,
    executeBulkStatus,
    executeBulkAssignee,
    executeBulkClearDependencies,
  };
}
