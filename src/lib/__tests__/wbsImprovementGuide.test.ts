import { describe, expect, it } from 'vitest';
import { buildWbsImprovementGuide } from '../wbsImprovementGuide';
import type { Project, Task } from '../../types';
import type { StatusConfig } from '../wbsSettings';

const statuses: StatusConfig[] = [
  { id: 'todo', name: '할일', progress: 0 },
  { id: 'done', name: '완료', progress: 100 },
];

const baseProject = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: '테스트 프로젝트',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  pmName: 'PM',
  ...over,
});

describe('buildWbsImprovementGuide', () => {
  it('작업이 없으면 안내 한 단계를 반환한다', () => {
    const steps = buildWbsImprovementGuide([], new Map(), statuses);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toContain('없습니다');
  });

  it('프로젝트 기간 밖 일정이 최우선(critical)으로 잡힌다', () => {
    const project = baseProject({ startDate: '2026-06-01', endDate: '2026-06-30' });
    const tasks: Task[] = [
      {
        id: 'a',
        projectId: 'p1',
        parentId: null,
        name: '밖의 작업',
        startDate: '2026-01-02',
        endDate: '2026-01-10',
        progress: 0,
        assignee: '홍길동',
        status: 'todo',
      },
    ];
    const steps = buildWbsImprovementGuide(tasks, new Map([['p1', project]]), statuses, { refDateIso: '2026-06-15' });
    expect(steps[0].severity).toBe('critical');
    expect(steps[0].title).toContain('기간');
  });

  it('말단 담당 미지정은 medium 단계로 포함된다', () => {
    const project = baseProject();
    const tasks: Task[] = [
      {
        id: 'leaf',
        projectId: 'p1',
        parentId: null,
        name: '리프',
        startDate: '2026-06-01',
        endDate: '2026-06-20',
        progress: 0,
        assignee: '',
        status: 'todo',
      },
    ];
    const steps = buildWbsImprovementGuide(tasks, new Map([['p1', project]]), statuses, { refDateIso: '2026-06-02' });
    const assignStep = steps.find((s) => s.title.includes('담당'));
    expect(assignStep).toBeDefined();
    expect(assignStep!.severity).toBe('medium');
  });
});
