import { parseISO, differenceInCalendarDays, addDays, format, isValid } from 'date-fns';

/**
 * 기간(duration) 컬럼 전용 날짜 계산.
 *
 * 공수(workEffort)·간트의 영업일 계산과 달리, 기간은 **순수 달력일 산술**로 다룬다.
 * - 표시: 시작일~종료일을 양 끝 포함(inclusive)으로 센 일수. (같은 날 = 1일)
 * - 편집: 시작일을 기준으로 `시작일 + (기간-1)`일을 종료일로 역산.
 *
 * 기본 기간은 5일 — 신규 작업 기본 종료일과 동일한 폭이며
 * {@link import('./workEffortUnits').defaultEndDateForNewTask}과 같은 규약(시작일 + 4일)을 따른다.
 */
export const DEFAULT_TASK_DURATION_DAYS = 5;

/** YYYY-MM-DD(또는 시간 접미사 포함) 문자열에서 날짜 부분만 Date로 파싱. 잘못된 값이면 null. */
function parseDatePart(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = parseISO(iso.slice(0, 10));
  return isValid(d) ? d : null;
}

/**
 * 시작일~종료일 사이의 기간을 양 끝 포함 달력일 수로 반환.
 * 두 날짜가 모두 유효하고 종료일 >= 시작일일 때만 1 이상의 값을 주고, 그 외에는 null.
 */
export function inclusiveCalendarDays(startIso: string | null | undefined, endIso: string | null | undefined): number | null {
  const s = parseDatePart(startIso);
  const e = parseDatePart(endIso);
  if (!s || !e) return null;
  const diff = differenceInCalendarDays(e, s);
  if (diff < 0) return null;
  return diff + 1;
}

/**
 * 시작일과 기간(양 끝 포함 달력일)으로 종료일(YYYY-MM-DD)을 역산.
 * 시작일이 잘못됐거나 기간이 1 미만이면 빈 문자열을 반환(호출부에서 무시).
 */
export function endYmdFromInclusiveDuration(startIso: string, days: number): string {
  const s = parseDatePart(startIso);
  if (!s || !Number.isFinite(days) || days < 1) return '';
  const end = addDays(s, Math.round(days) - 1);
  return format(end, 'yyyy-MM-dd');
}
