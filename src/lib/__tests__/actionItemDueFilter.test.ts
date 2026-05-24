import { describe, expect, it } from 'vitest';
import { filterActionTasksByDuePeriod, isActionDueDatePast, parseTaskDueDay, resolveActionDueVisualState } from '../actionItemDueFilter';
import type { Task } from '../../types';

const now = new Date('2026-05-23T12:00:00');

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    name: '액션',
    isActionItem: true,
    endDate: '2026-05-21',
    status: 'todo',
    progress: 0,
    ...overrides,
  } as Task;
}

describe('resolveActionDueVisualState', () => {
  it('미완료 + 기한 지남 → overdue', () => {
    expect(resolveActionDueVisualState('2026-05-21', false, now)).toBe('overdue');
  });

  it('미완료 + 기한 내 → pending', () => {
    expect(resolveActionDueVisualState('2026-05-25', false, now)).toBe('pending');
  });

  it('완료 + 기한 지남 → completedLate', () => {
    expect(resolveActionDueVisualState('2026-05-21', true, now)).toBe('completedLate');
  });

  it('완료 + 기한 내 → completed', () => {
    expect(resolveActionDueVisualState('2026-05-25', true, now)).toBe('completed');
  });
});

describe('isActionDueDatePast', () => {
  it('유효하지 않은 날짜는 false', () => {
    expect(isActionDueDatePast('', now)).toBe(false);
    expect(isActionDueDatePast(undefined, now)).toBe(false);
  });

  it('오늘은 past가 아님', () => {
    expect(isActionDueDatePast('2026-05-23', now)).toBe(false);
  });
});

describe('filterActionTasksByDuePeriod overdue', () => {
  it('기한초과 탭은 미완료만 포함', () => {
    const tasks = [task({ id: 'a', endDate: '2026-05-20', progress: 0 }), task({ id: 'b', endDate: '2026-05-20', progress: 100 })];
    const result = filterActionTasksByDuePeriod(tasks, 'overdue', now, (t) => (t.progress ?? 0) >= 100);
    expect(result.map((t) => t.id)).toEqual(['a']);
  });
});

describe('parseTaskDueDay', () => {
  it('ISO 날짜 앞 10자리만 사용', () => {
    expect(parseTaskDueDay('2026-05-21T00:00:00')).toBe('2026-05-21');
  });
});
