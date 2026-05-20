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

/** 조직도 인원 1명분 표시 메타(소속·직급). 이름 키는 저장 담당자 문자열과 동일한 `OrgMember.name` */
export type PersonDisplayMeta = {
  department: string;
  position: string;
};

/**
 * 이름 → 소속·직급 메타. 화면 표시용.
 * 부서 또는 직급 중 하나라도 있을 때만 맵에 넣는다.
 */
export function buildOrgMemberDisplayMetaMap(orgMembers: OrgMember[] | undefined): Map<string, PersonDisplayMeta> {
  const m = new Map<string, PersonDisplayMeta>();
  for (const member of orgMembers ?? []) {
    if (!member?.name) continue;
    if (m.has(member.name)) continue;
    const department = (member.department || '').trim();
    const position = (member.position || '').trim();
    if (!department && !position) continue;
    m.set(member.name, { department, position });
  }
  return m;
}

export type FormatPersonDisplayOpts = {
  orgMetaByName?: Map<string, PersonDisplayMeta>;
  /** 조직 노드에 없을 때 프로필 등에서 온 소속 */
  fallbackDepartment?: string | null;
};

/**
 * 단일 인물 표기: `소속 이름 직급` (있는 항목만 공백으로 연결).
 * 콤마 구분 복수 담당자(예: "A, B")는 각각 포맷한 뒤 ", "로 이어 붙인다.
 */
export function formatPersonDisplay(name: string | undefined | null, opts?: FormatPersonDisplayOpts): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  const parts = trimmed
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((p) => formatPersonDisplay(p, opts)).join(', ');
  }
  const org = opts?.orgMetaByName?.get(trimmed);
  const dept = org?.department?.trim() || opts?.fallbackDepartment?.trim() || '' || '';
  const pos = org?.position?.trim() || '';
  const segments = [dept, trimmed, pos].filter(Boolean);
  if (segments.length === 1) return segments[0]!;
  return segments.join(' ');
}

/** 담당자 저장값(이름)에 소속·직급을 붙여 표시. 저장값은 이름(들)만 유지한다. */
export function formatAssigneeDisplay(name: string | undefined | null, orgMetaByName?: Map<string, PersonDisplayMeta>): string {
  return formatPersonDisplay(name, { orgMetaByName: orgMetaByName });
}

/**
 * 프로필 id → 화면용 표시 문자열(소속·이름·직급).
 * 필터·담당자 매칭용 `profileMap`은 별도로 평문 이름을 유지하고, 이 맵은 표시 전용으로 쓴다.
 */
export function buildProfileDisplayById(
  profiles: ReadonlyArray<{ id: string; email: string | null; full_name?: string | null; department?: string | null }>,
  orgMembers: OrgMember[] | undefined,
  ownerDisplayNames?: Readonly<Record<string, string>>,
): Record<string, string> {
  const meta = buildOrgMemberDisplayMetaMap(orgMembers);
  const out: Record<string, string> = {};
  for (const p of profiles) {
    const plain = (p.full_name && String(p.full_name).trim()) || p.email || '(이메일 없음)';
    out[p.id] = formatPersonDisplay(plain, { orgMetaByName: meta, fallbackDepartment: p.department });
  }
  if (ownerDisplayNames) {
    for (const [id, raw] of Object.entries(ownerDisplayNames)) {
      const plain = String(raw ?? '').trim();
      if (!plain) continue;
      out[id] = formatPersonDisplay(plain, { orgMetaByName: meta });
    }
  }
  return out;
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
