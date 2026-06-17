import { describe, expect, it } from 'vitest';
import type { TaskWithDepth } from '../../../lib/taskView';
import type { Task } from '../../../types';
import {
  resolveMarqueeRowsForSpaceCheckbox,
  resolveSpaceCheckboxSelection,
  resolveTabLevelAdjustOrderedIds,
  shouldPreferBulkTabLevelChange,
} from '../useWbsTableKeyboard';

const visibleTasks: TaskWithDepth[] = [
  { id: 'a', name: 'A', projectId: 'p1', parentId: 'root', depth: 1 } as TaskWithDepth,
  { id: 'b', name: 'B', projectId: 'p1', parentId: 'root', depth: 1 } as TaskWithDepth,
  { id: 'c', name: 'C', projectId: 'p1', parentId: 'root', depth: 1 } as TaskWithDepth,
  { id: 'd', name: 'D', projectId: 'p1', parentId: 'root', depth: 1 } as TaskWithDepth,
  { id: 'e', name: 'E', projectId: 'p1', parentId: 'root', depth: 1 } as TaskWithDepth,
];

const tasks = visibleTasks as unknown as Task[];

describe('shouldPreferBulkTabLevelChange', () => {
  it('다중 체크·다중 셀·2행 이상 마퀴 구간이면 일괄 Tab 레벨 조정을 우선한다', () => {
    expect(shouldPreferBulkTabLevelChange({ selectedTaskIdsSize: 2, cellMarqueeKeySetSize: 0, marqueeRangeRowCount: 0 })).toBe(true);
    expect(shouldPreferBulkTabLevelChange({ selectedTaskIdsSize: 0, cellMarqueeKeySetSize: 5, marqueeRangeRowCount: 0 })).toBe(true);
    expect(shouldPreferBulkTabLevelChange({ selectedTaskIdsSize: 0, cellMarqueeKeySetSize: 0, marqueeRangeRowCount: 5 })).toBe(true);
    expect(shouldPreferBulkTabLevelChange({ selectedTaskIdsSize: 1, cellMarqueeKeySetSize: 1, marqueeRangeRowCount: 1 })).toBe(false);
  });
});

describe('resolveTabLevelAdjustOrderedIds', () => {
  it('작업명 열 다중 행 마퀴(range)만 있어도 표시 순서의 모든 행 id를 반환한다', () => {
    const cellMarqueeRange = {
      anchor: { taskId: 'b', columnId: 'name' as const },
      end: { taskId: 'e', columnId: 'name' as const },
    };
    const res = resolveTabLevelAdjustOrderedIds({
      selectedTaskIds: new Set(),
      visibleTasks,
      tasks,
      cellMarqueeKeySet: null,
      cellMarqueeRange,
      cursorLastSelectedId: 'e',
    });
    expect(res.orderedIds).toEqual(['b', 'c', 'd', 'e']);
    expect(res.syncedMarqueeToCheckboxRows).toBe(true);
  });

  it('체크 다중 선택이 마퀴와 같거나 더 많으면 체크 행을 우선한다', () => {
    const res = resolveTabLevelAdjustOrderedIds({
      selectedTaskIds: new Set(['a', 'c']),
      visibleTasks,
      tasks,
      cellMarqueeKeySet: new Set(['a::name', 'c::name']),
      cellMarqueeRange: {
        anchor: { taskId: 'a', columnId: 'name' },
        end: { taskId: 'c', columnId: 'name' },
      },
      cursorLastSelectedId: 'c',
    });
    expect(res.orderedIds).toEqual(['a', 'c']);
    expect(res.syncedMarqueeToCheckboxRows).toBe(false);
  });
});

describe('resolveSpaceCheckboxSelection', () => {
  it('단일 행은 포커스 행만 토글한다', () => {
    expect(resolveSpaceCheckboxSelection({ selectedTaskIds: new Set(), focusRowId: 'a' })).toEqual(new Set(['a']));
    expect(resolveSpaceCheckboxSelection({ selectedTaskIds: new Set(['a']), focusRowId: 'a' })).toEqual(new Set());
  });

  it('다중 체크 선택이면 포커스 행이 선택 안에 있을 때 전체를 해제한다', () => {
    expect(resolveSpaceCheckboxSelection({ selectedTaskIds: new Set(['a', 'b', 'c']), focusRowId: 'b' })).toEqual(new Set());
  });

  it('다중 체크 선택에서 포커스 행이 선택 밖이면 그 행만 추가한다', () => {
    expect(resolveSpaceCheckboxSelection({ selectedTaskIds: new Set(['a', 'c']), focusRowId: 'b' })).toEqual(new Set(['a', 'c', 'b']));
  });
});

describe('resolveMarqueeRowsForSpaceCheckbox', () => {
  it('2행 이상 마퀴 범위만 체크 대상 행 목록을 반환한다', () => {
    const cellMarqueeRange = {
      anchor: { taskId: 'b', columnId: 'name' as const },
      end: { taskId: 'd', columnId: 'name' as const },
    };
    expect(
      resolveMarqueeRowsForSpaceCheckbox({
        cellMarqueeKeySet: null,
        cellMarqueeRange,
        visibleTasks,
      }),
    ).toEqual(['b', 'c', 'd']);
    expect(
      resolveMarqueeRowsForSpaceCheckbox({
        cellMarqueeKeySet: null,
        cellMarqueeRange: {
          anchor: { taskId: 'a', columnId: 'name' },
          end: { taskId: 'a', columnId: 'status' },
        },
        visibleTasks,
      }),
    ).toBeNull();
  });
});
