import { describe, it, expect } from 'vitest';
import {
  syncParentRollups,
  recomputeProjectRollups,
  applyRollupsToTasks,
  syncParentStatus,
  deriveParentStatusFromChildren,
  rescaleSiblingsToSum100,
} from '../rollups';
import type { Task } from '../../types';
import { DEFAULT_STATUS_CONFIGS } from '../wbsSettings';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p1',
    parentId: null,
    name: 'task',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
    progress: 0,
    assignee: '',
    status: 'todo',
    ...overrides,
  };
}

describe('syncParentRollups', () => {
  it('자식 진척률 가중평균으로 부모 진척률 계산', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', workEffort: 10, progress: 0 }),
      makeTask({ id: 'c1', parentId: 'parent', workEffort: 6, progress: 100 }),
      makeTask({ id: 'c2', parentId: 'parent', workEffort: 4, progress: 50 }),
    ];
    const result = syncParentRollups(tasks, 'parent');
    const parent = result.find((t) => t.id === 'parent')!;
    // (100*6 + 50*4) / (6+4) = 800/10 = 80
    expect(parent.progress).toBe(80);
  });

  it('자식 시작일/종료일로 부모 기간 롤업', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', startDate: '2026-04-01', endDate: '2026-04-01' }),
      makeTask({ id: 'c1', parentId: 'parent', startDate: '2026-04-01', endDate: '2026-04-05' }),
      makeTask({ id: 'c2', parentId: 'parent', startDate: '2026-04-03', endDate: '2026-04-10' }),
    ];
    const result = syncParentRollups(tasks, 'parent');
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.startDate).toBe('2026-04-01');
    expect(parent.endDate).toBe('2026-04-10');
  });

  it('3레벨: 중간 노드 종료일이 직계 자식 max보다 짧아도 손자 기간으로 조부모 종료일이 확장된다', () => {
    const tasks: Task[] = [
      makeTask({ id: 'gp', startDate: '2010-09-10', endDate: '2010-09-10' }),
      makeTask({ id: 'p', parentId: 'gp', startDate: '2010-09-10', endDate: '2010-09-10' }),
      makeTask({ id: 'leaf', parentId: 'p', startDate: '2024-04-01', endDate: '2050-04-01' }),
    ];
    const result = syncParentRollups(tasks, 'p');
    const gp = result.find((t) => t.id === 'gp')!;
    const p = result.find((t) => t.id === 'p')!;
    expect(p.endDate).toBe('2050-04-01');
    expect(gp.endDate).toBe('2050-04-01');
  });

  it('parentId가 null이면 변경 없음', () => {
    const tasks: Task[] = [makeTask({ id: 'a' })];
    const result = syncParentRollups(tasks, null);
    expect(result).toBe(tasks); // 동일 참조
  });

  it('완료 상태인 부모는 진척률 100% 유지', () => {
    const doneIds = new Set(['done']);
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'done', progress: 100 }),
      makeTask({ id: 'c1', parentId: 'parent', progress: 50, workEffort: 5 }),
    ];
    const result = syncParentRollups(tasks, 'parent', doneIds);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.progress).toBe(100);
  });

  it('직속 자식 공수 합으로 부모 공수를 롤업', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', workEffort: 99, progress: 0 }),
      makeTask({ id: 'c1', parentId: 'parent', workEffort: 6 }),
      makeTask({ id: 'c2', parentId: 'parent', workEffort: 4 }),
    ];
    const result = syncParentRollups(tasks, 'parent');
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.workEffort).toBe(10);
  });

  it('부모 공수는 자식 합으로 롤업된다', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', workEffort: 14 }),
      makeTask({ id: 'c1', parentId: 'parent', workEffort: 0.5 }),
      makeTask({ id: 'c2', parentId: 'parent', workEffort: 0.5 }),
    ];
    const result = syncParentRollups(tasks, 'parent');
    expect(result.find((t) => t.id === 'parent')!.workEffort).toBe(1);
  });

  it('3레벨: 손자 공수 변경이 조부모 공수까지 롤업', () => {
    const tasks: Task[] = [
      makeTask({ id: 'gp', workEffort: 1 }),
      makeTask({ id: 'p', parentId: 'gp', workEffort: 1 }),
      makeTask({ id: 'leaf', parentId: 'p', workEffort: 7 }),
    ];
    const result = syncParentRollups(tasks, 'p');
    expect(result.find((t) => t.id === 'p')!.workEffort).toBe(7);
    expect(result.find((t) => t.id === 'gp')!.workEffort).toBe(7);
  });

  it('skipWorkEffortRollupParentIds면 해당 부모 공수만 롤업 생략', () => {
    const tasks: Task[] = [makeTask({ id: 'parent', workEffort: 14 }), makeTask({ id: 'c1', parentId: 'parent', workEffort: 3 })];
    const result = syncParentRollups(tasks, 'parent', undefined, false, undefined, new Set(['parent']));
    expect(result.find((t) => t.id === 'parent')!.workEffort).toBe(14);
  });
});

