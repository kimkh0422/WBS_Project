import type { Project } from '../types';

export function isProjectPeriodDateUnset(date: string | undefined): boolean {
  return !(date || '').trim();
}

/** 시작일 또는 종료일이 비어 있는 프로젝트 */
export function hasUndeterminedProjectPeriod(project: Pick<Project, 'startDate' | 'endDate'>): boolean {
  return isProjectPeriodDateUnset(project.startDate) || isProjectPeriodDateUnset(project.endDate);
}

export function formatProjectPeriodDate(date: string | undefined, emptyLabel = '미정'): string {
  const raw = (date || '').trim();
  return raw || emptyLabel;
}

export function formatProjectPeriodRange(
  startDate: string | undefined,
  endDate: string | undefined,
  options?: { emptyLabel?: string; noDatesLabel?: string },
): string {
  const empty = options?.emptyLabel ?? '미정';
  const noDates = options?.noDatesLabel ?? '기간 미정';
  const hasStart = !isProjectPeriodDateUnset(startDate);
  const hasEnd = !isProjectPeriodDateUnset(endDate);
  if (!hasStart && !hasEnd) return noDates;
  return `${formatProjectPeriodDate(startDate, empty)} ~ ${formatProjectPeriodDate(endDate, empty)}`;
}

/** 배너·목록용: 어떤 날짜가 비었는지 요약 */
export function summarizeUndeterminedProjectPeriod(project: Pick<Project, 'startDate' | 'endDate'>): string {
  const missingStart = isProjectPeriodDateUnset(project.startDate);
  const missingEnd = isProjectPeriodDateUnset(project.endDate);
  if (missingStart && missingEnd) return '시작·종료 미정';
  if (missingStart) return '시작일 미정';
  return '종료일 미정';
}
