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

describe('computePlannedProgressMap (계획율 완전 수동 — override만)', () => {
  it('수동 override가 있으면 그 값만 반환(일정 기반 계산 덮어쓰기 아님, 그냥 그 값)', () => {
    const t = task({ id: 'x', startDate: '2026-06-01', endDate: '2026-06-30', plannedProgressOverride: 12 });
    const map = computePlannedProgressMap([t]);
    expect(map.get('x')).toBe(12);
  });

  it('수동 override가 없으면 맵에 없음 — 일정이 있어도 자동 계산하지 않음', () => {
    const t = task({ id: 'noovr', startDate: '2026-06-01', endDate: '2026-06-30' });
    const map = computePlannedProgressMap([t], '2026-06-15', NO_HOLIDAYS);
    expect(map.has('noovr')).toBe(false);
  });

  it('0~100 밖은 클램프', () => {
    const lo = task({ id: 'lo', plannedProgressOverride: -5 });
    const hi = task({ id: 'hi', plannedProgressOverride: 150 });
    const map = computePlannedProgressMap([lo, hi]);
    expect(map.get('lo')).toBe(0);
    expect(map.get('hi')).toBe(100);
  });

  it('부모 자동 롤업 — 자식 계획율의 평균으로 상위가 자동 갱신', () => {
    const childA = task({ id: 'A', parentId: 'P', plannedProgressOverride: 40 });
    const childB = task({ id: 'B', parentId: 'P', plannedProgressOverride: 60 });
    const parent = task({ id: 'P' }); // 부모 수동값 없음
    const map = computePlannedProgressMap([parent, childA, childB]);
    expect(map.get('A')).toBe(40);
    expect(map.get('B')).toBe(60);
    expect(map.get('P')).toBeCloseTo(50); // 가중치 없음 → 단순 평균
  });

  it('부모 가중평균 — 자식 weight 반영', () => {
    const childA = task({ id: 'A', parentId: 'P', plannedProgressOverride: 100, weight: 3 });
    const childB = task({ id: 'B', parentId: 'P', plannedProgressOverride: 0, weight: 1 });
    const parent = task({ id: 'P' });
    const map = computePlannedProgressMap([parent, childA, childB]);
    expect(map.get('P')).toBeCloseTo(75); // (100*3 + 0*1)/4
  });

  it('계획율 없는 자식은 0으로 보고 롤업, 빈 리프는 맵에서 빠짐', () => {
    const childA = task({ id: 'A', parentId: 'P', plannedProgressOverride: 80 });
    const childB = task({ id: 'B', parentId: 'P' }); // 계획율 없음
    const parent = task({ id: 'P' });
    const map = computePlannedProgressMap([parent, childA, childB]);
    expect(map.get('A')).toBe(80);
    expect(map.has('B')).toBe(false);
    expect(map.get('P')).toBeCloseTo(40); // (80 + 0)/2
  });

  it('부모: 자신의 수동값은 무시하고 자식 롤업을 사용', () => {
    const childA = task({ id: 'A', parentId: 'P', plannedProgressOverride: 10 });
    const childB = task({ id: 'B', parentId: 'P', plannedProgressOverride: 30 });
    const parent = task({ id: 'P', plannedProgressOverride: 99 });
    const map = computePlannedProgressMap([parent, childA, childB]);
    expect(map.get('P')).toBeCloseTo(20); // 99 무시, (10+30)/2
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
  it('가중 평균 계획(수동값)·실제·차이를 계산', () => {
    const a = task({ id: 'A', progress: 100, plannedProgressOverride: 100, weight: 3 });
    const b = task({ id: 'B', progress: 0, plannedProgressOverride: 0, weight: 1 });
    const planned = computePlannedProgressMap([a, b]);
    const summary = aggregatePlannedActual([a, b], planned);
    expect(summary.planned).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.actual).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.variance).toBeCloseTo(0);
  });

  it('지연이면 variance 음수', () => {
    const a = task({ id: 'A', progress: 40, plannedProgressOverride: 100, weight: 1 }); // 계획 100, 실제 40
    const planned = computePlannedProgressMap([a]);
    const summary = aggregatePlannedActual([a], planned);
    expect(summary.planned).toBeCloseTo(100);
    expect(summary.actual).toBeCloseTo(40);
    expect(summary.variance).toBeCloseTo(-60);
  });
});
