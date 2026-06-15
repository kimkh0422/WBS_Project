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

  it('탭이 없고 열 개수가 일정하면 쉼표로 열을 구분한다', () => {
    const csv = ['2026-01-01, 2026-05-29', '2026-01-01, 2026-03-06', '2026-01-26, 2026-05-15'].join('\n');
    expect(parseClipboardTsvToTextGrid(csv)).toEqual([
      ['2026-01-01', '2026-05-29'],
      ['2026-01-01', '2026-03-06'],
      ['2026-01-26', '2026-05-15'],
    ]);
  });

  it('쉼표 열 개수가 줄마다 다르면 한 열로 두어 한 셀에 붙지 않게 분할만 억제한다', () => {
    expect(parseClipboardTsvToTextGrid('a,b\nc')).toEqual([['a,b'], ['c']]);
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
