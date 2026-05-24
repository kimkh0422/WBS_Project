import { describe, expect, it } from 'vitest';
import { DEFAULT_MAN_DAYS_PER_MAN_MONTH } from '../workEffortUnits';
import {
  allocationEffortAllocatedInputTooltip,
  allocationEffortMismatchDetailTooltip,
  allocationEffortPairColumnHeadingTooltip,
  evaluateAllocationEffortIntegrity,
  evaluateAllocationMissingMeaningfulWbs,
} from '../allocationEffortIntegrity';

describe('evaluateAllocationEffortIntegrity', () => {
  it('WBS 공수가 없으면 불일치 아님', () => {
    const r = evaluateAllocationEffortIntegrity(90, 0);
    expect(r.hasMismatch).toBe(false);
  });

  it('할당 0.90 M/M vs WBS 24.13 M/M → 불일치', () => {
    const wbsMd = 24.13 * DEFAULT_MAN_DAYS_PER_MAN_MONTH;
    const r = evaluateAllocationEffortIntegrity(90, wbsMd);
    expect(r.hasMismatch).toBe(true);
    expect(r.reason).toBe('wbs_exceeds_allocation');
    expect(r.ratio).toBeGreaterThan(20);
  });

  it('투입 미등록 + WBS만 있으면 wbs_without_allocation', () => {
    const r = evaluateAllocationEffortIntegrity(0, DEFAULT_MAN_DAYS_PER_MAN_MONTH);
    expect(r.hasMismatch).toBe(true);
    expect(r.reason).toBe('wbs_without_allocation');
  });

  it('할당과 WBS가 비슷하면 불일치 아님', () => {
    const r = evaluateAllocationEffortIntegrity(100, DEFAULT_MAN_DAYS_PER_MAN_MONTH);
    expect(r.hasMismatch).toBe(false);
  });
});

describe('evaluateAllocationMissingMeaningfulWbs', () => {
  it('투입 100%·WBS 0이면 공수 미입력', () => {
    expect(evaluateAllocationMissingMeaningfulWbs(100, 0).missing).toBe(true);
  });

  it('투입 24%·WBS 0이면 미입력 아님(미세 투입 제외)', () => {
    expect(evaluateAllocationMissingMeaningfulWbs(24, 0).missing).toBe(false);
  });

  it('투입 90%·WBS가 임계 이상이면 미입력 아님', () => {
    const md = 0.1 * DEFAULT_MAN_DAYS_PER_MAN_MONTH;
    expect(evaluateAllocationMissingMeaningfulWbs(90, md).missing).toBe(false);
  });
});

describe('allocation effort tooltips', () => {
  it('할당 투입 툴팁에 퍼센트·구분 설명이 포함됨', () => {
    const t = allocationEffortAllocatedInputTooltip(90, 'mm', { aggregate: 'person_projects' });
    expect(t).toContain('90.0%');
    expect(t).toContain('WBS');
    expect(t).toContain('투입율');
  });

  it('열 헤더 툴팁에 두 지표 설명이 포함됨', () => {
    const t = allocationEffortPairColumnHeadingTooltip('mm');
    expect(t).toContain('할당');
    expect(t).toContain('WBS');
  });

  it('불일치 상세 툴팁에 비율 식이 포함됨', () => {
    const wbsMd = 24.13 * DEFAULT_MAN_DAYS_PER_MAN_MONTH;
    const r = evaluateAllocationEffortIntegrity(90, wbsMd);
    const d = allocationEffortMismatchDetailTooltip(r);
    expect(d).toBeTruthy();
    expect(d!).toContain('÷');
    expect(d!).toContain('할당 투입');
  });
});
