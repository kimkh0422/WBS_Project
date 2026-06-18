import { describe, expect, it } from 'vitest';
import { normalizeTaskNameHierarchyMarkersInTasks, stripTaskNameHierarchyMarker } from '../taskName';

describe('stripTaskNameHierarchyMarker', () => {
  it('removes leading ㄴ with space', () => {
    expect(stripTaskNameHierarchyMarker('ㄴ ICD 분석')).toBe('ICD 분석');
  });

  it('removes repeated ㄴ markers', () => {
    expect(stripTaskNameHierarchyMarker('ㄴ ㄴ 상세 요구사항')).toBe('상세 요구사항');
  });

  it('leaves names without markers unchanged', () => {
    expect(stripTaskNameHierarchyMarker('2DR(SPS-732)')).toBe('2DR(SPS-732)');
  });

  it('removes box-drawing markers', () => {
    expect(stripTaskNameHierarchyMarker('└ 화면설계')).toBe('화면설계');
  });
});

describe('normalizeTaskNameHierarchyMarkersInTasks', () => {
  it('strips markers from matching tasks only', () => {
    const tasks = [
      { id: '1', projectId: 'p', parentId: null, name: '루트', startDate: '', endDate: '', progress: 0, assignee: '', status: 'todo' },
      { id: '2', projectId: 'p', parentId: '1', name: 'ㄴ 하위', startDate: '', endDate: '', progress: 0, assignee: '', status: 'todo' },
    ];
    const { tasks: out, changed } = normalizeTaskNameHierarchyMarkersInTasks(tasks);
    expect(changed).toBe(true);
    expect(out[1]?.name).toBe('하위');
    expect(out[0]?.name).toBe('루트');
  });
});
