// 공수(workEffort)·투입비율 ↔ 일정(시작·종료·기간) 변환 유틸.
//
// schedule.ts 는 "일정은 날짜·선행관계로만 결정"(공수 미사용) 모델로 정리되어,
// 공수 기반 환산은 이 모듈로 분리한다. 과부하 분석/해소(workload.ts)처럼
// 공수·투입비율로 기간을 산정해야 하는 기능에서만 사용한다.

import { parseISO, format, isValid } from 'date-fns';
import type { ProjectAssignment } from '../types';
import { addBusinessDaysEx, subtractBusinessDaysEx, differenceInBusinessDaysEx, getKoreanHolidaysSet } from './calendar';

type TaskAssignment = ProjectAssignment;

/**
 * 총 투입비율(0~1) 계산. assignments가 없거나 비어 있으면 1 (100%)로 간주.
 */
export function getTotalAllocationRatio(assignments: TaskAssignment[] | undefined): number {
  if (!assignments || assignments.length === 0) return 1;
  const sum = assignments.reduce((s, a) => s + (a.allocationPercent || 0), 0);
  return Math.min(100, Math.max(0, sum)) / 100;
}

/**
 * 작업 공수(MD)와 투입비율로 소요 영업일 수 계산.
 * - 공수(workEffort) = Man-Day(MD): 100% 투입 시 1 영업일 = 1 MD (1인일, 하루 8시간 가정).
 * - 10% 투입이면 1 MD를 하려면 1/0.1 = 10 영업일 소요.
 * - duration = ceil(workEffort / totalAllocation). totalAllocation 0이면 workEffort 그대로.
 */
export function computeDurationBusinessDays(workEffort: number, assignments: TaskAssignment[] | undefined): number {
  if (!Number.isFinite(workEffort) || workEffort <= 0) return 0;
  const ratio = getTotalAllocationRatio(assignments);
  if (ratio <= 0) return Math.ceil(workEffort);
  return Math.ceil(workEffort / ratio);
}

/**
 * 시작일 + 작업공수 + 투입비율 → 종료일(영업일 기준) 계산.
 * 100% = 1 MD당 1 영업일, 10% = 1 MD당 10 영업일. 토·일·공휴일 제외. holidays 미지정 시 한국 공휴일 사용.
 */
export function computeEndDateFromEffort(
  startDate: string,
  workEffort: number,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
): string {
  const start = parseISO(startDate);
  if (!isValid(start)) return startDate;
  const days = computeDurationBusinessDays(workEffort, assignments);
  if (days <= 0) return startDate;
  const hol = holidays ?? getKoreanHolidaysSet(start.getFullYear() - 1, start.getFullYear() + 2);
  const end = addBusinessDaysEx(start, days - 1, hol);
  return format(end, 'yyyy-MM-dd');
}

/**
 * 종료일 + 기간(영업일) → 시작일 역산.
 * workEffort가 있으면 공수·투입비율로 기간 계산, 없으면 originalStart~originalEnd 기간 사용.
 */
export function computeStartDateFromEndDate(
  endDate: string,
  workEffort: number | undefined,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
  originalStart?: string,
  originalEnd?: string,
): string {
  const end = parseISO(endDate);
  if (!isValid(end)) return endDate;
  const hol = holidays ?? getKoreanHolidaysSet(end.getFullYear() - 1, end.getFullYear() + 2);
  let durationDays: number;
  if (typeof workEffort === 'number' && workEffort > 0) {
    durationDays = Math.max(1, computeDurationBusinessDays(workEffort, assignments));
  } else if (originalStart && originalEnd) {
    const s = parseISO(originalStart);
    const e = parseISO(originalEnd);
    durationDays = isValid(s) && isValid(e) ? Math.max(1, differenceInBusinessDaysEx(s, e, hol)) : 1;
  } else {
    return endDate; // 기간 없으면 역산 불가
  }
  const start = subtractBusinessDaysEx(end, durationDays - 1, hol);
  return format(start, 'yyyy-MM-dd');
}

/**
 * 시작일·종료일 + 투입비율 → 작업 공수(MD) 역산.
 * 투입공수(MD) = 영업일 수 × (투입비율/100). 100% 1일 = 1 MD. 토·일·공휴일 제외. holidays 미지정 시 한국 공휴일 사용.
 */
export function computeWorkEffortFromDates(
  startDate: string,
  endDate: string,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end)) return 0;
  const hol = holidays ?? getKoreanHolidaysSet(start.getFullYear() - 1, end.getFullYear() + 2);
  const businessDays = differenceInBusinessDaysEx(start, end, hol);
  if (businessDays <= 0) return 0;
  const ratio = getTotalAllocationRatio(assignments);
  return Math.round(businessDays * ratio * 10) / 10;
}
