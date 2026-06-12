import { describe, expect, it } from 'vitest';
import { makeEmptyCooperationRequest, type CooperationMemberProgress, type CooperationRequest } from '../db/cooperationRequests';
import {
  COOPERATION_POINTS_BY_PRIORITY,
  deriveCooperationPointEntries,
  splitAssigneeNames,
  summarizeCooperationPoints,
} from '../db/cooperationPoints';

function req(overrides: Partial<CooperationRequest> = {}): CooperationRequest {
  return {
    ...makeEmptyCooperationRequest(),
    id: 'req-1',
    createdBy: null,
    createdAt: '2026-06-01T09:00:00Z',
    updatedAt: '2026-06-09T09:00:00Z',
    ...overrides,
  };
}

function member(overrides: Partial<CooperationMemberProgress> = {}): CooperationMemberProgress {
  return {
    name: '홍길동',
    department: '운영기술개발실',
    position: '책임',
    status: '요청완료',
    completedAt: '',
    sourceOrgIds: [],
    direct: true,
    ...overrides,
  };
}

describe('deriveCooperationPointEntries — DB reconcile 와 동일한 지급 규칙', () => {
  it('확인완료가 아니면 지급하지 않는다', () => {
    expect(deriveCooperationPointEntries(req({ status: '진행중', assignee: '홍길동' }))).toEqual([]);
    expect(deriveCooperationPointEntries(req({ status: '처리완료', memberProgress: [member({ status: '처리완료' })] }))).toEqual([]);
  });

  it('멤버 본인 상태가 확인완료면 요청 전체 상태와 무관하게 그 멤버에게 지급한다', () => {
    const entries = deriveCooperationPointEntries(
      req({
        status: '진행중',
        memberProgress: [
          member({ name: '홍길동', status: '확인완료', completedAt: '2026-06-08' }),
          member({ name: '이몽룡', status: '진행중' }),
        ],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].memberName).toBe('홍길동');
    expect(entries[0].awardedAt).toBe('2026-06-08');
  });

  it('요청 전체가 확인완료면 취소되지 않은 모든 멤버에게 지급한다', () => {
    const entries = deriveCooperationPointEntries(
      req({
        status: '확인완료',
        memberProgress: [
          member({ name: '홍길동', status: '처리완료' }),
          member({ name: '이몽룡', status: '요청완료' }),
          member({ name: '성춘향', status: '취소됨' }),
        ],
      }),
    );
    expect(entries.map((e) => e.memberName).sort()).toEqual(['이몽룡', '홍길동']);
  });

  it('memberProgress 가 비어 있으면(레거시) 요청 확인완료 시 assignee 이름별로 지급한다', () => {
    const entries = deriveCooperationPointEntries(req({ status: '확인완료', assignee: ' 김길용 ', completedDate: '2026-06-05' }));
    expect(entries).toHaveLength(1);
    expect(entries[0].memberName).toBe('김길용');
    expect(entries[0].awardedAt).toBe('2026-06-05');
  });

  it('레거시 assignee 에 여러 명이 있으면 한 덩어리가 아니라 각 사람에게 따로 지급한다', () => {
    const entries = deriveCooperationPointEntries(req({ status: '확인완료', assignee: '김길용, 홍길동·이몽룡', priority: '중' }));
    expect(entries.map((e) => e.memberName).sort()).toEqual(['김길용', '이몽룡', '홍길동']);
    expect(entries.every((e) => e.points === COOPERATION_POINTS_BY_PRIORITY.중)).toBe(true);
  });

  it('조직을 담당으로 지정한 요청은 조직 이름에 지급하지 않는다(담당자 미지정 시 지급 0)', () => {
    // assignee 텍스트에 조직 이름이 들어 있어도 assigneeOrgIds 가 있으면 레거시 폴백을 끈다.
    const entries = deriveCooperationPointEntries(
      req({
        status: '확인완료',
        assignee: '영업대표 - 공공사업, 영업대표 - 전략사업',
        assigneeOrgIds: ['sales-public', 'sales-strategic'],
      }),
    );
    expect(entries).toEqual([]);
  });

  it('조직 지정 후 담당자가 member_progress 로 지정되면 그 담당자에게 지급한다', () => {
    const entries = deriveCooperationPointEntries(
      req({
        status: '확인완료',
        assignee: '영업대표 - 공공사업',
        assigneeOrgIds: ['sales-public'],
        memberProgress: [member({ name: '김창민', department: '영업대표 - 공공부문', position: '상무', direct: true })],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].memberName).toBe('김창민');
  });

  it('포인트 양은 중요도 기준(상 30 / 중 20 / 하 10)', () => {
    for (const priority of ['상', '중', '하'] as const) {
      const entries = deriveCooperationPointEntries(req({ status: '확인완료', assignee: '김길용', priority }));
      expect(entries[0].points).toBe(COOPERATION_POINTS_BY_PRIORITY[priority]);
    }
  });

  it('같은 사람이 중복돼도 요청 1건당 1번만 지급한다', () => {
    const entries = deriveCooperationPointEntries(
      req({
        status: '확인완료',
        memberProgress: [member({ name: '홍길동' }), member({ name: '홍길동' })],
      }),
    );
    expect(entries).toHaveLength(1);
  });
});

describe('summarizeCooperationPoints — 인원별 합산·정렬', () => {
  it('여러 요청의 지급분을 인원별로 합산하고 포인트 합 내림차순으로 정렬한다', () => {
    const a = deriveCooperationPointEntries(
      req({ id: 'r1', status: '확인완료', priority: '상', memberProgress: [member({ name: '홍길동' }), member({ name: '이몽룡' })] }),
    );
    const b = deriveCooperationPointEntries(
      req({ id: 'r2', status: '확인완료', priority: '하', memberProgress: [member({ name: '홍길동', completedAt: '2026-06-09' })] }),
    );
    const summary = summarizeCooperationPoints([...a, ...b]);
    expect(summary).toHaveLength(2);
    expect(summary[0].name).toBe('홍길동');
    expect(summary[0].totalPoints).toBe(40); // 상 30 + 하 10
    expect(summary[0].awardCount).toBe(2);
    expect(summary[0].lastAwardedAt).toBe('2026-06-09');
    expect(summary[1].name).toBe('이몽룡');
    expect(summary[1].totalPoints).toBe(30);
  });

  it('부서·직위 스냅샷이 달라도(레거시 공백 등) 같은 이름이면 한 사람으로 합산한다', () => {
    const legacy = deriveCooperationPointEntries(req({ id: 'r1', status: '확인완료', priority: '하', assignee: '홍길동' }));
    const viaMember = deriveCooperationPointEntries(
      req({ id: 'r2', status: '확인완료', priority: '상', memberProgress: [member()], completedDate: '2026-06-09' }),
    );
    const summary = summarizeCooperationPoints([...viaMember, ...legacy]);
    expect(summary).toHaveLength(1);
    expect(summary[0].name).toBe('홍길동');
    expect(summary[0].totalPoints).toBe(40); // 하 10 + 상 30
    expect(summary[0].awardCount).toBe(2);
    // 표시용 부서·직위는 비어 있지 않은 스냅샷에서 채운다
    expect(summary[0].department).toBe('운영기술개발실');
    expect(summary[0].position).toBe('책임');
  });
});

describe('splitAssigneeNames — 레거시 assignee 텍스트 분해', () => {
  it('쉼표·세미콜론·슬래시·가운뎃점으로 나누고 공백·중복을 정리한다', () => {
    expect(splitAssigneeNames(' 김길용 , 홍길동; 이몽룡/성춘향 · 김길용 ')).toEqual(['김길용', '홍길동', '이몽룡', '성춘향']);
  });

  it("'외 N명' 꼬리표는 떼고 이름만 남긴다", () => {
    expect(splitAssigneeNames('김길용 외 2명')).toEqual(['김길용']);
    expect(splitAssigneeNames('운영기술개발실, 김길용 외 3명')).toEqual(['운영기술개발실', '김길용']);
  });

  it('빈 문자열·구분자만 있는 입력은 빈 배열', () => {
    expect(splitAssigneeNames('')).toEqual([]);
    expect(splitAssigneeNames(' , ; ')).toEqual([]);
  });
});
