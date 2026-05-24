import { formatNum2, formatPercent1 } from './utils';
import {
  DEFAULT_MAN_DAYS_PER_MAN_MONTH,
  allocationPercentSumToManMonths,
  formatAllocationPercentSumForDisplay,
  formatEffortFromManDays,
  manDaysToManMonths,
} from './workEffortUnits';

/** 투입·WBS 툴팁에서 집계 범위를 설명할 때 사용 */
export type AllocationEffortTooltipAggregate = 'person_projects' | 'single_project';

/** WBS 공수(M/M)가 할당 투입(M/M) 대비 이 배율을 넘으면 불일치로 표시 */
export const DEFAULT_WBS_TO_ALLOCATION_RATIO_THRESHOLD = 1.2;

/** WBS 공수가 이 값(M/M) 미만이면 불일치 검사에서 제외 */
export const MIN_WBS_MM_FOR_INTEGRITY_CHECK = 0.05;

/**
 * 투입율 합이 이 값(%) 이상인데 WBS 공수 합이 거의 없으면「공수 미입력」으로 분류한다.
 * (미세 투입만 잡힌 경우는 제외하기 위한 하한)
 */
export const MIN_ALLOCATION_PERCENT_FOR_MISSING_WBS_FLAG = 25;

export type AllocationEffortMismatchReason = 'wbs_exceeds_allocation' | 'wbs_without_allocation';

export type AllocationEffortIntegrityResult = {
  hasMismatch: boolean;
  reason?: AllocationEffortMismatchReason;
  /** 프로젝트 투입율(%) 합 → M/M */
  allocationMm: number;
  /** WBS 작업 공수 합 → M/M */
  wbsMm: number;
  /** wbsMm / allocationMm (할당 0이면 Infinity) */
  ratio: number;
};

export function evaluateAllocationEffortIntegrity(
  totalPercent: number,
  totalWorkEffortMd: number,
  options?: {
    ratioThreshold?: number;
    daysPerMonth?: number;
    minWbsMm?: number;
  },
): AllocationEffortIntegrityResult {
  const ratioThreshold = options?.ratioThreshold ?? DEFAULT_WBS_TO_ALLOCATION_RATIO_THRESHOLD;
  const minWbsMm = options?.minWbsMm ?? MIN_WBS_MM_FOR_INTEGRITY_CHECK;
  const allocationMm = allocationPercentSumToManMonths(totalPercent);
  const wbsMm = manDaysToManMonths(totalWorkEffortMd, options?.daysPerMonth);

  if (!Number.isFinite(wbsMm) || wbsMm < minWbsMm) {
    return { hasMismatch: false, allocationMm, wbsMm: wbsMm || 0, ratio: 0 };
  }

  if (!Number.isFinite(allocationMm) || allocationMm <= 0.01) {
    return {
      hasMismatch: true,
      reason: 'wbs_without_allocation',
      allocationMm: allocationMm || 0,
      wbsMm,
      ratio: Number.POSITIVE_INFINITY,
    };
  }

  const ratio = wbsMm / allocationMm;
  if (ratio > ratioThreshold) {
    return {
      hasMismatch: true,
      reason: 'wbs_exceeds_allocation',
      allocationMm,
      wbsMm,
      ratio,
    };
  }

  return { hasMismatch: false, allocationMm, wbsMm, ratio };
}

/**
 * 프로젝트에 할당 투입은 일정 수준 이상인데, 담당 WBS 작업 공수 합이 임계 미만일 때.
 * `evaluateAllocationEffortIntegrity`는 WBS가 너무 작으면 불일치로 잡지 않으므로 별도 플래그로 집계한다.
 */
export function evaluateAllocationMissingMeaningfulWbs(
  totalPercent: number,
  totalWorkEffortMd: number,
  options?: {
    minAllocationPercent?: number;
    minWbsMm?: number;
    daysPerMonth?: number;
  },
): { missing: boolean } {
  const minAlloc = options?.minAllocationPercent ?? MIN_ALLOCATION_PERCENT_FOR_MISSING_WBS_FLAG;
  const minWbsMm = options?.minWbsMm ?? MIN_WBS_MM_FOR_INTEGRITY_CHECK;
  if (!Number.isFinite(totalPercent) || totalPercent < minAlloc) {
    return { missing: false };
  }
  const wbsMm = manDaysToManMonths(totalWorkEffortMd, options?.daysPerMonth);
  if (!Number.isFinite(wbsMm) || wbsMm >= minWbsMm) {
    return { missing: false };
  }
  return { missing: true };
}

export function allocationEffortMissingWbsShortTooltip(minAllocationPercent: number = MIN_ALLOCATION_PERCENT_FOR_MISSING_WBS_FLAG): string {
  return [
    `투입율 합이 ${minAllocationPercent}% 이상인데 담당 WBS 작업 공수 합이 거의 없습니다.`,
    '작업에 공수를 입력했는지, 담당자·표시 범위가 맞는지 확인해 주세요.',
  ].join('\n');
}

