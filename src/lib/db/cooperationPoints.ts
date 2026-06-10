import { supabase, isSupabaseConfigured } from '../supabase';
import { isDevAuthBypass } from '../devAuthBypass';
import {
  fetchCooperationRequests,
  COOPERATION_REQUEST_PRIORITIES,
  type CooperationRequest,
  type CooperationRequestPriority,
} from './cooperationRequests';

/**
 * 중요도별 지급 포인트 — DB 함수 cooperation_point_value 와 짝
 * (마이그레이션 20260610150000_cooperation_points.sql). 값을 바꾸려면 양쪽을 같이 바꾼다.
 */
export const COOPERATION_POINTS_BY_PRIORITY: Record<CooperationRequestPriority, number> = { 상: 30, 중: 20, 하: 10 };

export function cooperationPointValue(priority: CooperationRequestPriority): number {
  return COOPERATION_POINTS_BY_PRIORITY[priority] ?? COOPERATION_POINTS_BY_PRIORITY.중;
}

/** 포인트 지급 1건(ledger 행). 지급·회수는 DB 트리거가 관리하고 클라이언트는 조회 전용. */
export type CooperationPointEntry = {
  id: string;
  requestId: string;
  memberName: string;
  memberDepartment: string;
  memberPosition: string;
  points: number;
  priority: CooperationRequestPriority;
  requestMgmtId: string;
  requestTitle: string;
  /** 지급 일시(ISO). 로컬 모드 즉석 계산에서는 YYYY-MM-DD 일 수 있음. */
  awardedAt: string;
};

/** 인원별 합산(현황 랭킹용). */
export type CooperationPointPersonSummary = {
  key: string;
  name: string;
  department: string;
  position: string;
  totalPoints: number;
  awardCount: number;
  lastAwardedAt: string;
};

const personKey = (name: string, department: string, position: string) => `${name}||${department}||${position}`;

function normalizePriority(v: unknown): CooperationRequestPriority {
  return (COOPERATION_REQUEST_PRIORITIES as readonly string[]).includes(v as string) ? (v as CooperationRequestPriority) : '중';
}

/**
 * 협조 요청 1건에서 '지급 대상' 집합을 계산 — DB reconcile_cooperation_points 와 동일 규칙:
 *   1) 멤버 본인 상태가 '확인완료' → 지급
 *   2) 요청 전체가 '확인완료' → 취소되지 않은 모든 담당 멤버 지급
 *   3) memberProgress 가 비어 있으면(레거시/단순 행) 요청 '확인완료' 시 assignee 텍스트 1건 지급
 * 로컬(dev 우회) 모드의 현황 계산과, 저장 직후 지급/회수 토스트 예측에 사용한다.
 */
export function deriveCooperationPointEntries(r: CooperationRequest): CooperationPointEntry[] {
  const points = cooperationPointValue(r.priority);
  const confirmed = r.status === '확인완료';
  const fallbackDate = r.completedDate || (r.updatedAt || '').slice(0, 10);
  const out = new Map<string, CooperationPointEntry>();
  const add = (name: string, department: string, position: string, completedAt: string) => {
    const key = personKey(name, department, position);
    if (out.has(key)) return;
    out.set(key, {
      id: `${r.id}|${key}`,
      requestId: r.id,
      memberName: name,
      memberDepartment: department,
      memberPosition: position,
      points,
      priority: r.priority,
      requestMgmtId: r.mgmtId,
      requestTitle: r.title,
      awardedAt: completedAt || fallbackDate,
    });
  };
  if (r.memberProgress.length > 0) {
    for (const m of r.memberProgress) {
      if (!m.name) continue;
      if (m.status === '확인완료' || (confirmed && m.status !== '취소됨')) add(m.name, m.department, m.position, m.completedAt);
    }
  } else if (confirmed && r.assignee.trim()) {
    add(r.assignee.trim(), '', '', '');
  }
  return Array.from(out.values());
}

type CooperationPointDbRow = {
  id: string;
  request_id: string;
  member_name: string;
  member_department: string | null;
  member_position: string | null;
  points: number | null;
  priority: string | null;
  request_mgmt_id: string | null;
  request_title: string | null;
  awarded_at: string;
};

function isLocalOnly(): boolean {
  return isDevAuthBypass() || !isSupabaseConfigured || !supabase;
}

/**
 * 지급 이력 전체(최신 지급 순).
 * - DB 모드: cooperation_points 테이블 조회. 테이블이 없으면(마이그레이션 미적용) 안내 메시지로 throw.
 * - 로컬(dev 우회) 모드: 현재 협조 요청 데이터에서 즉석 계산(지급 규칙 동일).
 */
export async function fetchCooperationPoints(): Promise<CooperationPointEntry[]> {
  if (isLocalOnly()) {
    const rows = await fetchCooperationRequests();
    return rows.flatMap(deriveCooperationPointEntries).sort((a, b) => (b.awardedAt || '').localeCompare(a.awardedAt || ''));
  }
  const { data, error } = await supabase!
    .from('cooperation_points')
    .select('id, request_id, member_name, member_department, member_position, points, priority, request_mgmt_id, request_title, awarded_at')
    .order('awarded_at', { ascending: false });
  if (error) {
    // 42P01 = relation does not exist — 마이그레이션 미적용 환경 안내.
    if ((error as { code?: string }).code === '42P01') {
      throw new Error('포인트 테이블이 아직 없습니다. 마이그레이션 20260610150000_cooperation_points.sql 을 적용하세요.');
    }
    throw error;
  }
  return ((data ?? []) as CooperationPointDbRow[]).map((r) => ({
    id: r.id,
    requestId: r.request_id,
    memberName: r.member_name,
    memberDepartment: r.member_department ?? '',
    memberPosition: r.member_position ?? '',
    points: typeof r.points === 'number' && Number.isFinite(r.points) ? r.points : 0,
    priority: normalizePriority(r.priority),
    requestMgmtId: r.request_mgmt_id ?? '',
    requestTitle: r.request_title ?? '',
    awardedAt: r.awarded_at,
  }));
}

/** 인원별 합산 + 정렬(포인트 합 ↓ → 건수 ↓ → 이름 가나다). */
export function summarizeCooperationPoints(entries: CooperationPointEntry[]): CooperationPointPersonSummary[] {
  const map = new Map<string, CooperationPointPersonSummary>();
  for (const e of entries) {
    const key = personKey(e.memberName, e.memberDepartment, e.memberPosition);
    const cur = map.get(key);
    if (cur) {
      cur.totalPoints += e.points;
      cur.awardCount += 1;
      if ((e.awardedAt || '') > cur.lastAwardedAt) cur.lastAwardedAt = e.awardedAt || '';
    } else {
      map.set(key, {
        key,
        name: e.memberName,
        department: e.memberDepartment,
        position: e.memberPosition,
        totalPoints: e.points,
        awardCount: 1,
        lastAwardedAt: e.awardedAt || '',
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.totalPoints - a.totalPoints || b.awardCount - a.awardCount || a.name.localeCompare(b.name, 'ko'),
  );
}
