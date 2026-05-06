import { useState, useCallback } from 'react';
import type { Task, TaskStatus } from '../../types';
import type { WBSSettings } from '../../lib/wbsSettings';
import { round2 } from '../../lib/utils';

interface UseWbsBulkEditOptions {
  selectedTaskIds: Set<string>;
  tasks: Task[];
  /** 현재 표(필터·정렬 반영)에 보이는 행 순서 — 선행 순차 연결에 사용 */
  visibleTasks: Task[];
  wbsSettings: WBSSettings;
  updateTask: (id: string, updates: Partial<Task>) => void;
  updateTasksBulk: (ids: string[], updates: Partial<Task>) => void;
  linkSequentialPredecessors: (orderedTaskIds: string[]) => void;
  setSelection: (next: Set<string>) => void;
  setLastSelectedId: (id: string | null) => void;
}

export function useWbsBulkEdit({
  selectedTaskIds,
  tasks,
  visibleTasks,
  wbsSettings,
  updateTask,
  updateTasksBulk,
  linkSequentialPredecessors,
  setSelection,
  setLastSelectedId,
}: UseWbsBulkEditOptions) {
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkWorkEffort, setBulkWorkEffort] = useState('');
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkWeight, setBulkWeight] = useState('');
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');

  const resetBulkFields = useCallback(() => {
    setBulkStatus('');
    setBulkAssignee('');
    setBulkWorkEffort('');
    setBulkProgress('');
    setBulkWeight('');
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
    if (bulkWeight !== '') {
      const val = parseFloat(bulkWeight);
      if (!isNaN(val) && val >= 0) updates.weight = round2(val);
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
    bulkWeight,
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
    // 담당자 일괄 변경 시 선택된 작업의 모든 하위 작업도 동일 담당자로 자동 등록
    const childrenByParentId = new Map<string, string[]>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const list = childrenByParentId.get(t.parentId);
      if (list) list.push(t.id);
      else childrenByParentId.set(t.parentId, [t.id]);
    }
    const expanded = new Set<string>();
    const stack = Array.from(selectedTaskIds);
    while (stack.length) {
      const id = stack.pop()!;
      if (expanded.has(id)) continue;
      expanded.add(id);
      const children = childrenByParentId.get(id);
      if (children) stack.push(...children);
    }
    updateTasksBulk(Array.from(expanded), { assignee: value });
    setBulkAssignee('');
    setSelection(new Set());
    setLastSelectedId(null);
  }, [bulkAssignee, tasks, selectedTaskIds, updateTasksBulk, setSelection, setLastSelectedId]);

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

  /** 표에 보이는 순서대로 선택 행만 연쇄 선행(FS) 연결 */
  const executeBulkLinkSequentialPredecessors = useCallback(() => {
    const ordered = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
    if (ordered.length < 2) return;
    linkSequentialPredecessors(ordered);
    setSelection(new Set());
    setLastSelectedId(null);
  }, [visibleTasks, selectedTaskIds, linkSequentialPredecessors, setSelection, setLastSelectedId]);

  return {
    bulkStatus,
    setBulkStatus,
    bulkAssignee,
    setBulkAssignee,
    bulkWorkEffort,
    setBulkWorkEffort,
    bulkProgress,
    setBulkProgress,
    bulkWeight,
    setBulkWeight,
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
    executeBulkLinkSequentialPredecessors,
  };
}
