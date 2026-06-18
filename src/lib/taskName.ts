import type { Project, Task } from '../types';
import { ensureProjectTopLevelNameInTasks } from './ensureProjectTopLevelName';

/** 엑셀 WBS 등에서 작업명 앞에 붙는 계층 표시(ㄴ, ├, └ 등)를 제거 */
export function stripTaskNameHierarchyMarker(name: string): string {
  let s = String(name ?? '');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^(?:[ㄴ├└│▶►\-]+\s*)/, '');
  }
  return s.trimStart();
}

/** 모든 작업명에서 계층 표시 접두어를 제거한다. 변경이 있으면 changed: true */
export function normalizeTaskNameHierarchyMarkersInTasks(tasks: Task[]): { tasks: Task[]; changed: boolean } {
  let changed = false;
  const out = tasks.map((t) => {
    const stripped = stripTaskNameHierarchyMarker(t.name ?? '');
    const current = t.name ?? '';
    if (stripped !== current) {
      changed = true;
      return { ...t, name: stripped };
    }
    return t;
  });
  return { tasks: changed ? out : tasks, changed };
}

/** DB·로컬 로드 시 작업명 계층 표시 제거 후 프로젝트 최상단 구조를 정규화 */
export function normalizeLoadedTasks(
  projects: Project[],
  tasks: Task[],
): { tasks: Task[]; changed: boolean; nameChanged: boolean; topChanged: boolean } {
  const { tasks: named, changed: nameChanged } = normalizeTaskNameHierarchyMarkersInTasks(tasks);
  const { tasks: topped, changed: topChanged } = ensureProjectTopLevelNameInTasks(projects, named);
  return { tasks: topped, changed: nameChanged || topChanged, nameChanged, topChanged };
}
