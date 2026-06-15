import type { Task } from '../types';

/**
 * 상·하위 진척·계획 롤업 가중치: **공수(workEffort)만** 사용합니다.
 * (진척 가중치 `weight` 필드는 롤업에 반영하지 않음 — 업무 구성비와 동일 기준.)
 */
export function rollupWeightFromEffort(t: Pick<Task, 'workEffort'>): number {
  const e = t.workEffort;
  return typeof e === 'number' && Number.isFinite(e) && e > 0 ? e : 0;
}
