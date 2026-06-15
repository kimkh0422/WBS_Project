import type { Project, Task } from '../types';
import { computePlannedProgressMap } from './plannedProgress';
import { computeProjectAssigneeWorkEffort } from './personAllocations';
import { aggregatePercentByWeight } from './utils';
import { getUseWeightForProgressRollup } from './rollupOptions';
import { rollupWeightFromEffort } from './progressRollupWeights';

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

/** progress 가중평균(가중치 ON) 또는 단순평균(가중치 OFF). 결과 0~100% 클램프 — 요약 바와 동일 규칙. */
function computeWeightedProgress(items: Task[], useWeight: boolean): number {
  return aggregatePercentByWeight(
    items.map((t) => ({
      value: typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0,
      weight: rollupWeightFromEffort(t),
    })),
    useWeight,
    Math.round,
  );
}

function computeWeightedPlanned(items: Task[], plannedById: Map<string, number>, useWeight: boolean): number {
  return aggregatePercentByWeight(
    items.map((t) => ({ value: plannedById.get(t.id) ?? 0, weight: rollupWeightFromEffort(t) })),
    useWeight,
    Math.round,
  );
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
  const useWeight = getUseWeightForProgressRollup();
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
      ? computeWeightedProgress(level1, useWeight)
      : forAggregate.length > 0
        ? Math.min(100, Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (t.progress || 0), 0) / forAggregate.length)))
        : 0;

  const plannedById = computePlannedProgressMap(pTasks);
  const planned =
    level1.length > 0
      ? computeWeightedPlanned(level1, plannedById, useWeight)
      : forAggregate.length > 0
        ? Math.min(
            100,
            Math.max(0, Math.round(forAggregate.reduce((acc, t) => acc + (plannedById.get(t.id) ?? 0), 0) / forAggregate.length)),
          )
        : 0;

  return { taskCount: total, progress, planned, inputManDays };
}
