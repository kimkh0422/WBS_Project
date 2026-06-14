import { describe, it, expect } from 'vitest';
import { buildSiblingMoveStepsFromSelection, resolveProjectTasksForSiblingMove } from '../siblingMoveKeyboard';
import type { Task } from '../../types';

function t(id: string, parentId: string | null, projectId = 'p1'): Task {
  return {
    id,
    projectId,
    parentId,
    name: id,
    startDate: '',
    endDate: '',
    progress: 0,
    expanded: true,
  } as Task;
}

describe('resolveProjectTasksForSiblingMove', () => {
  const tasks = [t('a', null), t('b', null, 'p2')];

  it('단일 프로젝트 뷰에서는 해당 프로젝트 작업만', () => {
    const pt = resolveProjectTasksForSiblingMove(tasks, 'p1', new Set(['a']));
    expect(pt?.map((x) => x.id)).toEqual(['a']);
  });

  it('all 뷰에서 선택이 한 프로젝트에만 있으면 그 프로젝트만', () => {
    const pt = resolveProjectTasksForSiblingMove(tasks, 'all', new Set(['a']));
    expect(pt?.map((x) => x.id)).toEqual(['a']);
  });

  it('all 뷰에서 프로젝트가 섞이면 null', () => {
    expect(resolveProjectTasksForSiblingMove(tasks, 'all', new Set(['a', 'b']))).toBeNull();
  });
});

describe('buildSiblingMoveStepsFromSelection', () => {
  it('연속 블록 하나: 위로는 첫 id, 아래로는 마지막 id', () => {
    const projectTasks = [t('x', null), t('a', null), t('b', null), t('c', null)];
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'b']), 'up')).toEqual([{ id: 'a', direction: 'up' }]);
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'b']), 'down')).toEqual([{ id: 'b', direction: 'down' }]);
  });

  it('같은 부모에서 비연속이면 구간마다 스텝', () => {
    const projectTasks = [t('x', null), t('a', null), t('b', null), t('c', null), t('d', null)];
    const stepsUp = buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'c']), 'up');
    expect(stepsUp).toEqual([
      { id: 'a', direction: 'up' },
      { id: 'c', direction: 'up' },
    ]);
    const stepsDown = buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'c']), 'down');
    expect(stepsDown).toEqual([
      { id: 'c', direction: 'down' },
      { id: 'a', direction: 'down' },
    ]);
  });

  it('맨 위·맨 아래면 빈 스텝', () => {
    const projectTasks = [t('a', null), t('b', null)];
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a']), 'up')).toEqual([]);
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['b']), 'down')).toEqual([]);
  });
});
