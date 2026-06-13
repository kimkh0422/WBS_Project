import { describe, it, expect } from 'vitest';
import { outdentTasksLevelOnly } from '../useTaskMovement';
import { buildVisibleTasks } from '../../../lib/taskView';
import type { Task, FilterState } from '../../../types';

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

/** 표(트리) 표시 순서대로 [id, depth] 추출 — 행 위치·레벨을 한 번에 확인 */
function rows(tasks: Task[]): [string, number][] {
  return buildVisibleTasks(tasks, NO_FILTER, null).map((t) => [t.id, t.depth] as [string, number]);
}

function byId(tasks: Task[]): Record<string, Task> {
  return Object.fromEntries(tasks.map((t) => [t.id, t]));
}

describe('outdentTasksLevelOnly (내어쓰기: 선택 항목 레벨만 변경, 형제 흡수 없음·나머지 불변)', () => {
  it('뒤에 형제가 있어도 내어쓰기는 parentId만 조부모로 변경 — 뒤 형제를 자식으로 흡수하지 않음(DFS 표시 순서는 달라질 수 있음)', () => {
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'X', parentId: 'A' }),
      makeTask({ id: 'Y', parentId: 'A' }),
      makeTask({ id: 'Z', parentId: 'A' }),
    ];
    expect(rows(tasks)).toEqual([
      ['A', 0],
      ['X', 1],
      ['Y', 1],
      ['Z', 1],
    ]);

    const { tasks: after, changed } = outdentTasksLevelOnly(tasks, ['X']);
    expect(changed).toBe(true);

    expect(rows(after)).toEqual([
      ['A', 0],
      ['Y', 1],
      ['Z', 1],
      ['X', 0],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.Y.parentId).toBe('A');
    expect(m.Z.parentId).toBe('A');
  });

  it('마지막 자식(뒤 형제 없음)을 내어쓰면 제자리에서 레벨만 내려가고 흡수는 없다', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'X', parentId: 'A' }), makeTask({ id: 'Y', parentId: 'A' })];
    const { tasks: after, changed } = outdentTasksLevelOnly(tasks, ['Y']);
    expect(changed).toBe(true);
    expect(rows(after)).toEqual([
      ['A', 0],
      ['X', 1],
      ['Y', 0],
    ]);
    const m = byId(after);
    expect(m.Y.parentId).toBe(null);
    expect(m.X.parentId).toBe('A'); // 흡수 대상 아님
  });

  it('하위 트리가 있어도 내어쓰기는 레벨만 변경 — 뒤 형제(Y)는 부모 A에 그대로 둔다', () => {
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'X', parentId: 'A' }),
      makeTask({ id: 'X1', parentId: 'X' }),
      makeTask({ id: 'Y', parentId: 'A' }),
    ];
    expect(rows(tasks)).toEqual([
      ['A', 0],
      ['X', 1],
      ['X1', 2],
      ['Y', 1],
    ]);

    const { tasks: after } = outdentTasksLevelOnly(tasks, ['X']);
    expect(rows(after)).toEqual([
      ['A', 0],
      ['Y', 1],
      ['X', 0],
      ['X1', 1],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.X1.parentId).toBe('X');
    expect(m.Y.parentId).toBe('A');
  });

  it('다중 선택: 각각 parentId만 조부모로 — 비선택 형제 Z는 여전히 A의 자식', () => {
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'X', parentId: 'A' }),
      makeTask({ id: 'Y', parentId: 'A' }),
      makeTask({ id: 'Z', parentId: 'A' }),
    ];
    const { tasks: after, changed } = outdentTasksLevelOnly(tasks, ['X', 'Y']);
    expect(changed).toBe(true);
    expect(rows(after)).toEqual([
      ['A', 0],
      ['Z', 1],
      ['X', 0],
      ['Y', 0],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.Y.parentId).toBe(null);
    expect(m.Z.parentId).toBe('A');
  });

  it('루트(부모 없음)는 더 내어쓸 수 없어 변화 없음(changed=false)', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const res = outdentTasksLevelOnly(tasks, ['A']);
    expect(res.changed).toBe(false);
    expect(res.tasks).toBe(tasks); // 원본 그대로 반환
  });
});
