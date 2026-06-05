import type { Project, Task } from '../types';
import { computePlannedProgressMap } from './plannedProgress';
import { computeProjectAssigneeWorkEffort } from './personAllocations';

/** 주어진 task 목록에서 깊이(depth)를 메모이제이션하여 반환하는 getter 생성 */
function buildDepthGetter(taskById: Map<string, Task>): (id: string) => number {
  const memo = new Map<string, number>();
  const get = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const t = taskById.get(id);
    if (!t || !t.parentId || !taskById.has(t.parentId)) {
      memo.set(id, 0);
      return 0;
    }
    const d = get(t.parentId) + 1;
    memo.set(id, d);
    return d;
  };
  return get;
}

/** progress × weight 가중평균(Σw는 임의, Σ(pw)/Σw). 결과 0~100% 클램프 — 대시보드 projectStats와 동일 */
function computeWeightedProgress(items: Task[]): number {
  let totalWeight = 0;
  let acc = 0;
  for (const t of items) {
    const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    const w =
      typeof t.weight === 'number' && Number.isFinite(t.weight)
        ? t.weight
        : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
          ? t.workEffort
          : 0;
    totalWeight += w;
    acc += p * w;
  }
  if (totalWeight > 0) return Math.min(100, Math.max(0, Math.round(acc / totalWeight)));
  if (items.length > 0)
    return Math.min(
      100,
      Math.max(0, Math.round(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length)),
    );
  return 0;
}

function computeWeightedPlanned(items: Task[], plannedById: Map<string, number>): number {
  let totalWeight = 0;
  let acc = 0;
  for (const t of items) {
    const p = plannedById.get(t.id) ?? 0;
    const w =
      typeof t.weight === 'number' && Number.isFinite(t.weight)
        ? t.weight
        : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
          ? t.workEffort
          : 0;
    totalWeight += w;
    acc += p * w;
  }
  if (totalWeight > 0) return Math.min(100, Math.max(0, Math.round(acc / totalWeight)));
  if (items.length > 0)
    return Math.min(100, Math.max(0, Math.round(items.reduce((s, t) => s + (plannedById.get(t.id) ?? 0), 0) / items.length)));
  return 0;
}

export type ProjectRollupMetrics = {
  taskCount: number;
  progress: number;
  planned: number;
  inputManDays: number;
};

/**
 * 한 프로젝트의 WBS 작업만으로 진척률·계획율·작업 수·투입 공수(M/D 합)를 계산합니다.
 * 대시보드 `projectStats`와 동일한 집계 규칙입니다.
 */
export function computeProjectRollupMetrics(project: Project, pTasks: Task[]): ProjectRollupMetrics {
  const total = pTasks.length;
  const assigneeWorkMd = computeProjectAssigneeWorkEffort(pTasks, project.id);
  const inputManDays = [...assigneeWorkMd.values()].reduce((a, b) => a + b, 0);

  const taskById = new Map<string, Task>(pTasks.map((t) => [t.id, t]));
  const getDepth = buildDepthGetter(taskById);
  const level1 = pTasks.filter((t) => getDepth(t.id) === 0);
  const pParentIdSet = new Set(pTasks.map((t) => t.parentId).filter(Boolean));
  const leafTasks = pTasks.filter((t) => !pParentIdSet.has(t.id));
  const forAggregate = leafTasks.length > 0 ? leafTasks : pTasks;

  const progress =
    level1.length > 0
      ? computeWeightedProgress(level1)
      : forAggregate.length > 0
        ? Math.min(100, Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (t.progress || 0), 0) / forAggregate.length)))
        : 0;

  const plannedById = computePlannedProgressMap(pTasks);
  const planned =
    level1.length > 0
      ? computeWeightedPlanned(level1, plannedById)
      : forAggregate.length > 0
        ? Math.min(
            100,
            Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (plannedById.get(t.id) ?? 0), 0) / forAggregate.length)),
          )
        : 0;

  return { taskCount: total, progress, planned, inputManDays };
}
