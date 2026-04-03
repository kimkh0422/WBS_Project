import { describe, it, expect } from 'vitest';
import { syncParentRollups, recomputeProjectRollups, applyRollupsToTasks } from '../rollups';
import type { Task } from '../../types';

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
    const parent = result.find(t => t.id === 'parent')!;
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
    const parent = result.find(t => t.id === 'parent')!;
    expect(parent.startDate).toBe('2026-04-01');
    expect(parent.endDate).toBe('2026-04-10');
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
    const parent = result.find(t => t.id === 'parent')!;
    expect(parent.progress).toBe(100);
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
    const root = result.find(t => t.id === 'root')!;
    expect(root.progress).toBe(30); // (100*3 + 0*7) / 10
  });

  it('다른 프로젝트 작업은 영향 없음', () => {
    const tasks: Task[] = [
      makeTask({ id: 'a', projectId: 'p1', progress: 50 }),
      makeTask({ id: 'b', projectId: 'p2', progress: 0 }),
    ];
    const result = recomputeProjectRollups(tasks, 'p1');
    const b = result.find(t => t.id === 'b')!;
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
    const parent = result.find(t => t.id === 'parent')!;
    expect(parent.progress).toBe(50); // (100*5 + 0*5) / 10
  });

  it('리프 작업은 진척률 변경 없음 (상태 기반 매핑은 별도 함수)', () => {
    const configs = [{ id: 'done', progress: 100 }];
    const tasks: Task[] = [
      makeTask({ id: 'a', status: 'done', progress: 0, projectId: 'p1' }),
    ];
    const result = applyRollupsToTasks(tasks, configs);
    // applyRollupsToTasks는 부모 롤업만 수행, 리프 작업의 상태→진척률 매핑은 안 함
    expect(result.find(t => t.id === 'a')!.progress).toBe(0);
  });
});
