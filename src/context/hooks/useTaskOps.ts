import { useCallback, useMemo, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project } from '../../types';
import { WBSSettings, StatusConfig } from '../../lib/wbsSettings';
import { v4 as uuidv4 } from 'uuid';
import { upsertTasks, upsertProject } from '../../lib/db';
import { round1, round2 } from '../../lib/utils';
import { setPlannedOverrideLocal } from '../../lib/plannedOverrideLocalCache';
import { setWeightLocal } from '../../lib/weightLocalCache';
import { clampAllocationPercentInt } from '../../lib/personAllocations';
import { applyDependencySchedule, distributeChildrenEvenly } from '../../lib/schedule';
import { syncParentRollups, recomputeProjectRollups, syncParentStatus, distributeProgressDown } from '../../lib/rollups';
import { resolveWorkEffortForNewTask } from '../../lib/workEffortUnits';
import { applyMilestoneDateInvariant } from '../../lib/milestoneDates';
import { expandProjectStoredDatesToTaskSpan } from '../../lib/projectPeriod';

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
  bumpDirty: () => void;
  dirtyEpochRef: MutableRefObject<number>;
  clearUnsyncedIfDirtyEpochIs: (epoch: number) => void;
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
    dirtyEpochRef,
    clearUnsyncedIfDirtyEpochIs,
  } = deps;

  const addTask = useCallback(
    (newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string, projectIdOverride?: string): string => {
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      const projectId = projectIdOverride ?? (cpi === 'all' ? projs[0]?.id || '' : cpi);
      // 신규 작업의 계획율 기본값: 미입력(빈칸). 계획율은 완전 수동이라 사용자가 직접 입력하기 전까진 비워 둔다.
      // 호출자가 명시적으로 값을 넘긴 경우에만 그 값을 존중한다.
      const plannedOverrideForNew =
        typeof newTask.plannedProgressOverride === 'number' && Number.isFinite(newTask.plannedProgressOverride)
          ? newTask.plannedProgressOverride
          : null;
      const task: Task = applyMilestoneDateInvariant({
        ...newTask,
        plannedProgressOverride: plannedOverrideForNew,
        workEffort: resolveWorkEffortForNewTask(newTask.workEffort),
        id: uuidv4(),
        projectId,
      } as Task);
      // 명시적으로 계획율을 받은 경우에만 로컬 캐시에 기록(미입력은 빈칸 유지).
      if (typeof plannedOverrideForNew === 'number') setPlannedOverrideLocal(task.id, plannedOverrideForNew);
      let tasksToPersist: Task[] | null = null;
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
        // 가중치: 형제 값은 건드리지 않음. 명시된 경우만 반올림해 저장(합 100 제약 없음) + 로컬 캐시 기록.
        const hasExplicitWeight = typeof task.weight === 'number' && Number.isFinite(task.weight);
        if (hasExplicitWeight && task.projectId) {
          const normalized = round1(task.weight as number);
          nextTasks = nextTasks.map((t) => (t.id === task.id ? { ...t, weight: normalized } : t));
          setWeightLocal(task.id, normalized);
        }
        const result = syncParentRollups(
          nextTasks,
          task.parentId,
          new Set<string>(
            ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
          ),
          undefined,
          undefined,
          undefined,
          true,
        );
        tasksToPersist = result;
        return result;
      });
      // 신규 작업이 로컬에만 남아 새로고침·동기화 시 사라지지 않도록 변경분을 즉시 저장 (updateTask·일정 연산과 동일 패턴).
      if (tasksToPersist) {
        if (task.projectId && !useLocalOnlyRef.current) {
          const pid = task.projectId;
          const rows = (tasksToPersist as Task[]).filter((t) => t.projectId === pid);
          if (rows.length > 0) {
            bumpDirty();
            const epoch = dirtyEpochRef.current;
            void upsertTasks(rows)
              .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
              .catch((err) => handleDbError(err, '새 작업 저장에 실패했습니다.'));
          }
        } else {
          bumpDirty();
        }
      }
      return task.id;
    },
    [
      saveHistory,
      currentProjectIdRef,
      projectsRef,
      wbsSettingsRef,
      setAllTasks,
      bumpDirty,
      useLocalOnlyRef,
      handleDbError,
      dirtyEpochRef,
      clearUnsyncedIfDirtyEpochIs,
    ],
  );

  /**
   * 여러 작업을 한 번의 setAllTasks + (가능하면) 한 번의 upsert로 삽입한다.
   * 연속 addTask마다 비동기 upsertTasks가 겹치면 이전 스냅샷이 나중에 덮여 행이 사라지는 문제가 생길 수 있어,
   * 작업 단위 붙여넣기 등에서는 이 API를 사용한다.
   */
  const insertPastedTasksInOrder = useCallback(
    (rows: Array<{ id: string; draft: Omit<Task, 'id' | 'projectId'>; insertAfterId?: string }>, projectIdOverride?: string): string[] => {
      if (rows.length === 0) return [];
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      const projectId = projectIdOverride ?? (cpi === 'all' ? projs[0]?.id || '' : cpi);
      const doneStatusIds = new Set<string>(
        ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
      );
      let tasksToPersist: Task[] | null = null;
      setAllTasks((prev) => {
        let next: Task[] = prev;
        for (const { id, draft, insertAfterId } of rows) {
          const plannedOverrideForNew =
            typeof draft.plannedProgressOverride === 'number' && Number.isFinite(draft.plannedProgressOverride)
              ? draft.plannedProgressOverride
              : null;
          const task: Task = applyMilestoneDateInvariant({
            ...draft,
            plannedProgressOverride: plannedOverrideForNew,
            workEffort: resolveWorkEffortForNewTask(draft.workEffort),
            id,
            projectId,
          } as Task);
          if (typeof plannedOverrideForNew === 'number') setPlannedOverrideLocal(task.id, plannedOverrideForNew);

          let nextTasks: Task[];
          if (insertAfterId) {
            const index = next.findIndex((t) => t.id === insertAfterId);
            if (index !== -1) {
              const arr = [...next];
              arr.splice(index + 1, 0, task);
              nextTasks = arr;
            } else nextTasks = [...next, task];
          } else nextTasks = [...next, task];

          const hasExplicitWeight = typeof task.weight === 'number' && Number.isFinite(task.weight);
          if (hasExplicitWeight && task.projectId) {
            const normalized = round1(task.weight as number);
            nextTasks = nextTasks.map((t) => (t.id === task.id ? { ...t, weight: normalized } : t));
            setWeightLocal(task.id, normalized);
          }
          next = syncParentRollups(nextTasks, task.parentId, doneStatusIds, undefined, undefined, undefined, true);
        }
        tasksToPersist = next;
        return next;
      });
      if (tasksToPersist) {
        if (projectId && !useLocalOnlyRef.current) {
          const pid = projectId;
          const persistRows = (tasksToPersist as Task[]).filter((t) => t.projectId === pid);
          if (persistRows.length > 0) {
            bumpDirty();
            const epoch = dirtyEpochRef.current;
            void upsertTasks(persistRows)
              .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
              .catch((err) => handleDbError(err, '새 작업 저장에 실패했습니다.'));
          }
        } else {
          bumpDirty();
        }
      }
      return rows.map((r) => r.id);
    },
    [
      saveHistory,
      currentProjectIdRef,
      projectsRef,
      wbsSettingsRef,
      setAllTasks,
      bumpDirty,
      useLocalOnlyRef,
      handleDbError,
      dirtyEpochRef,
      clearUnsyncedIfDirtyEpochIs,
    ],
  );

  const addTasks = useCallback(
    (newTasks: Task[]) => {
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      const effectiveProjectId = cpi === 'all' ? projs[0]?.id || '' : cpi;
      const tasksWithProject = newTasks.map((t) =>
        applyMilestoneDateInvariant({
          ...t,
          projectId: effectiveProjectId,
          workEffort: resolveWorkEffortForNewTask(t.workEffort),
        } as Task),
      );
      setAllTasks((prev) => {
        const next = [...prev, ...tasksWithProject];

        return recomputeProjectRollups(next, effectiveProjectId, undefined, undefined, true);
      });
      bumpDirty();
    },
    [saveHistory, currentProjectIdRef, projectsRef, setAllTasks, bumpDirty],
  );

  const updateTask = useCallback(
    (
      id: string,
      updates: Partial<Task>,
      options?: { skipCascade?: boolean; skipEffortScheduleLink?: boolean; deferScheduleSync?: boolean },
    ) => {
      const deferScheduleSync = options?.deferScheduleSync ?? false;
      saveHistory();
      let projectScheduleExpansion: { projectId: string; startDate: string; endDate: string } | null = null;
      let tasksToPersist: Task[] | null = null;
      setAllTasks((prev) => {
        const wSettings = wbsSettingsRef.current;
        const task = prev.find((t) => t.id === id);
        if (!task) return prev;
        const hasDateChange =
          Object.prototype.hasOwnProperty.call(updates, 'startDate') || Object.prototype.hasOwnProperty.call(updates, 'endDate');
        const hasWorkEffortChange = Object.prototype.hasOwnProperty.call(updates, 'workEffort');
        const hasDependencyChange = Object.prototype.hasOwnProperty.call(updates, 'dependencies');
        const hasScheduleChange = hasDateChange || hasWorkEffortChange || hasDependencyChange;

        let resolvedUpdates = { ...updates };
        // 가중치(weight) 직렬화/보호 정책: plannedProgressOverride와 동일 패턴
        //   - 호출자가 명시적으로 키를 넘겼을 때만 변경(round1 정규화) + 로컬 캐시에 영구 기록
        //   - 키를 안 넘긴 경우 자동 로직(롤업/일정 변경/status 동기화 등)이 weight를 절대 바꾸지 못하도록 키 제거
        const hasWeightKey = Object.prototype.hasOwnProperty.call(updates, 'weight');
        if (hasWeightKey) {
          const w = resolvedUpdates.weight;
          if (typeof w === 'number' && Number.isFinite(w)) {
            const normalized = round1(Math.max(0, w));
            resolvedUpdates = { ...resolvedUpdates, weight: normalized };
            setWeightLocal(id, normalized); // 로컬 캐시: DB가 어떻든 이 PC에서는 보존
          } else if (w === null) {
            resolvedUpdates = { ...resolvedUpdates, weight: null };
            setWeightLocal(id, null);
          } else {
            // 그 외 — 무시: 기존 값 유지
            const rest: Record<string, unknown> = { ...resolvedUpdates };
            delete rest.weight;
            resolvedUpdates = rest as typeof resolvedUpdates;
          }
        } else {
          // 호출자가 weight 키를 안 넘긴 경우: 자동 로직이 절대 weight를 건드릴 수 없도록 키 강제 제거.
          const rest: Record<string, unknown> = { ...resolvedUpdates };
          delete rest.weight;
          resolvedUpdates = rest as typeof resolvedUpdates;
        }
        if (typeof resolvedUpdates.progress === 'number' && Number.isFinite(resolvedUpdates.progress)) {
          resolvedUpdates = { ...resolvedUpdates, progress: round2(resolvedUpdates.progress) };
        }
        // 계획율 수동값(plannedProgressOverride) 직렬화/보호 정책:
        //   - 호출자가 명시적으로 키를 넘겼을 때만 변경(round2 정규화) + 로컬 캐시에 영구 기록
        //   - 키를 안 넘긴 경우 자동 로직(롤업/status 동기화/일정 변경 등)으로 절대 reset 되지 않도록 보호
        const hasPlannedOverrideKey = Object.prototype.hasOwnProperty.call(updates, 'plannedProgressOverride');
        if (hasPlannedOverrideKey) {
          const v = resolvedUpdates.plannedProgressOverride;
          if (typeof v === 'number' && Number.isFinite(v)) {
            const normalized = round2(Math.min(100, Math.max(0, v)));
            resolvedUpdates = { ...resolvedUpdates, plannedProgressOverride: normalized };
            setPlannedOverrideLocal(id, normalized); // 로컬 캐시: DB가 어떻든 이 PC에서는 보존
          } else if (v === null) {
            // 사용자가 명시적으로 자동 모드로 복귀
            resolvedUpdates = { ...resolvedUpdates, plannedProgressOverride: null };
            setPlannedOverrideLocal(id, null);
          } else {
            // 그 외(NaN 등) — 무시: 기존 값 유지
            const rest: Record<string, unknown> = { ...resolvedUpdates };
            delete rest.plannedProgressOverride;
            resolvedUpdates = rest as typeof resolvedUpdates;
          }
        } else {
          // 호출자가 키를 안 넘긴 경우: 다른 어떤 자동 로직도 plannedProgressOverride를 건드리지 않도록 명시적으로 키 제거.
          // (계획율 완전 수동: 날짜 변경 등으로 수동 계획율을 자동 해제/변경하지 않는다.)
          const rest: Record<string, unknown> = { ...resolvedUpdates };
          delete rest.plannedProgressOverride;
          resolvedUpdates = rest as typeof resolvedUpdates;
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
        let updatedTask = { ...task, ...resolvedUpdates };

        const explicitStartChange = hasDateChange && Object.prototype.hasOwnProperty.call(updates, 'startDate');
        const explicitEndChange = hasDateChange && Object.prototype.hasOwnProperty.call(updates, 'endDate');
        // 한쪽 날짜만 바꿔 기간이 역전되면 표시·저장이 꼬일 수 있어 시작≤종료로만 맞춘다(프로젝트 기간과 무관).
        if (hasDateChange) {
          const YMD = /^\d{4}-\d{2}-\d{2}$/;
          const rawS = updatedTask.startDate ?? '';
          const rawE = updatedTask.endDate ?? '';
          const sY = rawS.slice(0, 10);
          const eY = rawE.slice(0, 10);
          if (YMD.test(sY) && YMD.test(eY) && sY > eY) {
            const tailS = rawS.length > 10 ? rawS.slice(10) : '';
            const tailE = rawE.length > 10 ? rawE.slice(10) : '';
            if (explicitEndChange && !explicitStartChange) {
              updatedTask = { ...updatedTask, startDate: eY + tailS };
            } else {
              updatedTask = { ...updatedTask, endDate: sY + tailE };
            }
          }
        }
        const hasChildTasks = prev.some((t) => t.parentId === id);
        let preferCanonical: 'start' | 'end' | undefined;
        if (updatedTask.isMilestone && !hasChildTasks) {
          if (explicitEndChange && !explicitStartChange) preferCanonical = 'end';
          else if (explicitStartChange && !explicitEndChange) preferCanonical = 'start';
        }
        updatedTask = applyMilestoneDateInvariant(updatedTask, { hasChildTasks, preferCanonical });

        let nextTasks = prev.map((t) => (t.id === id ? updatedTask : t));

        // 상위 작업 진척률 수동 변경 시 모든 하위 레벨에 분배
        if (typeof resolvedUpdates.progress === 'number' && resolvedUpdates.progress !== task.progress && hasChildTasks) {
          nextTasks = distributeProgressDown(nextTasks, id, resolvedUpdates.progress);
        }

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

        // 일정·의존성·공수 변경 시에도 FS 재계산·연관 행 델타 이동·부모 일정 자동 맞춤은 하지 않는다(저장값 그대로 유지).
        // 클라이언트가 보낸 키가 updates에만 있는 경우에도 상위 진척 롤업이 빠지지 않도록 한다.
        const affectsRollup = (['startDate', 'endDate', 'workEffort', 'weight', 'dependencies', 'progress', 'status'] as const).some(
          (k) => Object.prototype.hasOwnProperty.call(updates, k) || Object.prototype.hasOwnProperty.call(resolvedUpdates, k),
        );
        const doneStatusIds: Set<string> = new Set(
          ((wSettings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        const parentIdChanged = Object.prototype.hasOwnProperty.call(updates, 'parentId') && updates.parentId !== task.parentId;
        let result = nextTasks;
        // 간트 등에서 여러 행 일정을 연속 패치할 때: 중간마다 상위 롤업을 돌리면 아직 옮기지 않은 형제/자식 때문에 부모 시작일이 당겨지는 버그가 난다.
        if (!deferScheduleSync) {
          if (hasDateChange) {
            // 하위(자식) 시작/종료일 변경 → 상위(조상) 일정만 자식 기준으로 자동 롤업(상위가 자식을 포괄).
            // 단, '날짜만' 편집한 경우 어떤 행의 공수(workEffort)도 자식 합으로 덮어쓰지 않는다(요청: 날짜↔공수 비연동).
            // 공수가 함께 변경된 편집(모달 저장 등)은 기존대로 공수 롤업도 수행.
            let skipEffortIds: Set<string> | undefined;
            if (!hasWorkEffortChange) {
              skipEffortIds = new Set<string>();
              const byId = new Map<string, Task>(result.map((t) => [t.id, t]));
              let cur: string | null | undefined = task.parentId;
              while (cur) {
                skipEffortIds.add(cur);
                cur = byId.get(cur)?.parentId ?? null;
              }
            }
            // 하위 날짜 편집 시 상위(조상) 일정은 'growOnly'(확장만): 상위가 하위 트리를 항상 포함하도록 넓히되,
            // 직접 입력해 둔 더 넓은 상위 날짜는 자식 min/max로 줄이지 않는다(저장 후 재조회 시 값이 줄어 사라지는 문제 방지).
            // 편집한 행(task) 자신은 syncParentRollups가 task.parentId부터 올라가므로 그대로 보존된다.
            // 상위를 자식에 '정확히' 맞추는 축소 정렬은 '일정 자동 맞춤' 메뉴(refreshProjectSchedule)·우클릭 롤업으로만 명시 수행한다.
            result = syncParentRollups(result, task.parentId, doneStatusIds, true, undefined, skipEffortIds, 'growOnly');
          } else if (affectsRollup) {
            const hasChildTasks = prev.some((t) => t.parentId === id && t.projectId === task.projectId);
            const isDirectProgressEdit = Object.prototype.hasOwnProperty.call(updates, 'progress');
            // 하위가 있는 행에서 공수만 직접 바꾼 경우: 같은 틱에서 자식 합으로 덮어쓰지 않도록 공수 롤업만 건너뜀
            const skipWorkEffortRollupParentIds = hasChildTasks && !isDirectProgressEdit && hasWorkEffortChange ? new Set([id]) : undefined;
            if (hasChildTasks && !isDirectProgressEdit) {
              result = syncParentRollups(result, id, doneStatusIds, true, undefined, skipWorkEffortRollupParentIds, true);
            } else {
              result = syncParentRollups(result, task.parentId, doneStatusIds, true, undefined, undefined, true);
            }
          }
          if (parentIdChanged) {
            // 부모가 바뀌면 옛/새 부모의 진척·공수만 다시 롤업한다.
            // 일정(시작·종료)은 자동으로 맞추지 않음 — '일정 자동 맞춤' 메뉴로만 수행.
            if (task.parentId) result = syncParentRollups(result, task.parentId, doneStatusIds, false, undefined, undefined, true);
            if (updates.parentId) result = syncParentRollups(result, updates.parentId, doneStatusIds, false, undefined, undefined, true);
          }
        }

        // 자식 단계(status) 변경 시 부모(및 조상)의 단계도 함께 갱신.
        // 단계 표시는 자식들의 실제 상태를 반영해야 하므로 linkStatusAndProgress와 무관하게 항상 전파.
        // 단, 상위 단계 변경에 따른 progress 자동 적용은 linkStatusAndProgress 설정으로 제어.
        const statusChanged =
          Object.prototype.hasOwnProperty.call(updates, 'status') &&
          typeof resolvedUpdates.status === 'string' &&
          resolvedUpdates.status !== task.status;
        if (statusChanged && !deferScheduleSync) {
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

        // 일정 필드 변경 시 프로젝트 단위 최종 정합화는 진척·공수·마일스톤 보정만 수행한다(skipScheduleRollup=true).
        // 부모 시작일·종료일은 어떤 자동 경로로도 덮어쓰지 않는다 — '일정 자동 맞춤' 메뉴로만 수행.
        if (hasScheduleChange && task.projectId && !deferScheduleSync) {
          const hasChildTasks = nextTasks.some((t) => t.parentId === id && t.projectId === task.projectId);
          const excludeFromRollup = hasChildTasks ? new Set([id]) : undefined;
          result = recomputeProjectRollups(result, task.projectId, doneStatusIds, excludeFromRollup, true);

          const projRow = projectsRef.current.find((p) => p.id === task.projectId);
          const tasksInProject = result.filter((t) => t.projectId === task.projectId);
          const expanded = expandProjectStoredDatesToTaskSpan(projRow, tasksInProject);
          if (expanded?.changed) {
            projectScheduleExpansion = {
              projectId: task.projectId,
              startDate: expanded.startDate,
              endDate: expanded.endDate,
            };
          }
        }

        tasksToPersist = result;
        return result;
      });

      if (tasksToPersist) {
        bumpDirty();
        if (!useLocalOnlyRef.current) {
          const epoch = dirtyEpochRef.current;
          void upsertTasks(tasksToPersist)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '작업 수정 저장에 실패했습니다.'));
        }
      }

      if (projectScheduleExpansion) {
        bumpDirty();
        const prevProj = projectsRef.current.find((p) => p.id === projectScheduleExpansion!.projectId);
        if (prevProj) {
          const merged: Project = {
            ...prevProj,
            startDate: projectScheduleExpansion.startDate,
            endDate: projectScheduleExpansion.endDate,
          };
          setProjects((projs) => projs.map((p) => (p.id === merged.id ? merged : p)));
          if (!useLocalOnlyRef.current) {
            const epoch = dirtyEpochRef.current;
            void upsertProject(merged)
              .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
              .catch((err) => handleDbError(err, '프로젝트 기간 저장에 실패했습니다.'));
          }
        }
      }
    },
    [
      saveHistory,
      wbsSettingsRef,
      setAllTasks,
      setProjects,
      projectsRef,
      bumpDirty,
      useLocalOnlyRef,
      handleDbError,
      dirtyEpochRef,
      clearUnsyncedIfDirtyEpochIs,
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
      // 계획율·가중치 일괄 수정도 셀 편집(updateTask)과 동일하게 로컬 캐시를 갱신한다.
      // 그렇지 않으면 새로고침 후 overlayPlannedOverrideFromLocal/overlayWeightFromLocal이
      // 옛 캐시값으로 덮어써서 일괄 수정이 "원복"되는 버그가 난다.
      if (Object.prototype.hasOwnProperty.call(updates, 'plannedProgressOverride')) {
        const v = updates.plannedProgressOverride;
        const cacheVal = typeof v === 'number' && Number.isFinite(v) ? v : null;
        for (const id of taskIds) setPlannedOverrideLocal(id, cacheVal);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'weight')) {
        const w = updates.weight;
        const cacheVal = typeof w === 'number' && Number.isFinite(w) ? w : null;
        for (const id of taskIds) setWeightLocal(id, cacheVal);
      }
      const hasAssignee = Object.prototype.hasOwnProperty.call(updates, 'assignee') && typeof updates.assignee === 'string';
      let tasksToPersist: Task[] | null = null;
      setAllTasks((prev) => {
        const idSet = hasAssignee ? collectDescendantTaskIds(originalIdSet, prev) : originalIdSet;
        const assigneePatch: Partial<Task> = hasAssignee ? { assignee: updates.assignee as string } : {};
        let next = prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const patch = originalIdSet.has(t.id) ? updates : assigneePatch;
          if (Object.keys(patch).length === 0) return t;
          return { ...t, ...patch };
        });

        // 일괄 수정은 updateTask와 달리 기본적으로 롤업이 없어 상위·요약 진척률이 갱신되지 않았음.
        const needsProgressRollup = ['progress', 'weight', 'workEffort', 'status'].some((k) =>
          Object.prototype.hasOwnProperty.call(updates, k),
        );
        if (needsProgressRollup) {
          const doneStatusIds: Set<string> = new Set(
            ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
          );
          const parentIds = new Set<string>();
          for (const tid of idSet) {
            const row = next.find((x) => x.id === tid);
            if (row?.parentId) parentIds.add(row.parentId);
          }
          for (const pid of parentIds) {
            next = syncParentRollups(next, pid, doneStatusIds, true, undefined, undefined, true);
          }
        }

        tasksToPersist = next;
        return next;
      });
      if (tasksToPersist) {
        bumpDirty();
        if (!useLocalOnlyRef.current) {
          const epoch = dirtyEpochRef.current;
          void upsertTasks(tasksToPersist)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '작업 일괄 수정 저장에 실패했습니다.'));
        }
      }
    },
    [saveHistory, setAllTasks, wbsSettingsRef, bumpDirty, useLocalOnlyRef, handleDbError, dirtyEpochRef, clearUnsyncedIfDirtyEpochIs],
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
      bumpDirty();
      const epoch = dirtyEpochRef.current;

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
        if (!useLocalOnlyRef.current) {
          void upsertTasks(next)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '투입인원 이름 변경 저장에 실패했습니다.'));
        }
        return next;
      });
    },
    [saveHistory, bumpDirty, handleDbError, useLocalOnlyRef, setProjects, setAllTasks, dirtyEpochRef, clearUnsyncedIfDirtyEpochIs],
  );

  /** '일정 자동 맞춤' 메뉴 전용(명시 실행): 선행(FS) 일정 재계산 + 상위 작업 시작·종료를 하위 min/max로 정렬.
   *  셀 편집·행 이동·가져오기 등 자동 경로에서는 일정이 절대 변경되지 않으며, 이 함수로만 자동 정렬이 수행된다. */
  const refreshProjectSchedule = useCallback(() => {
    const cpi = currentProjectIdRef.current;
    const projs = projectsRef.current;
    const projectIds = cpi === 'all' ? projs.map((p) => p.id).filter(Boolean) : [cpi].filter(Boolean);
    if (projectIds.length === 0) return;
    saveHistory();
    let tasksToPersist: Task[] | null = null;
    setAllTasks((prev) => {
      let result = prev;
      for (const effectiveProjectId of projectIds) {
        const projectTasks = result.filter((t) => t.projectId === effectiveProjectId);
        if (projectTasks.length === 0) continue;
        const adjusted = applyDependencySchedule(projectTasks);
        const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
        result = result.map((t) => (t.projectId === effectiveProjectId ? (adjustedById.get(t.id) ?? t) : t));
        result = recomputeProjectRollups(result, effectiveProjectId);
      }
      tasksToPersist = result;
      return result;
    });
    // '일정 자동 맞춤'은 다른 수정과 달리 DB에 저장되지 않아 사용자마다 일정이 달라 보였음 → 변경분을 즉시 저장.
    if (tasksToPersist) {
      if (!useLocalOnlyRef.current) {
        bumpDirty();
        const epoch = dirtyEpochRef.current;
        const affected = new Set(projectIds);
        const rows = tasksToPersist.filter((t) => t.projectId != null && affected.has(t.projectId));
        if (rows.length > 0) {
          void upsertTasks(rows)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '일정 자동 맞춤 저장에 실패했습니다.'));
        } else {
          clearUnsyncedIfDirtyEpochIs(epoch);
        }
      } else {
        bumpDirty();
      }
    }
  }, [
    saveHistory,
    currentProjectIdRef,
    projectsRef,
    setAllTasks,
    bumpDirty,
    useLocalOnlyRef,
    handleDbError,
    dirtyEpochRef,
    clearUnsyncedIfDirtyEpochIs,
  ]);

  /** '상위→하위 균등 분배' 메뉴 전용(명시 실행): 선택한 상위 작업의 기간을 직속 하위에 영업일 기준으로 균등 분배하고
   *  하위끼리 선행관계(FS)로 연결. 하위의 하위까지 재귀. 상위 작업 자신의 날짜는 유지한다.
   *  반환: 실제 적용한 상위 작업 수(applied)와 하위 없음·일정 없음 등으로 건너뛴 수(skipped). */
  const distributeChildrenSchedule = useCallback(
    (parentIds: string[]): { applied: number; skipped: number } => {
      const ids = Array.from(new Set(parentIds.filter(Boolean)));
      if (ids.length === 0) return { applied: 0, skipped: 0 };
      let applied = 0;
      let skipped = 0;
      saveHistory();
      let tasksToPersist: Task[] | null = null;
      setAllTasks((prev) => {
        let result = prev;
        for (const pid of ids) {
          const parent = result.find((t) => t.id === pid);
          const hasKids = parent ? result.some((t) => t.parentId === pid) : false;
          if (!parent || !hasKids || !parent.startDate || !parent.endDate) {
            skipped += 1;
            continue;
          }
          result = distributeChildrenEvenly(result, pid);
          applied += 1;
        }
        tasksToPersist = result;
        return result;
      });
      // 균등 분배 결과는 기존엔 로컬 상태에만 남아 사용자마다 일정이 달라 보였음 → 변경분을 즉시 저장.
      if (applied > 0 && tasksToPersist && !useLocalOnlyRef.current) {
        const affected = new Set<string>();
        for (const pid of ids) {
          const parent = tasksToPersist.find((t) => t.id === pid);
          if (parent?.projectId) affected.add(parent.projectId);
        }
        if (affected.size > 0) {
          bumpDirty();
          const epoch = dirtyEpochRef.current;
          const rows = tasksToPersist.filter((t) => t.projectId != null && affected.has(t.projectId));
          if (rows.length > 0) {
            void upsertTasks(rows)
              .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
              .catch((err) => handleDbError(err, '균등 분배 저장에 실패했습니다.'));
          } else {
            clearUnsyncedIfDirtyEpochIs(epoch);
          }
        }
      } else if (applied > 0 && tasksToPersist && useLocalOnlyRef.current) {
        bumpDirty();
      }
      return { applied, skipped };
    },
    [saveHistory, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError, dirtyEpochRef, clearUnsyncedIfDirtyEpochIs],
  );

  /**
   * 우클릭 메뉴 전용: 선택한 상위 작업의 **직·간접 하위 작업끼리**의 선행(dependencies) 연결만 제거한다.
   * 하위→상위(또는 상위→하위) 선행, 트리 밖 작업과의 선행은 유지한다. 히스토리 1회.
   */
  const disconnectSubtreeInternalDependencies = useCallback(
    (parentTaskId: string): { removedEdges: number } => {
      if (!parentTaskId) return { removedEdges: 0 };
      const prev = allTasksRef.current;
      const parent = prev.find((t) => t.id === parentTaskId);
      if (!parent?.projectId) return { removedEdges: 0 };

      const subtreeAll = collectDescendantTaskIds([parentTaskId], prev);
      const strictDesc = new Set(subtreeAll);
      strictDesc.delete(parentTaskId);
      if (strictDesc.size === 0) return { removedEdges: 0 };

      const scanIds = new Set<string>([parentTaskId, ...strictDesc]);
      let removedEdges = 0;
      for (const t of prev) {
        if (!scanIds.has(t.id) || t.projectId !== parent.projectId) continue;
        const deps = t.dependencies ?? [];
        for (const d of deps) {
          if (strictDesc.has(d)) removedEdges += 1;
        }
      }
      if (removedEdges === 0) return { removedEdges: 0 };

      saveHistory();
      let tasksToPersist: Task[] | null = null;
      setAllTasks((current) => {
        const p = current.find((x) => x.id === parentTaskId);
        if (!p?.projectId) return current;
        const stAll = collectDescendantTaskIds([parentTaskId], current);
        const st = new Set(stAll);
        st.delete(parentTaskId);
        const ids = new Set<string>([parentTaskId, ...st]);
        const doneStatusIds = new Set(
          ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        let result = current.map((t) => {
          if (!ids.has(t.id) || t.projectId !== p.projectId) return t;
          const deps = t.dependencies ?? [];
          const filtered = deps.filter((d) => !st.has(d));
          if (filtered.length === deps.length) return t;
          return { ...t, dependencies: filtered };
        });
        result = recomputeProjectRollups(result, p.projectId, doneStatusIds, undefined, true);
        tasksToPersist = result;
        return result;
      });

      if (tasksToPersist && !useLocalOnlyRef.current) {
        bumpDirty();
        const epoch = dirtyEpochRef.current;
        const pid = parent.projectId;
        const rows = tasksToPersist.filter((t) => t.projectId === pid);
        if (rows.length > 0) {
          void upsertTasks(rows)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '선행 연결 해제 저장에 실패했습니다.'));
        } else {
          clearUnsyncedIfDirtyEpochIs(epoch);
        }
      } else if (tasksToPersist && useLocalOnlyRef.current) {
        bumpDirty();
      }

      return { removedEdges };
    },
    [
      allTasksRef,
      saveHistory,
      setAllTasks,
      wbsSettingsRef,
      bumpDirty,
      useLocalOnlyRef,
      handleDbError,
      dirtyEpochRef,
      clearUnsyncedIfDirtyEpochIs,
    ],
  );

  /** 특정 작업 기준 '하위 → 상위 롤업'(우클릭 메뉴 전용): 그 작업과 하위(서브트리)만 대상으로
   *  선행(FS) 재계산 + 상위(이 작업·중간 요약)의 시작·종료를 하위 min/max로 정렬한다.
   *  서브트리 밖(이 작업의 상위·형제)은 건드리지 않아 '특정 작업 범위'로 한정된다. */
  const rollupTaskSchedule = useCallback(
    (taskId: string) => {
      if (!taskId) return;
      saveHistory();
      let tasksToPersist: Task[] | null = null;
      setAllTasks((prev) => {
        const subtreeIds = collectDescendantTaskIds([taskId], prev);
        if (subtreeIds.size <= 1) return prev; // 하위가 없으면 롤업할 것이 없음
        // 서브트리만 추출하되, 루트(taskId)는 부모가 서브트리 밖에 있으므로 parentId=null로 둬야
        // applyDependencySchedule의 상위 롤업 순회(부모 null부터 깊이 우선)가 루트를 포함한다. 병합 시 원래 parentId 복원.
        const subtree = prev.filter((t) => subtreeIds.has(t.id)).map((t) => (t.id === taskId ? { ...t, parentId: null } : t));
        const adjusted = applyDependencySchedule(subtree);
        const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
        const next = prev.map((t) => {
          const a = adjustedById.get(t.id);
          if (!a) return t;
          return t.id === taskId ? { ...a, parentId: t.parentId } : a;
        });
        tasksToPersist = next;
        return next;
      });
      // 우클릭 '하위→상위 롤업'도 DB에 저장되지 않아 사용자마다 일정이 달라 보였음 → 변경분을 즉시 저장.
      if (tasksToPersist && !useLocalOnlyRef.current) {
        const projectId = tasksToPersist.find((t) => t.id === taskId)?.projectId ?? null;
        if (projectId) {
          bumpDirty();
          const epoch = dirtyEpochRef.current;
          const rows = tasksToPersist.filter((t) => t.projectId === projectId);
          if (rows.length > 0) {
            void upsertTasks(rows)
              .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
              .catch((err) => handleDbError(err, '일정 롤업 저장에 실패했습니다.'));
          } else {
            clearUnsyncedIfDirtyEpochIs(epoch);
          }
        }
      } else if (tasksToPersist && useLocalOnlyRef.current) {
        bumpDirty();
      }
    },
    [saveHistory, setAllTasks, bumpDirty, useLocalOnlyRef, handleDbError, dirtyEpochRef, clearUnsyncedIfDirtyEpochIs],
  );

  /** 표에 보이는 순서대로 선행작업을 FS 체인으로 연결 (두 번째 행부터 직전 선택 행이 선행). 잠금된 시작일·종료일은 applyDependencySchedule에서 그대로 유지된다. */
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
        const pct = clampAllocationPercentInt(bulkAlloc);
        const taskById = new Map<string, Task>(allTasksRef.current.map((t): [string, Task] => [t.id, t]));
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
            bumpDirty();
            const epochProj = dirtyEpochRef.current;
            void Promise.all(
              [...assigneesByProjectId.keys()].map((projectId) => {
                const updated = projs.find((p) => p.id === projectId);
                return updated
                  ? upsertProject(updated).catch((err) => handleDbError(err, '투입율 저장에 실패했습니다.'))
                  : Promise.resolve();
              }),
            ).then(() => clearUnsyncedIfDirtyEpochIs(epochProj));
          } else {
            bumpDirty();
          }
        }
      }

      let tasksToPersist: Task[] | null = null;
      let persistProjectId: string | null = null;
      setAllTasks((prev) => {
        const wSettings = wbsSettingsRef.current;
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

          let updated: Task = { ...t };

          if (applyBulkEffort != null) {
            updated = { ...updated, workEffort: applyBulkEffort };
          }

          if (idx > 0) {
            const prevInChain = sameProject[idx - 1]!.id;
            updated = { ...updated, dependencies: [prevInChain] };
          }

          return updated;
        });

        const projectTaskList = nextTasks.filter((t) => t.projectId === projectId);
        // 선행 순차 연결: FS로 시작일만 옮기고 각 작업의 기존 영업일 기간을 유지(공수는 일정에 미사용).
        const adjusted = applyDependencySchedule(projectTaskList);
        const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
        nextTasks = nextTasks.map((t) => (t.projectId === projectId ? (adjustedById.get(t.id) ?? t) : t));

        const doneStatusIds = new Set(
          ((wSettings.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
        );
        const finalTasks = recomputeProjectRollups(nextTasks, projectId, doneStatusIds);
        tasksToPersist = finalTasks;
        persistProjectId = projectId;
        return finalTasks;
      });
      // 선행 FS 연결도 일정·의존성을 바꾸지만 기존엔 task가 저장되지 않아 사용자마다 일정이 달라 보였음 → 변경분을 즉시 저장.
      if (tasksToPersist && persistProjectId && !useLocalOnlyRef.current) {
        bumpDirty();
        const epoch = dirtyEpochRef.current;
        const pid: string = persistProjectId;
        const rows = tasksToPersist.filter((t) => t.projectId === pid);
        if (rows.length > 0) {
          void upsertTasks(rows)
            .then(() => clearUnsyncedIfDirtyEpochIs(epoch))
            .catch((err) => handleDbError(err, '선행 연결 저장에 실패했습니다.'));
        } else {
          clearUnsyncedIfDirtyEpochIs(epoch);
        }
      } else if (tasksToPersist && persistProjectId && useLocalOnlyRef.current) {
        bumpDirty();
      }
    },
    [
      saveHistory,
      wbsSettingsRef,
      projectsRef,
      allTasksRef,
      setAllTasks,
      setProjects,
      useLocalOnlyRef,
      handleDbError,
      bumpDirty,
      dirtyEpochRef,
      clearUnsyncedIfDirtyEpochIs,
    ],
  );

  /**
   * 간트 등에서 연속 패치(skipCascade) 후 호출.
   * 기본: 선행(FS) 일정 정합 + 프로젝트 상위 롤업.
   * `skipDependencySchedule`: 의존성 재계산 없이 롤업만(간트에서 막대만 옮길 때 후행이 따라오지 않게).
   */
  const flushProjectTaskRollups = useCallback(
    (projectId: string, options?: { skipDependencySchedule?: boolean }) => {
      if (!projectId || projectId === 'all') return;
      const skipDependencySchedule = options?.skipDependencySchedule === true;
      saveHistory();
      const doneStatusIds: Set<string> = new Set(
        ((wbsSettingsRef.current.statusConfigs ?? []) as StatusConfig[]).filter((c) => c.progress === 100).map((c) => c.id),
      );
      setAllTasks((prev) => {
        const projectTasks = prev.filter((t) => t.projectId === projectId);
        if (projectTasks.length === 0) return prev;
        let result = prev;
        if (!skipDependencySchedule) {
          const adjusted = applyDependencySchedule(projectTasks);
          const adjustedById = new Map(adjusted.map((t) => [t.id, t]));
          result = prev.map((t) => (t.projectId === projectId ? (adjustedById.get(t.id) ?? t) : t));
        }
        // 간트에서 막대만 이동(skipDependencySchedule)한 경우 상위 일정은 'growOnly'(확장만) — 막대가 상위 밖으로 나가면 포함하도록 넓히되 직접입력 상위값은 축소 안 함.
        result = recomputeProjectRollups(result, projectId, doneStatusIds, undefined, skipDependencySchedule ? 'growOnly' : false);
        return result;
      });
      bumpDirty();
    },
    [saveHistory, setAllTasks, wbsSettingsRef, bumpDirty],
  );

  const deleteTask = useCallback(
    (id: string) => {
      saveHistory();
      const removedRef = { current: false };
      setAllTasks((prev) => {
        const taskToDelete = prev.find((t) => t.id === id);
        if (!taskToDelete) return prev;
        removedRef.current = true;
        const getAllDescendantIds = (parentId: string, list: Task[]): string[] => {
          const children = list.filter((t) => t.parentId === parentId);
          return [...children.map((c) => c.id), ...children.flatMap((c) => getAllDescendantIds(c.id, list))];
        };
        const idsToDelete = [id, ...getAllDescendantIds(id, prev)];
        if (taskToDelete.projectId) recordDeletedTaskIds(taskToDelete.projectId, idsToDelete);
        const next = prev.filter((t) => !new Set(idsToDelete).has(t.id));
        return syncParentRollups(next, taskToDelete.parentId, undefined, false, undefined, undefined, true);
      });
      if (removedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, recordDeletedTaskIds, bumpDirty],
  );

  return useMemo(
    () => ({
      addTask,
      insertPastedTasksInOrder,
      addTasks,
      updateTask,
      updateTasksBulk,
      linkSequentialPredecessors,
      setBaselineForTasks,
      setBaselineForAllTasks,
      renameAssignee,
      refreshProjectSchedule,
      distributeChildrenSchedule,
      disconnectSubtreeInternalDependencies,
      rollupTaskSchedule,
      deleteTask,
      flushProjectTaskRollups,
    }),
    [
      addTask,
      insertPastedTasksInOrder,
      addTasks,
      updateTask,
      updateTasksBulk,
      linkSequentialPredecessors,
      setBaselineForTasks,
      setBaselineForAllTasks,
      renameAssignee,
      refreshProjectSchedule,
      distributeChildrenSchedule,
      disconnectSubtreeInternalDependencies,
      rollupTaskSchedule,
      deleteTask,
      flushProjectTaskRollups,
    ],
  );
}
