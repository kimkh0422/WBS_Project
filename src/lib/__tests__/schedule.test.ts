import { describe, it, expect } from 'vitest';
import {
  getTotalAllocationRatio,
  computeDurationBusinessDays,
  computeEndDateFromEffort,
  computeStartDateFromEndDate,
  computeWorkEffortFromDates,
  getTopologicalOrder,
} from '../schedule';

const noHolidays = new Set<string>();

describe('getTotalAllocationRatio', () => {
  it('assignments 없으면 1 (100%)', () => {
    expect(getTotalAllocationRatio(undefined)).toBe(1);
    expect(getTotalAllocationRatio([])).toBe(1);
  });
  it('50% 투입 → 0.5', () => {
    expect(getTotalAllocationRatio([{ assignee: 'A', allocationPercent: 50 }])).toBe(0.5);
  });
  it('100% 초과 시 1로 제한', () => {
    expect(getTotalAllocationRatio([
      { assignee: 'A', allocationPercent: 80 },
      { assignee: 'B', allocationPercent: 80 },
    ])).toBe(1);
  });
});

describe('computeDurationBusinessDays', () => {
  it('100% 투입, 5MD → 5영업일', () => {
    expect(computeDurationBusinessDays(5, [{ assignee: 'A', allocationPercent: 100 }])).toBe(5);
  });
  it('50% 투입, 5MD → 10영업일', () => {
    expect(computeDurationBusinessDays(5, [{ assignee: 'A', allocationPercent: 50 }])).toBe(10);
  });
  it('투입비율 없으면 100% 가정', () => {
    expect(computeDurationBusinessDays(3, undefined)).toBe(3);
  });
  it('공수 0이면 0일', () => {
    expect(computeDurationBusinessDays(0, undefined)).toBe(0);
  });
  it('올림 처리: 100% 초과 투입은 100%로 제한', () => {
    // 200%도 getTotalAllocationRatio에서 1(100%)로 제한 → 3MD/1 = 3일
    expect(computeDurationBusinessDays(3, [{ assignee: 'A', allocationPercent: 200 }])).toBe(3);
  });
});

describe('computeEndDateFromEffort', () => {
  it('월요일 + 5MD 100% → 금요일', () => {
    const result = computeEndDateFromEffort('2026-03-30', 5, undefined, noHolidays);
    expect(result).toBe('2026-04-03'); // 월→금
  });
  it('금요일 + 1MD → 금요일 (당일)', () => {
    const result = computeEndDateFromEffort('2026-04-03', 1, undefined, noHolidays);
    expect(result).toBe('2026-04-03');
  });
  it('금요일 + 2MD → 다음주 월요일', () => {
    const result = computeEndDateFromEffort('2026-04-03', 2, undefined, noHolidays);
    expect(result).toBe('2026-04-06');
  });
  it('50% 투입, 5MD → 10영업일', () => {
    const result = computeEndDateFromEffort('2026-03-30', 5, [{ assignee: 'A', allocationPercent: 50 }], noHolidays);
    // 월요일 + 9영업일 뒤 = 2주 뒤 목요일
    expect(result).toBe('2026-04-10');
  });
});

describe('computeStartDateFromEndDate', () => {
  it('금요일, 5MD → 월요일 역산', () => {
    const result = computeStartDateFromEndDate('2026-04-03', 5, undefined, noHolidays);
    expect(result).toBe('2026-03-30');
  });
  it('1MD → 종료일 = 시작일', () => {
    const result = computeStartDateFromEndDate('2026-04-03', 1, undefined, noHolidays);
    expect(result).toBe('2026-04-03');
  });
});

describe('computeWorkEffortFromDates', () => {
  it('월~금 100% → 5MD', () => {
    const result = computeWorkEffortFromDates('2026-03-30', '2026-04-03', undefined, noHolidays);
    expect(result).toBe(5);
  });
  it('월~금 50% → 2.5MD', () => {
    const result = computeWorkEffortFromDates('2026-03-30', '2026-04-03', [{ assignee: 'A', allocationPercent: 50 }], noHolidays);
    expect(result).toBe(2.5);
  });
});

describe('getTopologicalOrder', () => {
  it('의존성 순서대로 정렬', () => {
    const tasks = [
      { id: 'a', projectId: 'p1', parentId: null, name: 'A', startDate: '2026-03-30', endDate: '2026-04-03', progress: 0, assignee: '', status: 'todo', dependencies: ['b'] },
      { id: 'b', projectId: 'p1', parentId: null, name: 'B', startDate: '2026-03-30', endDate: '2026-04-03', progress: 0, assignee: '', status: 'todo' },
      { id: 'c', projectId: 'p1', parentId: null, name: 'C', startDate: '2026-03-30', endDate: '2026-04-03', progress: 0, assignee: '', status: 'todo', dependencies: ['a'] },
    ];
    const order = getTopologicalOrder(tasks);
    const idxB = order.indexOf('b');
    const idxA = order.indexOf('a');
    const idxC = order.indexOf('c');
    expect(idxB).toBeLessThan(idxA); // B가 A보다 먼저
    expect(idxA).toBeLessThan(idxC); // A가 C보다 먼저
  });
  it('의존성 없으면 모든 id 포함', () => {
    const tasks = [
      { id: 'x', projectId: 'p1', parentId: null, name: 'X', startDate: '', endDate: '', progress: 0, assignee: '', status: 'todo' },
      { id: 'y', projectId: 'p1', parentId: null, name: 'Y', startDate: '', endDate: '', progress: 0, assignee: '', status: 'todo' },
    ];
    const order = getTopologicalOrder(tasks);
    expect(order).toContain('x');
    expect(order).toContain('y');
  });
});
