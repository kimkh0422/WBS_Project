import type { Project } from '../types';

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
