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
 * 레거시 assignee 텍스트를 개인 이름들로 분해 — 포인트는 항상 '사람 단위'로 지급하기 위함.
 * 쉼표·세미콜론·슬래시·가운뎃점 구분, 각 토큰의 '외 N명' 꼬리표 제거.
 * DB reconcile_cooperation_points(마이그레이션 20260612100000) 의 regexp 규칙과 짝 — 같이 바꾼다.
 */
export function splitAssigneeNames(assignee: string): string[] {
  const out: string[] = [];
  for (const raw of assignee.split(/[,;/·]/)) {
    const name = raw.replace(/\s*외\s*\d+\s*명$/, '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 협조 요청 1건에서 '지급 대상' 집합을 계산 — DB reconcile_cooperation_points 와 동일 규칙:
 *   1) 멤버 본인 상태가 '확인완료' → 지급
 *   2) 요청 전체가 '확인완료' → 취소되지 않은 모든 담당 멤버(member_progress) 지급
 *   3) memberProgress 가 비어 있고 **조직 지정도 없는**(assigneeOrgIds 비어 있음) 순수 레거시 행만
 *      요청 '확인완료' 시 assignee 텍스트를 개인 이름으로 분해해(splitAssigneeNames) 각 사람에게 지급
 *
 * 포인트는 항상 '사람'에게만 간다 — 조직(부서)을 담당으로 지정한 요청은 그 조직 이름으로 지급하지 않는다.
 * 조직 지정 워크플로: 조직 지정 → 팀장/사업부장이 담당자를 member_progress 로 지정 → 그 담당자에게 지급.
 * 담당자가 지정되기 전(member_progress 비어 있음)에는 지급 대상이 없다.
 *
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
  } else if (confirmed && r.assigneeOrgIds.length === 0) {
    // 조직 지정이 없는 순수 레거시(엑셀 가져오기 등) 행만 assignee 텍스트로 지급.
    // 조직이 지정된 요청은 담당자가 member_progress 로 지정되어야 그 담당자에게 지급된다(조직엔 미지급).
    for (const name of splitAssigneeNames(r.assignee)) add(name, '', '', '');
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

/**
 * 인원별 합산 + 정렬(포인트 합 ↓ → 건수 ↓ → 이름 가나다).
 * 묶음 키는 '이름'만 사용 — 부서·직위는 지급 당시 스냅샷이라 조직 개편·레거시 공백으로 달라질 수 있고,
 * 그때마다 같은 사람이 여러 줄로 갈라지면 인원별 현황이 깨진다(동명이인 합산보다 훨씬 흔한 문제).
 * 부서·직위 표시는 비어 있지 않은 첫 항목 — fetch가 최신 지급 순으로 주므로 최신 스냅샷이 잡힌다.
 */
export function summarizeCooperationPoints(entries: CooperationPointEntry[]): CooperationPointPersonSummary[] {
  const map = new Map<string, CooperationPointPersonSummary>();
  for (const e of entries) {
    const key = e.memberName.trim();
    const cur = map.get(key);
    if (cur) {
      cur.totalPoints += e.points;
      cur.awardCount += 1;
      if ((e.awardedAt || '') > cur.lastAwardedAt) cur.lastAwardedAt = e.awardedAt || '';
      if (!cur.department && e.memberDepartment) cur.department = e.memberDepartment;
      if (!cur.position && e.memberPosition) cur.position = e.memberPosition;
    } else {
      map.set(key, {
        key,
        name: key,
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