describe('recomputeProjectRollups', () => {
  it('프로젝트 내 모든 부모 롤업', () => {
    const tasks: Task[] = [
      makeTask({ id: 'root', projectId: 'p1' }),
      makeTask({ id: 'c1', parentId: 'root', projectId: 'p1', progress: 100, workEffort: 3 }),
      makeTask({ id: 'c2', parentId: 'root', projectId: 'p1', progress: 0, workEffort: 7 }),
    ];
    const result = recomputeProjectRollups(tasks, 'p1');
    const root = result.find((t) => t.id === 'root')!;
    expect(root.progress).toBe(30); // (100*3 + 0*7) / 10
    expect(root.workEffort).toBe(10);
  });

  it('다른 프로젝트 작업은 영향 없음', () => {
    const tasks: Task[] = [makeTask({ id: 'a', projectId: 'p1', progress: 50 }), makeTask({ id: 'b', projectId: 'p2', progress: 0 })];
    const result = recomputeProjectRollups(tasks, 'p1');
    const b = result.find((t) => t.id === 'b')!;
    expect(b.progress).toBe(0); // 변경 없음
  });
});

describe('applyRollupsToTasks', () => {
  it('부모의 진척률을 자식 기준으로 롤업', () => {
    const configs = [
      { id: 'todo', progress: 0 },
      { id: 'done', progress: 100 },
    ];
    const tasks: Task[] = [
      makeTask({ id: 'parent', projectId: 'p1' }),
      makeTask({ id: 'c1', parentId: 'parent', projectId: 'p1', progress: 100, workEffort: 5 }),
      makeTask({ id: 'c2', parentId: 'parent', projectId: 'p1', progress: 0, workEffort: 5 }),
    ];
    const result = applyRollupsToTasks(tasks, configs);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.progress).toBe(50); // (100*5 + 0*5) / 10
    expect(parent.workEffort).toBe(10);
  });

  it('리프 작업은 진척률 변경 없음 (상태 기반 매핑은 별도 함수)', () => {
    const configs = [{ id: 'done', progress: 100 }];
    const tasks: Task[] = [makeTask({ id: 'a', status: 'done', progress: 0, projectId: 'p1' })];
    const result = applyRollupsToTasks(tasks, configs);
    // applyRollupsToTasks는 부모 롤업만 수행, 리프 작업의 상태→진척률 매핑은 안 함
    expect(result.find((t) => t.id === 'a')!.progress).toBe(0);
  });
});

