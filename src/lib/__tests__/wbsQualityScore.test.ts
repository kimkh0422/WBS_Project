import { describe, expect, it } from 'vitest';
import { computeWbsQualityScore, wbsQualityGradeOf, wbsQualityChecksSummary } from '../wbsQualityScore';
import type { Project, Task } from '../../types';
import type { StatusConfig } from '../wbsSettings';

const statuses: StatusConfig[] = [
  { id: 'todo', name: '할일', progress: 0 },
  { id: 'done', name: '완료', progress: 100 },
];

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: '테스트 프로젝트',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  pmName: 'PM',
  ...over,
});

// 기본: 프로젝트 기간 내·담당자·산출물·선행 모두 충족하는 말단
const task = (over: Partial<Task>): Task => ({
  id: 'x',
  projectId: 'p1',
  parentId: null,
  name: '작업',
  startDate: '2026-06-01',
  endDate: '2026-06-20',
  progress: 0,
  assignee: '홍길동',
  status: 'todo',
  deliverables: '결과 문서',
  dependencies: ['dep'],
  ...over,
});

// 기준일을 모든 작업 시작 전으로 두면 '진척 최신화'·'계획대비 진척'은 N/A가 된다.
const REF_BEFORE = '2026-01-01';

const checkBy = (q: ReturnType<typeof computeWbsQualityScore>, key: string) => q.checks.find((c) => c.key === key)!;

describe('computeWbsQualityScore', () => {
  it('모든 항목 충족 시 100점·우수, 미시작 항목 점검은 N/A로 제외된다', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const q = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: REF_BEFORE });
    expect(q.score).toBe(100);
    expect(q.grade).toBe('excellent');
    expect(q.failTotal).toBe(0);
    // 시작 전이라 진척 관련 점검은 N/A(ratio null)이며 점수에서 제외
    expect(checkBy(q, 'progressFresh').ratio).toBeNull();
    expect(checkBy(q, 'scheduleAdherence').ratio).toBeNull();
    // 적용된 점검은 모두 충족
    expect(checkBy(q, 'assignee').ratio).toBe(1);
    expect(checkBy(q, 'dependencies').applicable).toBe(2);
  });

  it('담당자·산출물 일부 누락 시 가중 점수가 내려가고 등급이 양호가 된다', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', assignee: '', deliverables: '' })];
    const q = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: REF_BEFORE });
    // assignee 1/2, schedule 2/2, deliverables 1/2, dependencies 2/2, pm 1/1
    // 가중합 8, 충족 6.5 → 81점
    expect(q.score).toBe(81);
    expect(q.grade).toBe('good');
    expect(checkBy(q, 'assignee').passed).toBe(1);
    expect(checkBy(q, 'deliverables').passed).toBe(1);
    expect(q.failTotal).toBe(2);
  });

  it('부모 작업과 마일스톤은 말단 점검 모집단에서 제외된다', () => {
    const tasks: Task[] = [
      task({ id: 'P', deliverables: '', assignee: '', dependencies: [] }), // 부모
      task({ id: 'C', parentId: 'P' }), // 말단(충족)
      task({ id: 'M', isMilestone: true, assignee: '', deliverables: '', dependencies: [] }), // 마일스톤 말단
    ];
    const q = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: REF_BEFORE });
    // 말단·비마일스톤은 C 하나뿐 → assignee/산출물 모집단 1
    expect(checkBy(q, 'assignee').applicable).toBe(1);
    expect(checkBy(q, 'deliverables').applicable).toBe(1);
    // 말단 1개라 선행관계 점검은 N/A
    expect(checkBy(q, 'dependencies').ratio).toBeNull();
  });

  it('시작일 경과·진척 미반영 말단은 진척 최신화 점검에서 미충족으로 잡힌다', () => {
    const tasks = [task({ id: 'a', startDate: '2026-05-01', endDate: '2026-05-20', progress: 0 })];
    const q = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: '2026-06-02' });
    const fresh = checkBy(q, 'progressFresh');
    expect(fresh.applicable).toBe(1);
    expect(fresh.passed).toBe(0);
  });

  it('PM 미지정은 점수에 반영된다', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const withPm = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: REF_BEFORE });
    const noPm = computeWbsQualityScore(tasks, project({ pmName: '' }), statuses, { refDateIso: REF_BEFORE });
    expect(noPm.score).toBeLessThan(withPm.score!);
    expect(checkBy(noPm, 'pm').passed).toBe(0);
  });

  it('체크리스트 요약 문자열에 N/A 항목은 "해당없음"으로 표기된다', () => {
    const tasks = [task({ id: 'a' })]; // 말단 1개 → 선행관계 N/A
    const q = computeWbsQualityScore(tasks, project(), statuses, { refDateIso: REF_BEFORE });
    const summary = wbsQualityChecksSummary(q);
    expect(summary).toContain('선행관계 해당없음');
    expect(summary).toContain('담당자 지정 1/1');
  });
});

describe('wbsQualityGradeOf', () => {
  it('임계값 경계를 올바르게 매핑한다', () => {
    expect(wbsQualityGradeOf(100)).toBe('excellent');
    expect(wbsQualityGradeOf(90)).toBe('excellent');
    expect(wbsQualityGradeOf(89)).toBe('good');
    expect(wbsQualityGradeOf(75)).toBe('good');
    expect(wbsQualityGradeOf(74)).toBe('fair');
    expect(wbsQualityGradeOf(60)).toBe('fair');
    expect(wbsQualityGradeOf(59)).toBe('poor');
    expect(wbsQualityGradeOf(0)).toBe('poor');
  });
});
