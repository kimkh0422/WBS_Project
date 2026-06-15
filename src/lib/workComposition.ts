import type { Task } from '../types';
import { round1 } from './utils';

function finitePositiveEffort(e: number | undefined | null): number {
  return typeof e === 'number' && Number.isFinite(e) && e > 0 ? e : 0;
}

/**
 * 동일 부모·동일 프로젝트 직속 형제들의 공수(workEffort) 합.
 */
export function siblingEffortSum(task: Pick<Task, 'id' | 'projectId' | 'parentId'>, allTasks: Task[]): number {
  const pid = task.parentId;
  const proj = task.projectId;
  if (!proj) return 0;
  let sum = 0;
  for (const t of allTasks) {
    if (t.projectId !== proj) continue;
    if ((t.parentId ?? null) !== (pid ?? null)) continue;
    sum += finitePositiveEffort(t.workEffort);
  }
  return sum;
}

/**
 * 업무 구성비(%): 이 행 공수 ÷ 직속 형제 공수 합 × 100, 소수 첫째 자리까지.
 * 최상위(부모 없음)이거나 형제 공수 합이 0이면 null(표시는 '—' 등).
 */
export function computeWorkCompositionPercent(task: Task, allTasks: Task[]): number | null {
  if (task.parentId == null) return null;
  const sum = siblingEffortSum(task, allTasks);
  if (sum <= 0) return null;
  const own = finitePositiveEffort(task.workEffort);
  return round1((own / sum) * 100);
}
