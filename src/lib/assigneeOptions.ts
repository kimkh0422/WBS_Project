import type { OrgMember } from '../data/organization';
import type { Project, Task } from '../types';

/**
 * 담당자 자동완성 후보를 한 곳에서 생성한다.
 *
 * 우선순위: 조직 회원 > 프로젝트 등록 인원(assignments) > 작업의 기존 담당자 > 호출자가 지정한 extra(현재 값 등).
 * 중복 제거 + 한국어 정렬(localeCompare 'ko')된 결과를 반환한다.
 */
export function buildAssigneeCandidates(opts: {
  orgMembers?: OrgMember[];
  projects?: Project[];
  tasks?: Task[];
  /** 지정 시 해당 프로젝트의 작업·assignments만 후보에 포함 */
  projectId?: string;
  /** 추가로 포함할 이름들 (예: 현재 입력 값, 부모 작업 담당자) */
  extra?: string[];
}): string[] {
  const set = new Set<string>();
  for (const m of opts.orgMembers ?? []) {
    if (m.name) set.add(m.name);
  }
  for (const p of opts.projects ?? []) {
    if (opts.projectId && p.id !== opts.projectId) continue;
    for (const a of p.assignments ?? []) {
      if (a.assignee) set.add(a.assignee);
    }
  }
  for (const t of opts.tasks ?? []) {
    if (opts.projectId && t.projectId !== opts.projectId) continue;
    if (t.assignee) set.add(t.assignee);
  }
  for (const x of opts.extra ?? []) {
    if (x) set.add(x);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
}

/**
 * 이름 → "부서 · 직위" 라벨 맵.
 * datalist `<option label>` 또는 hover 표시에 사용한다.
 */
export function buildOrgMemberLabelMap(orgMembers: OrgMember[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const member of orgMembers ?? []) {
    if (!member?.name) continue;
    if (m.has(member.name)) continue;
    const dept = member.department || '';
    const pos = member.position || '';
    const label = [dept, pos].filter(Boolean).join(' · ');
    if (label) m.set(member.name, label);
  }
  return m;
}
