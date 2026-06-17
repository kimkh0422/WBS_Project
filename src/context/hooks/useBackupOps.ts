import { useCallback, useMemo, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task, Project } from '../../types';
import { DEFAULT_NEW_PROJECT_KIND } from '../../lib/projectKind';
import { WBSSettings, parseSettings } from '../../lib/wbsSettings';
import { BackupData } from '../../lib/export';
import { v4 as uuidv4 } from 'uuid';
import { recomputeProjectRollups, applyRollupsToTasks } from '../../lib/rollups';
import { ensureProjectTopLevelNameInTasks } from '../../lib/ensureProjectTopLevelName';

export interface BackupOpsDeps {
  saveHistory: (label?: string) => void;
  bumpDirty: (...projectIds: string[]) => void;
  recordDeletedTaskIds: (projectId: string, ids: string[]) => void;
  ownerIdRef: MutableRefObject<string | undefined>;
  /** 신규·리셋 프로젝트 PM 기본값(표시명) */
  creatorDisplayNameRef: MutableRefObject<string | undefined>;
  currentProjectIdRef: MutableRefObject<string>;
  projectsRef: MutableRefObject<Project[]>;
  allTasksRef: MutableRefObject<Task[]>;
  wbsSettingsRef: MutableRefObject<WBSSettings>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  setCurrentProjectId: (id: string) => void;
  setWbsSettings: Dispatch<SetStateAction<WBSSettings>>;
  setSelectedTaskIds: (ids: string[]) => void;
  setDeletedProjectIds: Dispatch<SetStateAction<string[]>>;
}

