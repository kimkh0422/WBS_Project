import { parseISO, isValid } from 'date-fns';
import type { Task } from '../types';
import { differenceInBusinessDaysEx, getHolidaysForTaskDates } from './calendar';
import { getUseWeightForProgressRollup } from './rollupOptions';

/**
 * 계획율(계획 진척률)과 계획 대비 진척 차이(일정 변동) 계산.
 *
 * - **계획율**: 기준일 D의 일정상 경과 비율. "오늘 일정대로면 이만큼 되어 있어야 한다"는 값.
 * - **진척차이(%p)**: 실제 진척률 − 계획율. 양수=계획보다 앞섬, 음수=계획 대비 지연.
 *
 * 영업일·휴일 기준은 일정 산정(lib/schedule.ts, lib/calendar.ts)과 동일하게 적용한다.
 * 기준 일정은 베이스라인이 설정된 경우 베이스라인을, 없으면 현재 계획 일정(startDate/endDate)을 사용한다.
 */

type PlannedTaskFields = Pick<Task, 'startDate' | 'endDate' | 'baselineStartDate' | 'baselineEndDate' | 'isMilestone'>;

/** 로컬 자정 기준 오늘 (YYYY-MM-DD) */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 계획 일정(시작·종료). 베이스라인이 있으면 베이스라인을 우선 사용. */
export function plannedScheduleOf(task: PlannedTaskFields): { start?: string; end?: string } {
  return {
    start: task.baselineStartDate || task.startDate || undefined,
    end: task.baselineEndDate || task.endDate || undefined,
  };
}

/** 리프 작업의 계획율을 계산할 수 있는지(시작·종료 일정 또는 마일스톤 시점 존재 여부) */
export function hasPlannedSchedule(task: PlannedTaskFields): boolean {
  const { start, end } = plannedScheduleOf(task);
  if (task.isMilestone) return Boolean(end || start);
  return Boolean(start && end);
}

/**
 * 단일(리프) 작업의 계획율(0~100).
 * - D ≤ 시작 → 0, D ≥ 종료 → 100, 그 사이 → (시작~D 영업일 경과)/(전체 영업일)×100 (시작 0%·종료 100% 선형).
 * - 마일스톤: D ≥ 시점이면 100, 아니면 0.
 * - 베이스라인이 있으면 베이스라인 일정 기준.
 */
