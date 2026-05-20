import type { OrgMember } from '../data/organization';

/** 높은 직급이 앞(작은 인덱스). 목록에 없는 직위는 맨 뒤로 보낸 뒤 이름순으로 정렬한다. */
const POSITION_ORDER = ['대표이사', '고문', '전무', '상무', '이사', '수석', '책임', '선임', '전임', '연구원', '사원'];

export function sortOrgMembersByPosition(members: OrgMember[]): OrgMember[] {
  const tail = POSITION_ORDER.length;
  return [...members].sort((a, b) => {
    const pa = POSITION_ORDER.indexOf((a.position || '').trim());
    const pb = POSITION_ORDER.indexOf((b.position || '').trim());
    const ia = pa === -1 ? tail : pa;
    const ib = pb === -1 ? tail : pb;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name, 'ko');
  });
}
