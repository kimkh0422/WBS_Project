import membersJson from './organizationMembers.json';

/**
 * 조직 데이터(부서 트리 + 인원).
 *
 * 주: 이 파일은 더 이상 런타임에서 직접 소비하지 않는다.
 * - DB 마이그레이션 `20260430120000_add_organization_tables.sql` + `20260430120001_seed_organization.sql`로 데이터가 Supabase에 적재된다.
 * - 앱은 `<OrganizationProvider>` (src/context/OrganizationContext.tsx)에서 DB를 조회해 사용한다.
 * - 이 파일은 (a) 시드 데이터의 단일 소스 (b) DB 미연결/미시드 상황 폴백으로 유지된다.
 *   조직 변경 시 이 파일을 수정한 뒤 `node scripts/build-org-seed-sql.cjs`로 시드 SQL을 재생성한다.
 */

export interface OrgMember {
  name: string;
  department: string;
  position: string;
  gender: string;
  /** 메일 발송 수신 주소(선택). 비어 있으면 자동 메일 미발송. */
  email?: string;
}

export interface OrgNode {
  id: string;
  name: string;
  /** 이 노드에 직접 매핑되는 엑셀의 부서명. 자식 노드의 합과는 별개로 "직속" 인원으로 잡힌다. */
  departments?: string[];
  children?: OrgNode[];
}

export const ORG_MEMBERS: OrgMember[] = membersJson as OrgMember[];

/**
 * 참고 UI 트리. 엑셀 부서명 → 노드 매핑.
 * - 자식 노드를 갖는 상위 노드도 직속 인원(`departments`)을 가질 수 있다.
 *   예) `모빌리티사업부`(직속) + `모빌리티사업1팀` + `모빌리티사업2팀`
 */
export const ORG_TREE: OrgNode = {
  id: 'gmt',
  name: '(주)지엠티',
  children: [
    {
      id: 'gmt-root',
      name: '지엠티',
      children: [
        { id: 'ceo', name: 'CEO', departments: ['CEO'] },
        {
          id: 'mgmt-strategy',
          name: '경영전략본부',
          children: [
            { id: 'mgmt-support', name: '경영지원팀', departments: ['경영지원팀'] },
            { id: 'purchasing', name: '구매팀', departments: ['구매팀'] },
            { id: 'rnd-support', name: 'R&D지원팀', departments: ['R&D지원팀'] },
          ],
        },
        { id: 'sales-public', name: '영업대표 - 공공사업', departments: ['영업대표 - 공공부문'] },
        { id: 'sales-strategic', name: '영업대표 - 전략사업', departments: ['영업대표 - 전략사업'] },
        { id: 'ai-lab', name: 'AI개발실', departments: ['AI개발실'] },
        { id: 'advisor', name: '자문위원', departments: ['자문위원'] },
        { id: 'op-tech', name: '운영기술개발실', departments: ['운영기술개발실'] },
        { id: 'strategy-plan', name: '전략기획실', departments: ['전략기획실'] },
        { id: 'energy', name: '에너지 사업부', departments: ['에너지사업부'] },
        { id: 'mobility-dev', name: '모빌리티개발팀', departments: ['모빌리티개발팀'] },
        {
          id: 'mobility-biz',
          name: '모빌리티사업부',
          departments: ['모빌리티사업부'],
          children: [
            { id: 'mobility-1', name: '모빌리티사업1팀', departments: ['모빌리티사업1팀'] },
            { id: 'mobility-2', name: '모빌리티사업2팀', departments: ['모빌리티사업2팀'] },
          ],
        },
        {
          id: 'navcomm',
          name: '항해통신 사업부',
          departments: ['항해통신사업부'],
          children: [
            { id: 'navcomm-1', name: '항해통신 사업1팀', departments: ['항해통신사업1팀'] },
            { id: 'navcomm-2', name: '항해통신 사업2팀', departments: ['항해통신사업2팀'] },
          ],
        },
        {
          id: 'navctrl',
          name: '항행관제 사업부',
          departments: ['항행관제사업부'],
          children: [
            { id: 'navctrl-1', name: '항행관제 사업1팀', departments: ['항행관제사업1팀'] },
            { id: 'navctrl-2', name: '항행관제 사업2팀', departments: ['항행관제사업2팀'] },
          ],
        },
        { id: 'solution', name: '솔루션 사업부', departments: ['솔루션사업부'] },
        {
          id: 'ict',
          name: 'ICT 사업부',
          departments: ['ICT사업부'],
          children: [
            { id: 'sm', name: 'SM 사업팀', departments: ['SM사업팀'] },
            { id: 'si', name: 'SI 사업팀', departments: ['SI사업팀'] },
          ],
        },
        {
          id: 'smart-marine',
          name: '지능형해상교통사업부',
          departments: ['지능형해상교통사업부'],
          children: [
            { id: 'biz-plan', name: '사업기획팀', departments: ['사업기획팀'] },
            { id: 'biz-exec', name: '사업수행팀', departments: ['사업수행팀'] },
          ],
        },
        {
          id: 'tech-dev',
          name: '기술 개발본부',
          departments: ['기술개발본부'],
          children: [
            { id: 'vision', name: '비전개발센터', departments: ['비전개발센터'] },
            { id: 'platform', name: '플랫폼개발센터', departments: ['플랫폼개발센터'] },
            {
              id: 'app-tech',
              name: '응용기술 개발센터',
              departments: ['응용기술개발센터'],
              children: [
                { id: 'app-dev-1', name: '응용 개발1팀', departments: ['응용개발1팀'] },
                { id: 'app-dev-2', name: '응용 개발2팀', departments: ['응용개발2팀'] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** 노드의 직속 부서에 속한 멤버. 자식 노드 멤버는 포함하지 않는다. */
export function getDirectMembers(node: OrgNode): OrgMember[] {
  if (!node.departments || node.departments.length === 0) return [];
  const set = new Set(node.departments);
  return ORG_MEMBERS.filter((m) => set.has(m.department));
}

/** 노드 + 모든 하위 노드를 포함한 총 인원 수. */
export function countMembersDeep(node: OrgNode): number {
  let total = getDirectMembers(node).length;
  for (const child of node.children ?? []) total += countMembersDeep(child);
  return total;
}
