import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import { inferProjectTopDivisionId, UNASSIGNED_PERSON_KEY } from '../allocationDivisionInfer';
import { splitUnassignedPersonWorkEffortByInferredDivision, type PersonWorkEffortAllocation } from '../personAllocations';

describe('inferProjectTopDivisionId', () => {
  it('PM 이름이 조직에 있으면 해당 사업부 id를 반환한다', () => {
    const memberToDivisionId = new Map([['홍길동', 'div-a']]);
    const departmentNameToDivisionId = new Map<string, string>();
    const project = { id: 'p1', name: 'P', pmName: '홍길동' } as Project;
    expect(inferProjectTopDivisionId(project, { memberToDivisionId, departmentNameToDivisionId })).toBe('div-a');
  });

  it('소유자 부서 문자열이 조직도 부서와 일치하면 사업부 id를 반환한다', () => {
    const memberToDivisionId = new Map<string, string>();
    const departmentNameToDivisionId = new Map([['운영기술개발실', 'div-x']]);
    const project = { id: 'p1', name: 'P', ownerId: 'u1' } as Project;
    expect(
      inferProjectTopDivisionId(project, {
        memberToDivisionId,
        departmentNameToDivisionId,
        ownerDepartmentByUserId: { u1: '운영기술개발실' },
      }),
    ).toBe('div-x');
  });
});

describe('splitUnassignedPersonWorkEffortByInferredDivision', () => {
  it('(미지정) 행을 사업부별로 나눈다', () => {
    const pA = { id: 'pa', name: 'A', pmName: 'PM1' } as Project;
    const pB = { id: 'pb', name: 'B', ownerId: 'o1' } as Project;
    const rows: PersonWorkEffortAllocation[] = [
      {
        person: UNASSIGNED_PERSON_KEY,
        items: [
          { project: pA, workEffortMd: 10, earnedEffortMd: 2 },
          { project: pB, workEffortMd: 5, earnedEffortMd: 1 },
        ],
        totalMd: 15,
        totalEarnedMd: 3,
      },
    ];
    const ctx = {
      memberToDivisionId: new Map([['PM1', 'd1']]),
      departmentNameToDivisionId: new Map([['개발팀', 'd2']]),
      ownerDepartmentByUserId: { o1: '개발팀' },
    };
    const out = splitUnassignedPersonWorkEffortByInferredDivision(rows, ctx);
    expect(out).toHaveLength(2);
    const keys = new Set(out.map((r) => r.person));
    expect(keys.has('(미지정)::d1')).toBe(true);
    expect(keys.has('(미지정)::d2')).toBe(true);
    expect(out.find((r) => r.person === '(미지정)::d1')?.totalEarnedMd).toBe(2);
    expect(out.find((r) => r.person === '(미지정)::d2')?.totalEarnedMd).toBe(1);
  });
});
