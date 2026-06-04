import type { Project, Task } from '../types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 저장값에 시간 접미사가 있어도 앞 10자만 검사해 YYYY-MM-DD를 반환 */
export function isoDatePrefix(s?: string | null): string | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const d = s.slice(0, 10);
  return YMD.test(d) ? d : undefined;
}

/**
 * 프로젝트에 설정된 기간과 작업들의 시작·종료일을 합친 최소·최대(표시·요약·프로젝트 기간 자동 확장에 공통 사용).
 */
export function envelopeProjectWithTaskDates(
  project: Pick<Project, 'startDate' | 'endDate'> | undefined,
  tasks: Array<Pick<Task, 'startDate' | 'endDate'>>,
): { startDate: string; endDate: string } | null {
  const days: string[] = [];
  const pS = isoDatePrefix(project?.startDate);
  const pE = isoDatePrefix(project?.endDate);
  if (pS) days.push(pS);
  if (pE) days.push(pE);
  for (const t of tasks) {
    const s = isoDatePrefix(t.startDate);
    const e = isoDatePrefix(t.endDate);
    if (s) days.push(s);
    if (e) days.push(e);
  }
  if (days.length === 0) return null;
  const startDate = days.reduce((a, b) => (a < b ? a : b));
  const endDate = days.reduce((a, b) => (a > b ? a : b));
  return { startDate, endDate };
}

/**
 * 프로젝트에 저장된 시작·종료가 모든 작업 일정을 덮도록 넓혀야 하면 그 값과 변경 여부를 반환.
 * (계약 기간이 작업보다 길면 유지, 작업이 더 나가면 확장)
 */
export function expandProjectStoredDatesToTaskSpan(
  project: Project | undefined,
  tasksInProject: Task[],
): { startDate: string; endDate: string; changed: boolean } | null {
  if (!project?.id) return null;
  const envelope = envelopeProjectWithTaskDates(project, tasksInProject);
  if (!envelope) return null;
  const origS = isoDatePrefix(project.startDate);
  const origE = isoDatePrefix(project.endDate);
  const changed = origS !== envelope.startDate || origE !== envelope.endDate;
  return { startDate: envelope.startDate, endDate: envelope.endDate, changed };
}

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
