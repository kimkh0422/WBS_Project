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
  it('연속 블록: 구간 내 모든 행이 순차 스왑되어 블록 전체가 한 칸 이동', () => {
    const projectTasks = [t('x', null), t('a', null), t('b', null), t('c', null), t('d', null), t('e', null)];
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'b']), 'up')).toEqual([
      { id: 'a', direction: 'up' },
      { id: 'b', direction: 'up' },
    ]);
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['b', 'c', 'd']), 'down')).toEqual([
      { id: 'd', direction: 'down' },
      { id: 'c', direction: 'down' },
      { id: 'b', direction: 'down' },
    ]);
    expect(buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'b', 'c', 'd']), 'up')).toEqual([
      { id: 'a', direction: 'up' },
      { id: 'b', direction: 'up' },
      { id: 'c', direction: 'up' },
      { id: 'd', direction: 'up' },
    ]);
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

  it('4행 연속 블록 아래 이동 시 형제 순서가 한 칸씩 내려간다', () => {
    const projectTasks = [t('w', null), t('a', null), t('b', null), t('c', null), t('d', null), t('e', null)];
    const steps = buildSiblingMoveStepsFromSelection(projectTasks, new Set(['a', 'b', 'c', 'd']), 'down');
    let order = projectTasks.map((x) => x.id);
    for (const step of steps) {
      const siblings = order;
      const idx = siblings.indexOf(step.id);
      if (idx < 0) continue;
      const swapIdx = step.direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= siblings.length) continue;
      const next = [...siblings];
      [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
      order = next;
    }
    expect(order).toEqual(['w', 'e', 'a', 'b', 'c', 'd']);
  });
});
