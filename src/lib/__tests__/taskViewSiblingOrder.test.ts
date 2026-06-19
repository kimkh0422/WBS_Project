import { describe, it, expect } from 'vitest';
import { buildTasksInTreeOrderWithWbs, buildVisibleTasks } from '../taskView';
import { findSiblingSwapIndicesInFlatList, swapTasksAtIndices } from '../../context/hooks/useTaskMovement';
import type { FilterState, Task } from '../../types';

const NO_FILTER: FilterState = { projectIds: 'all', status: 'all', assignee: '', startDate: '', endDate: '' };

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    parentId: null,
    name: overrides.id,
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    progress: 0,
    assignee: '',
    status: 'todo',
    expanded: true,
    ...overrides,
  };
}

function wbsCodes(tasks: Task[]): string[] {
  return buildTasksInTreeOrderWithWbs(tasks).map(({ wbsCode }) => wbsCode);
}

function visibleIds(tasks: Task[]): string[] {
  return buildVisibleTasks(tasks, NO_FILTER, null).map((t) => t.id);
}

describe('Alt+↑↓ 형제 이동 — 표시 순·WBS 번호 일치', () => {
  it('루트 형제를 아래로 이동하면 WBS 번호와 표시 순서가 함께 바뀐다', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' }), makeTask({ id: 'C' })];
    expect(wbsCodes(tasks)).toEqual(['1', '2', '3']);
    expect(visibleIds(tasks)).toEqual(['A', 'B', 'C']);

    const swap = findSiblingSwapIndicesInFlatList(tasks, 'p1', 'A', 'down', []);
    expect(swap).toEqual({ iA: 0, iB: 1 });
    const after = swapTasksAtIndices(tasks, swap!.iA, swap!.iB);

    expect(visibleIds(after)).toEqual(['B', 'A', 'C']);
    expect(wbsCodes(after)).toEqual(['1', '2', '3']);
    expect(wbsCodes(after)[visibleIds(after).indexOf('B')]).toBe('1');
    expect(wbsCodes(after)[visibleIds(after).indexOf('A')]).toBe('2');
  });

  it('자식이 끼어 있어도 표시 순 기준 형제와 스왑한다', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'A1', parentId: 'A' }), makeTask({ id: 'B' })];
    expect(visibleIds(tasks)).toEqual(['A', 'A1', 'B']);

    const swap = findSiblingSwapIndicesInFlatList(tasks, 'p1', 'B', 'up', []);
    expect(swap).toEqual({ iA: 2, iB: 0 });
    const after = swapTasksAtIndices(tasks, swap!.iA, swap!.iB);

    expect(visibleIds(after)).toEqual(['B', 'A', 'A1']);
    expect(wbsCodes(after)).toEqual(['1', '2', '2.1']);
  });

  it('저장 후 재로드(sort_order 순)와 동일한 WBS·표시 순을 유지한다', () => {
    let tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' }), makeTask({ id: 'C' })];
    const swap = findSiblingSwapIndicesInFlatList(tasks, 'p1', 'C', 'up', []);
    tasks = swapTasksAtIndices(tasks, swap!.iA, swap!.iB);

    const reloaded = [...tasks].sort((a, b) => tasks.indexOf(a) - tasks.indexOf(b));
    expect(visibleIds(reloaded)).toEqual(['A', 'C', 'B']);
    expect(wbsCodes(reloaded)).toEqual(['1', '2', '3']);
  });
});
