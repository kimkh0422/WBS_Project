import { describe, expect, it } from 'vitest';
import {
  formatProjectPeriodDate,
  formatProjectPeriodRange,
  hasUndeterminedProjectPeriod,
  summarizeUndeterminedProjectPeriod,
} from '../projectPeriod';

describe('hasUndeterminedProjectPeriod', () => {
  it('시작·종료 모두 없으면 true', () => {
    expect(hasUndeterminedProjectPeriod({})).toBe(true);
  });

  it('하나만 없어도 true', () => {
    expect(hasUndeterminedProjectPeriod({ startDate: '2026-01-01' })).toBe(true);
    expect(hasUndeterminedProjectPeriod({ endDate: '2026-12-31' })).toBe(true);
  });

  it('둘 다 있으면 false', () => {
    expect(hasUndeterminedProjectPeriod({ startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(false);
  });
});

describe('formatProjectPeriodRange', () => {
  it('빈 기간은 기간 미정', () => {
    expect(formatProjectPeriodRange(undefined, undefined)).toBe('기간 미정');
  });

  it('부분 미정은 미정 표기', () => {
    expect(formatProjectPeriodRange('2026-01-01', undefined)).toBe('2026-01-01 ~ 미정');
  });
});

describe('summarizeUndeterminedProjectPeriod', () => {
  it('누락 필드를 구분', () => {
    expect(summarizeUndeterminedProjectPeriod({})).toBe('시작·종료 미정');
    expect(summarizeUndeterminedProjectPeriod({ startDate: '2026-01-01' })).toBe('종료일 미정');
  });
});

describe('formatProjectPeriodDate', () => {
  it('빈 값은 미정', () => {
    expect(formatProjectPeriodDate('')).toBe('미정');
  });
});
