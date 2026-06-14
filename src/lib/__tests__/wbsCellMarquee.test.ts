import { describe, it, expect } from 'vitest';
import { parseClipboardTsvToTextGrid, expandWbsMarqueePlainPastePairs, jumpWbsCellArrowToEdge } from '../wbsCellMarquee';
import type { TaskWithDepth } from '../taskView';

describe('parseClipboardTsvToTextGrid', () => {
  it('탭·줄바꿈으로 격자를 파싱하고 끝 빈 줄을 제거한다', () => {
    expect(parseClipboardTsvToTextGrid('a\tb\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('expandWbsMarqueePlainPastePairs', () => {
  const tasks = [
    { id: 'r0', depth: 0 },
    { id: 'r1', depth: 0 },
  ] as TaskWithDepth[];
  const cols = ['name', 'startDate'] as const;

  it('앵커부터 복사 격자만큼 오른쪽·아래로 매핑한다', () => {
    const pairs = expandWbsMarqueePlainPastePairs({
      anchor: { taskId: 'r0', columnId: 'name' },
      textGrid: [
        ['x', 'y'],
        ['z', 'w'],
      ],
      visibleTasks: tasks,
      visibleColumnIds: [...cols],
    });
    expect(pairs).toEqual([
      { taskId: 'r0', columnId: 'name', text: 'x' },
      { taskId: 'r0', columnId: 'startDate', text: 'y' },
      { taskId: 'r1', columnId: 'name', text: 'z' },
      { taskId: 'r1', columnId: 'startDate', text: 'w' },
    ]);
  });
});

describe('jumpWbsCellArrowToEdge', () => {
  const tasks = [
    { id: 'r0', depth: 0 },
    { id: 'r1', depth: 0 },
    { id: 'r2', depth: 0 },
  ] as TaskWithDepth[];
  const cols = ['name', 'startDate', 'duration'] as const;
  const visibleTaskRowIndexById = new Map(tasks.map((t, i) => [t.id, i]));

  const opts = {
    visibleTasks: tasks,
    columnIds: [...cols],
    visibleTaskRowIndexById,
    defaultNavColumn: 'name' as const,
  };

  it('같은 열에서 위/아래 끝 행으로 점프한다', () => {
    expect(jumpWbsCellArrowToEdge({ taskId: 'r1', columnId: 'startDate' }, 'ArrowUp', opts)).toEqual({
      taskId: 'r0',
      columnId: 'startDate',
    });
    expect(jumpWbsCellArrowToEdge({ taskId: 'r1', columnId: 'startDate' }, 'ArrowDown', opts)).toEqual({
      taskId: 'r2',
      columnId: 'startDate',
    });
  });

  it('같은 행에서 왼쪽/오른쪽 끝 열로 점프한다', () => {
    expect(jumpWbsCellArrowToEdge({ taskId: 'r1', columnId: 'startDate' }, 'ArrowLeft', opts)).toEqual({
      taskId: 'r1',
      columnId: 'name',
    });
    expect(jumpWbsCellArrowToEdge({ taskId: 'r1', columnId: 'startDate' }, 'ArrowRight', opts)).toEqual({
      taskId: 'r1',
      columnId: 'duration',
    });
  });

  it('이미 끝이면 null', () => {
    expect(jumpWbsCellArrowToEdge({ taskId: 'r0', columnId: 'name' }, 'ArrowUp', opts)).toBeNull();
    expect(jumpWbsCellArrowToEdge({ taskId: 'r2', columnId: 'duration' }, 'ArrowDown', opts)).toBeNull();
  });
});
