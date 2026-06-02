import { describe, it, expect } from 'vitest';
import {
  getTotalAllocationRatio,
  computeDurationBusinessDays,
  computeEndDateFromEffort,
  computeStartDateFromEndDate,
  computeWorkEffortFromDates,
  getTopologicalOrder,
  applyDependencySchedule,
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

  it('FS 체인에서 공수·100% 투입율로 시작·종료일 연쇄 산정', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 5 },
      { ...baseTask, id: 't2', name: 'T2', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 3, dependencies: ['t1'] },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, { linkEffortToSchedule: true });
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-03');
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-08');
  });

  it('FS 체인에서 linkEffortToSchedule false면 공수가 작아도 기존 달력 간격으로 종료일 유지', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 0.5 },
      { ...baseTask, id: 't2', name: 'T2', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 0.5, dependencies: ['t1'] },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, { linkEffortToSchedule: false });
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-10');
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-13');
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-24');
  });

  it('선행 순차 연결용: 공수가 있으면 시작·종료가 있어도 공수로 종료일 산정', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-03', workEffort: 5 },
      {
        ...baseTask,
        id: 't2',
        name: 'T2',
        startDate: '2026-03-30',
        endDate: '2026-04-01',
        workEffort: 20,
        dependencies: ['t1'],
      },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, {
      linkEffortToSchedule: true,
      chainLinkRespectBothDates: true,
    });
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-03');
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    // 20MD 100%: 2026-04-06(월)부터 20영업일(한국 공휴일 반영)
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-05-01');
  });

  it('선행 순차 연결용: 공수 없이 시작·종료만 있으면 기존 영업일 기간 유지', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-03', workEffort: 5 },
      {
        ...baseTask,
        id: 't2',
        name: 'T2',
        startDate: '2026-03-30',
        endDate: '2026-04-01',
        dependencies: ['t1'],
      },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, {
      linkEffortToSchedule: true,
      chainLinkRespectBothDates: true,
    });
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-03');
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    // 입력 기간 3영업일(3/30월~4/1수) 유지: 4/6(월)+2영업일 = 4/8(수)
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-08');
  });

  it('선행 순차 연결용: 체인 작업에 시작·종료가 비어 있으면 공수로 종료일 산정', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-03', workEffort: 5 },
      {
        ...baseTask,
        id: 't2',
        name: 'T2',
        startDate: '',
        endDate: '',
        workEffort: 3,
        dependencies: ['t1'],
      },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, {
      linkEffortToSchedule: true,
      chainLinkRespectBothDates: true,
    });
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-08');
  });

  it('선행(FS) 반영 후 종료일은 저장 공수 기준으로 산정', () => {
    const tasks = [
      { ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-03', workEffort: 5 },
      {
        ...baseTask,
        id: 't2',
        name: 'T2',
        startDate: '2026-03-30',
        endDate: '2026-04-10',
        workEffort: 3,
        dependencies: ['t1'],
      },
    ];
    const assignments = new Map([['p1', [{ assignee: 'Alice', allocationPercent: 100 }]]]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, { linkEffortToSchedule: true });
    expect(result.find((t) => t.id === 't2')!.startDate).toBe('2026-04-06');
    expect(result.find((t) => t.id === 't2')!.endDate).toBe('2026-04-08');
  });

  it('담당자 투입율만 반영해 기간 산정 (다른 인원 투입율 합산 제외)', () => {
    const tasks = [{ ...baseTask, id: 't1', name: 'T1', startDate: '2026-03-30', endDate: '2026-04-10', workEffort: 5 }];
    const assignments = new Map([
      [
        'p1',
        [
          { assignee: 'Alice', allocationPercent: 50 },
          { assignee: 'Bob', allocationPercent: 50 },
        ],
      ],
    ]);
    const result = applyDependencySchedule(tasks, assignments, undefined, undefined, { linkEffortToSchedule: true });
    // 5MD / 50% = 10영업일 → 2026-03-30(월) + 9영업일 = 2026-04-10
    expect(result.find((t) => t.id === 't1')!.endDate).toBe('2026-04-10');
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
