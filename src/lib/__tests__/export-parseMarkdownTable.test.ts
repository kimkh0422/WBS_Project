import { describe, it, expect } from 'vitest';
import { parseMarkdownTable, wbsAlternatesForPasteLookup, buildWbsCodeToTaskIdForMarkdownPaste } from '../export';
import type { Project, Task } from '../../types';

const userSample = `
| WBS | 작업명 | 시작일 | 종료일 | 진행률 | 담당자 | 상태 | 공수 |
|-----|--------|--------|--------|--------|--------|------|------|
| 1.0 | 전체 연구 기획 및 방향 설정 | | | | | | |
| 2.1.1 | 관련 표준(IEC 61174, S-100 등) 검토 | | | | | | |
`.trim();

describe('parseMarkdownTable', () => {
  it('인식: 굵게 없는 WBS 열 + 빈 칸만 있는 8열', () => {
    const rows = parseMarkdownTable(userSample);
    expect(rows).toHaveLength(2);
    expect(rows[0].wbsCode).toBe('1.0');
    expect(rows[0].name).toContain('전체 연구');
    expect(rows[1].wbsCode).toBe('2.1.1');
    expect(rows[1].name).toContain('IEC 61174');
  });
});

describe('wbsAlternatesForPasteLookup', () => {
  it('1.0 → 1.0, 1 순', () => {
    expect(wbsAlternatesForPasteLookup('1.0')).toEqual(['1.0', '1']);
  });
  it('2.1.0 → 2.1.0, 2.1', () => {
    expect(wbsAlternatesForPasteLookup('2.1.0')).toEqual(['2.1.0', '2.1']);
  });
});

describe('buildWbsCodeToTaskIdForMarkdownPaste', () => {
  it('트리 번호·1.0 표기·컨텍스트 wbsMap을 한데 묶어 조회한다', () => {
    const project: Project = { id: 'p1', name: 'P' };
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: '상위',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
      {
        id: 't2',
        projectId: 'p1',
        parentId: 't1',
        name: '하위',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const wbsMap = new Map<string, string>([
      ['t1', '1'],
      ['t2', '1.1'],
    ]);
    const m = buildWbsCodeToTaskIdForMarkdownPaste('p1', tasks, [project], wbsMap);
    expect(m.get('1')).toBe('t1');
    expect(m.get('1.0')).toBe('t1');
    expect(m.get('1.1')).toBe('t2');
    expect(m.get('1.1.0')).toBe('t2');
  });
});
