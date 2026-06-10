import { describe, expect, it } from 'vitest';
import { makeEmptyCooperationRequest, type CooperationMemberProgress, type CooperationRequest } from '../db/cooperationRequests';
import { COOPERATION_POINTS_BY_PRIORITY, deriveCooperationPointEntries, summarizeCooperationPoints } from '../db/cooperationPoints';

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

  it('memberProgress 가 비어 있으면(레거시) 요청 확인완료 시 assignee 1건으로 지급한다', () => {
    const entries = deriveCooperationPointEntries(req({ status: '확인완료', assignee: ' 김길용 ', completedDate: '2026-06-05' }));
    expect(entries).toHaveLength(1);
    expect(entries[0].memberName).toBe('김길용');
    expect(entries[0].awardedAt).toBe('2026-06-05');
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
});
