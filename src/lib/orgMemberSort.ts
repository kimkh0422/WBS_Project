import type { OrgMember } from '../data/organization';
import { UNASSIGNED_DIVISION_SPLIT_PREFIX, UNASSIGNED_PERSON_KEY } from './allocationDivisionInfer';

/** 높은 직급이 앞(작은 인덱스). 목록에 없는 직위는 맨 뒤로 보낸 뒤 이름순으로 정렬한다. */
const POSITION_ORDER = ['대표이사', '고문', '전무', '상무', '이사', '수석', '책임', '선임', '전임', '연구원', '사원'];

const POSITION_SORT_TAIL = POSITION_ORDER.length;

/** 직급 문자열 → 정렬 인덱스(작을수록 앞). 목록에 없으면 맨 뒤 구간. */
export function positionSortIndex(position: string | undefined | null): number {
  const p = (position ?? '').trim();
  const i = POSITION_ORDER.indexOf(p);
  return i === -1 ? POSITION_SORT_TAIL : i;
}

const UNSPECIFIED_ASSIGNEE = UNASSIGNED_PERSON_KEY;

function unassignedDisplayTier(name: string): 0 | 1 | 2 {
  if (name === UNSPECIFIED_ASSIGNEE) return 2;
  if (name.startsWith(UNASSIGNED_DIVISION_SPLIT_PREFIX)) return 1;
  return 0;
}

/**
 * 담당자 이름 두 개를 직급(조직도 기준) → 이름순으로 비교.
 * `(미지정)`은 항상 맨 뒤. `(미지정)::사업부id` 형태(담당 비어 있으나 사업부 추정)는 그 앞에 둔다.
 */
export function compareAssigneeByPositionThenName(nameA: string, nameB: string, getPosition: (name: string) => string | undefined): number {
  const ta = unassignedDisplayTier(nameA);
  const tb = unassignedDisplayTier(nameB);
  if (ta !== tb) return ta - tb;
  if (ta === 1) return nameA.localeCompare(nameB, 'ko');

  const aUn = nameA === UNSPECIFIED_ASSIGNEE;
  const bUn = nameB === UNSPECIFIED_ASSIGNEE;
  if (aUn && !bUn) return 1;
  if (bUn && !aUn) return -1;
  const ia = positionSortIndex(getPosition(nameA));
  const ib = positionSortIndex(getPosition(nameB));
  if (ia !== ib) return ia - ib;
  return nameA.localeCompare(nameB, 'ko');
}

export function sortOrgMembersByPosition(members: OrgMember[]): OrgMember[] {
  return [...members].sort((a, b) => {
    const ia = positionSortIndex(a.position);
    const ib = positionSortIndex(b.position);
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name, 'ko');
  });
}
