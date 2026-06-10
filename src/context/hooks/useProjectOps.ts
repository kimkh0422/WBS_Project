import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project } from '../../types';
import { DEFAULT_NEW_PROJECT_KIND } from '../../lib/projectKind';
import { v4 as uuidv4 } from 'uuid';
import { upsertProject, upsertTasks } from '../../lib/db';
import { recomputeProjectRollups } from '../../lib/rollups';
import { convertStoredEffortBetweenUnits, normalizeWorkEffortUnit } from '../../lib/workEffortUnits';

export interface ProjectOpsDeps {
  saveHistory: () => void;
  bumpDirty: () => void;
  handleDbError: (err: unknown, fallback: string) => void;
  ownerIdRef: MutableRefObject<string | undefined>;
  /** 신규·복사 프로젝트 PM 기본값(만든 사람 표시명). `extras.pmName`이 비어 있으면 이 값으로 채움 */
  creatorDisplayNameRef: MutableRefObject<string | undefined>;
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
    creatorDisplayNameRef,
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
          | 'projectKind'
          | 'reportCategory'
          | 'reportAgency'
          | 'reportBudgetThisYear'
          | 'reportTotalPeriod'
          | 'reportNameShort'
          | 'reportNameFull'
          | 'workEffortUnit'
          | 'pmName'
          | 'poName'
          | 'includeInDashboard'
          | 'formalName'
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
      const extras = reportExtras ?? {};
      const resolvedKind = extras.projectKind !== undefined ? extras.projectKind : DEFAULT_NEW_PROJECT_KIND;
      const creatorDefault = creatorDisplayNameRef.current?.trim() || undefined;
      // extras에 pmName 키만 있고 값이 비어 있으면(모달에서 undefined 전달 등) 생성자 이름으로 채운다.
      const explicitPm = extras.pmName?.trim();
      const resolvedPmName = explicitPm || creatorDefault;
      if (!resolvedPmName?.trim()) {
        handleDbError(
          new Error('프로젝트 PM이 비어 있습니다. 로그인 사용자 표시명이 없으면 프로젝트 생성 전에 프로필 이름을 설정해 주세요.'),
          '프로젝트를 만들 수 없습니다.',
        );
        return;
      }
      const pmFinal = resolvedPmName.trim();
      const newProject: Project = {
        id: uuidv4(),
        name,
        description,
        startDate,
        endDate,
        assignments,
        minWorkEffortDays,
        ownerId: ownerIdRef.current,
        ...extras,
        projectKind: resolvedKind,
        pmName: pmFinal,
        poName: extras.poName?.trim() ? extras.poName.trim() : undefined,
      };
      setProjects((prev) => [...prev, newProject]);
      setCurrentProjectId(newProject.id);
      if (useLocalOnlyRef.current) {
        bumpDirty();
      } else {
        upsertProject(newProject).catch((err) => {
          bumpDirty();
          handleDbError(err, '프로젝트 저장에 실패했습니다.');
        });
      }
    },
    [bumpDirty, handleDbError, ownerIdRef, creatorDisplayNameRef, useLocalOnlyRef, setProjects, setCurrentProjectId],
  );

  const updateProject = useCallback(
    (id: string, updates: Partial<Project>) => {
      // 1) 변경 영향 사전 계산 — projectsRef는 즉시 동기화되어 있으므로 안전하게 읽는다.
      const prevProjects = projectsRef.current;
      const project = prevProjects.find((p) => p.id === id);
      if (!project) {
        // 프로젝트가 없으면 (이론적으로 발생 안 함) 단순 머지만 수행하고 종료
        setProjects((prev) => prev.map((p) => (p.id === id ? ({ ...p, ...updates } as Project) : p)));
        bumpDirty();
        return;
      }

      const unitChanging =
        updates.workEffortUnit !== undefined &&
        normalizeWorkEffortUnit(project.workEffortUnit) !== normalizeWorkEffortUnit(updates.workEffortUnit);

      /** 로컬 전용의 일반 프로젝트 필드 수정만 수동 동기화 플래그를 올린다. 원격+비단위변경은 upsert로 즉시 DB 반영. 공수 단위 변경은 saveHistory가 bump한다. */
      if (useLocalOnlyRef.current && !unitChanging) {
        bumpDirty();
      }

      // 2) 프로젝트 자체 상태는 항상 먼저 갱신 (작업 일괄 이동은 하지 않음)
      setProjects((prev) => prev.map((p) => (p.id === id ? ({ ...p, ...updates } as Project) : p)));

      // 3) 공수 단위만 바뀐 경우에만 작업 공수 숫자 변환(작업 일정은 자동 조정하지 않음)
      if (unitChanging) {
        saveHistory();

        setAllTasks((currentTasks) => {
          const shifted = currentTasks.map((t) => {
            if (t.projectId !== id) return t;
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

          const doneStatusIds = new Set<string>();
          const rolled = recomputeProjectRollups(shifted, id, doneStatusIds, undefined, true);
          if (!useLocalOnlyRef.current) upsertTasks(rolled).catch((err) => handleDbError(err, '공수 단위 변경 저장에 실패했습니다.'));
          return rolled;
        });
      }

      // 4) DB에 프로젝트 변경 반영 — 로컬 모드 아닐 때
      // detectPermissionDenied: RLS가 조용히 거부(0행)하면 권한 오류로 올려 무음 되돌림을 막는다.
      if (!useLocalOnlyRef.current) {
        upsertProject({ ...project, ...updates } as Project, { detectPermissionDenied: true }).catch((err) => {
          bumpDirty();
          handleDbError(err, '프로젝트 수정 저장에 실패했습니다.');
        });
      }
    },
    [bumpDirty, saveHistory, handleDbError, projectsRef, useLocalOnlyRef, setProjects, setAllTasks],
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
      const copierPm = creatorDisplayNameRef.current?.trim() || undefined;
      const copiedPm = copierPm || source.pmName?.trim();
      const newProject: Project = {
        id: newProjectId,
        name: `${source.name} (복사본)`,
        formalName: source.formalName,
        description: source.description,
        startDate: source.startDate,
        endDate: source.endDate,
        assignments: source.assignments?.map((a) => ({ ...a })),
        minWorkEffortDays: source.minWorkEffortDays,
        workEffortUnit: source.workEffortUnit,
        projectKind: source.projectKind,
        ownerId: ownerIdRef.current ?? undefined,
        pmName: copiedPm || 'PM 미입력',
        poName: source.poName?.trim() || undefined,
        includeInDashboard: source.includeInDashboard !== false,
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
        const rolled = recomputeProjectRollups(combined, newProjectId, undefined, undefined, true);
        return rolled;
      });
      // 복사 직후 DB에 즉시 저장 (프로젝트 먼저 → 작업 순서, FK 제약 충족)
      if (!useLocalOnlyRef.current) {
        upsertProject(newProject)
          .then(() => upsertTasks(newTasks))
          .catch((err) => handleDbError(err, '복사 프로젝트 저장에 실패했습니다.'));
      }
    },
    [
      saveHistory,
      handleDbError,
      projectsRef,
      allTasksRef,
      ownerIdRef,
      creatorDisplayNameRef,
      useLocalOnlyRef,
      setProjects,
      setAllTasks,
      setCurrentProjectId,
    ],
  );

  const forkTaskToProject = useCallback(
    (
      sourceTaskId: string,
      input: {
        name: string;
        formalName?: string;
        description?: string;
        pmName?: string;
        poName?: string;
        startDate?: string;
        endDate?: string;
        projectKind?: Project['projectKind'];
        includeInDashboard?: boolean;
      },
    ): string | undefined => {
      const projs = projectsRef.current;
      const tasks = allTasksRef.current;
      const sourceTask = tasks.find((t) => t.id === sourceTaskId);
      if (!sourceTask) {
        handleDbError(new Error('분기할 작업을 찾을 수 없습니다.'), '작업 분기에 실패했습니다.');
        return undefined;
      }
      if (projs.some((p) => p.sourceTaskId === sourceTaskId)) {
        handleDbError(new Error('이 작업은 이미 다른 프로젝트로 분기되어 있습니다.'), '작업 분기에 실패했습니다.');
        return undefined;
      }
      const sourceProject = projs.find((p) => p.id === sourceTask.projectId);
      if (!sourceProject) {
        handleDbError(new Error('원본 프로젝트를 찾을 수 없습니다.'), '작업 분기에 실패했습니다.');
        return undefined;
      }
      if (!useLocalOnlyRef.current && !ownerIdRef.current) {
        handleDbError(new Error('로그인 세션이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.'), '프로젝트 저장에 실패했습니다.');
        return undefined;
      }
      const creatorDefault = creatorDisplayNameRef.current?.trim() || undefined;
      const resolvedPm = input.pmName?.trim() || creatorDefault || sourceProject.pmName?.trim();
      if (!resolvedPm) {
        handleDbError(new Error('프로젝트 PM이 비어 있습니다. PM 이름을 입력해 주세요.'), '분기 프로젝트를 만들 수 없습니다.');
        return undefined;
      }
      const newProjectId = uuidv4();

      // 원본 task의 자식 트리(strict descendants) 수집
      const childrenBy = new Map<string, Task[]>();
      for (const t of tasks) {
        if (t.projectId !== sourceTask.projectId || !t.parentId) continue;
        const arr = childrenBy.get(t.parentId);
        if (arr) arr.push(t);
        else childrenBy.set(t.parentId, [t]);
      }
      const descendantTasks: Task[] = [];
      const stack = [sourceTaskId];
      while (stack.length) {
        const id = stack.pop()!;
        const ch = childrenBy.get(id);
        if (!ch) continue;
        for (const c of ch) {
          descendantTasks.push(c);
          stack.push(c.id);
        }
      }

      // 새 task id 매핑
      const taskIdMap = new Map<string, string>();
      for (const t of descendantTasks) taskIdMap.set(t.id, uuidv4());

      const newTasks: Task[] = descendantTasks.map((t) => {
        const newId = taskIdMap.get(t.id)!;
        let newParentId: string | null;
        if (t.parentId === sourceTaskId) {
          newParentId = null; // 분기된 자식 프로젝트의 root task가 됨
        } else if (t.parentId && taskIdMap.has(t.parentId)) {
          newParentId = taskIdMap.get(t.parentId)!;
        } else {
          newParentId = null;
        }
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

      const newProject: Project = {
        id: newProjectId,
        name: (input.name ?? '').trim() || sourceTask.name,
        formalName: input.formalName?.trim() || undefined,
        description: input.description?.trim() || undefined,
        startDate: input.startDate || sourceTask.startDate || sourceProject.startDate,
        endDate: input.endDate || sourceTask.endDate || sourceProject.endDate,
        assignments: sourceProject.assignments?.map((a) => ({ ...a })),
        minWorkEffortDays: sourceProject.minWorkEffortDays,
        workEffortUnit: sourceProject.workEffortUnit,
        projectKind: input.projectKind ?? sourceProject.projectKind ?? DEFAULT_NEW_PROJECT_KIND,
        ownerId: ownerIdRef.current ?? undefined,
        pmName: resolvedPm,
        poName: input.poName?.trim() || sourceProject.poName,
        includeInDashboard: input.includeInDashboard ?? true,
        sourceTaskId,
        sourceProjectId: sourceProject.id,
      };

      saveHistory();
      setProjects((prev) => [...prev, newProject]);
      setCurrentProjectId(newProjectId);
      const deletedIds = descendantTasks.map((t) => t.id);
      if (deletedIds.length > 0) recordDeletedTaskIds(sourceProject.id, deletedIds);
      setAllTasks((prev) => {
        const withoutChildren = deletedIds.length > 0 ? prev.filter((t) => !deletedIds.includes(t.id)) : prev;
        const combined = newTasks.length > 0 ? [...withoutChildren, ...newTasks] : withoutChildren;
        // 분기된 자식 프로젝트의 롤업 (자체)
        const rolledChild = recomputeProjectRollups(combined, newProjectId, undefined, undefined, true);
        // 원본 프로젝트의 부모 task는 이제 leaf — 일정/진척은 mirror 단계가 덮어쓴다.
        return recomputeProjectRollups(rolledChild, sourceProject.id, undefined, undefined, true);
      });

      if (!useLocalOnlyRef.current) {
        upsertProject(newProject)
          .then(() => (newTasks.length > 0 ? upsertTasks(newTasks) : Promise.resolve()))
          .catch((err) => handleDbError(err, '분기 프로젝트 저장에 실패했습니다.'));
      } else {
        bumpDirty();
      }

      return newProjectId;
    },
    [
      saveHistory,
      bumpDirty,
      handleDbError,
      ownerIdRef,
      creatorDisplayNameRef,
      projectsRef,
      allTasksRef,
      useLocalOnlyRef,
      setProjects,
      setAllTasks,
      setCurrentProjectId,
      recordDeletedTaskIds,
    ],
  );

  return { addProject, updateProject, deleteProject, copyProject, forkTaskToProject };
}