describe('deriveParentStatusFromChildren', () => {
  it('자식이 모두 완료면 done 반환', () => {
    const id = deriveParentStatusFromChildren(['done', 'done'], DEFAULT_STATUS_CONFIGS);
    expect(id).toBe('done');
  });

  it('자식이 모두 시작 전이면 todo 반환', () => {
    const id = deriveParentStatusFromChildren(['todo', 'todo', 'todo'], DEFAULT_STATUS_CONFIGS);
    expect(id).toBe('todo');
  });

  it('자식 중 진행 중이 있으면 in-progress 반환', () => {
    const id = deriveParentStatusFromChildren(['todo', 'in-progress'], DEFAULT_STATUS_CONFIGS);
    expect(id).toBe('in-progress');
  });

  it('일부만 done이면 in-progress 반환', () => {
    const id = deriveParentStatusFromChildren(['done', 'todo'], DEFAULT_STATUS_CONFIGS);
    expect(id).toBe('in-progress');
  });

  it('자식 중 blocked가 있으면 in-progress 계열 반환 (중간 progress)', () => {
    // DEFAULT: in-progress(10) < blocked(50) < done(100), 가장 작은 중간 progress = in-progress
    const id = deriveParentStatusFromChildren(['blocked', 'todo'], DEFAULT_STATUS_CONFIGS);
    expect(id).toBe('in-progress');
  });

  it('빈 배열이면 null 반환', () => {
    expect(deriveParentStatusFromChildren([], DEFAULT_STATUS_CONFIGS)).toBeNull();
  });

  it('완료형(preset=100)이 여러 개여도 자식이 모두 같은 완료 단계면 그 id를 쓴다', () => {
    const configs = [
      { id: 'todo', name: '할 일', progress: 0 },
      { id: 'in-progress', name: '진행 중', progress: 50 },
      { id: 'author-done', name: '작성자 완료', progress: 100 },
      { id: 'reviewer-done', name: '검토자 완료', progress: 100 },
    ];
    expect(deriveParentStatusFromChildren(['reviewer-done', 'reviewer-done'], configs)).toBe('reviewer-done');
  });

  it('preset이 100이 아닌 동일 단계여도 자식이 모두 같으면 그 상태를 부모에 반영', () => {
    const configs = [
      { id: 'todo', name: '할 일', progress: 0 },
      { id: 'in-progress', name: '진행 중', progress: 50 },
      { id: 'review', name: '검토', progress: 90 },
      { id: 'done', name: '완료', progress: 100 },
    ];
    expect(deriveParentStatusFromChildren(['review', 'review'], configs)).toBe('review');
  });
});

describe('rescaleSiblingsToSum100', () => {
  it('가중치 미지정 형제들을 균등(100/n) 분배', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', projectId: 'p1', parentId: null }),
      makeTask({ id: 'b', projectId: 'p1', parentId: null }),
      makeTask({ id: 'c', projectId: 'p1', parentId: null }),
    ];
    const result = rescaleSiblingsToSum100(tasks, 'p1', null);
    const sum = result.reduce((s, t) => s + (t.weight ?? 0), 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(result.find((t) => t.id === 'a')!.weight).toBeCloseTo(33.33, 2);
  });

  it('preserveTaskId가 주어지면 해당 가중치는 그대로 유지하고 나머지를 비례 분배', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', projectId: 'p1', parentId: null, weight: 33.33 }),
      makeTask({ id: 'b', projectId: 'p1', parentId: null, weight: 50 }),
      makeTask({ id: 'c', projectId: 'p1', parentId: null, weight: 33.34 }),
    ];
    const result = rescaleSiblingsToSum100(tasks, 'p1', null, 'b');
    const b = result.find((t) => t.id === 'b')!;
    expect(b.weight).toBe(50);
    const sum = result.reduce((s, t) => s + (t.weight ?? 0), 0);
    expect(sum).toBeCloseTo(100, 2);
    // a와 c는 기존 비율(약 1:1)을 유지하며 나머지 50을 균등 분배
    const a = result.find((t) => t.id === 'a')!;
    const c = result.find((t) => t.id === 'c')!;
    expect(a.weight! + c.weight!).toBeCloseTo(50, 2);
  });

  it('단일 작업이면 가중치 100', () => {
    const tasks: Task[] = [makeTask({ id: 'only', projectId: 'p1' })];
    const result = rescaleSiblingsToSum100(tasks, 'p1', null);
    expect(result.find((t) => t.id === 'only')!.weight).toBe(100);
  });

  it('다른 프로젝트 또는 다른 부모의 작업은 영향 없음', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', projectId: 'p1', parentId: null, weight: 30 }),
      makeTask({ id: 'b', projectId: 'p1', parentId: null, weight: 70 }),
      makeTask({ id: 'x', projectId: 'p1', parentId: 'a', weight: 99 }),
      makeTask({ id: 'y', projectId: 'p2', parentId: null, weight: 99 }),
    ];
    const result = rescaleSiblingsToSum100(tasks, 'p1', null);
    expect(result.find((t) => t.id === 'x')!.weight).toBe(99);
    expect(result.find((t) => t.id === 'y')!.weight).toBe(99);
  });

  it('preserve 가중치가 100을 넘으면 100으로 클램프되고 나머지는 0', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', projectId: 'p1', parentId: null, weight: 150 }),
      makeTask({ id: 'b', projectId: 'p1', parentId: null, weight: 25 }),
    ];
    const result = rescaleSiblingsToSum100(tasks, 'p1', null, 'a');
    expect(result.find((t) => t.id === 'a')!.weight).toBe(100);
    expect(result.find((t) => t.id === 'b')!.weight).toBe(0);
  });
});

