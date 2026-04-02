import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project, ProjectAssignment } from '../../types';
import { WBSSettings, StatusConfig } from '../../lib/wbsSettings';
import { v4 as uuidv4 } from 'uuid';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { upsertTasks } from '../../lib/db';
import { round2 } from '../../lib/utils';
import { getTopologicalOrder, applyDependencySchedule, computeEndDateFromEffort, computeStartDateFromEndDate } from '../../lib/schedule';
import { getHolidaysForTaskDates } from '../../lib/calendar';
import {
  computeWorkloadOverloads,
  fixOverloadByExtending,
  fixOverloadByIncreasingAllocation,
  type WorkloadDay,
} from '../../lib/workload';
import { syncParentRollups, redistributeWeightsDown, recomputeProjectRollups } from '../../lib/rollups';

export interface TaskOpsDeps {
  saveHistory: () => void;
  handleDbError: (err: unknown, fallback: string) => void;
  projectsRef: MutableRefObject<Project[]>;
  currentProjectIdRef: MutableRefObject<string>;
  wbsSettingsRef: MutableRefObject<WBSSettings>;
  useLocalOnlyRef: MutableRefObject<boolean>;
  allTasksRef: MutableRefObject<Task[]>;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  recordDeletedTaskIds: (projectId: string, ids: string[]) => void;
}

