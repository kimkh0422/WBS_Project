import { describe, it, expect } from 'vitest';
import {
  getTotalAllocationRatio,
  computeDurationBusinessDays,
  computeEndDateFromEffort,
  computeStartDateFromEndDate,
  computeWorkEffortFromDates,
} from '../effortSchedule';
import { getTopologicalOrder, applyDependencySchedule, distributeChildrenEvenly } from '../schedule';

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
    expect(
      getTotalAllocationRatio([
        { assignee: 'A', allocationPercent: 80 },
        { assignee: 'B', allocationPercent: 80 },
      ]),
    ).toBe(1);
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

describe('applyDependencySchedule', () => {
  const baseTask = {
    projectId: 'p1',
    parentId: null as string | null,
    progress: 0,
    assignee: 'Alice',
    status: 'todo',
  };

  it('FS 체인: 선행 종료일 다음 영업일로 시작 이동 + 기존 영업일 기간 유지(공수 무시)', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 0.5 },
      { ...baseTask, id: 't2', name: 'T2', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 0.5, dependencies: ['t1'] },
    ];
    const result = applyDependencySchedule(tasks);
    // t1: 선행 없음 → 그대로
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-10');
    // t2: t1 종료(4/10 금) 다음 영업일 4/13(월)로 시작, 입력 기간 10영업일 유지 → 4/24(금)
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-13');
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-24');
  });

  it('FS 체인: 3영업일 작업의 기간을 유지한 채 시작만 이동', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-03' },
      { ...baseTask, id: 't2', name: 'T2', startDate: '2026-03-30', endDate: '2026-04-01', dependencies: ['t1'] },
    ];
    const result = applyDependencySchedule(tasks);
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-03');
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    // 입력 기간 3영업일(3/30월~4/1수) 유지: 4/6(월)+2영업일 = 4/8(수)
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-08');
  });

  it('공수는 일정에 영향을 주지 않는다(선행 없는 작업의 종료일 불변)', () => {
    const tasks = [{ ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 100 }];
    const result = applyDependencySchedule(tasks);
    expect(result.find((t) => t.id === 't1')!.startDate).toBe('2026-03-30');
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-10');
  });

  it('상위 작업은 직속 하위 구간(min 시작 ~ max 종료)으로 맞춘다', () => {
    const tasks = [
      { ...baseTask, id: 'P', name: 'P', startDate: '', endDate: '' },
      { ...baseTask, id: 'c1', name: 'c1', parentId: 'P', startDate: '2026-03-30', endDate: '2026-04-01' },
      { ...baseTask, id: 'c2', name: 'c2', parentId: 'P', startDate: '2026-04-06', endDate: '2026-04-10' },
    ];
    const result = applyDependencySchedule(tasks);
    expect(result.find((t) => t.id === 'P')!.startDate).toBe('2026-03-30');
    expect(result.find((t) => t.id === 'P')!.endDate).toBe('2026-04-10');
  });
});

