import { useMemo } from 'react';
import type { Task } from '../../types';

export interface SummaryStats {
  totalEffort: number;
  avgProgress: number;
  startDate: string;
  endDate: string;
  taskCount: number;
  leafCount: number;
  isSelection: boolean;
}

/**
 * 전체 진척율: 1레벨 WBS의 (progress×weight) 가중평균을 우선 사용.
 * (weight 없으면 공수로 대체) 1레벨이 없으면 폴백으로 단말(리프) 단순 평균.
 */
export function useWbsSummaryStats(baseTasks: Task[]): SummaryStats | null {
  return useMemo(() => {
    const source = baseTasks;
    if (source.length === 0) return null;

    const leafTasks = source.filter((t) => !source.some((other) => other.parentId === t.id));
    const forAggregate = leafTasks.length > 0 ? leafTasks : source;

    const totalEffort = forAggregate.reduce((sum, t) => sum + (t.workEffort || 0), 0);
    const taskById = new Map<string, Task>(source.map((t) => [t.id, t]));
    const depthMemo = new Map<string, number>();
    const getDepth = (id: string): number => {
      const cached = depthMemo.get(id);
      if (cached !== undefined) return cached;
      const t = taskById.get(id);
      if (!t || !t.parentId || !taskById.has(t.parentId)) {
        depthMemo.set(id, 0);
        return 0;
      }
      const d = getDepth(t.parentId) + 1;
      depthMemo.set(id, d);
      return d;
    };
    const level1 = source.filter((t) => getDepth(t.id) === 1);
    const computeWeighted = (items: Task[]) => {
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
      if (totalWeight > 0) return Math.round(acc / totalWeight);
      if (items.length > 0)
        return Math.round(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length);
      return 0;
    };
    const avgProgress =
      level1.length > 0
        ? computeWeighted(level1)
        : forAggregate.length > 0
          ? Math.round(forAggregate.reduce((sum, t) => sum + (t.progress || 0), 0) / forAggregate.length)
          : 0;
    const startDate = source.reduce((min, t) => (t.startDate < min ? t.startDate : min), source[0].startDate);
    const endDate = source.reduce((max, t) => (t.endDate > max ? t.endDate : max), source[0].endDate);

    return { totalEffort, avgProgress, startDate, endDate, taskCount: source.length, leafCount: leafTasks.length, isSelection: false };
  }, [baseTasks]);
}

export function formatSummaryDate(d: string): string {
  if (!d) return '-';
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}
