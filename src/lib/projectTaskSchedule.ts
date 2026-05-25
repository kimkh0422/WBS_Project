import type { Project, Task } from '../types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function sliceYmd(s: string | undefined | null): string | null {
  if (s == null || s === '') return null;
  const y = String(s).slice(0, 10);
  return YMD.test(y) ? y : null;
}

/**
 * 작업 시작·종료일이 프로젝트에 설정된 일정 경계와 어긋나면 안내 문장을 반환합니다.
 * 프로젝트에 시작일·종료일이 모두 없으면 null(비교하지 않음). 한쪽만 있으면 그 경계만 검사합니다.
 */
export function getTaskScheduleOutsideProjectMessage(
  task: Pick<Task, 'startDate' | 'endDate'>,
  project: Pick<Project, 'startDate' | 'endDate'>,
): string | null {
  const tS = sliceYmd(task.startDate);
  const tE = sliceYmd(task.endDate);
  if (!tS || !tE) return null;

  let pS = sliceYmd(project.startDate);
  let pE = sliceYmd(project.endDate);
  if (pS && pE && pE < pS) {
    const x = pS;
    pS = pE;
    pE = x;
  }
  if (!pS && !pE) return null;

  if (pS && pE) {
    if (tS >= pS && tE <= pE) return null;
    return `작업 일정(${tS} ~ ${tE})이 프로젝트 기간(${pS} ~ ${pE})과 맞지 않습니다.`;
  }
  if (pS) {
    if (tS >= pS && tE >= pS) return null;
    return `작업 일정이 프로젝트 시작일(${pS})보다 앞섭니다.`;
  }
  if (pE) {
    if (tS <= pE && tE <= pE) return null;
    return `작업 일정이 프로젝트 종료일(${pE})을 넘습니다.`;
  }
  return null;
}
