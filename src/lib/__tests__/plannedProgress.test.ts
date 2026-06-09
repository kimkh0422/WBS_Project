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

describe('computePlannedProgressMap (자동 산정 — 시작/종료/기준일 기반)', () => {
  it('리프: 일정과 기준일로 자동 계산(시작 전=0, 진행 중=비율, 종료 후=100)', () => {
    const before = task({ id: 'b', startDate: '2026-06-20', endDate: '2026-06-30' });
    const mid = task({ id: 'm', startDate: '2026-06-01', endDate: '2026-06-30' });
    const after = task({ id: 'a', startDate: '2026-05-01', endDate: '2026-05-10' });
    const map = computePlannedProgressMap([before, mid, after], '2026-06-15', NO_HOLIDAYS);
    expect(map.get('b')).toBe(0);
    expect(map.get('a')).toBe(100);
    const m = map.get('m');
    expect(typeof m).toBe('number');
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(100);
  });

  it('리프: 일정이 없으면 맵에 없음(빈칸)', () => {
    const t = task({ id: 'noplan' });
    const map = computePlannedProgressMap([t], '2026-06-15', NO_HOLIDAYS);
    expect(map.has('noplan')).toBe(false);
  });

  it('부모: 자식 자동 계산값의 평균으로 자동 롤업', () => {
    const parent = task({ id: 'P' });
    const childDone = task({ id: 'A', parentId: 'P', startDate: '2026-05-01', endDate: '2026-05-10' }); // 100
    const childTodo = task({ id: 'B', parentId: 'P', startDate: '2026-06-20', endDate: '2026-06-30' }); // 0
    const map = computePlannedProgressMap([parent, childDone, childTodo], '2026-06-15', NO_HOLIDAYS);
    expect(map.get('A')).toBe(100);
    expect(map.get('B')).toBe(0);
    expect(map.get('P')).toBeCloseTo(50);
  });

  it('부모 가중평균: 자식 weight 반영', () => {
    const parent = task({ id: 'P' });
    const heavy = task({ id: 'A', parentId: 'P', startDate: '2026-05-01', endDate: '2026-05-10', weight: 3 }); // 100
    const light = task({ id: 'B', parentId: 'P', startDate: '2026-06-20', endDate: '2026-06-30', weight: 1 }); // 0
    const map = computePlannedProgressMap([parent, heavy, light], '2026-06-15', NO_HOLIDAYS);
    expect(map.get('P')).toBeCloseTo(75); // (100*3 + 0*1)/4
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
  it('가중 평균: 계획(자동)·실제·차이를 계산', () => {
    // A: 종료된 일정 → 계획 100, 실제 100, weight 3 / B: 시작 전 → 계획 0, 실제 0, weight 1
    const a = task({ id: 'A', progress: 100, startDate: '2026-05-01', endDate: '2026-05-10', weight: 3 });
    const b = task({ id: 'B', progress: 0, startDate: '2026-06-20', endDate: '2026-06-30', weight: 1 });
    const planned = computePlannedProgressMap([a, b], '2026-06-15', NO_HOLIDAYS);
    const summary = aggregatePlannedActual([a, b], planned);
    expect(summary.planned).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.actual).toBeCloseTo(75); // (100*3 + 0*1)/4
    expect(summary.variance).toBeCloseTo(0);
  });

  it('지연이면 variance 음수', () => {
    // A: 종료된 일정 → 계획 100, 실제 40 → 차이 -60
    const a = task({ id: 'A', progress: 40, startDate: '2026-05-01', endDate: '2026-05-10', weight: 1 });
    const planned = computePlannedProgressMap([a], '2026-06-15', NO_HOLIDAYS);
    const summary = aggregatePlannedActual([a], planned);
    expect(summary.planned).toBeCloseTo(100);
    expect(summary.actual).toBeCloseTo(40);
    expect(summary.variance).toBeCloseTo(-60);
  });
});
