import type { OrgMember } from '../data/organization';

/** 조직현황 이름 매칭용 — 공백 정규화 */
export function normalizePersonName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

/** 조직현황 인원 목록 → 이름(정규화) → 부서 */
export function buildOrgDepartmentByNameMap(orgMembers: OrgMember[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of orgMembers ?? []) {
    const key = normalizePersonName(m.name);
    const dept = (m.department ?? '').trim();
    if (!key || !dept || map.has(key)) continue;
    map.set(key, dept);
  }
  return map;
}

/** 회원명으로 조직현황 부서 조회. 없으면 null */
export function lookupOrgDepartment(fullName: string | null | undefined, map: Map<string, string>): string | null {
  const key = normalizePersonName(fullName);
  if (!key) return null;
  return map.get(key) ?? null;
}

/** 프로필 저장값 우선, 없으면 조직현황 부서 */
export function resolveMemberDepartment(
  savedDepartment: string | null | undefined,
  fullName: string | null | undefined,
  orgDeptByName: Map<string, string>,
): string {
  const saved = (savedDepartment ?? '').trim();
  if (saved) return saved;
  return lookupOrgDepartment(fullName, orgDeptByName) ?? '';
}