export function allocationEffortMismatchMessage(result: AllocationEffortIntegrityResult): string | null {
  if (!result.hasMismatch) return null;
  if (result.reason === 'wbs_without_allocation') {
    return '투입율 미등록 · WBS 공수만 존재합니다';
  }
  if (result.reason === 'wbs_exceeds_allocation') {
    return `WBS 공수가 할당 투입 대비 약 ${result.ratio >= 10 ? Math.round(result.ratio) : Math.round(result.ratio * 10) / 10}배입니다`;
  }
  return null;
}

function aggregateScopeSentence(aggregate: AllocationEffortTooltipAggregate): string {
  if (aggregate === 'single_project') {
    return '이 프로젝트·이 인원에 대해 등록한 투입율(%) 한 건을 기준으로 합니다.';
  }
  return '표시 중인 프로젝트들에 대해, 해당 인원의 투입율(%)을 모두 더한 값을 기준으로 합니다.';
}

function wbsAggregateScopeSentence(aggregate: AllocationEffortTooltipAggregate): string {
  if (aggregate === 'single_project') {
    return '이 인원이 이 프로젝트에서 담당자로 지정된 WBS 작업만 합산합니다.';
  }
  return '이 인원이 담당자로 지정된 WBS 작업(표시 범위의 프로젝트)을 모두 합산합니다.';
}

/** 「할당 투입」숫자·라벨에 붙이는 설명 (WBS 공수와의 차이 포함) */
export function allocationEffortAllocatedInputTooltip(
  totalPercent: number,
  effortDisplayUnit: 'mm' | 'md',
  options?: { daysPerMonth?: number; aggregate?: AllocationEffortTooltipAggregate },
): string {
  const daysPerMonth = options?.daysPerMonth ?? DEFAULT_MAN_DAYS_PER_MAN_MONTH;
  const aggregate = options?.aggregate ?? 'person_projects';
  const pct = formatPercent1(totalPercent);
  const shown = formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit);
  const unitLine =
    effortDisplayUnit === 'mm'
      ? `맨먼스(M/M)로 보면 투입율 합(%) ÷ 100 = M/M 입니다. (예: 90% → 0.90 M/M)\n1 M/M = ${daysPerMonth} M/D(인일)로 환산해 표시합니다.`
      : `인일(M/D)로 보면 (투입율 합 % ÷ 100) × ${daysPerMonth} M/D 입니다.`;

  return [
    '「할당 투입」은 WBS 작업에 적힌 공수 합이 아니라, 프로젝트에 등록한 투입율(%)을 공수로 환산한 값입니다.',
    aggregateScopeSentence(aggregate),
    `현재 투입율 합: ${pct}% → 표시: ${shown}`,
    unitLine,
    '의미: 배분된 인력 캐파(100%를 1명이 해당 기간 전일 투입한다고 볼 때의 1 M/M에 대응)입니다. WBS 추정 공수와 맞추려면 투입율을 조정하거나, WBS 공수·담당자를 현실에 맞게 조정하세요.',
  ].join('\n');
}

/** 「WBS 공수」숫자·라벨에 붙이는 설명 */
export function allocationEffortWbsSumTooltip(
  totalWorkEffortMd: number,
  effortDisplayUnit: 'mm' | 'md',
  options?: { daysPerMonth?: number; aggregate?: AllocationEffortTooltipAggregate },
): string {
  const daysPerMonth = options?.daysPerMonth ?? DEFAULT_MAN_DAYS_PER_MAN_MONTH;
  const aggregate = options?.aggregate ?? 'person_projects';
  if (!Number.isFinite(totalWorkEffortMd) || totalWorkEffortMd <= 0) {
    return [
      '「WBS 공수」는 담당 WBS 작업의 공수를 인일(M/D)로 합친 뒤 M/M 또는 M/D로 보여 줍니다.',
      wbsAggregateScopeSentence(aggregate),
      '담당 작업에 공수가 없거나 합이 0이면 이 줄은 표시되지 않습니다.',
    ].join('\n');
  }
  const shown = formatEffortFromManDays(totalWorkEffortMd, effortDisplayUnit);
  const mm = manDaysToManMonths(totalWorkEffortMd, daysPerMonth);
  return [
    '「WBS 공수」는 작업 표(WBS)에 입력한 공수를 프로젝트 단위로 합산한 추정치입니다.',
    wbsAggregateScopeSentence(aggregate),
    `인일 합: ${formatNum2(totalWorkEffortMd)} M/D → 표시: ${shown} (내부 환산: ${formatNum2(mm)} M/M, 1 M/M = ${daysPerMonth} M/D)`,
    '투입율과는 별개입니다. 투입율은 배분, WBS 공수는 작업량 추정입니다.',
  ].join('\n');
}

