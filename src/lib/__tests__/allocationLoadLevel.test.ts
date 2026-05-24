import { describe, expect, it } from 'vitest';
import { evaluateAllocationEffortIntegrity, evaluateAllocationMissingMeaningfulWbs } from '../allocationEffortIntegrity';
import { DEFAULT_MAN_DAYS_PER_MAN_MONTH } from '../workEffortUnits';
import { getAllocationLoadLevel, resolvePersonAllocationLoadPresentation } from '../allocationLoadLevel';

describe('getAllocationLoadLevel', () => {
  it('0% 이하는 low', () => {
    expect(getAllocationLoadLevel(0)).toBe('low');
    expect(getAllocationLoadLevel(-5)).toBe('low');
  });

  it('50% 이하는 low, 51~80은 normal', () => {
    expect(getAllocationLoadLevel(50)).toBe('low');
    expect(getAllocationLoadLevel(51)).toBe('normal');
    expect(getAllocationLoadLevel(80)).toBe('normal');
  });

  it('81~100은 high', () => {
    expect(getAllocationLoadLevel(81)).toBe('high');
    expect(getAllocationLoadLevel(100)).toBe('high');
  });

  it('100% 초과는 overload', () => {
    expect(getAllocationLoadLevel(100.1)).toBe('overload');
    expect(getAllocationLoadLevel(150)).toBe('overload');
  });
});

describe('resolvePersonAllocationLoadPresentation', () => {
  it('100%·WBS 정상이면 적정(주의 아님)', () => {
    const integrity = evaluateAllocationEffortIntegrity(100, DEFAULT_MAN_DAYS_PER_MAN_MONTH);
    const { missing } = evaluateAllocationMissingMeaningfulWbs(100, DEFAULT_MAN_DAYS_PER_MAN_MONTH);
    const p = resolvePersonAllocationLoadPresentation(100, integrity, missing);
    expect(p.chipLabel).toBe('적정');
    expect(p.barFillClass).toContain('teal');
  });

  it('WBS가 할당을 크게 넘으면 초과', () => {
    const wbsMd = 24.13 * DEFAULT_MAN_DAYS_PER_MAN_MONTH;
    const integrity = evaluateAllocationEffortIntegrity(90, wbsMd);
    const { missing } = evaluateAllocationMissingMeaningfulWbs(90, wbsMd);
    const p = resolvePersonAllocationLoadPresentation(90, integrity, missing);
    expect(p.chipLabel).toBe('초과');
    expect(p.barFillClass).toContain('red');
  });

  it('투입만 있고 WBS 거의 없으면 공수미입력', () => {
    const integrity = evaluateAllocationEffortIntegrity(100, 0);
    const { missing } = evaluateAllocationMissingMeaningfulWbs(100, 0);
    const p = resolvePersonAllocationLoadPresentation(100, integrity, missing);
    expect(p.chipLabel).toBe('공수미입력');
    expect(p.barFillClass).toContain('amber');
  });
});
