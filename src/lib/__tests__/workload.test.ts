import { describe, it, expect } from 'vitest';
import { getEffectiveAllocationPercent, computeWorkloadOverloads } from '../workload';
import type { Task, Project } from '../../types';

describe('getEffectiveAllocationPercent', () => {
  it('월별 설정 없으면 기본 allocationPercent 반환', () => {
    const assignment = { allocationPercent: 80 };
    expect(getEffectiveAllocationPercent(assignment, '2026-04-01')).toBe(80);
  });

  it('월별 설정 있으면 해당 월 값 반환', () => {
    const assignment = {
      allocationPercent: 100,
      monthlyAllocations: { '2026-04': 50, '2026-05': 30 },
    };
    expect(getEffectiveAllocationPercent(assignment, '2026-04-15')).toBe(50);
    expect(getEffectiveAllocationPercent(assignment, '2026-05-01')).toBe(30);
  });

  it('해당 월 설정 없으면 기본값', () => {
    const assignment = {
      allocationPercent: 100,
      monthlyAllocations: { '2026-04': 50 },
    };
    expect(getEffectiveAllocationPercent(assignment, '2026-06-01')).toBe(100);
  });
});

describe('computeWorkloadOverloads', () => {
  function makeTask(overrides: Partial<Task> & { id: string }): Task {
    return {
      projectId: 'p1',
      parentId: null,
      name: 'task',
      startDate: '2026-04-06', // 월
      endDate: '2026-04-06',
      progress: 0,
      assignee: 'Alice',
      status: 'in-progress',
      ...overrides,
    };
  }

  it('단일 작업 100% → 과부하 없음', () => {
    const tasks: Task[] = [makeTask({ id: 't1' })];
    const projects: Project[] = [{
      id: 'p1', name: 'P1',
      assignments: [{ assignee: 'Alice', allocationPercent: 100 }],
    }];
    const { overloads } = computeWorkloadOverloads(tasks, projects);
    expect(overloads.length).toBe(0);
  });

  it('같은 날 같은 인원 2작업 100%씩 → 과부하', () => {
    const tasks: Task[] = [
      makeTask({ id: 't1', startDate: '2026-04-06', endDate: '2026-04-06', assignee: 'Alice' }),
      makeTask({ id: 't2', startDate: '2026-04-06', endDate: '2026-04-06', assignee: 'Alice' }),
    ];
    const projects: Project[] = [{
      id: 'p1', name: 'P1',
      assignments: [{ assignee: 'Alice', allocationPercent: 100 }],
    }];
    const { overloads } = computeWorkloadOverloads(tasks, projects);
    expect(overloads.length).toBeGreaterThan(0);
    expect(overloads[0].assignee).toBe('Alice');
  });

  it('다른 프로젝트에 다른 인원이면 과부하 아님', () => {
    const tasks: Task[] = [
      makeTask({ id: 't1', projectId: 'p1', assignee: 'Alice' }),
      makeTask({ id: 't2', projectId: 'p2', assignee: 'Bob' }),
    ];
    const projects: Project[] = [
      { id: 'p1', name: 'P1', assignments: [{ assignee: 'Alice', allocationPercent: 100 }] },
      { id: 'p2', name: 'P2', assignments: [{ assignee: 'Bob', allocationPercent: 100 }] },
    ];
    const { overloads } = computeWorkloadOverloads(tasks, projects);
    expect(overloads.length).toBe(0);
  });

  it('작업 없으면 과부하 없음', () => {
    const { overloads } = computeWorkloadOverloads([], []);
    expect(overloads.length).toBe(0);
  });
});
