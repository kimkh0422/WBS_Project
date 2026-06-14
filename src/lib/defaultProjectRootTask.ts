import type { Project, Task } from '../types';
import { formatProjectDisplayName } from './projectKind';
import { DEFAULT_NEW_TASK_WORK_EFFORT, defaultEndDateForNewTask } from './workEffortUnits';

/** 신규 프로젝트 생성 직후 WBS 최상단에 넣을 기본 루트 작업 초안(프로젝트 표시명 = 작업명). */
export function draftDefaultRootTaskForProject(
  project: Pick<Project, 'name' | 'startDate' | 'endDate' | 'projectKind'>,
): Omit<Task, 'id' | 'projectId'> {
  const startIso = project.startDate || new Date().toISOString().split('T')[0];
  const endIso =
    project.endDate && String(project.endDate).localeCompare(startIso) >= 0 ? project.endDate : defaultEndDateForNewTask(startIso);
  const raw = (project.name || '').trim() || '프로젝트';
  return {
    name: formatProjectDisplayName(raw, project.projectKind),
    parentId: null,
    startDate: startIso,
    endDate: endIso,
    progress: 0,
    workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
    assignee: '',
    status: 'todo',
    expanded: true,
  };
}
