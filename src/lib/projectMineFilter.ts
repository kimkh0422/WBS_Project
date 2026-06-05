import type { Project } from '../types';

/**
 * 헤더·프로젝트 관리·보내기 등「내 프로젝트만」필터에 쓰는 기준.
 * - 소유자(ownerId)가 본인이거나
 * - PM 이름이 회원 프로필의 본명(plain)과 같으면 포함 (조직도 분류와 동일한 PM 문자열 기준)
 */
export function isProjectMineForUserListFilter(
  project: Project,
  userId: string | undefined,
  currentUserPlainName: string | undefined,
): boolean {
  if (!userId) return false;
  if (project.ownerId === userId) return true;
  const pm = (project.pmName ?? '').trim();
  const plain = (currentUserPlainName ?? '').trim();
  if (!pm || !plain) return false;
  return pm === plain;
}