export function computeLeafPlannedProgress(task: PlannedTaskFields, refDateIso: string, holidays: Set<string>): number {
  const { start, end } = plannedScheduleOf(task);

  if (task.isMilestone) {
    const point = end || start;
    if (!point) return 0;
    return refDateIso >= point ? 100 : 0;
  }

  if (!start || !end) return 0;
  if (refDateIso <= start) return 0;
  if (refDateIso >= end) return 100;

  const s = parseISO(start);
  const e = parseISO(end);
  const r = parseISO(refDateIso);
  if (!isValid(s) || !isValid(e) || !isValid(r)) return 0;

  const total = differenceInBusinessDaysEx(s, e, holidays); // [start..end] 포함 영업일 수
  if (total <= 1) return refDateIso >= end ? 100 : 0;
  const elapsed = differenceInBusinessDaysEx(s, r, holidays); // [start..ref] 포함 영업일 수
  const pct = ((elapsed - 1) / (total - 1)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * 작업 집합 전체의 작업별 계획율 맵(0~100).
 * - 리프: 날짜 기반 계획율(computeLeafPlannedProgress).
 * - 부모: 직속 자식 계획율의 가중평균. 가중치는 자식의 weight, 없으면 workEffort(둘 다 없으면 단순 평균).
 *   → 실제 진척 롤업(lib/rollups.ts)과 동일한 가중 규칙.
 * - `task.plannedProgressOverride`가 유한 숫자면 해당 작업 행은 일정 계산 대신 이 값(0~100 클램프)을 사용.
 */
export function computePlannedProgressMap(tasks: Task[], refDateIso: string = todayIso(), holidays?: Set<string>): Map<string, number> {
  const hol = holidays ?? getHolidaysForTaskDates(tasks);

  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.parentId;
    if (!key) continue;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(t);
    else childrenByParent.set(key, [t]);
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const compute = (t: Task): number => {
    const cached = memo.get(t.id);
    if (cached !== undefined) return cached;
    // 순환 참조 안전장치: 자기 자신 계산 중 다시 호출되면 리프 값으로 폴백
    if (visiting.has(t.id)) return computeLeafPlannedProgress(t, refDateIso, hol);
    visiting.add(t.id);

    const kids = childrenByParent.get(t.id);
    let val: number;
    if (!kids || kids.length === 0) {
      val = computeLeafPlannedProgress(t, refDateIso, hol);
    } else {
      let totalWeight = 0;
      let weightedSum = 0;
      let simpleSum = 0;
      for (const k of kids) {
        const p = compute(k);
        const effort = typeof k.workEffort === 'number' && Number.isFinite(k.workEffort) ? k.workEffort : 0;
        const w = typeof k.weight === 'number' && Number.isFinite(k.weight) ? k.weight : effort;
        totalWeight += w;
        weightedSum += p * w;
        simpleSum += p;
      }
      // 가중치 반영 여부 옵션과 동일하게 동작(진척률 롤업과 일관)
      const useWeight = getUseWeightForProgressRollup();
      val = useWeight && totalWeight > 0 ? weightedSum / totalWeight : simpleSum / kids.length;
    }

    val = Math.min(100, Math.max(0, val));
    const ovr = t.plannedProgressOverride;
    if (typeof ovr === 'number' && Number.isFinite(ovr)) {
      val = Math.min(100, Math.max(0, ovr));
    }
    visiting.delete(t.id);
    memo.set(t.id, val);
    return val;
  };

  for (const t of tasks) compute(t);
  return memo;
}

/** 진척차이(%p) = 실제 진척률 − 계획율. 양수=앞섬, 음수=지연. */
export function progressVariance(actualProgress: number | undefined, plannedProgress: number | undefined): number {
  const a = typeof actualProgress === 'number' && Number.isFinite(actualProgress) ? actualProgress : 0;
  const p = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress) ? plannedProgress : 0;
  return a - p;
}

export interface PlannedActualSummary {
  /** 가중 평균 계획율(0~100) */
  planned: number;
  /** 가중 평균 실제 진척률(0~100) */
  actual: number;
  /** 실제 − 계획 (%p) */
  variance: number;
}

/**
 * 작업 집합의 가중 평균 계획율·실제 진척률·차이를 계산(대시보드·요약용).
 * items는 보통 한 프로젝트의 최상위 작업 집합. 가중치는 weight, 없으면 workEffort(둘 다 없으면 단순 평균).
 */
export function aggregatePlannedActual(items: Task[], plannedById: Map<string, number>): PlannedActualSummary {
  let totalWeight = 0;
  let weightedPlanned = 0;
  let weightedActual = 0;
  let simplePlanned = 0;
  let simpleActual = 0;
  for (const t of items) {
    const planned = plannedById.get(t.id) ?? 0;
    const actual = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    const effort = typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) ? t.workEffort : 0;
    const w = typeof t.weight === 'number' && Number.isFinite(t.weight) ? t.weight : effort;
    totalWeight += w;
    weightedPlanned += planned * w;
    weightedActual += actual * w;
    simplePlanned += planned;
    simpleActual += actual;
  }
  const n = items.length || 1;
  const clamp = (x: number) => Math.min(100, Math.max(0, x));
  const planned = clamp(totalWeight > 0 ? weightedPlanned / totalWeight : simplePlanned / n);
  const actual = clamp(totalWeight > 0 ? weightedActual / totalWeight : simpleActual / n);
  return { planned, actual, variance: actual - planned };
}
