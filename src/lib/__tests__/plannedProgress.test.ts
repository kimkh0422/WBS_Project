import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import {
  computeLeafPlannedProgress,
  computePlannedProgressMap,
  progressVariance,
  aggregatePlannedActual,
  hasPlannedSchedule,
  plannedScheduleOf,
} from '../plannedProgress';

const NO_HOLIDAYS = new Set<string>();

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    parentId: null,
    name: partial.id,
    startDate: '',
    endDate: '',
    progress: 0,
    assignee: '',
    status: 'todo',
    ...partial,
  } as Task;
}

describe('computeLeafPlannedProgress', () => {
  const t = task({ id: 'a', startDate: '2026-06-01', endDate: '2026-06-30' });

  it('시작 전·시작 당일은 0%', () => {
    expect(computeLeafPlannedProgress(t, '2026-05-01', NO_HOLIDAYS)).toBe(0);
    expect(computeLeafPlannedProgress(t, '2026-06-01', NO_HOLIDAYS)).toBe(0);
  });

  it('종료일·종료 이후는 100%', () => {
    expect(computeLeafPlannedProgress(t, '2026-06-30', NO_HOLIDAYS)).toBe(100);
    expect(computeLeafPlannedProgress(t, '2026-12-31', NO_HOLIDAYS)).toBe(100);
  });

  it('기간 중간은 0~100 사이이고 시간이 갈수록 증가(단조)', () => {
    const mid = computeLeafPlannedProgress(t, '2026-06-15', NO_HOLIDAYS);
    const later = computeLeafPlannedProgress(t, '2026-06-22', NO_HOLIDAYS);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    expect(later).toBeGreaterThan(mid);
  });

  it('5영업일(월~금) 작업은 0/25/50/75/100으로 선형', () => {
    // 2026-06-01(월) ~ 2026-06-05(금), 공휴일 없음 가정
    const wk = task({ id: 'wk', startDate: '2026-06-01', endDate: '2026-06-05' });
    expect(computeLeafPlannedProgress(wk, '2026-06-01', NO_HOLIDAYS)).toBe(0);
    expect(computeLeafPlannedProgress(wk, '2026-06-02', NO_HOLIDAYS)).toBeCloseTo(25);
    expect(computeLeafPlannedProgress(wk, '2026-06-03', NO_HOLIDAYS)).toBeCloseTo(50);
    expect(computeLeafPlannedProgress(wk, '2026-06-04', NO_HOLIDAYS)).toBeCloseTo(75);
    expect(computeLeafPlannedProgress(wk, '2026-06-05', NO_HOLIDAYS)).toBe(100);
  });

  it('마일스톤은 시점 도달 여부로 0 또는 100', () => {
    const ms = task({ id: 'ms', startDate: '2026-06-10', endDate: '2026-06-10', isMilestone: true });
    expect(computeLeafPlannedProgress(ms, '2026-06-09', NO_HOLIDAYS)).toBe(0);
    expect(computeLeafPlannedProgress(ms, '2026-06-10', NO_HOLIDAYS)).toBe(100);
  });

  it('베이스라인이 있으면 베이스라인 일정을 우선 사용', () => {
    // 현재 일정은 먼 미래(=0이어야)지만, 베이스라인은 과거~현재 구간
    const b = task({
      id: 'b',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      baselineStartDate: '2026-06-01',
      baselineEndDate: '2026-06-30',
    });
    expect(plannedScheduleOf(b)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
    expect(computeLeafPlannedProgress(b, '2026-06-15', NO_HOLIDAYS)).toBeGreaterThan(0);
  });

  it('일정이 없으면 0% (계산 불가)', () => {
    const none = task({ id: 'none' });
    expect(computeLeafPlannedProgress(none, '2026-06-15', NO_HOLIDAYS)).toBe(0);
    expect(hasPlannedSchedule(none)).toBe(false);
  });
});

describe('computePlannedProgressMap (부모 롤업)', () => {
  // 자식 A는 완전히 과거(계획 100), 자식 B는 완전히 미래(계획 0)
  const ref = '2026-06-10';
  const childA = task({ id: 'A', parentId: 'P', startDate: '2026-01-01', endDate: '2026-02-01' });
  const childB = task({ id: 'B', parentId: 'P', startDate: '2026-12-01', endDate: '2026-12-31' });

  it('weight 가중평균: A.weight=3, B.weight=1 → 부모 75%', () => {
    const parent = task({ id: 'P', startDate: '2026-01-01', endDate: '2026-12-31' });
    const map = computePlannedProgressMap([parent, { ...childA, weight: 3 }, { ...childB, weight: 1 }], ref, NO_HOLIDAYS);
    expect(map.get('A')).toBe(100);
    expect(map.get('B')).toBe(0);
    expect(map.get('P')).toBeCloseTo(75);
  });

  it('weight 없으면 workEffort로 가중: 둘 다 2 → 50%', () => {
    const parent = task({ id: 'P', startDate: '2026-01-01', endDate: '2026-12-31' });
    const map = computePlannedProgressMap([parent, { ...childA, workEffort: 2 }, { ...childB, workEffort: 2 }], ref, NO_HOLIDAYS);
    expect(map.get('P')).toBeCloseTo(50);
  });

  it('weight·workEffort 모두 없으면 단순 평균 → 50%', () => {
    const parent = task({ id: 'P', startDate: '2026-01-01', endDate: '2026-12-31' });
    const map = computePlannedProgressMap([parent, childA, childB], ref, NO_HOLIDAYS);
    expect(map.get('P')).toBeCloseTo(50);
  });
});

describe('computePlannedProgressMap plannedProgressOverride', () => {
  it('리프: 수동 지정이 일정 기반 값을 덮어씀', () => {
    const t = task({
      id: 'x',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      plannedProgressOverride: 12,
    });
    const map = computePlannedProgressMap([t], '2026-06-15', NO_HOLIDAYS);
    expect(map.get('x')).toBe(12);
  });

  it('리프: 0~100 밖은 클램프', () => {
    const lo = task({ id: 'lo', plannedProgressOverride: -5, startDate: '2026-06-01', endDate: '2026-06-10' });
    const hi = task({ id: 'hi', plannedProgressOverride: 150, startDate: '2026-06-01', endDate: '2026-06-10' });
    const map = computePlannedProgressMap([lo, hi], '2026-06-05', NO_HOLIDAYS);
    expect(map.get('lo')).toBe(0);
    expect(map.get('hi')).toBe(100);
  });

  it('부모 롤업에 자식 수동 값이 반영됨', () => {
    const ref = '2026-06-10';
    const childA = task({ id: 'A', parentId: 'P', plannedProgressOverride: 40, weight: 1 });
    const childB = task({ id: 'B', parentId: 'P', startDate: '2026-12-01', endDate: '2026-12-31', weight: 1 });
    const parent = task({ id: 'P', startDate: '2026-01-01', endDate: '2026-12-31' });
    const map = computePlannedProgressMap([parent, childA, childB], ref, NO_HOLIDAYS);
    expect(map.get('P')).toBeCloseTo(20);
  });
});

describe('progressVariance', () => {
  it('실제 − 계획. 양수=앞섬, 음수=지연', () => {
    expect(progressVariance(80, 50)).toBe(30);
    expect(progressVariance(30, 50)).toBe(-20);
    expect(progressVariance(50, 50)).toBe(0);
  });
  it('비정상 값은 0으로 처리', () => {
    expect(progressVariance(undefined, 40)).toBe(-40);
    expect(progressVariance(60, undefined)).toBe(60);
  });
});

describe('aggregatePlannedActual', () => {
  it('가중 평균 계획·실제·차이를 계산', () => {
    const ref = '2026-06-10';
    const a = task({ id: 'A', startDate: '2026-01-01', endDate: '2026-02-01', progress: 100, weight: 3 }); // 계획 100
    const b = task({ id: 'B', startDate: '2026-12-01', endDate: '2026-12-31', progress: 0, weight: 1 }); // 계획 0
    const planned = computePlannedProgressMap([a, b], ref, NO_HOLIDAYS);
    const summary = aggregatePlannedActual([a, b], planned);
    expect(summary.planned).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.actual).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.variance).toBeCloseTo(0);
  });

  it('지연이면 variance 음수', () => {
    const ref = '2026-06-10';
    const a = task({ id: 'A', startDate: '2026-01-01', endDate: '2026-02-01', progress: 40, weight: 1 }); // 계획 100, 실제 40
    const planned = computePlannedProgressMap([a], ref, NO_HOLIDAYS);
    const summary = aggregatePlannedActual([a], planned);
    expect(summary.planned).toBeCloseTo(100);
    expect(summary.actual).toBeCloseTo(40);
    expect(summary.variance).toBeCloseTo(-60);
  });
});