/** 불일치 배너·경고 칩용 상세 설명 */
export function allocationEffortMismatchDetailTooltip(result: AllocationEffortIntegrityResult): string | null {
  if (!result.hasMismatch) return null;
  if (result.reason === 'wbs_without_allocation') {
    return [
      allocationEffortMismatchMessage(result),
      'WBS에는 공수가 잡혀 있는데, 이 범위의 투입율 합이 거의 0%입니다.',
      '· 투입율을 등록하면 「할당 투입」이 표시되고, 배분과 추정 공수를 비교할 수 있습니다.',
      '· 또는 WBS 담당·공수가 과대이면 작업을 정리해 주세요.',
    ].join('\n');
  }
  if (result.reason === 'wbs_exceeds_allocation') {
    const ratioLabel = result.ratio >= 10 ? String(Math.round(result.ratio)) : String(Math.round(result.ratio * 10) / 10);
    return [
      allocationEffortMismatchMessage(result),
      `비율 계산: WBS 공수 ${formatNum2(result.wbsMm)} M/M ÷ 할당 투입 ${formatNum2(result.allocationMm)} M/M ≈ ${ratioLabel}배.`,
      '해석: 작업표상 필요 공수(추정)에 비해, 투입율로 본 배분 캐파가 훨씬 작습니다. 일정·인력 배분·공수 추정 중 한쪽 이상을 재검토하는 것이 좋습니다.',
      '· 투입율을 올려 배분을 맞추거나, · WBS 공수·담당 범위를 줄여 추정을 맞추세요.',
    ].join('\n');
  }
  return null;
}

/** 셀 전체(배경)에 붙이는 요약 툴팁 */
export function allocationEffortIntegrityCellSummaryTooltip(
  result: AllocationEffortIntegrityResult,
  effortDisplayUnit: 'mm' | 'md',
  options?: { daysPerMonth?: number; aggregate?: AllocationEffortTooltipAggregate },
): string {
  const aggregate = options?.aggregate ?? 'person_projects';
  const daysPerMonth = options?.daysPerMonth ?? DEFAULT_MAN_DAYS_PER_MAN_MONTH;
  const unitLabel = effortDisplayUnit === 'mm' ? 'M/M(맨먼스)' : 'M/D(인일)';
  const head =
    aggregate === 'single_project'
      ? '이 칩은 한 프로젝트에서의 투입율 환산값과, 그 프로젝트 WBS 공수 합을 함께 봅니다.'
      : '이 셀은 한 인원의 투입율 합(할당 투입)과, 담당 WBS 작업 공수 합을 나란히 보여 줍니다.';
  const lines = [
    head,
    `· 위쪽 숫자: 투입율(%) → ${unitLabel}로 환산`,
    `· 아래 숫자: WBS 작업 공수 합 → 동일 단위(${unitLabel})`,
    '두 값은 출처가 다릅니다. 차이가 크면 amber로 강조됩니다.',
  ];
  const detail = allocationEffortMismatchDetailTooltip(result);
  if (detail) lines.push('', detail);
  else lines.push('', '현재는 임계값(약 1.2배) 이내로, 뚜렷한 불일치로 보지 않습니다.');
  lines.push('', `맨먼스 환산: 1 M/M = ${daysPerMonth} M/D(기본).`);
  return lines.join('\n');
}

/** 대시보드 표 헤더「할당 / WBS」열 설명 */
export function allocationEffortPairColumnHeadingTooltip(
  effortDisplayUnit: 'mm' | 'md',
  daysPerMonth: number = DEFAULT_MAN_DAYS_PER_MAN_MONTH,
): string {
  const unit = effortDisplayUnit === 'mm' ? 'M/M(맨먼스)' : 'M/D(인일)';
  return [
    '이 열은 한 인원의 두 지표를 세로로 묶어 보여 줍니다.',
    `· 위(할당 투입): 프로젝트 투입율(%) 합 → ${unit}`,
    `· 아래(WBS 공수): 담당 WBS 작업 공수 합 → 동일 단위 (1 M/M = ${daysPerMonth} M/D)`,
    '두 값의 출처가 다릅니다. 숫자·라벨·경고 문구에 마우스를 올리면 계산식과 해석이 표시됩니다.',
  ].join('\n');
}

export type PersonAllocationIntegrityRow = {
  person: string;
  totalPercent: number;
  totalWorkEffortMd: number;
  integrity: AllocationEffortIntegrityResult;
};

export function collectPersonAllocationIntegrityIssues(
  rows: Array<{ person: string; totalPercent: number; totalWorkEffortMd: number }>,
  options?: Parameters<typeof evaluateAllocationEffortIntegrity>[2],
): PersonAllocationIntegrityRow[] {
  return rows
    .map((row) => ({
      ...row,
      integrity: evaluateAllocationEffortIntegrity(row.totalPercent, row.totalWorkEffortMd, options),
    }))
    .filter((row) => row.integrity.hasMismatch);
}
