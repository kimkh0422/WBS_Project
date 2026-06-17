import { describe, it, expect, vi } from 'vitest';
import {
  parseMarkdownTable,
  wbsAlternatesForPasteLookup,
  buildWbsCodeToTaskIdForMarkdownPaste,
  extractProjectIdFromMarkdown,
  applyMarkdownTableToProject,
} from '../export';
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
  it('W1 → W1, 1 및 접두어 힌트로 W1', () => {
    expect(wbsAlternatesForPasteLookup('W1')).toEqual(expect.arrayContaining(['W1', '1']));
    expect(wbsAlternatesForPasteLookup('1', { level1Prefix: 'W', level2Prefix: 'W', level3Prefix: 'T' })).toEqual(
      expect.arrayContaining(['1', 'W1']),
    );
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
    const m = buildWbsCodeToTaskIdForMarkdownPaste('p1', tasks, [project], wbsMap, {
      level1Prefix: 'W',
      level2Prefix: 'W',
      level3Prefix: 'T',
    });
    expect(m.get('1')).toBe('t1');
    expect(m.get('1.0')).toBe('t1');
    expect(m.get('1.1')).toBe('t2');
    expect(m.get('1.1.0')).toBe('t2');
  });

  it('붙여넣은 W1이 트리 번호 1과 매칭된다', () => {
    const project: Project = { id: 'p1', name: 'P' };
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: '루트',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const wbsMap = new Map<string, string>();
    const m = buildWbsCodeToTaskIdForMarkdownPaste('p1', tasks, [project], wbsMap, {
      level1Prefix: 'W',
      level2Prefix: 'W',
      level3Prefix: 'T',
    });
    expect(m.get('W1')).toBe('t1');
  });
});

describe('extractProjectIdFromMarkdown', () => {
  it('projectId 백틱 값을 추출한다', () => {
    const md = '*projectId: `abc-123` · 생성: 2026-06-17*';
    expect(extractProjectIdFromMarkdown(md)).toBe('abc-123');
  });
});

describe('parseMarkdownTable — W/T 접두 WBS', () => {
  it('**W1**, **T1.1.1** 형식을 인식한다', () => {
    const md = `
| WBS | 작업명 | 시작일 | 종료일 | 진행률 | 담당자 | 상태 | 공수 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **W1** | AI팩토리 2차년도 | 2026-06-01 | 2027-05-31 | 0.0% | 김길용 | todo | 320일 |
| **T1.1.1** | M1. 착수 | 2026-06-01 | 2026-06-22 | 0.0% | 김길용 | todo | 5일 |
`.trim();
    const rows = parseMarkdownTable(md);
    expect(rows).toHaveLength(2);
    expect(rows[0].wbsCode).toBe('W1');
    expect(rows[1].wbsCode).toBe('T1.1.1');
    expect(rows[0].workEffort).toBe(320);
  });
});

describe('applyMarkdownTableToProject', () => {
  it('WBS 코드로 기존 작업 필드를 갱신한다', () => {
    const project: Project = { id: 'p1', name: 'P' };
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: '이전',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const wbsMap = new Map<string, string>([['t1', 'W1']]);
    const updateTask = vi.fn();
    const md = '| **W1** | 새 이름 | 2026-06-01 | 2026-07-01 | 50% | 홍길동 | doing | 10일 |';
    const result = applyMarkdownTableToProject(md, 'p1', tasks, [project], wbsMap, updateTask, {
      level1Prefix: 'W',
      level2Prefix: 'W',
      level3Prefix: 'T',
    });
    expect(result.updated).toBe(1);
    expect(updateTask).toHaveBeenCalledWith(
      't1',
      {
        name: '새 이름',
        startDate: '2026-06-01',
        endDate: '2026-07-01',
        progress: 50,
        assignee: '홍길동',
        status: 'doing',
        workEffort: 10,
      },
      { deferScheduleSync: false },
    );
  });
});
