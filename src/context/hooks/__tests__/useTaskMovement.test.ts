import { describe, it, expect } from 'vitest';
import { outdentTasksKeepingPosition } from '../useTaskMovement';
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

describe('outdentTasksKeepingPosition (Shift+Tab: 위치 유지, 레벨만 변경)', () => {
  it('뒤에 형제가 있는 첫 자식을 내어써도 행 위치는 그대로 — 레벨만 내려가고 뒤 형제는 자식으로 흡수', () => {
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

    const { tasks: after, changed } = outdentTasksKeepingPosition(tasks, ['X']);
    expect(changed).toBe(true);

    // X는 같은 행(A 바로 아래)에 그대로 남고 레벨만 0으로, Y·Z도 제자리에서 X의 자식이 된다.
    expect(rows(after)).toEqual([
      ['A', 0],
      ['X', 0],
      ['Y', 1],
      ['Z', 1],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.Y.parentId).toBe('X');
    expect(m.Z.parentId).toBe('X');
    expect(m.X.expanded).toBe(true); // 자식이 생겼으니 펼침
  });

  it('마지막 자식(뒤 형제 없음)을 내어쓰면 제자리에서 레벨만 내려가고 흡수는 없다', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'X', parentId: 'A' }), makeTask({ id: 'Y', parentId: 'A' })];
    const { tasks: after, changed } = outdentTasksKeepingPosition(tasks, ['Y']);
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

  it('자기 하위 트리를 가진 작업을 내어쓰면 하위는 함께 따라오고, 뒤 형제는 흡수된다 (모든 행 제자리)', () => {
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

    const { tasks: after } = outdentTasksKeepingPosition(tasks, ['X']);
    // 행 순서(A,X,X1,Y)는 그대로. X·X1은 한 레벨씩 내려오고, Y는 X의 자식으로 흡수.
    expect(rows(after)).toEqual([
      ['A', 0],
      ['X', 0],
      ['X1', 1],
      ['Y', 1],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.X1.parentId).toBe('X'); // 하위 트리 유지
    expect(m.Y.parentId).toBe('X'); // 흡수
  });

  it('다중 선택: 인접한 두 형제를 내어쓰면 둘 다 제자리에서 레벨만 내려가고, 그 뒤 비선택 형제는 마지막 선택 형제가 흡수', () => {
    const tasks = [
      makeTask({ id: 'A' }),
      makeTask({ id: 'X', parentId: 'A' }),
      makeTask({ id: 'Y', parentId: 'A' }),
      makeTask({ id: 'Z', parentId: 'A' }),
    ];
    const { tasks: after, changed } = outdentTasksKeepingPosition(tasks, ['X', 'Y']);
    expect(changed).toBe(true);
    expect(rows(after)).toEqual([
      ['A', 0],
      ['X', 0],
      ['Y', 0],
      ['Z', 1],
    ]);
    const m = byId(after);
    expect(m.X.parentId).toBe(null);
    expect(m.Y.parentId).toBe(null);
    expect(m.Z.parentId).toBe('Y'); // 다음 선택 형제(없음) 전까지 → Y가 흡수
  });

  it('루트(부모 없음)는 더 내어쓸 수 없어 변화 없음(changed=false)', () => {
    const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B' })];
    const res = outdentTasksKeepingPosition(tasks, ['A']);
    expect(res.changed).toBe(false);
    expect(res.tasks).toBe(tasks); // 원본 그대로 반환
  });
});
