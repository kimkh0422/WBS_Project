/**
 * 대시보드 집계용 순수 함수 모음.
 * React/JSX에 의존하지 않으며, 진척률·계획율·완료/지연 판정·깊이 계산을 담당한다.
 * (Dashboard.tsx에서 분리 — 동작 동일, 단위 테스트 용이)
 */
import { isBefore, parseISO, startOfDay } from 'date-fns';
import type { Task } from '../types';
import { aggregatePercentByWeight } from './utils';
import { getUseWeightForProgressRollup } from './rollupOptions';
import { rollupWeightFromEffort } from './progressRollupWeights';

/** 대시보드 집계용: 완료 상태·진척 100%면 미완료 아님 */
export function dashboardTaskDone(t: Task, doneStatusIds: Set<string>): boolean {
  return doneStatusIds.has(t.status) || (typeof t.progress === 'number' && Number.isFinite(t.progress) && t.progress >= 100);
}

/** 종료일이 지났고 아직 미완료인 작업(지연) 판정 */
export function dashboardTaskOverdue(t: Task, doneStatusIds: Set<string>): boolean {
  if (dashboardTaskDone(t, doneStatusIds)) return false;
  const end = t.endDate?.trim();
  if (!end) return false;
  try {
    const d = parseISO(end);
    if (Number.isNaN(d.getTime())) return false;
    return isBefore(d, startOfDay(new Date()));
  } catch {
    return false;
  }
}

/** 주어진 task 목록에서 깊이(depth)를 메모이제이션하여 반환하는 getter 생성 */
export function buildDepthGetter(taskById: Map<string, Task>): (id: string) => number {
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

/** 집계 가중치: 공수(workEffort)만 사용. 가중치 OFF면 helper가 무시. */
export function dashWeightOf(t: Task): number {
  return rollupWeightFromEffort(t);
}

/** 진척률 집계: 가중치 ON이면 (progress×weight) 가중평균, OFF면 단순평균. 결과 0~100% 클램프 — 요약 바와 동일 규칙. */
export function computeWeightedProgress(items: Task[]): number {
  return aggregatePercentByWeight(
    items.map((t) => ({ value: typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0, weight: dashWeightOf(t) })),
    getUseWeightForProgressRollup(),
    Math.round,
  );
}

/** computeWeightedProgress와 동일 규칙으로 계획율을 집계 (값만 plannedById에서 가져옴) */
export function computeWeightedPlanned(items: Task[], plannedById: Map<string, number>): number {
  return aggregatePercentByWeight(
    items.map((t) => ({ value: plannedById.get(t.id) ?? 0, weight: dashWeightOf(t) })),
    getUseWeightForProgressRollup(),
    Math.round,
  );
}
