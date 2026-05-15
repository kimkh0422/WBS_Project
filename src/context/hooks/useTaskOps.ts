import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project, ProjectAssignment } from '../../types';
import { WBSSettings, StatusConfig } from '../../lib/wbsSettings';
import { v4 as uuidv4 } from 'uuid';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { upsertTasks, upsertProject } from '../../lib/db';
import { round1, round2 } from '../../lib/utils';
import { getTopologicalOrder, applyDependencySchedule, computeEndDateFromEffort, computeStartDateFromEndDate } from '../../lib/schedule';
import { getHolidaysForTaskDates } from '../../lib/calendar';
import { computeWorkloadOverloads, fixOverloadByExtending, fixOverloadByIncreasingAllocation, type WorkloadDay } from '../../lib/workload';
import { syncParentRollups, recomputeProjectRollups, syncParentStatus } from '../../lib/rollups';
import { buildProjectEffortUnitMap, normalizeWorkEffortUnit, workEffortToManDays } from '../../lib/workEffortUnits';

/** rootIds와 그 모든 하위 작업 id (같은 트리: parentId 체인). */
function collectDescendantTaskIds(rootIds: Iterable<string>, tasks: Task[]): Set<string> {
  const childrenByParentId = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = childrenByParentId.get(t.parentId);
    if (list) list.push(t.id);
    else childrenByParentId.set(t.parentId, [t.id]);
  }
  const out = new Set<string>(rootIds);
  const stack = [...out];
  while (stack.length) {
    const id = stack.pop()!;
    const ch = childrenByParentId.get(id);
    if (!ch) continue;
    for (const c of ch) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

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
  /** 작업 일정이 프로젝트 범위 밖으로 변경되어 프로젝트가 자동 확장될 때 dirty 플래그를 올린다. */
  bumpDirty: () => void;
}

