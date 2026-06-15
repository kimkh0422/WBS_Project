import { describe, it, expect } from 'vitest';
import { computeWorkCompositionPercent, siblingEffortSum } from '../workComposition';
import type { Task } from '../../types';

function T(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    parentId: null,
    name: 't',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    progress: 0,
    assignee: '',
    status: 'todo',
    ...overrides,
  };
}

describe('computeWorkCompositionPercent', () => {
  it('부모가 있으면 직속 형제 공수 합 대비 비율(소수 1자리)', () => {
    const tasks: Task[] = [
      T({ id: 'p', workEffort: 5 }),
      T({ id: 'a', parentId: 'p', workEffort: 4 }),
      T({ id: 'b', parentId: 'p', workEffort: 1 }),
    ];
    expect(computeWorkCompositionPercent(tasks[1]!, tasks)).toBe(80);
    expect(computeWorkCompositionPercent(tasks[2]!, tasks)).toBe(20);
    expect(siblingEffortSum(tasks[1]!, tasks)).toBe(5);
  });

  it('최상위 작업은 null', () => {
    const tasks: Task[] = [T({ id: 'r', workEffort: 12 })];
    expect(computeWorkCompositionPercent(tasks[0]!, tasks)).toBeNull();
  });

  it('형제 공수 합이 0이면 null', () => {
    const tasks: Task[] = [T({ id: 'p' }), T({ id: 'a', parentId: 'p' }), T({ id: 'b', parentId: 'p', workEffort: 0 })];
    expect(computeWorkCompositionPercent(tasks[1]!, tasks)).toBeNull();
  });
});
