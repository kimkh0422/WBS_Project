import { describe, expect, it } from 'vitest';
import type { Task } from '../../types';
import { describeUndoChange } from '../describeUndoChange';

const base = (overrides: Partial<Task> = {}): Task => ({
  id: 't1',
  projectId: 'p1',
  parentId: null,
  name: '작업 A',
  startDate: '2026-01-01',
  endDate: '2026-01-10',
  progress: 0,
  assignee: '',
  status: 'todo',
  ...overrides,
});

describe('describeUndoChange', () => {
  it('uses action label when provided', () => {
    expect(describeUndoChange([], [], 'undo', '하위일정 균등분할')).toBe('「하위일정 균등분할」 되돌림');
  });

  it('describes single task field change', () => {
    const current = [base({ progress: 50 })];
    const target = [base({ progress: 0 })];
    expect(describeUndoChange(current, target, 'undo')).toBe('「작업 A」 진척률 되돌림');
  });

  it('describes restored deleted task', () => {
    const current: Task[] = [];
    const target = [base()];
    expect(describeUndoChange(current, target, 'undo')).toBe('「작업 A」 삭제 되돌림');
  });

  it('describes undo of added task', () => {
    const current = [base()];
    const target: Task[] = [];
    expect(describeUndoChange(current, target, 'undo')).toBe('「작업 A」 추가 되돌림');
  });
});
