/**
 * 협조 요청 알림 계산 — NotificationBell 에서 작업 알림과 함께 표시한다.
 *
 * 대상 항목 판정:
 *   - 현재 사용자의 plain name 이 memberProgress 의 어느 항목과 일치
 *     (직접 추가된 인원이든, 조직 자동 멤버이든 무관)
 *   - 또는 해당 멤버 행의 개인 상태가 '완료' / '회신불가' 가 아님
 *   - 추가로 해당 요청 전체 상태가 '완료' / '회신불가' 가 아닐 것
 *
 * 표시 우선순위(기한 기반):
 *   - overdue(기한 초과) → 가장 위
 *   - due-soon(D-3 이내) → 그다음
 *   - normal(아직 여유) → 마지막
 *
 * 알림 id 규칙: `coop-<requestId>` (사용자가 "확인(X)" 누르면 localStorage 에 저장돼 다음 로드 시 숨김).
 */
import type { CooperationRequest, CooperationRequestStatus } from '../db/cooperationRequests';

export type CooperationNotification = {
  id: string;
  /** 클릭 시 이동 대상 요청 ID (현재는 대시보드 섹션 스크롤만, 후속에 상세 모달로 확장 가능) */
  requestId: string;
  title: string;
  /** 조직 이름 또는 "조직 외 N건" 등 표시용 */
  context: string;
  type: 'overdue' | 'due-soon' | 'normal';
  /** "3일 초과" / "D-2" / "오늘 마감" / "기한 없음" 등 표시 문자열 */
  daysInfo: string;
  /** 기한(없으면 빈 문자열) */
  dueDate: string;
  /** 멤버 단위 개인 상태 — 토스트·뱃지 색깔 결정용 */
  memberStatus: CooperationRequestStatus;
};

const DONE_STATUSES: ReadonlySet<CooperationRequestStatus> = new Set<CooperationRequestStatus>(['처리완료', '확인완료', '취소됨']);

/** 두 이름이 같은 사람인지 단순 비교. 트림·앞뒤 공백 제거 후 일치. */
function nameMatches(a: string, b: string): boolean {
  return a.trim().length > 0 && a.trim() === b.trim();
}

/** D-day 계산 (기한 - 오늘). 음수 = 초과. */
function diffDays(dueIso: string, todayIso: string): number {
  if (!dueIso) return Number.POSITIVE_INFINITY;
  const due = new Date(dueIso);
  const today = new Date(todayIso);
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function computeCooperationNotifications(
  requests: CooperationRequest[],
  currentUserPlainName: string,
  todayIso: string,
): CooperationNotification[] {
  if (!currentUserPlainName) return [];
  const items: CooperationNotification[] = [];

  for (const r of requests) {
    if (DONE_STATUSES.has(r.status)) continue;
    const me = r.memberProgress.find((m) => nameMatches(m.name, currentUserPlainName));
    if (!me) continue;
    if (DONE_STATUSES.has(me.status)) continue;

    const d = diffDays(r.dueDate, todayIso);
    let type: CooperationNotification['type'] = 'normal';
    let daysInfo = '기한 없음';
    if (Number.isFinite(d)) {
      if (d < 0) {
        type = 'overdue';
        daysInfo = `${Math.abs(d)}일 초과`;
      } else if (d <= 3) {
        type = 'due-soon';
        daysInfo = d === 0 ? '오늘 마감' : `D-${d}`;
      } else {
        daysInfo = `D-${d}`;
      }
    }

    // context: 다중 조직 + 인원 혼합도 잘 표현하도록 assignee 문자열 그대로 사용
    const context = r.assignee || (r.assigneeOrgIds[0] ?? '');

    items.push({
      id: `coop-${r.id}`,
      requestId: r.id,
      title: r.title || '(제목 없음)',
      context,
      type,
      daysInfo,
      dueDate: r.dueDate,
      memberStatus: me.status,
    });
  }

  // 우선순위: overdue → due-soon → normal, 동순위면 기한 빠른 순(없으면 뒤로).
  const order: Record<CooperationNotification['type'], number> = { overdue: 0, 'due-soon': 1, normal: 2 };
  items.sort((a, b) => {
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.title.localeCompare(b.title, 'ko');
  });

  return items;
}
