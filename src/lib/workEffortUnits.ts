import type { Project, Task, WorkEffortUnit } from '../types';
import { formatNum2 } from './utils';

export const DEFAULT_WORK_EFFORT_UNIT: WorkEffortUnit = 'day';

/** 신규 작업 등에서 쓰는 저장 공수 기본값 (프로젝트 `workEffortUnit` 기준; 예: day면 1일). */
export const DEFAULT_NEW_TASK_WORK_EFFORT = 1;

/** 신규 작업에 적용할 공수: `0`은 유지(이정표 등), 양의 유한값은 그대로, 그 외는 {@link DEFAULT_NEW_TASK_WORK_EFFORT}. */
export function resolveWorkEffortForNewTask(workEffort: number | undefined | null): number {
  if (workEffort === 0) return 0;
  if (typeof workEffort === 'number' && Number.isFinite(workEffort) && workEffort > 0) return workEffort;
  return DEFAULT_NEW_TASK_WORK_EFFORT;
}

const HOURS_PER_MAN_DAY = 8;
const MINUTES_PER_MAN_DAY = HOURS_PER_MAN_DAY * 60;
/** `week` 단위 1주 → MD 환산(영업일 5일) */
export const MAN_DAYS_PER_WEEK_STORED = 5;

/**
 * M/M(맨먼스)로 환산할 때 1개월에 해당하는 표준 인일 수.
 * 보고·예산 관행에 맞게 20·22 등으로 바꿀 수 있습니다.
 */
export const DEFAULT_MAN_DAYS_PER_MAN_MONTH = 20;

/** 인일(MD) → 맨먼스. `daysPerMonth` 기본값은 {@link DEFAULT_MAN_DAYS_PER_MAN_MONTH}. */
export function manDaysToManMonths(md: number, daysPerMonth: number = DEFAULT_MAN_DAYS_PER_MAN_MONTH): number {
  if (!Number.isFinite(md) || md <= 0) return 0;
  if (!Number.isFinite(daysPerMonth) || daysPerMonth <= 0) return 0;
  return md / daysPerMonth;
}

/**
 * 프로젝트·인원의 투입비율(%) 합계를 맨먼스로 볼 때의 값.
 * 100%(1명 상당 전일 투입) = 1 M/M.
 */
export function allocationPercentSumToManMonths(totalPercent: number): number {
  if (!Number.isFinite(totalPercent)) return 0;
  return totalPercent / 100;
}

/** {@link allocationPercentSumToManMonths} 결과를 표준 인월(기본 20 M/D) 기준 인일로 환산 */
export function allocationPercentSumToManDays(totalPercent: number, daysPerMonth: number = DEFAULT_MAN_DAYS_PER_MAN_MONTH): number {
  if (!Number.isFinite(daysPerMonth) || daysPerMonth <= 0) return 0;
  return allocationPercentSumToManMonths(totalPercent) * daysPerMonth;
}

/** 투입비율(%) 합계를 M/M 또는 M/D로 표시 */
export function formatAllocationPercentSumForDisplay(totalPercent: number, unit: 'mm' | 'md'): string {
  if (!Number.isFinite(totalPercent)) return '-';
  if (unit === 'md') return `${formatNum2(allocationPercentSumToManDays(totalPercent))} M/D`;
  return `${formatNum2(allocationPercentSumToManMonths(totalPercent))} M/M`;
}

/** UI·프로젝트 설정 선택지 */
export const WORK_EFFORT_UNIT_OPTIONS: { value: WorkEffortUnit; label: string }[] = [
  { value: 'minute', label: '분' },
  { value: 'hour', label: '시간' },
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
];

export function normalizeWorkEffortUnit(raw: unknown): WorkEffortUnit {
  const u = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (u === 'minute' || u === 'minutes' || u === 'min' || u === 'm') return 'minute';
  if (u === 'hour' || u === 'hours' || u === 'h') return 'hour';
  if (u === 'week' || u === 'weeks' || u === 'w') return 'week';
  if (u === 'day' || u === 'days' || u === 'd' || u === '') return 'day';
  return 'day';
}

export function workEffortUnitSuffixKo(unit: WorkEffortUnit): string {
  switch (unit) {
    case 'minute':
      return '분';
    case 'hour':
      return '시간';
    case 'week':
      return '주';
    default:
      return '일';
  }
}

/** 간트 등 짧은 표기 */
export function workEffortUnitShortSuffixKo(unit: WorkEffortUnit): string {
  switch (unit) {
    case 'minute':
      return '분';
    case 'hour':
      return 'h';
    case 'week':
      return '주';
    default:
      return 'D';
  }
}

/**
 * 프로젝트에 저장된 공수 값 → MD(인일)로 환산.
 * - 분/시간: 1MD = 8시간
 * - 주: 1주 = 5MD
 */
export function workEffortToManDays(amount: number, unit: WorkEffortUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  switch (unit) {
    case 'minute':
      return amount / MINUTES_PER_MAN_DAY;
    case 'hour':
      return amount / HOURS_PER_MAN_DAY;
    case 'week':
      return amount * MAN_DAYS_PER_WEEK_STORED;
    default:
      return amount;
  }
}

/** MD → 프로젝트 저장 단위 값 (날짜 역산·단위 변경 시 사용) */
export function manDaysToStoredWorkEffort(md: number, unit: WorkEffortUnit): number {
  if (!Number.isFinite(md) || md <= 0) return 0;
  switch (unit) {
    case 'minute':
      return Math.max(1, Math.round(md * MINUTES_PER_MAN_DAY));
    case 'hour':
      return Math.round(md * HOURS_PER_MAN_DAY * 1000) / 1000;
    case 'week':
      return Math.round((md / MAN_DAYS_PER_WEEK_STORED) * 1000) / 1000;
    default:
      return Math.round(md * 100) / 100;
  }
}

/** 같은 MD를 유지하며 저장 단위만 변경 */
export function convertStoredEffortBetweenUnits(amount: number, from: WorkEffortUnit, to: WorkEffortUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (from === to) return amount;
  const md = workEffortToManDays(amount, from);
  return manDaysToStoredWorkEffort(md, to);
}

export function buildProjectEffortUnitMap(projects: Pick<Project, 'id' | 'workEffortUnit'>[]): Map<string, WorkEffortUnit> {
  return new Map(projects.map((p) => [p.id, normalizeWorkEffortUnit(p.workEffortUnit)]));
}

/** 표(table)·셀 표시용 (저장값 그대로, 단위에 맞는 소수 자릿수) */
export function formatStoredWorkEffortForDisplay(amount: number | undefined | null, unit: WorkEffortUnit): string {
  if (amount == null || !Number.isFinite(amount)) return '-';
  if (unit === 'minute') return String(Math.round(amount));
  const rounded = Math.round(amount * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 스케줄·MD 합산 등: 작업에 저장된 공수 → MD */
export function taskStoredEffortAsManDays(
  task: Pick<Task, 'workEffort' | 'projectId'>,
  projectEffortUnitByProjectId?: Map<string, WorkEffortUnit>,
): number {
  const we = typeof task.workEffort === 'number' && task.workEffort > 0 ? task.workEffort : 0;
  if (!(we > 0)) return 0;
  const pid = task.projectId;
  const unit = pid && projectEffortUnitByProjectId?.has(pid) ? projectEffortUnitByProjectId.get(pid)! : DEFAULT_WORK_EFFORT_UNIT;
  return workEffortToManDays(we, unit);
}
