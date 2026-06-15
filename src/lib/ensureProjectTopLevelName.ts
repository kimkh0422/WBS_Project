import { v4 as uuidv4 } from 'uuid';
import type { Project, Task } from '../types';
import { formatProjectDisplayName } from './projectKind';
import { getTopologicalOrder } from './schedule';
import { draftDefaultRootTaskForProject } from './defaultProjectRootTask';

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

/** `ensureProjectTopLevelNameInTasks`가 두는 프로젝트 표시명 전용 루트 행인지(거울·비루트 제외) */
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
 * - 루트가 없으면 기본 루트 1행을 추가한다(이름은 프로젝트 표시명과 동일).
 * - 루트가 정확히 하나면 **이름이 프로젝트 표시명과 달라도** 그대로 둔다.
 *   (프로젝트 복사 시 이름만 "(복사본)"으로 바뀌고 루트 작업명은 원본 그대로인 경우,
 *   예전에는 표시명 전용 루트를 새로 넣어 전체가 한 단계 들여쓰기되었다.)
 * - 루트가 여러 개이면: 이름이 기대값(`formatProjectDisplayName` 기준)과 일치하는 루트가 있으면
 *   나머지 루트를 그 아래로 묶고, 없으면 새 루트를 만들어 기존 루트들을 모두 그 하위로 옮긴다.
 * idempotent: 이미 처리할 일이 없으면 변경 없음.
 */
export function ensureProjectTopLevelNameInTasks(projects: Project[], tasks: Task[]): { tasks: Task[]; changed: boolean } {
  if (projects.length === 0) return { tasks, changed: false };

  const updates = new Map<string, Task>();
  const additions: Task[] = [];

  for (const project of projects) {
    const pid = project.id;
    if (!pid) continue;

    const roots = sortRootsByTopo(tasks, physicalRootsForProject(tasks, pid));
    const expected = expectedTopLevelTaskName(project);

    if (roots.length === 0) {
      const id = uuidv4();
      const draft = draftDefaultRootTaskForProject(project);
      additions.push({ ...draft, id, projectId: pid, name: expected });
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
      continue;
    }

    const newRootId = uuidv4();
    const draft = draftDefaultRootTaskForProject(project);
    additions.push({ ...draft, id: newRootId, projectId: pid, name: expected });
    for (const r of roots) {
      const cur = updates.get(r.id) ?? r;
      updates.set(r.id, { ...cur, parentId: newRootId });
    }
  }

  if (additions.length === 0 && updates.size === 0) {
    return { tasks, changed: false };
  }

  const out: Task[] = [];
  for (const t of tasks) {
    const u = updates.get(t.id);
    out.push(u ?? t);
  }
  out.push(...additions);
  return { tasks: out, changed: true };
}
