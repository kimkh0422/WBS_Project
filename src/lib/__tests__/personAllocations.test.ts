import { describe, it, expect } from 'vitest';
import {
  clampAllocationPercentInt,
  computePersonProjectTaskCounts,
  computePersonTaskAllocations,
  computePersonWorkEffortAllocationsFromTasks,
  computeProjectTotalManMonths,
  countProjectPersonnel,
  getProjectMonthKeys,
  mergePersonTaskAllocationsWithOrgDirectory,
  parseAllocationPercentInput,
} from '../personAllocations';
import type { OrgMember } from '../../data/organization';
import type { Project, Task } from '../../types';

describe('parseAllocationPercentInput / clampAllocationPercentInt', () => {
  it('투입율 입력을 0~100 정수로 파싱한다', () => {
    expect(parseAllocationPercentInput('37')).toBe(37);
    expect(parseAllocationPercentInput('37.6')).toBe(38);
    expect(parseAllocationPercentInput('100')).toBe(100);
    expect(parseAllocationPercentInput('0', { allowZero: true })).toBe(0);
    expect(parseAllocationPercentInput('0')).toBeNull();
    expect(parseAllocationPercentInput('')).toBeNull();
  });

  it('clampAllocationPercentInt가 범위를 맞춘다', () => {
    expect(clampAllocationPercentInt(33.4)).toBe(33);
    expect(clampAllocationPercentInt(-5)).toBe(0);
    expect(clampAllocationPercentInt(150)).toBe(100);
  });
});

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

describe('computePersonProjectTaskCounts', () => {
  it('담당자·프로젝트별 할당 작업 수를 집계한다', () => {
    const tasks: Task[] = [
      { id: 't1', projectId: 'p1', parentId: null, name: 'A', startDate: '', endDate: '', progress: 0, assignee: 'Kim', status: 'todo' },
      { id: 't2', projectId: 'p1', parentId: null, name: 'B', startDate: '', endDate: '', progress: 0, assignee: 'Kim', status: 'todo' },
      { id: 't3', projectId: 'p2', parentId: null, name: 'C', startDate: '', endDate: '', progress: 0, assignee: 'Kim', status: 'todo' },
      { id: 't4', projectId: 'p1', parentId: null, name: 'D', startDate: '', endDate: '', progress: 0, assignee: 'Lee', status: 'todo' },
      { id: 't5', projectId: 'p1', parentId: null, name: 'E', startDate: '', endDate: '', progress: 0, assignee: '', status: 'todo' },
    ];
    const counts = computePersonProjectTaskCounts(tasks);
    expect(counts.get('Kim')?.get('p1')).toBe(2);
    expect(counts.get('Kim')?.get('p2')).toBe(1);
    expect(counts.get('Lee')?.get('p1')).toBe(1);
    expect(counts.get('(미지정)')?.get('p1')).toBe(1);
  });
});

describe('computePersonTaskAllocations', () => {
  it('표시 프로젝트 범위 내 담당자별 작업 할당을 정렬해 반환한다', () => {
    const projects: Project[] = [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ];
    const taskCounts = new Map<string, Map<string, number>>([
      [
        'Kim',
        new Map([
          ['p1', 2],
          ['p2', 1],
        ]),
      ],
      ['Lee', new Map([['p1', 1]])],
      ['Park', new Map([['p9', 5]])],
    ]);
    const rows = computePersonTaskAllocations(projects, taskCounts);
    expect(rows.map((r) => r.person)).toEqual(['Kim', 'Lee']);
    expect(rows[0].totalTaskCount).toBe(3);
    expect(rows[0].items.map((i) => i.taskCount)).toEqual([2, 1]);
  });
});

