import { describe, expect, it } from 'vitest';
import {
  convertStoredEffortBetweenUnits,
  manDaysToStoredWorkEffort,
  normalizeWorkEffortUnit,
  workEffortToManDays,
} from '../workEffortUnits';

describe('normalizeWorkEffortUnit', () => {
  it('defaults invalid to day', () => {
    expect(normalizeWorkEffortUnit(undefined)).toBe('day');
    expect(normalizeWorkEffortUnit('DAY')).toBe('day');
    expect(normalizeWorkEffortUnit('hour')).toBe('hour');
    expect(normalizeWorkEffortUnit('week')).toBe('week');
  });
});

describe('workEffortToManDays', () => {
  it('converts units', () => {
    expect(workEffortToManDays(480, 'minute')).toBeCloseTo(1, 6);
    expect(workEffortToManDays(8, 'hour')).toBeCloseTo(1, 6);
    expect(workEffortToManDays(1, 'day')).toBe(1);
    expect(workEffortToManDays(2, 'week')).toBe(10);
  });
});

describe('manDaysToStoredWorkEffort', () => {
  it('round-trips approximate for day/hour/week', () => {
    expect(manDaysToStoredWorkEffort(1, 'day')).toBe(1);
    expect(manDaysToStoredWorkEffort(1, 'hour')).toBeCloseTo(8, 3);
    expect(manDaysToStoredWorkEffort(10, 'week')).toBeCloseTo(2, 3);
  });
});

describe('convertStoredEffortBetweenUnits', () => {
  it('preserves man-days equivalency within tolerance', () => {
    expect(convertStoredEffortBetweenUnits(1, 'day', 'hour')).toBeCloseTo(8, 2);
    const back = convertStoredEffortBetweenUnits(convertStoredEffortBetweenUnits(5, 'day', 'minute'), 'minute', 'day');
    expect(back).toBeCloseTo(5, 5);
  });
});
