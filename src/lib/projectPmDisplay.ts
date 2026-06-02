import type { Project } from '../types';

/** 프로젝트 소유자(만든 사람) 표시명. `ownerId`·프로필이 없으면 빈 문자열 */
export function resolveProjectOwnerDisplayName(project: Pick<Project, 'ownerId'>, profileMap?: Readonly<Record<string, string>>): string {
  const oid = project.ownerId?.trim();
  if (!oid) return '';
  const fromProfile = profileMap?.[oid]?.trim();
  if (fromProfile) return fromProfile;
  return `사용자 (${oid.slice(0, 8)}…)`;
}

/**
 * 대시보드 등에서 PM으로 쓸 표시 이름.
 * `pmName`이 비어 있으면 프로젝트 소유자(일반적으로 만든 사람)의 프로필 표시명을 사용한다.
 */
export function resolveProjectPmRawDisplayName(
  project: Pick<Project, 'pmName' | 'ownerId'>,
  profileMap?: Readonly<Record<string, string>>,
): string {
  const explicit = project.pmName?.trim();
  if (explicit) return explicit;
  const oid = project.ownerId;
  if (!oid) return '';
  const fromProfile = profileMap?.[oid]?.trim();
  if (fromProfile) return fromProfile;
  return `사용자 (${oid.slice(0, 8)}…)`;
}

/** 투입 담당자 키(저장된 assignee 문자열)가 프로젝트 PM 표시명과 같은지 — `PersonAllocationDetailPanel` 등과 동일 규칙 */
export function isAssigneeProjectPm(
  assigneeKey: string,
  project: Pick<Project, 'pmName' | 'ownerId'>,
  profileMap?: Readonly<Record<string, string>>,
): boolean {
  const t = assigneeKey.trim();
  if (!t || t === '(미지정)') return false;
  return resolveProjectPmRawDisplayName(project, profileMap).trim() === t;
}

/** 투입 담당자 키가 프로젝트 PO 이름과 같은지(PO 미입력이면 false) */
export function isAssigneeProjectPo(assigneeKey: string, project: Pick<Project, 'poName'>): boolean {
  const t = assigneeKey.trim();
  if (!t || t === '(미지정)') return false;
  const po = (project.poName ?? '').trim();
  return Boolean(po && po === t);
}
