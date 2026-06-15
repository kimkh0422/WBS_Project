import type { Project, Task } from '../types';
import { formatProjectDisplayName } from './projectKind';
import { getTopologicalOrder } from './schedule';

function normalizeParentId(parentId: Task['parentId']): string | null {
  if (parentId == null) return null;
  const v = String(parentId).trim();
  if (!v || v === 'null' || v === 'undefined') return null;
  return v;
}

/** 거울 task·삭제 예정 제외: 프로젝트의 실제 루트(parentId null) 작업 */
function physicalRootsForProject(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.projectId === projectId && !t.mirroredFromTaskId && normalizeParentId(t.parentId) === null);
}

function sortRootsByTopo(allTasks: Task[], roots: Task[]): Task[] {
  if (roots.length <= 1) return roots;
  const pid = roots[0]!.projectId;
  const subset = allTasks.filter((t) => t.projectId === pid && !t.mirroredFromTaskId);
  const order = getTopologicalOrder(subset);
  const idx = new Map(order.map((id, i) => [id, i] as const));
  return [...roots].sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
}

export function expectedTopLevelTaskName(project: Pick<Project, 'name' | 'projectKind'>): string {
  const raw = (project.name || '').trim() || '프로젝트';
  return formatProjectDisplayName(raw, project.projectKind);
}

/** 프로젝트 표시명과 동일한 이름의 루트 행인지(거울·비루트 제외). 마인드맵 등에서 해당 행을 숨길 때 사용 */
export function isProjectTitleRootTask(
  task: Pick<Task, 'projectId' | 'parentId' | 'name' | 'mirroredFromTaskId'>,
  project: Pick<Project, 'id' | 'name' | 'projectKind'> | undefined,
): boolean {
  if (!project || task.mirroredFromTaskId) return false;
  if (normalizeParentId(task.parentId) !== null) return false;
  if (task.projectId !== project.id) return false;
  return task.name.trim() === expectedTopLevelTaskName(project).trim();
}

/**
 * 마인드맵 등 트리 레이아웃용: 프로젝트명 전용 루트 행을 제거하고, 그 자식의 parent를 null로 올린 사본을 만든다.
 * 실제 `allTasks` 상태는 바꾸지 않는다.
 */
export function mapTasksOmittingProjectTitleRootsForTreeLayout(tasks: Task[], projects: readonly Project[]): Task[] {
  const byPid = new Map(projects.map((p) => [p.id, p] as const));
  const titleIds = new Set<string>();
  for (const t of tasks) {
    if (isProjectTitleRootTask(t, byPid.get(t.projectId))) titleIds.add(t.id);
  }
  if (titleIds.size === 0) return tasks;
  return tasks
    .filter((t) => !titleIds.has(t.id))
    .map((t) => {
      const pid = normalizeParentId(t.parentId);
      if (pid == null || !titleIds.has(pid)) return t;
      return { ...t, parentId: null };
    });
}

/**
 * 각 프로젝트 WBS 최상단 구조를 정규화한다.
 * - 루트가 없으면: 작업을 추가하지 않는다.
 * - 루트가 정확히 하나면 **이름이 프로젝트 표시명과 달라도** 그대로 둔다.
 * - 루트가 여러 개이면: 이름이 기대값(`formatProjectDisplayName` 기준)과 일치하는 루트가 있으면
 *   나머지 루트를 그 아래로 묶는다. 일치하는 루트가 없으면 변경하지 않는다.
 * idempotent: 이미 처리할 일이 없으면 변경 없음.
 */
export function ensureProjectTopLevelNameInTasks(projects: Project[], tasks: Task[]): { tasks: Task[]; changed: boolean } {
  if (projects.length === 0) return { tasks, changed: false };

  const updates = new Map<string, Task>();

  for (const project of projects) {
    const pid = project.id;
    if (!pid) continue;

    const roots = sortRootsByTopo(tasks, physicalRootsForProject(tasks, pid));
    const expected = expectedTopLevelTaskName(project);

    if (roots.length === 0) {
      continue;
    }

    if (roots.length === 1) {
      continue;
    }

    const canonical = roots.find((r) => r.name.trim() === expected.trim());

    if (canonical) {
      for (const r of roots) {
        if (r.id === canonical.id) continue;
        const cur = updates.get(r.id) ?? r;
        if (normalizeParentId(cur.parentId) !== null) continue;
        updates.set(r.id, { ...cur, parentId: canonical.id });
      }
    }
  }

  if (updates.size === 0) {
    return { tasks, changed: false };
  }

  const out: Task[] = [];
  for (const t of tasks) {
    const u = updates.get(t.id);
    out.push(u ?? t);
  }
  return { tasks: out, changed: true };
}