describe('mergePersonTaskAllocationsWithOrgDirectory', () => {
  it('조직 인원 전체를 포함하고 할당 없는 직원은 0건으로 둔다', () => {
    const projects: Project[] = [{ id: 'p1', name: 'Alpha' }];
    const taskCounts = new Map<string, Map<string, number>>([['Kim', new Map([['p1', 2]])]]);
    const base = computePersonTaskAllocations(projects, taskCounts);
    const org: OrgMember[] = [
      { name: 'Lee', department: '개발팀', position: '', gender: '' },
      { name: 'Kim', department: '개발팀', position: '', gender: '' },
    ];
    const merged = mergePersonTaskAllocationsWithOrgDirectory(base, org);
    expect(merged.map((r) => r.person)).toEqual(['Lee', 'Kim']);
    expect(merged[0].totalTaskCount).toBe(0);
    expect(merged[0].items).toEqual([]);
    expect(merged[1].totalTaskCount).toBe(2);
  });

  it('작업에만 있는 비조직 담당자는 뒤에 이어 붙인다', () => {
    const projects: Project[] = [{ id: 'p1', name: 'Alpha' }];
    const taskCounts = new Map<string, Map<string, number>>([
      ['Kim', new Map([['p1', 1]])],
      ['Outsider', new Map([['p1', 3]])],
    ]);
    const base = computePersonTaskAllocations(projects, taskCounts);
    const org: OrgMember[] = [{ name: 'Kim', department: 'A', position: '', gender: '' }];
    const merged = mergePersonTaskAllocationsWithOrgDirectory(base, org);
    expect(merged.map((r) => r.person)).toEqual(['Kim', 'Outsider']);
  });
});

describe('computePersonWorkEffortAllocationsFromTasks', () => {
  it('담당자·프로젝트별 workEffort 합을 M/D로 묶고 공수 큰 순으로 정렬한다', () => {
    const projects: Project[] = [
      { id: 'p1', name: 'Alpha', startDate: '', endDate: '', progress: 0, status: 'todo' },
      { id: 'p2', name: 'Beta', startDate: '', endDate: '', progress: 0, status: 'todo' },
    ];
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: 'a',
        startDate: '',
        endDate: '',
        progress: 0,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 10,
      },
      {
        id: 't2',
        projectId: 'p2',
        parentId: null,
        name: 'b',
        startDate: '',
        endDate: '',
        progress: 0,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 30,
      },
      {
        id: 't3',
        projectId: 'p1',
        parentId: null,
        name: 'c',
        startDate: '',
        endDate: '',
        progress: 0,
        assignee: 'Lee',
        status: 'todo',
        workEffort: 5,
      },
    ];
    const rows = computePersonWorkEffortAllocationsFromTasks(projects, tasks);
    expect(rows.map((r) => r.person)).toEqual(['Kim', 'Lee']);
    const kim = rows.find((r) => r.person === 'Kim')!;
    expect(kim.totalMd).toBe(40);
    expect(kim.totalEarnedMd).toBe(0);
    expect(kim.items.map((i) => i.project.id)).toEqual(['p2', 'p1']);
    expect(kim.items[0].workEffortMd).toBe(30);
    expect(kim.items[0].earnedEffortMd).toBe(0);
  });

  it('진척률에 따라 earnedEffortMd와 가중 진척률을 반영한다', () => {
    const projects: Project[] = [{ id: 'p1', name: 'Alpha', startDate: '', endDate: '', progress: 0, status: 'todo' }];
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: 'a',
        startDate: '',
        endDate: '',
        progress: 50,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 10,
      },
      {
        id: 't2',
        projectId: 'p1',
        parentId: null,
        name: 'b',
        startDate: '',
        endDate: '',
        progress: 100,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 10,
      },
    ];
    const rows = computePersonWorkEffortAllocationsFromTasks(projects, tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalMd).toBe(20);
    expect(rows[0].totalEarnedMd).toBe(15);
    expect(rows[0].items[0].earnedEffortMd).toBe(15);
  });

  it('projects 목록에 없는 프로젝트 작업은 제외한다', () => {
    const projects: Project[] = [{ id: 'p1', name: 'Alpha', startDate: '', endDate: '', progress: 0, status: 'todo' }];
    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        parentId: null,
        name: 'a',
        startDate: '',
        endDate: '',
        progress: 0,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 1,
      },
      {
        id: 't2',
        projectId: 'p99',
        parentId: null,
        name: 'x',
        startDate: '',
        endDate: '',
        progress: 0,
        assignee: 'Kim',
        status: 'todo',
        workEffort: 99,
      },
    ];
    const rows = computePersonWorkEffortAllocationsFromTasks(projects, tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalMd).toBe(1);
    expect(rows[0].totalEarnedMd).toBe(0);
    expect(rows[0].items).toHaveLength(1);
  });
});
