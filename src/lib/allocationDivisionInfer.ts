import type { Project } from '../types';
import type { PersonDisplayMeta } from './assigneeOptions';
import { formatAssigneeDisplay } from './assigneeOptions';
import { resolveProjectPmRawDisplayName } from './projectPmDisplay';

/** WBS 담당이 비어 있을 때 집계용 가상 행 키: `(미지정)::` + 최상위 사업부 id */
export const UNASSIGNED_DIVISION_SPLIT_PREFIX = '(미지정)::';

export const UNASSIGNED_PERSON_KEY = '(미지정)';

export function isUnassignedDivisionSplitPersonKey(person: string): boolean {
  return person.startsWith(UNASSIGNED_DIVISION_SPLIT_PREFIX);
}

export function parseDivisionIdFromUnassignedSplitKey(person: string): string | null {
  if (!isUnassignedDivisionSplitPersonKey(person)) return null;
  const id = person.slice(UNASSIGNED_DIVISION_SPLIT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/** 프로젝트 투입(월별)·상세 패널 조회 시 assignments 키로 쓸 담당자 문자열 */
export function allocationAssigneeStorageKey(person: string): string {
  return isUnassignedDivisionSplitPersonKey(person) ? UNASSIGNED_PERSON_KEY : person;
}

export type AllocationDivisionInferInput = {
  memberToDivisionId: Map<string, string>;
  departmentNameToDivisionId: Map<string, string>;
  profileMap?: Record<string, string>;
  ownerDepartmentByUserId?: Record<string, string | null | undefined>;
};

/**
 * 프로젝트가 속한 최상위 사업부(본부) id를 추론한다.
 * PM 이름 → PO 이름 → 소유자 프로필 부서(조직도 부서 문자열과 일치) 순.
 */
export function inferProjectTopDivisionId(project: Project, ctx: AllocationDivisionInferInput): string | undefined {
  const tryMember = (nameRaw: string | undefined) => {
    const name = (nameRaw ?? '').trim();
    if (!name) return undefined;
    return ctx.memberToDivisionId.get(name);
  };

  const fromPmExplicit = tryMember(project.pmName);
  if (fromPmExplicit) return fromPmExplicit;

  const pmResolved = tryMember(resolveProjectPmRawDisplayName(project, ctx.profileMap));
  if (pmResolved) return pmResolved;

  const fromPo = tryMember(project.poName);
  if (fromPo) return fromPo;

  const oid = project.ownerId;
  if (oid && ctx.ownerDepartmentByUserId && ctx.departmentNameToDivisionId.size > 0) {
    const dept = (ctx.ownerDepartmentByUserId[oid] ?? '').trim();
    if (dept) {
      const direct = ctx.departmentNameToDivisionId.get(dept);
      if (direct) return direct;
      const lower = dept.toLowerCase();
      for (const [k, v] of ctx.departmentNameToDivisionId) {
        if (k.toLowerCase() === lower) return v;
      }
    }
  }

  return undefined;
}

/** 대시보드 인원·공수 행 제목: 사업부 추정 `(미지정)::id` 행은 읽기 쉬운 문구로 바꿉니다. */
export function formatPersonWorkEffortRowDisplay(
  person: string,
  displayMetaByName: Map<string, PersonDisplayMeta>,
  divisionNameById: Map<string, string> | undefined,
): string {
  const id = parseDivisionIdFromUnassignedSplitKey(person);
  if (id) {
    const dept = divisionNameById?.get(id);
    return dept ? `담당 미지정 · ${dept}` : '담당 미지정 (사업부 추정)';
  }
  return formatAssigneeDisplay(person, displayMetaByName);
}