describe('syncParentStatus', () => {
  it('자식이 모두 done이면 부모 status도 done', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'todo', progress: 0 }),
      makeTask({ id: 'c1', parentId: 'parent', status: 'done', progress: 100 }),
      makeTask({ id: 'c2', parentId: 'parent', status: 'done', progress: 100 }),
    ];
    const result = syncParentStatus(tasks, 'parent', DEFAULT_STATUS_CONFIGS);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.status).toBe('done');
    expect(parent.progress).toBe(100);
  });

  it('자식 중 진행 중인 작업이 있으면 부모 status는 in-progress', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'todo', progress: 0 }),
      makeTask({ id: 'c1', parentId: 'parent', status: 'todo', progress: 0 }),
      makeTask({ id: 'c2', parentId: 'parent', status: 'in-progress', progress: 10 }),
    ];
    const result = syncParentStatus(tasks, 'parent', DEFAULT_STATUS_CONFIGS);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.status).toBe('in-progress');
  });

  it('자식이 모두 todo면 부모도 todo로 회귀', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'in-progress', progress: 10 }),
      makeTask({ id: 'c1', parentId: 'parent', status: 'todo', progress: 0 }),
      makeTask({ id: 'c2', parentId: 'parent', status: 'todo', progress: 0 }),
    ];
    const result = syncParentStatus(tasks, 'parent', DEFAULT_STATUS_CONFIGS);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.status).toBe('todo');
    expect(parent.progress).toBe(0);
  });

  it('3레벨: 손자 변경이 부모와 조부모까지 전파', () => {
    const tasks: Task[] = [
      makeTask({ id: 'gp', status: 'todo' }),
      makeTask({ id: 'p', parentId: 'gp', status: 'todo' }),
      makeTask({ id: 'c1', parentId: 'p', status: 'done', progress: 100 }),
      makeTask({ id: 'c2', parentId: 'p', status: 'done', progress: 100 }),
    ];
    // c1, c2의 부모인 'p'부터 시작해 위로 전파
    const result = syncParentStatus(tasks, 'p', DEFAULT_STATUS_CONFIGS);
    expect(result.find((t) => t.id === 'p')!.status).toBe('done');
    expect(result.find((t) => t.id === 'gp')!.status).toBe('done');
  });

  it('parentId가 null이면 변경 없음', () => {
    const tasks: Task[] = [makeTask({ id: 'a' })];
    const result = syncParentStatus(tasks, null, DEFAULT_STATUS_CONFIGS);
    expect(result).toBe(tasks);
  });

  it('자식이 모두 완료면 부모 status는 done이며 preset 진척률도 적용', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'todo', progress: 25 }),
      makeTask({ id: 'c1', parentId: 'parent', status: 'done', progress: 100 }),
      makeTask({ id: 'c2', parentId: 'parent', status: 'done', progress: 100 }),
    ];
    const result = syncParentStatus(tasks, 'parent', DEFAULT_STATUS_CONFIGS);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.status).toBe('done');
    expect(parent.progress).toBe(100);
  });

  it('syncProgress=false면 status만 갱신하고 progress는 유지', () => {
    const tasks: Task[] = [
      makeTask({ id: 'parent', status: 'todo', progress: 17 }),
      makeTask({ id: 'c1', parentId: 'parent', status: 'in-progress', progress: 50 }),
      makeTask({ id: 'c2', parentId: 'parent', status: 'todo', progress: 0 }),
    ];
    const result = syncParentStatus(tasks, 'parent', DEFAULT_STATUS_CONFIGS, false);
    const parent = result.find((t) => t.id === 'parent')!;
    expect(parent.status).toBe('in-progress');
    // syncProgress=false: progress는 status preset(10)로 덮어쓰지 않음
    expect(parent.progress).toBe(17);
  });
});
