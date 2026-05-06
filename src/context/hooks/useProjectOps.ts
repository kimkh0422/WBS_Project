import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project, ProjectAssignment } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { upsertProject, upsertTasks } from '../../lib/db';
import { computeEndDateFromEffort } from '../../lib/schedule';
import { getHolidaysForTaskDates, differenceInBusinessDaysEx, addBusinessDaysEx } from '../../lib/calendar';
import { applyDependencySchedule } from '../../lib/schedule';
import { recomputeProjectRollups } from '../../lib/rollups';
import {
  buildProjectEffortUnitMap,
  convertStoredEffortBetweenUnits,
  normalizeWorkEffortUnit,
  workEffortToManDays,
} from '../../lib/workEffortUnits';

export interface ProjectOpsDeps {
  saveHistory: () => void;
  bumpDirty: () => void;
  handleDbError: (err: unknown, fallback: string) => void;
  ownerIdRef: MutableRefObject<string | undefined>;
  projectsRef: MutableRefObject<Project[]>;
  allTasksRef: MutableRefObject<Task[]>;
  currentProjectIdRef: MutableRefObject<string>;
  useLocalOnlyRef: MutableRefObject<boolean>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  setCurrentProjectId: (id: string) => void;
  recordDeletedTaskIds: (projectId: string, ids: string[]) => void;
  setDeletedProjectIds: Dispatch<SetStateAction<string[]>>;
}

