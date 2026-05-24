import type { AllocationEffortIntegrityResult } from './allocationEffortIntegrity';
import { MIN_ALLOCATION_PERCENT_FOR_MISSING_WBS_FLAG } from './allocationEffortIntegrity';

/** 인원·프로젝트 투입율(%) 합계에 따른 부하 수준 */
export type AllocationLoadLevel = 'low' | 'normal' | 'high' | 'overload';

export function getAllocationLoadLevel(totalPercent: number): AllocationLoadLevel {
  if (!Number.isFinite(totalPercent) || totalPercent <= 0) return 'low';
  if (totalPercent > 100) return 'overload';
  if (totalPercent > 80) return 'high';
  if (totalPercent > 50) return 'normal';
  return 'low';
}

export function allocationLoadBarFillClass(level: AllocationLoadLevel): string {
  switch (level) {
    case 'overload':
      return 'bg-red-500';
    case 'high':
      return 'bg-amber-500';
    case 'normal':
      return 'bg-teal-500';
    case 'low':
      return 'bg-emerald-500';
  }
}

export function allocationLoadTextClass(level: AllocationLoadLevel): string {
  switch (level) {
    case 'overload':
      return 'text-red-700';
    case 'high':
      return 'text-amber-700';
    case 'normal':
      return 'text-teal-700';
    case 'low':
      return 'text-emerald-700';
  }
}

export function allocationLoadLabel(level: AllocationLoadLevel): string | null {
  switch (level) {
    case 'overload':
      return '과부하';
    case 'high':
      return '주의';
    case 'normal':
      return '적정';
    case 'low':
      return '여유';
  }
}

/**
 * 인원별 투입 현황: 풀타임(고 투입%)은 정상으로 두고, WBS 대비 할당 초과·미입력 등만 격상 표시한다.
 */
export type PersonAllocationLoadPresentation = {
  barFillClass: string;
  percentTextClass: string;
  chipLabel: string;
  chipContainerClass: string;
  chipTitle: string;
};

export function resolvePersonAllocationLoadPresentation(
  totalPercent: number,
  integrity: AllocationEffortIntegrityResult,
  missingMeaningfulWbs: boolean,
): PersonAllocationLoadPresentation {
  const pct = Number.isFinite(totalPercent) ? totalPercent : 0;

  const baseLow = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-emerald-500',
    percentTextClass: 'text-emerald-700',
    chipLabel: '여유',
    chipContainerClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    chipTitle: '투입율 합이 낮게 등록되어 있습니다.',
  });

  const baseNormal = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-teal-500',
    percentTextClass: 'text-teal-700',
    chipLabel: '적정',
    chipContainerClass: 'text-teal-700 bg-teal-50 border-teal-200',
    chipTitle: '투입 과다(100% 초과)나 WBS 대비 할당 초과가 아닙니다. 풀타임(100%에 가까운 합)도 정상 배분으로 표시됩니다.',
  });

  const overload = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-red-500',
    percentTextClass: 'text-red-700',
    chipLabel: '과부하',
    chipContainerClass: 'text-red-700 bg-red-50 border-red-200',
    chipTitle: '여러 프로젝트에 걸친 투입율(%) 합이 100%를 넘었습니다. 과다 배정이면 일부 투입율을 낮추거나, 표시 범위·담당을 확인하세요.',
  });

  const wbsExceeds = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-red-500',
    percentTextClass: 'text-red-700',
    chipLabel: '초과',
    chipContainerClass: 'text-red-700 bg-red-50 border-red-200',
    chipTitle: '담당 WBS 공수 합이 프로젝트에 등록한 할당 투입(투입율 환산)보다 큽니다. 투입을 늘리거나 공수·담당 범위를 검토하세요.',
  });

  const allocMissing = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-amber-500',
    percentTextClass: 'text-amber-700',
    chipLabel: '투입미등록',
    chipContainerClass: 'text-amber-800 bg-amber-50 border-amber-200',
    chipTitle: 'WBS에는 공수가 잡혀 있는데, 이 범위의 투입율 합이 거의 없습니다. 투입율을 등록하거나 WBS 담당·공수를 정리해 주세요.',
  });

  const effortMissing = (): PersonAllocationLoadPresentation => ({
    barFillClass: 'bg-amber-500',
    percentTextClass: 'text-amber-700',
    chipLabel: '공수미입력',
    chipContainerClass: 'text-amber-800 bg-amber-50 border-amber-200',
    chipTitle: `투입율 합이 ${MIN_ALLOCATION_PERCENT_FOR_MISSING_WBS_FLAG}% 이상인데 담당 WBS 작업 공수 합이 거의 없습니다. 작업 공수를 입력했는지 확인해 주세요.`,
  });

  if (pct > 100) {
    return overload();
  }
  if (integrity.hasMismatch && integrity.reason === 'wbs_exceeds_allocation') {
    return wbsExceeds();
  }
  if (integrity.hasMismatch && integrity.reason === 'wbs_without_allocation') {
    return allocMissing();
  }
  if (missingMeaningfulWbs) {
    return effortMissing();
  }
  if (pct <= 0) {
    return baseLow();
  }
  if (pct <= 50) {
    return baseLow();
  }
  return baseNormal();
}
