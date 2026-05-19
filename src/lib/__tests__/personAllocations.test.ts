import { describe, it, expect } from 'vitest';
import { computeProjectTotalManMonths, countProjectPersonnel, getProjectMonthKeys } from '../personAllocations';
import type { Project } from '../../types';

describe('getProjectMonthKeys', () => {
  it('시작·종료일 사이 월 목록을 반환한다', () => {
    const keys = getProjectMonthKeys({ startDate: '2026-01-15', endDate: '2026-03-20' });
    expect(keys).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('countProjectPersonnel', () => {
  it('투입비율이 있는 담당자 수를 센다', () => {
    const project: Pick<Project, 'assignments'> = {
      assignments: [
        { assignee: 'A', allocationPercent: 50 },
        { assignee: 'B', allocationPercent: 30 },
        { assignee: 'C', allocationPercent: 0 },
      ],
    };
    expect(countProjectPersonnel(project)).toBe(2);
  });
});

describe('computeProjectTotalManMonths', () => {
  it('월별 기본 투입비율로 인월을 합산한다', () => {
    const project: Pick<Project, 'startDate' | 'endDate' | 'assignments'> = {
      startDate: '2026-01-01',
      endDate: '2026-02-28',
      assignments: [
        { assignee: 'A', allocationPercent: 100 },
        { assignee: 'B', allocationPercent: 50 },
      ],
    };
    // 2개월 × (1.0 + 0.5) = 3.0 M/M
    expect(computeProjectTotalManMonths(project)).toBe(3);
  });

  it('월별 투입 설정이 있으면 해당 월 값을 사용한다', () => {
    const project: Pick<Project, 'startDate' | 'endDate' | 'assignments'> = {
      startDate: '2026-04-01',
      endDate: '2026-05-31',
      assignments: [
        {
          assignee: 'A',
          allocationPercent: 100,
          monthlyAllocations: { '2026-04': 50, '2026-05': 25 },
        },
      ],
    };
    // 0.5 + 0.25 = 0.75 M/M
    expect(computeProjectTotalManMonths(project)).toBe(0.8);
  });
});
