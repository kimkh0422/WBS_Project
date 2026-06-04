import { describe, expect, it } from 'vitest';
import {
  envelopeProjectWithTaskDates,
  expandProjectStoredDatesToTaskSpan,
  formatProjectPeriodDate,
  formatProjectPeriodRange,
  hasUndeterminedProjectPeriod,
  isoDatePrefix,
  summarizeUndeterminedProjectPeriod,
} from '../projectPeriod';
import type { Project, Task } from '../../types';

describe('hasUndeterminedProjectPeriod', () => {
  it('시작·종료 모두 없으면 true', () => {
    expect(hasUndeterminedProjectPeriod({})).toBe(true);
  });

  it('하나만 없어도 true', () => {
    expect(hasUndeterminedProjectPeriod({ startDate: '2026-01-01' })).toBe(true);
    expect(hasUndeterminedProjectPeriod({ endDate: '2026-12-31' })).toBe(true);
  });

  it('둘 다 있으면 false', () => {
    expect(hasUndeterminedProjectPeriod({ startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(false);
  });
});

describe('formatProjectPeriodRange', () => {
  it('빈 기간은 기간 미정', () => {
    expect(formatProjectPeriodRange(undefined, undefined)).toBe('기간 미정');
  });

  it('부분 미정은 미정 표기', () => {
    expect(formatProjectPeriodRange('2026-01-01', undefined)).toBe('2026-01-01 ~ 미정');
  });
});

describe('summarizeUndeterminedProjectPeriod', () => {
  it('누락 필드를 구분', () => {
    expect(summarizeUndeterminedProjectPeriod({})).toBe('시작·종료 미정');
    expect(summarizeUndeterminedProjectPeriod({ startDate: '2026-01-01' })).toBe('종료일 미정');
  });
});

describe('formatProjectPeriodDate', () => {
  it('빈 값은 미정', () => {
    expect(formatProjectPeriodDate('')).toBe('미정');
  });
});

describe('isoDatePrefix', () => {
  it('유효한 앞 10자만 반환', () => {
    expect(isoDatePrefix('2026-04-01T12:00:00')).toBe('2026-04-01');
    expect(isoDatePrefix('bad')).toBeUndefined();
  });
});

describe('envelopeProjectWithTaskDates', () => {
  it('프로젝트·작업 중 가장 이른 시작·늦은 종료를 반환', () => {
    const proj: Pick<Project, 'startDate' | 'endDate'> = { startDate: '2024-04-01', endDate: '2026-12-31' };
    const tasks: Pick<Task, 'startDate' | 'endDate'>[] = [
      { startDate: '2022-06-15', endDate: '2050-07-15' },
      { startDate: '2025-01-01', endDate: '2025-06-01' },
    ];
    expect(envelopeProjectWithTaskDates(proj, tasks)).toEqual({ startDate: '2022-06-15', endDate: '2050-07-15' });
  });

  it('프로젝트만 있으면 그 범위', () => {
    const proj: Pick<Project, 'startDate' | 'endDate'> = { startDate: '2024-01-01', endDate: '2024-12-31' };
    expect(envelopeProjectWithTaskDates(proj, [])).toEqual({ startDate: '2024-01-01', endDate: '2024-12-31' });
  });
});

describe('expandProjectStoredDatesToTaskSpan', () => {
  it('작업이 프로젝트 종료보다 길면 확장·changed true', () => {
    const project: Project = {
      id: 'p1',
      name: 'P',
      startDate: '2024-04-01',
      endDate: '2026-12-31',
    };
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: 'a',
        startDate: '2024-05-01',
        endDate: '2050-07-15',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const r = expandProjectStoredDatesToTaskSpan(project, tasks);
    expect(r?.changed).toBe(true);
    expect(r?.endDate).toBe('2050-07-15');
    expect(r?.startDate).toBe('2024-04-01');
  });

  it('이미 작업을 덮으면 changed false', () => {
    const project: Project = {
      id: 'p1',
      name: 'P',
      startDate: '2020-01-01',
      endDate: '2060-12-31',
    };
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: 'a',
        startDate: '2024-01-01',
        endDate: '2025-01-01',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const r = expandProjectStoredDatesToTaskSpan(project, tasks);
    expect(r?.changed).toBe(false);
  });
});