export function useTaskOps(deps: TaskOpsDeps) {
  const {
    saveHistory, handleDbError,
    projectsRef, currentProjectIdRef, wbsSettingsRef, useLocalOnlyRef, allTasksRef,
    setAllTasks, setProjects, recordDeletedTaskIds,
  } = deps;

  const clampTaskToProjectRange = useCallback((t: Task, proj?: Project): Task => {
    if (!proj) return t;
    let start = t.startDate;
    let end = t.endDate;
    if (proj.startDate && start && start < proj.startDate) start = proj.startDate;
    if (proj.endDate && end && end > proj.endDate) end = proj.endDate;
    if (start && end && start > end) start = end;
    if (start !== t.startDate || end !== t.endDate) return { ...t, startDate: start, endDate: end };
    return t;
  }, []);

  const addTask = useCallback((newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string): string => {
    saveHistory();
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectId = projectIdOverride ?? (cpi === 'all' ? (projs[0]?.id || '') : cpi);
    const project = projs.find(p => p.id === projectId);
    const task: Task = clampTaskToProjectRange(
      { ...newTask, id: uuidv4(), projectId } as Task,
      project,
    );
    setAllTasks(prev => {
      let nextTasks: Task[];
      if (insertAfterId) {
        const index = prev.findIndex(t => t.id === insertAfterId);
        if (index !== -1) { const arr = [...prev]; arr.splice(index + 1, 0, task); nextTasks = arr; }
        else nextTasks = [...prev, task];
      } else nextTasks = [...prev, task];
      const result = syncParentRollups(nextTasks, task.parentId, new Set<string>(((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id)));
      return result;
    });
    return task.id;
  }, [saveHistory, currentProjectIdRef, projectsRef, wbsSettingsRef, setAllTasks, clampTaskToProjectRange]);

  const addTasks = useCallback((newTasks: Task[]) => {
    saveHistory();
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const effectiveProjectId = cpi === 'all' ? (projs[0]?.id || '') : cpi;
    const project = projs.find(p => p.id === effectiveProjectId);
    const tasksWithProject = newTasks.map(t =>
      clampTaskToProjectRange({ ...t, projectId: effectiveProjectId }, project),
    );
    setAllTasks(prev => {
      const result = recomputeProjectRollups([...prev, ...tasksWithProject], effectiveProjectId);
      return result;
    });
  }, [saveHistory, currentProjectIdRef, projectsRef, setAllTasks, clampTaskToProjectRange]);

  const updateTask = useCallback((id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => {
    const skipCascade = options?.skipCascade ?? false;
    saveHistory();
    setAllTasks(prev => {
      const wSettings = wbsSettingsRef.current;
      const projs = projectsRef.current;
      const task = prev.find(t => t.id === id);
      if (!task) return prev;
      const hasDateChange = Object.prototype.hasOwnProperty.call(updates, 'startDate') || Object.prototype.hasOwnProperty.call(updates, 'endDate');
      const hasWorkEffortChange = Object.prototype.hasOwnProperty.call(updates, 'workEffort');
      const hasDependencyChange = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
      const hasScheduleChange = hasDateChange || hasWorkEffortChange || hasDependencyChange;

      const taskLockedFields = new Set(task.userLockedFields ?? []);
      const endDateLocked = taskLockedFields.has('endDate');
      let resolvedUpdates = { ...updates };
      if (typeof resolvedUpdates.weight === 'number' && Number.isFinite(resolvedUpdates.weight)) {
        resolvedUpdates = { ...resolvedUpdates, weight: round2(resolvedUpdates.weight) };
      }
      if (typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
        resolvedUpdates = { ...resolvedUpdates, progress: round2(resolvedUpdates.progress) };
      }
      if (
        typeof resolvedUpdates.status === 'string' &&
        wSettings.linkStatusAndProgress !== false &&
        !Object.prototype.hasOwnProperty.call(updates, 'progress')
      ) {
        const newStatusCfg = wSettings.statusConfigs?.find(c => c.id === resolvedUpdates.status);
        if (newStatusCfg && newStatusCfg.progress === 100) {
          resolvedUpdates = { ...resolvedUpdates, progress: 100 };
        }
      }
      const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(projs.map(p => [p.id, p.assignments ?? []]));
      const assignments = task.projectId ? projectAssignmentsMap.get(task.projectId) : undefined;
      const holidays = getHolidaysForTaskDates(prev);

      if (hasScheduleChange) {
        const newStart = updates.startDate ?? task.startDate;
        const newEnd = updates.endDate ?? task.endDate;
        const workEffort = updates.workEffort !== undefined ? updates.workEffort : task.workEffort;
        const startDateLocked = taskLockedFields.has('startDate');

        if (Object.prototype.hasOwnProperty.call(updates, 'endDate') && !Object.prototype.hasOwnProperty.call(updates, 'startDate') && !startDateLocked) {
          const computedStart = computeStartDateFromEndDate(
            newEnd,
            workEffort,
            assignments,
            holidays,
            task.startDate,
            task.endDate,
          );
          if (computedStart !== task.startDate) {
            resolvedUpdates.startDate = computedStart;
          }
        }

        if (!endDateLocked && !Object.prototype.hasOwnProperty.call(updates, 'endDate')) {
          if (typeof workEffort === 'number' && workEffort > 0) {
            resolvedUpdates.endDate = computeEndDateFromEffort(
              resolvedUpdates.startDate ?? newStart,
              workEffort,
              assignments,
              holidays,
            );
          } else if (updates.startDate) {
            const oldStart = parseISO(task.startDate);
            const oldEnd = parseISO(task.endDate);
            if (isValid(oldStart) && isValid(oldEnd)) {
              const durationDays = differenceInDays(oldEnd, oldStart);
              resolvedUpdates.endDate = format(addDays(parseISO(resolvedUpdates.startDate ?? newStart), durationDays), 'yyyy-MM-dd');
            }
          }
        }
      }

      const lockFields = new Set(task.userLockedFields ?? []);
      if (hasDateChange) {
        if (Object.prototype.hasOwnProperty.call(updates, 'startDate') && resolvedUpdates.startDate != null) {
          lockFields.add('startDate');
          lockFields.delete('endDate');
        }
        if (resolvedUpdates.endDate != null) {
          lockFields.add('endDate');
        }
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'progress') && typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
        lockFields.add('progress');
      }

      let updatedTask = { ...task, ...resolvedUpdates, userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined };
      const project = projs.find(p => p.id === task.projectId);
      updatedTask = clampTaskToProjectRange(updatedTask, project);
      let nextTasks = prev.map(t => t.id === id ? updatedTask : t);

      // 상태 변경 시 모든 하위 작업에 캐스케이드
      if (typeof resolvedUpdates.status === 'string' && wSettings.linkStatusAndProgress !== false) {
        const newStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find(c => c.id === resolvedUpdates.status);
        const oldStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find(c => c.id === task.status);
        const getAllDescendantIds = (rootId: string): string[] => {
          const result: string[] = [];
          const stack = [rootId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of nextTasks) {
              if (t.parentId === pid) {
                result.push(t.id);
                stack.push(t.id);
              }
            }
          }
          return result;
        };
        const descendantIds = new Set(getAllDescendantIds(id));
        if (descendantIds.size > 0) {
          if (newStatusCfg && newStatusCfg.progress === 100) {
            nextTasks = nextTasks.map(t =>
              descendantIds.has(t.id)
                ? { ...t, status: newStatusCfg.id, progress: 100 }
                : t,
            );
          } else if (oldStatusCfg && oldStatusCfg.progress === 100 && newStatusCfg && newStatusCfg.progress !== 100) {
            const doneStatusIds = new Set(((wSettings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
            nextTasks = nextTasks.map(t =>
              descendantIds.has(t.id) && doneStatusIds.has(t.status)
                ? { ...t, status: newStatusCfg.id, progress: newStatusCfg.progress ?? 0 }
                : t,
            );
          }
        }
      }

      // 가중치 변경 시 하위 재분배
      if (Object.prototype.hasOwnProperty.call(updates, 'weight') && typeof updates.weight === 'number' && Number.isFinite(updates.weight)) {
        const parentWeight = updatedTask.weight ?? 0;
        nextTasks = redistributeWeightsDown(nextTasks, id, parentWeight);
      }

      // 일정 변경 시 연관 업무 재계산
      if (hasScheduleChange && task.projectId && !skipCascade) {
        const projectTaskList = nextTasks.filter(t => t.projectId === task.projectId);
        const dateLocked = new Set(projectTaskList.filter(t => (t.userLockedFields ?? []).includes('startDate') || (t.userLockedFields ?? []).includes('endDate')).map(t => t.id));

        const getDescendantIds = (rootId: string): Set<string> => {
          const desc = new Set<string>();
          const stack = [rootId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of projectTaskList) {
              if (t.parentId === pid && !dateLocked.has(t.id) && !desc.has(t.id)) {
                desc.add(t.id);
                stack.push(t.id);
              }
            }
          }
          return desc;
        };
        const descendantIds = getDescendantIds(id);

        const sourceAssignee = updatedTask.assignee ?? '';
        const getSuccessorIds = (predId: string): Set<string> => {
          const succ = new Set<string>();
          const stack = [predId];
          while (stack.length) {
            const pid = stack.pop()!;
            for (const t of projectTaskList) {
              if (t.id === id || dateLocked.has(t.id)) continue;
              if (t.dependencies?.includes(pid)) {
                if ((t.assignee ?? '') !== sourceAssignee) continue;
                if (!succ.has(t.id)) { succ.add(t.id); stack.push(t.id); }
              }
            }
          }
          return succ;
        };
        const getPredecessorIds = (succId: string): Set<string> => {
          const preds = new Set<string>();
          const stack = [succId];
          const existingIds = new Set(projectTaskList.map(t => t.id));
          while (stack.length) {
            const sid = stack.pop()!;
            const t = projectTaskList.find(x => x.id === sid);
            const taskDeps = (t?.dependencies ?? []).filter(depId => existingIds.has(depId));
            for (const depId of taskDeps) {
              if (!dateLocked.has(depId) && !preds.has(depId)) {
                preds.add(depId);
                stack.push(depId);
              }
            }
          }
          return preds;
        };
        const successorIds = getSuccessorIds(id);
        const predecessorIds = getPredecessorIds(id);
        const affectedIds = new Set<string>([id, ...descendantIds, ...successorIds, ...predecessorIds]);

        const oldStart = parseISO(task.startDate);
        const newStart = parseISO(updatedTask.startDate);
        if (isValid(oldStart) && isValid(newStart)) {
          const deltaDays = Math.round(differenceInDays(newStart, oldStart));
          if (deltaDays !== 0) {
            nextTasks = nextTasks.map(t => {
              if (t.id === id) return t;
              if (t.projectId !== task.projectId || !affectedIds.has(t.id)) return t;
              const start = parseISO(t.startDate);
              const end = parseISO(t.endDate);
              if (!isValid(start) || !isValid(end)) return t;
              return {
                ...t,
                startDate: format(addDays(start, deltaDays), 'yyyy-MM-dd'),
                endDate: format(addDays(end, deltaDays), 'yyyy-MM-dd'),
              };
            });
          }
        }

        const projectTasksForSchedule = nextTasks.filter(t => t.projectId === task.projectId);
        const excludeFromRecalc = hasDateChange ? new Set([id]) : undefined;
        const adjusted = applyDependencySchedule(projectTasksForSchedule, projectAssignmentsMap, excludeFromRecalc);
        const adjustedById = new Map(adjusted.map(t => [t.id, t]));

        nextTasks = nextTasks.map(t => {
          if (t.projectId !== task.projectId) return t;
          if (affectedIds.has(t.id)) {
            return adjustedById.get(t.id) ?? t;
          }
          return t;
        });
      }

      const affectsRollup = ['startDate', 'endDate', 'workEffort', 'weight', 'dependencies', 'progress'].some(k =>
        Object.prototype.hasOwnProperty.call(resolvedUpdates, k),
      );
      const doneStatusIds: Set<string> = new Set(((wSettings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
      const parentIdChanged = Object.prototype.hasOwnProperty.call(updates, 'parentId') && updates.parentId !== task.parentId;
      let result = nextTasks;
      if (affectsRollup) {
        const hasChildTasks = prev.some(t => t.parentId === id && t.projectId === task.projectId);
        const isDirectProgressEdit = Object.prototype.hasOwnProperty.call(updates, 'progress');
        if (hasChildTasks && !hasDateChange && !isDirectProgressEdit) {
          result = syncParentRollups(result, id, doneStatusIds, true);
        } else {
          result = syncParentRollups(result, task.parentId, doneStatusIds, true);
        }
      }
      if (parentIdChanged) {
        if (task.parentId) result = syncParentRollups(result, task.parentId, doneStatusIds);
        if (updates.parentId) result = syncParentRollups(result, updates.parentId, doneStatusIds);
      }

      return result;
    });
  }, [saveHistory, wbsSettingsRef, projectsRef, setAllTasks, clampTaskToProjectRange]);

  const updateTasksBulk = useCallback((taskIds: string[], updates: Partial<Task>) => {
    const hasScheduleChange =
      Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
      Object.prototype.hasOwnProperty.call(updates, 'dependencies');
    if (hasScheduleChange || taskIds.length === 0) return;
    saveHistory();
    const idSet = new Set(taskIds);
    setAllTasks(prev => {
      const shouldLockProgress =
        Object.prototype.hasOwnProperty.call(updates, 'progress') &&
        typeof updates.progress === 'number' &&
        Number.isFinite(updates.progress);
      const next = prev.map(t => {
        if (!idSet.has(t.id)) return t;
        if (!shouldLockProgress) return { ...t, ...updates };
        const localLockFields = new Set(t.userLockedFields ?? []);
        localLockFields.add('progress');
        return {
          ...t,
          ...updates,
          userLockedFields: localLockFields.size > 0 ? Array.from(localLockFields) : undefined,
        };
      });
      return next;
    });
  }, [saveHistory, setAllTasks]);

  const setBaselineForTasks = useCallback((taskIds: string[]) => {
    if (taskIds.length === 0) return;
    saveHistory();
    setAllTasks(prev => {
      const idSet = new Set(taskIds);
      return prev.map(t => {
        if (!idSet.has(t.id)) return t;
        return {
          ...t,
          baselineStartDate: t.startDate,
          baselineEndDate: t.endDate,
          baselineWorkEffort: t.workEffort,
        };
      });
    });
  }, [saveHistory, setAllTasks]);

  const setBaselineForAllTasks = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const ids = cpi === 'all'
      ? allTasksRef.current.map(t => t.id)
      : allTasksRef.current.filter(t => t.projectId === cpi).map(t => t.id);
    setBaselineForTasks(ids);
  }, [setBaselineForTasks, currentProjectIdRef, allTasksRef]);

  const renameAssignee = useCallback((oldName: string, newName: string) => {
    const from = (oldName ?? '').trim();
    const to = (newName ?? '').trim();
    if (!from || !to || from === to) return;
    saveHistory();

    setProjects(prev => {
      const next = prev.map(p => {
        const pAssignments = p.assignments ?? [];
        const has = pAssignments.some(a => (a.assignee ?? '').trim() === from);
        if (!has) return p;
        return {
          ...p,
          assignments: pAssignments.map(a => ((a.assignee ?? '').trim() === from ? { ...a, assignee: to } : a)),
        };
      });
      return next;
    });

    setAllTasks(prev => {
      const next = prev.map(t => {
        const nextAssignee = ((t.assignee ?? '').trim() === from) ? to : t.assignee;
        if (nextAssignee === t.assignee) return t;
        return { ...t, assignee: nextAssignee ?? '' };
      });
      if (!useLocalOnlyRef.current) upsertTasks(next).catch(err => handleDbError(err, '투입인원 이름 변경 저장에 실패했습니다.'));
      return next;
    });
  }, [saveHistory, handleDbError, useLocalOnlyRef, setProjects, setAllTasks]);

  const refreshProjectSchedule = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectIds = cpi === 'all'
      ? projs.map(p => p.id).filter(Boolean)
      : [cpi].filter(Boolean);
    if (projectIds.length === 0) return;
    saveHistory();
    setAllTasks(prev => {
      const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>(
        projectsRef.current.map(p => [p.id, p.assignments ?? []]),
      );
      let result = prev;
      for (const effectiveProjectId of projectIds) {
        const projectTasks = result.filter(t => t.projectId === effectiveProjectId);
        if (projectTasks.length === 0) continue;
        const adjusted = applyDependencySchedule(projectTasks, projectAssignmentsByProjectId);
        const adjustedById = new Map(adjusted.map(t => [t.id, t]));
        result = result.map(t => t.projectId === effectiveProjectId ? (adjustedById.get(t.id) ?? t) : t);
        result = recomputeProjectRollups(result, effectiveProjectId);
      }
      return result;
    });
  }, [saveHistory, currentProjectIdRef, projectsRef, setAllTasks]);

  const fixOverload = useCallback((overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => {
    if (overloadsToFix.length === 0) return;
    saveHistory();
    const extendOverloads = overloadsToFix.filter((x) => x.strategy === 'extend').map((x) => x.overload);
    const allocationOverloads = overloadsToFix.filter((x) => x.strategy === 'increaseAllocation').map((x) => x.overload);
    setAllTasks((prev) => {
      const projs = projectsRef.current;
      const settings = wbsSettingsRef.current;
      let result = [...prev];
      const allocationTaskIds = new Set(allocationOverloads.flatMap((o) => o.taskIds));
      if (extendOverloads.length > 0) {
        result = fixOverloadByExtending(result, projs, extendOverloads);
      }
      if (allocationOverloads.length > 0) {
        const { overloads: currentOverloads } = computeWorkloadOverloads(result, projs);
        const toAllocate = currentOverloads.filter((o) => o.taskIds.some((tid) => allocationTaskIds.has(tid)));
        if (toAllocate.length > 0) {
          result = fixOverloadByIncreasingAllocation(result, projs, toAllocate);
        }
      }
      const pids = Array.from(new Set(result.map((t) => t.projectId))).filter(Boolean) as string[];
      const doneStatusIds: Set<string> = new Set(((settings.statusConfigs ?? []) as StatusConfig[]).filter(c => c.progress === 100).map(c => c.id));
      for (const pid of pids) {
        result = recomputeProjectRollups(result, pid, doneStatusIds);
      }
      return result;
    });
  }, [saveHistory, projectsRef, wbsSettingsRef, setAllTasks]);

  const deleteTask = useCallback((id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const taskToDelete = prev.find(t => t.id === id);
      if (!taskToDelete) return prev;
      const getAllDescendantIds = (parentId: string, list: Task[]): string[] => {
        const children = list.filter(t => t.parentId === parentId);
        return [...children.map(c => c.id), ...children.flatMap(c => getAllDescendantIds(c.id, list))];
      };
      const idsToDelete = [id, ...getAllDescendantIds(id, prev)];
      if (taskToDelete.projectId) recordDeletedTaskIds(taskToDelete.projectId, idsToDelete);
      return syncParentRollups(prev.filter(t => !new Set(idsToDelete).has(t.id)), taskToDelete.parentId);
    });
  }, [saveHistory, setAllTasks, recordDeletedTaskIds]);

  return {
    addTask, addTasks, updateTask, updateTasksBulk,
    setBaselineForTasks, setBaselineForAllTasks,
    renameAssignee, refreshProjectSchedule, fixOverload, deleteTask,
  };
}