export function useProjectOps(deps: ProjectOpsDeps) {
  const {
    saveHistory,
    bumpDirty,
    handleDbError,
    ownerIdRef,
    projectsRef,
    allTasksRef,
    currentProjectIdRef,
    useLocalOnlyRef,
    setProjects,
    setAllTasks,
    setCurrentProjectId,
    recordDeletedTaskIds,
    setDeletedProjectIds,
  } = deps;

  const addProject = useCallback(
    (
      name: string,
      description?: string,
      startDate?: string,
      endDate?: string,
      assignments?: Project['assignments'],
      minWorkEffortDays?: number,
      reportExtras?: Partial<
        Pick<
          Project,
          | 'reportCategory'
          | 'reportAgency'
          | 'reportBudgetThisYear'
          | 'reportTotalPeriod'
          | 'reportNameShort'
          | 'reportNameFull'
          | 'workEffortUnit'
        >
      >,
    ) => {
      // 가드: user.id가 잡히기 전에 프로젝트가 생성되면 owner_id NULL로 저장되어
      // 이후 RLS 정책(owner_id = auth.uid())을 통과하지 못하고 작업 INSERT가 거부된다.
      // 로그인 세션이 잡히기 전에는 DB에 저장하지 않고 사용자에게 안내한다.
      if (!useLocalOnlyRef.current && !ownerIdRef.current) {
        handleDbError(new Error('로그인 세션이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'), '프로젝트 저장에 실패했습니다.');
        return;
      }
      bumpDirty();
      const newProject: Project = {
        id: uuidv4(),
        name,
        description,
        startDate,
        endDate,
        assignments,
        minWorkEffortDays,
        ownerId: ownerIdRef.current,
        ...reportExtras,
      };
      setProjects((prev) => [...prev, newProject]);
      setCurrentProjectId(newProject.id);
      if (!useLocalOnlyRef.current) upsertProject(newProject).catch((err) => handleDbError(err, '프로젝트 저장에 실패했습니다.'));
    },
    [bumpDirty, handleDbError, ownerIdRef, useLocalOnlyRef, setProjects, setCurrentProjectId],
  );

  const updateProject = useCallback(
    (id: string, updates: Partial<Project>) => {
      bumpDirty();
      setProjects((prev) => {
        const project = prev.find((p) => p.id === id);
        const newStart = updates.startDate ?? project?.startDate;
        const newEnd = updates.endDate ?? project?.endDate;
        const startChanged = project && updates.startDate !== undefined && updates.startDate !== project.startDate;
        const endChanged = project && updates.endDate !== undefined && updates.endDate !== project.endDate;
        const needsTaskClamp = startChanged || (endChanged && newEnd && (!project?.endDate || newEnd < project.endDate));

        const unitChanging =
          !!project &&
          updates.workEffortUnit !== undefined &&
          normalizeWorkEffortUnit(project.workEffortUnit) !== normalizeWorkEffortUnit(updates.workEffortUnit);

        if (project && (needsTaskClamp || unitChanging)) {
          saveHistory();
          setAllTasks((currentTasks) => {
            const mergedProjects = prev.map((p) => (p.id === id ? ({ ...p, ...updates } as Project) : p));
            const projectAssignmentsMap = new Map<string, ProjectAssignment[]>(mergedProjects.map((p) => [p.id, p.assignments ?? []]));
            const unitMap = buildProjectEffortUnitMap(mergedProjects);
            const effectiveProjectRow = mergedProjects.find((p) => p.id === id)!;
            const effUnit = normalizeWorkEffortUnit(effectiveProjectRow.workEffortUnit);

            let shifted = currentTasks.map((t) => {
              if (t.projectId !== id) return t;
              if (!unitChanging) return t;
              const oldU = normalizeWorkEffortUnit(project.workEffortUnit);
              const newU = normalizeWorkEffortUnit(updates.workEffortUnit);
              return {
                ...t,
                workEffort:
                  typeof t.workEffort === 'number' && t.workEffort > 0
                    ? convertStoredEffortBetweenUnits(t.workEffort, oldU, newU)
                    : t.workEffort,
                baselineWorkEffort:
                  typeof t.baselineWorkEffort === 'number' && t.baselineWorkEffort > 0
                    ? convertStoredEffortBetweenUnits(t.baselineWorkEffort, oldU, newU)
                    : t.baselineWorkEffort,
              };
            });

            if (needsTaskClamp) {
              const holidays = getHolidaysForTaskDates(shifted);
              shifted = shifted.map((t) => {
                if (t.projectId !== id) return t;
                let taskStart = t.startDate;
                let taskEnd = t.endDate;

                if (newStart && taskStart && taskStart < newStart) {
                  const assignments = projectAssignmentsMap.get(t.projectId);
                  const start = parseISO(taskStart);
                  const end = parseISO(taskEnd);
                  let computedEnd: string;
                  if (typeof t.workEffort === 'number' && t.workEffort > 0) {
                    const effortMd = workEffortToManDays(t.workEffort, effUnit);
                    computedEnd = computeEndDateFromEffort(newStart, effortMd, assignments, holidays);
                  } else if (isValid(start) && isValid(end)) {
                    const durationDays = Math.max(1, differenceInBusinessDaysEx(start, end, holidays));
                    computedEnd = format(addBusinessDaysEx(parseISO(newStart), durationDays - 1, holidays), 'yyyy-MM-dd');
                  } else {
                    computedEnd = newStart;
                  }
                  taskStart = newStart;
                  taskEnd = computedEnd;
                }

                if (newEnd && taskEnd && taskEnd > newEnd) {
                  taskEnd = newEnd;
                  if (taskStart && taskStart > taskEnd) {
                    taskStart = taskEnd;
                  }
                }

                if (taskStart !== t.startDate || taskEnd !== t.endDate) {
                  return { ...t, startDate: taskStart, endDate: taskEnd };
                }
                return t;
              });

              if (startChanged && newStart) {
                const projectTasksAfterClamp = shifted.filter((t) => t.projectId === id && t.startDate && t.startDate >= newStart);
                const earliestAfter = projectTasksAfterClamp.reduce<string | null>(
                  (min, t) => (!min || (t.startDate && t.startDate < min) ? t.startDate || min : min),
                  null,
                );
                if (earliestAfter && earliestAfter > newStart) {
                  const deltaDays = differenceInDays(parseISO(newStart), parseISO(earliestAfter));
                  if (deltaDays !== 0) {
                    shifted = shifted.map((t) => {
                      if (t.projectId !== id || !t.startDate || t.startDate < newStart) return t;
                      return {
                        ...t,
                        startDate: format(addDays(parseISO(t.startDate), deltaDays), 'yyyy-MM-dd'),
                        endDate: format(addDays(parseISO(t.endDate), deltaDays), 'yyyy-MM-dd'),
                      };
                    });
                  }
                }
              }
            }

            const projectTasks = shifted.filter((t) => t.projectId === id);
            const adjusted = applyDependencySchedule(projectTasks, projectAssignmentsMap, undefined, unitMap);
            const adjustedById = new Map<string, Task>(adjusted.map((t) => [t.id, t]));
            shifted = shifted.map((t) => (t.projectId === id && adjustedById.has(t.id) ? adjustedById.get(t.id)! : t));
            shifted = recomputeProjectRollups(shifted, id);
            if (!useLocalOnlyRef.current) upsertTasks(shifted).catch((err) => handleDbError(err, '날짜 이동 저장에 실패했습니다.'));
            return shifted;
          });
        }
        return prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      });
      const updated = projectsRef.current.find((p) => p.id === id);
      if (updated && !useLocalOnlyRef.current)
        upsertProject({ ...updated, ...updates }).catch((err) => handleDbError(err, '프로젝트 수정 저장에 실패했습니다.'));
    },
    [bumpDirty, saveHistory, handleDbError, projectsRef, useLocalOnlyRef, setProjects, setAllTasks, setCurrentProjectId],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (projectsRef.current.length <= 1) return; // 최소 1개 프로젝트 유지
      bumpDirty();
      const idsToDelete = allTasksRef.current.filter((t) => t.projectId === id).map((t) => t.id);
      if (idsToDelete.length > 0) recordDeletedTaskIds(id, idsToDelete);
      setDeletedProjectIds((prev) => {
        if (!id) return prev;
        return prev.includes(id) ? prev : [...prev, id];
      });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setAllTasks((prev) => prev.filter((t) => t.projectId !== id));
      if (currentProjectIdRef.current === id) setCurrentProjectId(projectsRef.current.find((p) => p.id !== id)?.id || '');
    },
    [
      bumpDirty,
      recordDeletedTaskIds,
      projectsRef,
      allTasksRef,
      currentProjectIdRef,
      setProjects,
      setAllTasks,
      setCurrentProjectId,
      setDeletedProjectIds,
    ],
  );

  const copyProject = useCallback(
    (sourceProjectId: string) => {
      const projs = projectsRef.current;
      const tasks = allTasksRef.current;
      const source = projs.find((p) => p.id === sourceProjectId);
      if (!source) return;
      const sourceTasks = tasks.filter((t) => t.projectId === sourceProjectId);
      const newProjectId = uuidv4();
      const newProject: Project = {
        id: newProjectId,
        name: `${source.name} (복사본)`,
        description: source.description,
        startDate: source.startDate,
        endDate: source.endDate,
        assignments: source.assignments?.map((a) => ({ ...a })),
        minWorkEffortDays: source.minWorkEffortDays,
        workEffortUnit: source.workEffortUnit,
        ownerId: ownerIdRef.current ?? undefined,
      };
      const taskIdMap = new Map<string, string>();
      for (const t of sourceTasks) taskIdMap.set(t.id, uuidv4());
      const newTasks: Task[] = sourceTasks.map((t) => {
        const newId = taskIdMap.get(t.id)!;
        const newParentId = t.parentId ? (taskIdMap.get(t.parentId) ?? null) : null;
        const newDeps = (t.dependencies ?? []).map((depId) => taskIdMap.get(depId)).filter((id): id is string => !!id);
        return {
          ...t,
          id: newId,
          projectId: newProjectId,
          parentId: newParentId,
          dependencies: newDeps,
          updatedAt: undefined,
        };
      });
      saveHistory();
      setProjects((prev) => [...prev, newProject]);
      setCurrentProjectId(newProject.id);
      setAllTasks((prev) => {
        const combined = [...prev, ...newTasks];
        const rolled = recomputeProjectRollups(combined, newProjectId);
        return rolled;
      });
      // 복사 직후 DB에 즉시 저장 (프로젝트 먼저 → 작업 순서, FK 제약 충족)
      if (!useLocalOnlyRef.current) {
        upsertProject(newProject)
          .then(() => upsertTasks(newTasks))
          .catch((err) => handleDbError(err, '복사 프로젝트 저장에 실패했습니다.'));
      }
    },
    [saveHistory, handleDbError, projectsRef, allTasksRef, ownerIdRef, useLocalOnlyRef, setProjects, setAllTasks, setCurrentProjectId],
  );

  return { addProject, updateProject, deleteProject, copyProject };
}