export function useTaskOps(deps: TaskOpsDeps) {
  const {
    saveHistory,
    handleDbError,
    projectsRef,
    currentProjectIdRef,
    wbsSettingsRef,
    useLocalOnlyRef,
    allTasksRef,
    setAllTasks,
    setProjects,
    recordDeletedTaskIds,
    bumpDirty,
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

  const addTask = useCallback(
    (newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string): string => {
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      const projectId = projectIdOverride ?? (cpi === 'all' ? projs[0]?.id || '' : cpi);
      const project = projs.find((p) => p.id === projectId);
      const task: Task = clampTaskToProjectRange({ ...newTask, id: uuidv4(), projectId } as Task, project);
      setAllTasks((prev) => {
        let nextTasks: Task[];
        if (insertAfterId) {
          const index = prev.findIndex((t) => t.id === insertAfterId);
          if (index !== -1) {
            const arr = [...prev];
            arr.splice(index + 1, 0, task);
            nextTasks = arr;
          } else nextTasks = [...prev, task];
        } else nextTasks = [...prev, task];
        // 가중치: 형제 값은 건드리지 않음. 명시된 경우만 반올림해 저장(합 100 제약 없음).
        const hasExplicitWeight = typeof task.weight === 'number' && Number.isFinite(task.weight);
        if (hasExplicitWeight && task.projectId) {
          nextTasks = nextTasks.map((t) => (t.id === task.id ? { ...t, weight: round1(task.weight as number) } : t));
        }
        const result = syncParentRollups(
          nextTasks,
          task.parentId,
          new Set<string>(
            ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
          ),
        );
        return result;
      });
      return task.id;
    },
    [saveHistory, currentProjectIdRef, projectsRef, wbsSettingsRef, setAllTasks, clampTaskToProjectRange],
  );

  const addTasks = useCallback(
    (newTasks: Task[]) => {
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      const effectiveProjectId = cpi === 'all' ? projs[0]?.id || '' : cpi;
      const project = projs.find((p) => p.id === effectiveProjectId);
      const tasksWithProject = newTasks.map((t) => clampTaskToProjectRange({ ...t, projectId: effectiveProjectId }, project));
      setAllTasks((prev) => {
        const next = [...prev, ...tasksWithProject];

        return recomputeProjectRollups(next, effectiveProjectId);
      });
    },
    [saveHistory, currentProjectIdRef, projectsRef, setAllTasks, clampTaskToProjectRange],
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<Task>, options?: { skipCascade?: boolean }) => {
      const skipCascade = options?.skipCascade ?? false;
      saveHistory();
      // setAllTasks 업데이터에서 프로젝트 자동 확장이 필요한지 결정한 뒤, 외부에서 setProjects/upsertProject로 반영한다.
      let projectExpansionToApply: { project: Project; expansion: { startDate?: string; endDate?: string } } | null = null;
      setAllTasks((prev) => {
        const wSettings = wbsSettingsRef.current;
        const projs = projectsRef.current;
        const task = prev.find((t) => t.id === id);
        if (!task) return prev;
        const hasDateChange =
          Object.prototype.hasOwnProperty.call(updates, 'startDate') || Object.prototype.hasOwnProperty.call(updates, 'endDate');
        const hasWorkEffortChange = Object.prototype.hasOwnProperty.call(updates, 'workEffort');
        const hasDependencyChange = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
        const hasScheduleChange = hasDateChange || hasWorkEffortChange || hasDependencyChange;

        const taskLockedFields = new Set(task.userLockedFields ?? []);
        const endDateLocked = taskLockedFields.has('endDate');
        let resolvedUpdates = { ...updates };
        if (typeof resolvedUpdates.weight === 'number' && Number.isFinite(resolvedUpdates.weight)) {
          resolvedUpdates = { ...resolvedUpdates, weight: round1(resolvedUpdates.weight) };
        }
        if (typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
          resolvedUpdates = { ...resolvedUpdates, progress: round2(resolvedUpdates.progress) };
        }
        if (
          typeof resolvedUpdates.status === 'string' &&
          wSettings.linkStatusAndProgress !== false &&
          !Object.prototype.hasOwnProperty.call(updates, 'progress')
        ) {
          const newStatusCfg = wSettings.statusConfigs?.find((c) => c.id === resolvedUpdates.status);
          if (newStatusCfg && newStatusCfg.progress === 100) {
            resolvedUpdates = { ...resolvedUpdates, progress: 100 };
          }
        }
        const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(projs.map((p) => [p.id, p.assignments ?? []]));
        const assignments = task.projectId ? projectAssignmentsMap.get(task.projectId) : undefined;
        const holidays = getHolidaysForTaskDates(prev);
        const effortProject = projs.find((p) => p.id === task.projectId);
        const effortUnit = normalizeWorkEffortUnit(effortProject?.workEffortUnit);
        const linkEffortToSchedule = wSettings.linkEffortToSchedule === true;
        const scheduleOpts = { linkEffortToSchedule } as const;

        if (hasScheduleChange && linkEffortToSchedule) {
          const newStart = updates.startDate ?? task.startDate;
          const newEnd = updates.endDate ?? task.endDate;
          const workEffort = updates.workEffort !== undefined ? updates.workEffort : task.workEffort;
          const startDateLocked = taskLockedFields.has('startDate');
          const workEffortMd = typeof workEffort === 'number' && workEffort > 0 ? workEffortToManDays(workEffort, effortUnit) : undefined;

          if (
            Object.prototype.hasOwnProperty.call(updates, 'endDate') &&
            !Object.prototype.hasOwnProperty.call(updates, 'startDate') &&
            !startDateLocked
          ) {
            const computedStart = computeStartDateFromEndDate(newEnd, workEffortMd, assignments, holidays, task.startDate, task.endDate);
            if (computedStart !== task.startDate) {
              resolvedUpdates.startDate = computedStart;
            }
          }

          if (!endDateLocked && !Object.prototype.hasOwnProperty.call(updates, 'endDate')) {
            if (typeof workEffortMd === 'number' && workEffortMd > 0) {
              resolvedUpdates.endDate = computeEndDateFromEffort(
                resolvedUpdates.startDate ?? newStart,
                workEffortMd,
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
        if (
          Object.prototype.hasOwnProperty.call(updates, 'progress') &&
          typeof resolvedUpdates.progress === 'number' &&
          Number.isFinite(resolvedUpdates.progress)
        ) {
          lockFields.add('progress');
        }

        let updatedTask = { ...task, ...resolvedUpdates, userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined };
        const project = projs.find((p) => p.id === task.projectId);

        // 사용자가 명시적으로 작업 일정을 프로젝트 범위 밖으로 변경하면, 클램프하지 않고 프로젝트 범위를 자동 확장한다.
        // (그렇지 않으면 사용자의 변경이 클램프에 의해 무효화되어, 화면에서는 "날짜가 변경되지 않는" 것처럼 보인다.)
        // 상위 작업 일정은 syncParentRollups가 자식 min/max로 자동 확장하므로, 여기서는 프로젝트 경계만 처리.
        const explicitStartChange = hasDateChange && Object.prototype.hasOwnProperty.call(updates, 'startDate');
        const explicitEndChange =
          hasDateChange &&
          (Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
            // linkEffortToSchedule 모드에서 startDate 변경에 따라 endDate가 자동 계산된 경우도 포함.
            (explicitStartChange && resolvedUpdates.endDate != null));
        const expansion: { startDate?: string; endDate?: string } = {};
        if (project) {
          if (explicitStartChange && updatedTask.startDate && project.startDate && updatedTask.startDate < project.startDate) {
            expansion.startDate = updatedTask.startDate;
          }
          if (explicitEndChange && updatedTask.endDate && project.endDate && updatedTask.endDate > project.endDate) {
            expansion.endDate = updatedTask.endDate;
          }
        }
        const willExpandProject = expansion.startDate !== undefined || expansion.endDate !== undefined;
        const effectiveProject = willExpandProject ? ({ ...project!, ...expansion } as Project) : project;
        updatedTask = clampTaskToProjectRange(updatedTask, effectiveProject);

        // 프로젝트 범위 확장은 setAllTasks 외부에서 setProjects/upsertProject로 별도 적용해야 한다.
        if (willExpandProject && project) {
          projectExpansionToApply = { project, expansion };
        }
        let nextTasks = prev.map((t) => (t.id === id ? updatedTask : t));

        // 상태 변경 시 모든 하위 작업에 캐스케이드
        if (typeof resolvedUpdates.status === 'string' && wSettings.linkStatusAndProgress !== false) {
          const newStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find((c) => c.id === resolvedUpdates.status);
          const oldStatusCfg = ((wSettings.statusConfigs ?? []) as StatusConfig[]).find((c) => c.id === task.status);
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
              nextTasks = nextTasks.map((t) => (descendantIds.has(t.id) ? { ...t, status: newStatusCfg.id, progress: 100 } : t));
            } else if (oldStatusCfg && oldStatusCfg.progress === 100 && newStatusCfg && newStatusCfg.progress !== 100) {
              const doneStatusIds = new Set(
                ((wSettings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
              );
              nextTasks = nextTasks.map((t) =>
                descendantIds.has(t.id) && doneStatusIds.has(t.status)
                  ? { ...t, status: newStatusCfg.id, progress: newStatusCfg.progress ?? 0 }
                  : t,
              );
            }
          }
        }

        // 담당자가 실제로 바뀐 경우에만 모든 하위 작업에 같은 담당자 자동 등록 (모달 저장 등 불필요한 전파 방지)
        if (Object.prototype.hasOwnProperty.call(updates, 'assignee') && typeof resolvedUpdates.assignee === 'string') {
          const newAssignee = resolvedUpdates.assignee;
          if ((task.assignee ?? '').trim() !== (newAssignee ?? '').trim()) {
            const descendantIds = collectDescendantTaskIds([id], nextTasks);
            descendantIds.delete(id);
            if (descendantIds.size > 0) {
              nextTasks = nextTasks.map((t) => (descendantIds.has(t.id) ? { ...t, assignee: newAssignee } : t));
            }
          }
        }

        // 일정 변경 시 연관 업무 재계산
        if (hasScheduleChange && task.projectId && !skipCascade) {
          const projectTaskList = nextTasks.filter((t) => t.projectId === task.projectId);
          const dateLocked = new Set(
            projectTaskList
              .filter((t) => (t.userLockedFields ?? []).includes('startDate') || (t.userLockedFields ?? []).includes('endDate'))
              .map((t) => t.id),
          );

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
                  if (!succ.has(t.id)) {
                    succ.add(t.id);
                    stack.push(t.id);
                  }
                }
              }
            }
            return succ;
          };
          const getPredecessorIds = (succId: string): Set<string> => {
            const preds = new Set<string>();
            const stack = [succId];
            const existingIds = new Set(projectTaskList.map((t) => t.id));
            while (stack.length) {
              const sid = stack.pop()!;
              const t = projectTaskList.find((x) => x.id === sid);
              const taskDeps = (t?.dependencies ?? []).filter((depId) => existingIds.has(depId));
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
              nextTasks = nextTasks.map((t) => {
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

          const projectTasksForSchedule = nextTasks.filter((t) => t.projectId === task.projectId);
          const excludeFromRecalc = hasDateChange ? new Set([id]) : undefined;
          const projectEffortUnitByProjectId = buildProjectEffortUnitMap(projs);
          const adjusted = applyDependencySchedule(
            projectTasksForSchedule,
            projectAssignmentsMap,
            excludeFromRecalc,
            projectEffortUnitByProjectId,
            scheduleOpts,
          );
          const adjustedById = new Map(adjusted.map((t) => [t.id, t]));

          nextTasks = nextTasks.map((t) => {
            if (t.projectId !== task.projectId) return t;
            if (affectedIds.has(t.id)) {
              return adjustedById.get(t.id) ?? t;
            }
            return t;
          });
        }

        const affectsRollup = ['startDate', 'endDate', 'workEffort', 'weight', 'dependencies', 'progress'].some((k) =>
          Object.prototype.hasOwnProperty.call(resolvedUpdates, k),
        );
        const doneStatusIds: Set<string> = new Set(
          ((wSettings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        const parentIdChanged = Object.prototype.hasOwnProperty.call(updates, 'parentId') && updates.parentId !== task.parentId;
        let result = nextTasks;
        if (affectsRollup) {
          const hasChildTasks = prev.some((t) => t.parentId === id && t.projectId === task.projectId);
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

        // 자식 단계(status) 변경 시 부모(및 조상)의 단계도 함께 갱신.
        // 단계 표시는 자식들의 실제 상태를 반영해야 하므로 linkStatusAndProgress와 무관하게 항상 전파.
        // 단, 상위 단계 변경에 따른 progress 자동 적용은 linkStatusAndProgress 설정으로 제어.
        const statusChanged =
          Object.prototype.hasOwnProperty.call(updates, 'status') &&
          typeof resolvedUpdates.status === 'string' &&
          resolvedUpdates.status !== task.status;
        if (statusChanged) {
          const cfgs = (wSettings.statusConfigs ?? []) as StatusConfig[];
          if (cfgs.length > 0) {
            const syncProgress = wSettings.linkStatusAndProgress !== false;
            // 변경된 작업의 부모부터 위로 전파
            if (task.parentId) {
              result = syncParentStatus(result, task.parentId, cfgs, syncProgress);
            }
            // 부모가 바뀐 경우 새 부모쪽도 검사
            if (parentIdChanged && updates.parentId) {
              result = syncParentStatus(result, updates.parentId, cfgs, syncProgress);
            }
          }
        }

        // 일정 필드 변경 시 의존 작업/연쇄 작업이 다른 가지에 있을 수 있어
        // 해당 가지의 상위 작업 기간 롤업이 누락되지 않도록 프로젝트 단위로 최종 정합화한다.
        // 단, 사용자가 직접 편집한 부모 작업(자식이 있는 경우)은 자식 min/max로 덮어쓰지 않도록 제외.
        if (hasScheduleChange && task.projectId) {
          const hasChildTasks = nextTasks.some((t) => t.parentId === id && t.projectId === task.projectId);
          const excludeFromRollup = hasChildTasks ? new Set([id]) : undefined;
          result = recomputeProjectRollups(result, task.projectId, doneStatusIds, excludeFromRollup);
        }

        return result;
      });

      // 작업 일정이 프로젝트 범위 밖으로 변경된 경우, 프로젝트 시작/종료일을 자동 확장하여 저장한다.
      if (projectExpansionToApply) {
        const { project, expansion } = projectExpansionToApply;
        const expandedProject: Project = { ...project, ...expansion };
        setProjects((prev) => prev.map((p) => (p.id === project.id ? expandedProject : p)));
        bumpDirty();
        if (!useLocalOnlyRef.current) {
          upsertProject(expandedProject).catch((err) => handleDbError(err, '프로젝트 일정 자동 확장 저장에 실패했습니다.'));
        }
      }
    },
    [
      saveHistory,
      wbsSettingsRef,
      projectsRef,
      setAllTasks,
      setProjects,
      clampTaskToProjectRange,
      bumpDirty,
      handleDbError,
      useLocalOnlyRef,
    ],
  );

  const updateTasksBulk = useCallback(
    (taskIds: string[], updates: Partial<Task>) => {
      const hasScheduleChange =
        Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
        Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
        Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
        Object.prototype.hasOwnProperty.call(updates, 'dependencies');
      if (hasScheduleChange || taskIds.length === 0) return;
      saveHistory();
      const originalIdSet = new Set(taskIds);
      const hasAssignee = Object.prototype.hasOwnProperty.call(updates, 'assignee') && typeof updates.assignee === 'string';
      setAllTasks((prev) => {
        const idSet = hasAssignee ? collectDescendantTaskIds(originalIdSet, prev) : originalIdSet;
        const assigneePatch: Partial<Task> = hasAssignee ? { assignee: updates.assignee as string } : {};
        const next = prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const patch = originalIdSet.has(t.id) ? updates : assigneePatch;
          if (Object.keys(patch).length === 0) return t;
          const patchLocksProgress =
            Object.prototype.hasOwnProperty.call(patch, 'progress') &&
            typeof patch.progress === 'number' &&
            Number.isFinite(patch.progress);
          if (!patchLocksProgress) return { ...t, ...patch };
          const localLockFields = new Set(t.userLockedFields ?? []);
          localLockFields.add('progress');
          return {
            ...t,
            ...patch,
            userLockedFields: localLockFields.size > 0 ? Array.from(localLockFields) : undefined,
          };
        });

        return next;
      });
    },
    [saveHistory, setAllTasks],
  );

  const setBaselineForTasks = useCallback(
    (taskIds: string[]) => {
      if (taskIds.length === 0) return;
      saveHistory();
      setAllTasks((prev) => {
        const idSet = new Set(taskIds);
        return prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          return {
            ...t,
            baselineStartDate: t.startDate,
            baselineEndDate: t.endDate,
            baselineWorkEffort: t.workEffort,
          };
        });
      });
    },
    [saveHistory, setAllTasks],
  );

  const setBaselineForAllTasks = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const ids =
      cpi === 'all' ? allTasksRef.current.map((t) => t.id) : allTasksRef.current.filter((t) => t.projectId === cpi).map((t) => t.id);
    setBaselineForTasks(ids);
  }, [setBaselineForTasks, currentProjectIdRef, allTasksRef]);

  const renameAssignee = useCallback(
    (oldName: string, newName: string) => {
      const from = (oldName ?? '').trim();
      const to = (newName ?? '').trim();
      if (!from || !to || from === to) return;
      saveHistory();

      setProjects((prev) => {
        const next = prev.map((p) => {
          const pAssignments = p.assignments ?? [];
          const has = pAssignments.some((a) => (a.assignee ?? '').trim() === from);
          if (!has) return p;
          return {
            ...p,
            assignments: pAssignments.map((a) => ((a.assignee ?? '').trim() === from ? { ...a, assignee: to } : a)),
          };
        });
        return next;
      });

      setAllTasks((prev) => {
        const next = prev.map((t) => {
          const nextAssignee = (t.assignee ?? '').trim() === from ? to : t.assignee;
          if (nextAssignee === t.assignee) return t;
          return { ...t, assignee: nextAssignee ?? '' };
        });
        if (!useLocalOnlyRef.current) upsertTasks(next).catch((err) => handleDbError(err, '투입인원 이름 변경 저장에 실패했습니다.'));
        return next;
      });
    },
    [saveHistory, handleDbError, useLocalOnlyRef, setProjects, setAllTasks],
  );

  const refreshProjectSchedule = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectIds = cpi === 'all' ? projs.map((p) => p.id).filter(Boolean) : [cpi].filter(Boolean);
    if (projectIds.length === 0) return;
    saveHistory();
    setAllTasks((prev) => {
      const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>(
        projectsRef.current.map((p) => [p.id, p.assignments ?? []]),
      );
      const projectEffortUnitByProjectId = buildProjectEffortUnitMap(projectsRef.current);
      const scheduleOpts = { linkEffortToSchedule: wbsSettingsRef.current.linkEffortToSchedule === true } as const;
      let result = prev;
      for (const effectiveProjectId of projectIds) {
        const projectTasks = result.filter((t) => t.projectId === effectiveProjectId);
        if (projectTasks.length === 0) continue;
        const adjusted = applyDependencySchedule(
          projectTasks,
          projectAssignmentsByProjectId,
          undefined,
          projectEffortUnitByProjectId,
          scheduleOpts,
        );
        const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
        result = result.map((t) => (t.projectId === effectiveProjectId ? (adjustedById.get(t.id) ?? t) : t));
        result = recomputeProjectRollups(result, effectiveProjectId);
      }
      return result;
    });
  }, [saveHistory, currentProjectIdRef, projectsRef, wbsSettingsRef, setAllTasks]);

  const fixOverload = useCallback(
    (overloadsToFix: Array<{ overload: WorkloadDay; strategy: 'extend' | 'increaseAllocation' }>) => {
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
        const doneStatusIds: Set<string> = new Set(
          ((settings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        for (const pid of pids) {
          result = recomputeProjectRollups(result, pid, doneStatusIds);
        }
        return result;
      });
    },
    [saveHistory, projectsRef, wbsSettingsRef, setAllTasks],
  );

  /** 표에 보이는 순서대로 선행작업을 FS 체인으로 연결 (두 번째 행부터 직전 선택 행이 선행). */
  const linkSequentialPredecessors = useCallback(
    (
      orderedTaskIds: string[],
      options?: {
        /** 일괄 바 공수를 체인 작업에 먼저 반영 */
        bulkWorkEffort?: number;
        /** 일괄 바 투입율(%)을 담당자별 프로젝트 투입에 반영 */
        bulkAllocationPercent?: number;
      },
    ) => {
      if (orderedTaskIds.length < 2) return;
      saveHistory();

      let projs = projectsRef.current;
      const bulkEffort = options?.bulkWorkEffort;
      const bulkAlloc = options?.bulkAllocationPercent;
      if (bulkAlloc != null && Number.isFinite(bulkAlloc)) {
        const pct = Math.min(100, Math.max(0, Math.round(bulkAlloc * 10) / 10));
        const taskById = new Map(allTasksRef.current.map((t) => [t.id, t]));
        const assigneesByProjectId = new Map<string, Set<string>>();
        for (const id of orderedTaskIds) {
          const t = taskById.get(id);
          if (!t?.projectId) continue;
          const assignee = (t.assignee || '').trim();
          if (!assignee) continue;
          const set = assigneesByProjectId.get(t.projectId) ?? new Set<string>();
          set.add(assignee);
          assigneesByProjectId.set(t.projectId, set);
        }
        if (assigneesByProjectId.size > 0) {
          projs = projs.map((p) => {
            const assignees = assigneesByProjectId.get(p.id);
            if (!assignees) return p;
            const existing = p.assignments ?? [];
            const nextAssignments = existing.filter((a) => !assignees.has((a.assignee || '').trim()));
            for (const assignee of assignees) {
              nextAssignments.push({ assignee, allocationPercent: pct });
            }
            return { ...p, assignments: nextAssignments };
          });
          setProjects(projs);
          if (!useLocalOnlyRef.current) {
            for (const [projectId] of assigneesByProjectId) {
              const updated = projs.find((p) => p.id === projectId);
              if (updated) upsertProject(updated).catch((err) => handleDbError(err, '투입율 저장에 실패했습니다.'));
            }
          }
        }
      }

      setAllTasks((prev) => {
        const wSettings = wbsSettingsRef.current;
        const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(projs.map((p) => [p.id, p.assignments ?? []]));
        const unitMap = buildProjectEffortUnitMap(projs);
        const taskById = new Map<string, Task>(prev.map((t) => [t.id, t] as const));

        const resolved: Task[] = [];
        for (const id of orderedTaskIds) {
          const t = taskById.get(id);
          if (t) resolved.push(t);
        }
        if (resolved.length < 2) return prev;

        const projectId = resolved[0]!.projectId;
        if (!projectId) return prev;

        const sameProject = resolved.filter((t) => t.projectId === projectId);
        if (sameProject.length < 2) return prev;

        const indexInChain = new Map<string, number>();
        sameProject.forEach((t, i) => indexInChain.set(t.id, i));

        const applyBulkEffort =
          bulkEffort != null && Number.isFinite(bulkEffort) && bulkEffort >= 0 ? Math.round(bulkEffort * 10) / 10 : undefined;

        let nextTasks = prev.map((t) => {
          const idx = indexInChain.get(t.id);
          if (idx == null) return t;

          const lockFields = new Set(t.userLockedFields ?? []);
          lockFields.delete('startDate');
          lockFields.delete('endDate');
          lockFields.add('dependencies');

          let updated: Task = { ...t, userLockedFields: lockFields.size > 0 ? Array.from(lockFields) : undefined };

          if (applyBulkEffort != null) {
            updated = { ...updated, workEffort: applyBulkEffort };
            lockFields.add('workEffort');
            updated.userLockedFields = Array.from(lockFields);
          }

          if (idx > 0) {
            const prevInChain = sameProject[idx - 1]!.id;
            updated = { ...updated, dependencies: [prevInChain] };
          }

          return updated;
        });

        const projectTaskList = nextTasks.filter((t) => t.projectId === projectId);
        // 선행 순차 연결은 공수·투입율 기준 일정 재산정이 핵심이므로 linkEffortToSchedule 설정과 무관하게 적용
        const adjusted = applyDependencySchedule(projectTaskList, projectAssignmentsMap, undefined, unitMap, {
          linkEffortToSchedule: true,
        });
        const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
        nextTasks = nextTasks.map((t) => (t.projectId === projectId ? (adjustedById.get(t.id) ?? t) : t));

        const doneStatusIds = new Set(
          ((wSettings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        return recomputeProjectRollups(nextTasks, projectId, doneStatusIds);
      });
    },
    [saveHistory, wbsSettingsRef, projectsRef, allTasksRef, setAllTasks, setProjects, useLocalOnlyRef, handleDbError],
  );

  const deleteTask = useCallback(
    (id: string) => {
      saveHistory();
      setAllTasks((prev) => {
        const taskToDelete = prev.find((t) => t.id === id);
        if (!taskToDelete) return prev;
        const getAllDescendantIds = (parentId: string, list: Task[]): string[] => {
          const children = list.filter((t) => t.parentId === parentId);
          return [...children.map((c) => c.id), ...children.flatMap((c) => getAllDescendantIds(c.id, list))];
        };
        const idsToDelete = [id, ...getAllDescendantIds(id, prev)];
        if (taskToDelete.projectId) recordDeletedTaskIds(taskToDelete.projectId, idsToDelete);
        const next = prev.filter((t) => !new Set(idsToDelete).has(t.id));
        return syncParentRollups(next, taskToDelete.parentId);
      });
    },
    [saveHistory, setAllTasks, recordDeletedTaskIds],
  );

  return {
    addTask,
    addTasks,
    updateTask,
    updateTasksBulk,
    linkSequentialPredecessors,
    setBaselineForTasks,
    setBaselineForAllTasks,
    renameAssignee,
    refreshProjectSchedule,
    fixOverload,
    deleteTask,
  };
}