export function useBackupOps(deps: BackupOpsDeps) {
  const {
    saveHistory,
    bumpDirty,
    recordDeletedTaskIds,
    ownerIdRef,
    creatorDisplayNameRef,
    currentProjectIdRef,
    projectsRef,
    allTasksRef,
    wbsSettingsRef,
    setProjects,
    setAllTasks,
    setCurrentProjectId,
    setWbsSettings,
    setSelectedTaskIds,
    setDeletedProjectIds,
  } = deps;

  const importTasks = useCallback(
    async (
      newTasks: Task[],
      targetProjectId?: string,
      newProjectName?: string,
      addCustomColumns?: Array<{ id: string; name: string }>,
    ): Promise<void> => {
      saveHistory();
      const cpi = currentProjectIdRef.current;
      const projs = projectsRef.current;
      let effectiveProjectId = targetProjectId ?? (cpi === 'all' ? projs[0]?.id || '' : cpi);

      const createNewProject = effectiveProjectId === '__new__' && typeof newProjectName === 'string' && newProjectName.trim().length > 0;

      const newProject: Project | null = createNewProject
        ? {
            id: uuidv4(),
            name: newProjectName!.trim() || '가져온 프로젝트',
            ownerId: ownerIdRef.current ?? undefined,
            pmName: creatorDisplayNameRef.current?.trim() || 'PM 미입력',
          }
        : null;

      if (newProject) {
        effectiveProjectId = newProject.id;
      }

      const tasksWithProject = newTasks.map((t) => ({ ...t, projectId: effectiveProjectId }));

      if (newProject) {
        setProjects((prev) => [...prev, newProject]);
        setCurrentProjectId(newProject.id);
      }
      // 가져온 사용자 정의 컬럼 정의를 설정에 등록:
      //  - customColumns: 새 정의만 추가(같은 id는 건너뜀). 임포트 대상 프로젝트의 id를 붙여 다른 프로젝트에선 자동 제외되게 한다.
      //  - tableColumns: 가져온 컬럼은 모두 visible: true로 보장(없으면 끝에 추가, 있으면 visible 켬). 다른 프로젝트에서는 customColumnNameById 필터로 자동 제외돼 보이지 않음.
      if (addCustomColumns && addCustomColumns.length > 0) {
        setWbsSettings((prev) => {
          const existingCustomIds = new Set((prev.customColumns ?? []).map((c) => c.id));
          const newCustomDefs = addCustomColumns
            .filter((c) => c && c.id && !existingCustomIds.has(c.id))
            .map((c) => ({ id: c.id, name: c.name, projectId: effectiveProjectId }));
          const tableMap = new Map<string, { id: string; visible: boolean }>(
            (prev.tableColumns ?? []).map((c) => [c.id, { id: c.id, visible: c.visible !== false }]),
          );
          let tableChanged = false;
          for (const cc of addCustomColumns) {
            if (!cc?.id) continue;
            const cur = tableMap.get(cc.id);
            if (!cur || !cur.visible) {
              tableMap.set(cc.id, { id: cc.id, visible: true });
              tableChanged = true;
            }
          }
          if (newCustomDefs.length === 0 && !tableChanged) return prev;
          return {
            ...prev,
            customColumns: newCustomDefs.length > 0 ? [...(prev.customColumns ?? []), ...newCustomDefs] : prev.customColumns,
            tableColumns: tableChanged ? Array.from(tableMap.values()) : prev.tableColumns,
          };
        });
      }
      setAllTasks((prev) => {
        const prevProjectTaskIds = prev.filter((t) => t.projectId === effectiveProjectId).map((t) => t.id);
        const nextProjectTaskIds = tasksWithProject.map((t) => t.id);
        const removed = prevProjectTaskIds.filter((id) => !new Set(nextProjectTaskIds).has(id));
        if (removed.length > 0) recordDeletedTaskIds(effectiveProjectId, removed);
        // 가져온 파일에 적힌 시작일·종료일을 그대로 보존(skipScheduleRollup=true). 진척·공수만 롤업.
        return recomputeProjectRollups(
          [...prev.filter((t) => t.projectId !== effectiveProjectId), ...tasksWithProject],
          effectiveProjectId,
          undefined,
          undefined,
          true,
        );
      });
      bumpDirty(effectiveProjectId);
    },
    [
      saveHistory,
      bumpDirty,
      recordDeletedTaskIds,
      ownerIdRef,
      creatorDisplayNameRef,
      currentProjectIdRef,
      projectsRef,
      setProjects,
      setAllTasks,
      setCurrentProjectId,
      setWbsSettings,
    ],
  );

  const deleteAllTasks = useCallback(() => {
    saveHistory();
    const effectiveProjectId = currentProjectIdRef.current === 'all' ? '' : currentProjectIdRef.current;
    setAllTasks((prev) => {
      if (effectiveProjectId) {
        const ids = prev.filter((t) => t.projectId === effectiveProjectId).map((t) => t.id);
        if (ids.length > 0) recordDeletedTaskIds(effectiveProjectId, ids);
      } else {
        const idsByProject = new Map<string, string[]>();
        prev.forEach((t) => {
          if (!t.projectId) return;
          idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
        });
        idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      }
      return effectiveProjectId ? prev.filter((t) => t.projectId !== effectiveProjectId) : [];
    });
    if (effectiveProjectId) bumpDirty(effectiveProjectId);
    else bumpDirty(...projectsRef.current.map((p) => p.id).filter(Boolean));
  }, [saveHistory, bumpDirty, recordDeletedTaskIds, currentProjectIdRef, setAllTasks, projectsRef]);

  const deleteAllTasksInAllProjects = useCallback(() => {
    saveHistory();
    setAllTasks((prev) => {
      const idsByProject = new Map<string, string[]>();
      prev.forEach((t) => {
        if (!t.projectId) return;
        idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
      });
      idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      return [];
    });
    bumpDirty(...projectsRef.current.map((p) => p.id).filter(Boolean));
  }, [saveHistory, bumpDirty, recordDeletedTaskIds, setAllTasks, projectsRef]);

  const resetAllProjectsToNew = useCallback(async (): Promise<void> => {
    const newProject: Project = {
      id: uuidv4(),
      name: '새 프로젝트',
      ownerId: ownerIdRef.current,
      projectKind: DEFAULT_NEW_PROJECT_KIND,
      includeInDashboard: false,
      pmName: creatorDisplayNameRef.current?.trim() || 'PM 미입력',
    };
    saveHistory();
    setSelectedTaskIds([]);

    // 기존 프로젝트들의 ID를 deletedProjectIds에 기록 → 다음 sync에서 DB에서도 삭제됨.
    // 그러지 않으면 클라이언트만 리셋되고 DB엔 남아 다음 fetch에서 다시 보인다.
    const existingProjectIds = projectsRef.current.map((p) => p.id).filter(Boolean);
    if (existingProjectIds.length > 0) {
      setDeletedProjectIds((prev) => Array.from(new Set([...prev, ...existingProjectIds])));
    }

    setProjects([newProject]);
    setAllTasks((prev) => {
      const idsByProject = new Map<string, string[]>();
      prev.forEach((t) => {
        if (!t.projectId) return;
        idsByProject.set(t.projectId, [...(idsByProject.get(t.projectId) ?? []), t.id]);
      });
      idsByProject.forEach((ids, pid) => recordDeletedTaskIds(pid, ids));
      const { tasks: ensured } = ensureProjectTopLevelNameInTasks([newProject], []);
      return applyRollupsToTasks(ensured, wbsSettingsRef.current.statusConfigs);
    });
    setCurrentProjectId(newProject.id);
    bumpDirty(...existingProjectIds, newProject.id); // 자동 sync trigger → DB에서 기존 프로젝트들 삭제됨
    try {
      localStorage.setItem('wbs-current-project', newProject.id);
    } catch (_) {}
  }, [
    saveHistory,
    bumpDirty,
    recordDeletedTaskIds,
    ownerIdRef,
    creatorDisplayNameRef,
    projectsRef,
    setProjects,
    setAllTasks,
    setCurrentProjectId,
    setSelectedTaskIds,
    setDeletedProjectIds,
  ]);

  const restoreBackup = useCallback(
    (data: BackupData) => {
      const projectIds = Array.from(new Set(data.tasks.map((t) => t.projectId))).filter(Boolean) as string[];
      let rolled = data.tasks;
      // 백업에 저장된 시작일·종료일 그대로 복원(skipScheduleRollup=true). 진척·공수만 롤업.
      for (const pid of projectIds) rolled = recomputeProjectRollups(rolled, pid, undefined, undefined, true);
      const { tasks: topped } = ensureProjectTopLevelNameInTasks(data.projects, rolled);
      setProjects(data.projects);
      setAllTasks(topped);
      setWbsSettings(parseSettings(data.settings));
      if (data.projects.length > 0) {
        if (!data.projects.find((p) => p.id === currentProjectIdRef.current)) setCurrentProjectId(data.projects[0].id);
      } else setCurrentProjectId('');
      bumpDirty(...data.projects.map((p) => p.id).filter(Boolean));
    },
    [bumpDirty, currentProjectIdRef, setProjects, setAllTasks, setWbsSettings, setCurrentProjectId],
  );

  const exportFullBackup = useCallback(
    (): BackupData => ({
      version: '1.0',
      projects: projectsRef.current,
      tasks: allTasksRef.current,
      settings: wbsSettingsRef.current,
      exportDate: new Date().toISOString(),
    }),
    [projectsRef, allTasksRef, wbsSettingsRef],
  );

  const mergeBackups = useCallback(
    (backups: BackupData[]): { addedProjects: number; addedTasks: number } => {
      const newProjects: Project[] = [];
      const newTasks: Task[] = [];
      const currentOwnerId = ownerIdRef.current;
      const statusConfigs = wbsSettingsRef.current.statusConfigs;
      for (const backup of backups) {
        const projectIdMap = new Map<string, string>();
        for (const project of backup.projects) {
          const newId = uuidv4();
          projectIdMap.set(project.id, newId);
          newProjects.push({ ...project, id: newId, ownerId: currentOwnerId ?? project.ownerId });
        }
        const taskIdMap = new Map<string, string>();
        for (const task of backup.tasks) taskIdMap.set(task.id, uuidv4());
        for (const task of backup.tasks) {
          const newProjectId = projectIdMap.get(task.projectId);
          if (!newProjectId) continue;
          newTasks.push({
            ...task,
            id: taskIdMap.get(task.id)!,
            projectId: newProjectId,
            parentId: task.parentId ? (taskIdMap.get(task.parentId) ?? null) : null,
            dependencies: task.dependencies?.map((depId) => taskIdMap.get(depId) ?? depId) ?? [],
          });
        }
      }
      const nextProjects = [...projectsRef.current, ...newProjects];
      const combinedTasks = [...allTasksRef.current, ...newTasks];
      const { tasks: ensuredMerge } = ensureProjectTopLevelNameInTasks(nextProjects, combinedTasks);
      setProjects(nextProjects);
      setAllTasks(applyRollupsToTasks(ensuredMerge, statusConfigs));
      if (newProjects.length > 0) setCurrentProjectId(newProjects[0].id);
      bumpDirty(...nextProjects.map((p) => p.id).filter(Boolean));
      return { addedProjects: newProjects.length, addedTasks: newTasks.length };
    },
    [bumpDirty, ownerIdRef, wbsSettingsRef, projectsRef, allTasksRef, setProjects, setAllTasks, setCurrentProjectId],
  );

  return useMemo(
    () => ({
      importTasks,
      deleteAllTasks,
      deleteAllTasksInAllProjects,
      resetAllProjectsToNew,
      restoreBackup,
      exportFullBackup,
      mergeBackups,
    }),
    [importTasks, deleteAllTasks, deleteAllTasksInAllProjects, resetAllProjectsToNew, restoreBackup, exportFullBackup, mergeBackups],
  );
}