describe('getTopologicalOrder', () => {
  it('의존성 순서대로 정렬', () => {
    const tasks = [
      {
        id: 'a',
        projectId: 'p1',
        parentId: null,
        name: 'A',
        startDate: '2026-03-30',
        endDate: '2026-04-03',
        progress: 0,
        assignee: '',
        status: 'todo',
        dependencies: ['b'],
      },
      {
        id: 'b',
        projectId: 'p1',
        parentId: null,
        name: 'B',
        startDate: '2026-03-30',
        endDate: '2026-04-03',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
      {
        id: 'c',
        projectId: 'p1',
        parentId: null,
        name: 'C',
        startDate: '2026-03-30',
        endDate: '2026-04-03',
        progress: 0,
        assignee: '',
        status: 'todo',
        dependencies: ['a'],
      },
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

describe('distributeChildrenEvenly', () => {
  const base = {
    projectId: 'p1',
    parentId: null as string | null,
    progress: 0,
    assignee: '',
    status: 'todo',
  };
  // 공휴일 제외(주말만)로 결정적 검증. 2026-03-02(월) ~ 2026-03-13(금) = 영업일 10일.
  const find = (arr: ReturnType<typeof distributeChildrenEvenly>, id: string) => arr.find((t) => t.id === id)!;

  it('나머지 없는 균등 분배 + 형제 FS 체인', () => {
    const tasks = [
      { ...base, id: 'P', name: 'P', startDate: '2026-03-02', endDate: '2026-03-13' },
      { ...base, id: 'c1', name: 'c1', parentId: 'P', startDate: '', endDate: '' },
      { ...base, id: 'c2', name: 'c2', parentId: 'P', startDate: '', endDate: '' },
    ];
    const out = distributeChildrenEvenly(tasks, 'P', noHolidays);
    // 상위 자신의 날짜는 유지
    expect(find(out, 'P').startDate).toBe('2026-03-02');
    expect(find(out, 'P').endDate).toBe('2026-03-13');
    // 10 영업일 / 2 = 각 5영업일, 순차 배치
    expect(find(out, 'c1').startDate).toBe('2026-03-02');
    expect(find(out, 'c1').endDate).toBe('2026-03-06');
    expect(find(out, 'c2').startDate).toBe('2026-03-09');
    expect(find(out, 'c2').endDate).toBe('2026-03-13');
    // 둘째부터 직전 형제를 선행으로
    expect(find(out, 'c1').dependencies ?? []).toEqual([]);
    expect(find(out, 'c2').dependencies).toEqual(['c1']);
  });

  it('나머지는 앞쪽 하위부터 1일씩 더 가져감 (10영업일 / 3 → 4,3,3)', () => {
    const tasks = [
      { ...base, id: 'P', name: 'P', startDate: '2026-03-02', endDate: '2026-03-13' },
      { ...base, id: 'c1', name: 'c1', parentId: 'P', startDate: '', endDate: '' },
      { ...base, id: 'c2', name: 'c2', parentId: 'P', startDate: '', endDate: '' },
      { ...base, id: 'c3', name: 'c3', parentId: 'P', startDate: '', endDate: '' },
    ];
    const out = distributeChildrenEvenly(tasks, 'P', noHolidays);
    expect([find(out, 'c1').startDate, find(out, 'c1').endDate]).toEqual(['2026-03-02', '2026-03-05']); // 4영업일
    expect([find(out, 'c2').startDate, find(out, 'c2').endDate]).toEqual(['2026-03-06', '2026-03-10']); // 3영업일
    expect([find(out, 'c3').startDate, find(out, 'c3').endDate]).toEqual(['2026-03-11', '2026-03-13']); // 3영업일
    expect(find(out, 'c3').dependencies).toEqual(['c2']);
  });

  it('하위의 하위까지 재귀 적용 (각 하위 구간 안에서 다시 분배)', () => {
    const tasks = [
      { ...base, id: 'P', name: 'P', startDate: '2026-03-02', endDate: '2026-03-13' },
      { ...base, id: 'A', name: 'A', parentId: 'P', startDate: '', endDate: '' },
      { ...base, id: 'B', name: 'B', parentId: 'P', startDate: '', endDate: '' },
      { ...base, id: 'A1', name: 'A1', parentId: 'A', startDate: '', endDate: '' },
      { ...base, id: 'A2', name: 'A2', parentId: 'A', startDate: '', endDate: '' },
    ];
    const out = distributeChildrenEvenly(tasks, 'P', noHolidays);
    // A = 2026-03-02 ~ 03-06 (5영업일), 그 안에서 A1/A2 분배(5/2 → 3,2)
    expect([find(out, 'A').startDate, find(out, 'A').endDate]).toEqual(['2026-03-02', '2026-03-06']);
    expect([find(out, 'A1').startDate, find(out, 'A1').endDate]).toEqual(['2026-03-02', '2026-03-04']);
    expect([find(out, 'A2').startDate, find(out, 'A2').endDate]).toEqual(['2026-03-05', '2026-03-06']);
    expect(find(out, 'A2').dependencies).toEqual(['A1']);
  });

  it('하위가 없거나 상위 일정이 없으면 입력 그대로', () => {
    const noKids = [{ ...base, id: 'P', name: 'P', startDate: '2026-03-02', endDate: '2026-03-13' }];
    expect(distributeChildrenEvenly(noKids, 'P', noHolidays)).toBe(noKids);
    const noDate = [
      { ...base, id: 'P', name: 'P', startDate: '', endDate: '' },
      { ...base, id: 'c1', name: 'c1', parentId: 'P', startDate: '', endDate: '' },
    ];
    expect(distributeChildrenEvenly(noDate, 'P', noHolidays)).toBe(noDate);
  });
});
