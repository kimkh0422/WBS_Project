import { describe, it, expect } from 'vitest';
import {
  isWeekend,
  isNonWorkingDay,
  addBusinessDaysEx,
  subtractBusinessDaysEx,
  differenceInBusinessDaysEx,
} from '../calendar';

describe('isWeekend', () => {
  it('토요일은 주말', () => {
    expect(isWeekend(new Date('2026-04-04'))).toBe(true); // 토
  });
  it('일요일은 주말', () => {
    expect(isWeekend(new Date('2026-04-05'))).toBe(true); // 일
  });
  it('월요일은 평일', () => {
    expect(isWeekend(new Date('2026-04-06'))).toBe(false); // 월
  });
  it('금요일은 평일', () => {
    expect(isWeekend(new Date('2026-04-03'))).toBe(false); // 금
  });
});

describe('isNonWorkingDay', () => {
  const holidays = new Set(['2026-04-06']);
  it('주말은 비업무일', () => {
    expect(isNonWorkingDay(new Date('2026-04-04'), holidays)).toBe(true);
  });
  it('공휴일은 비업무일', () => {
    expect(isNonWorkingDay(new Date('2026-04-06'), holidays)).toBe(true);
  });
  it('평일이면서 공휴일 아니면 업무일', () => {
    expect(isNonWorkingDay(new Date('2026-04-07'), holidays)).toBe(false);
  });
});

describe('addBusinessDaysEx', () => {
  const holidays = new Set<string>();

  it('평일 1일 추가 (금→월)', () => {
    const result = addBusinessDaysEx(new Date('2026-04-03'), 1, holidays); // 금
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-06'); // 월
  });
  it('평일 5일 추가 (월→다음주 월)', () => {
    const result = addBusinessDaysEx(new Date('2026-03-30'), 5, holidays); // 월
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-06'); // 다음주 월 (주말 건너뜀)
  });
  it('0일이면 시작일 그대로', () => {
    const start = new Date('2026-04-03');
    const result = addBusinessDaysEx(start, 0, holidays);
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-03');
  });
  it('공휴일 건너뜀', () => {
    const hol = new Set(['2026-04-06']); // 월요일 공휴일
    const result = addBusinessDaysEx(new Date('2026-04-03'), 1, hol); // 금 +1
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-07'); // 화 (월 공휴일 건너뜀)
  });
});

describe('subtractBusinessDaysEx', () => {
  const holidays = new Set<string>();

  it('평일 1일 빼기 (월→금)', () => {
    const result = subtractBusinessDaysEx(new Date('2026-04-06'), 1, holidays); // 월
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-03'); // 금
  });
  it('0일이면 그대로', () => {
    const end = new Date('2026-04-06');
    const result = subtractBusinessDaysEx(end, 0, holidays);
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-06');
  });
});

describe('differenceInBusinessDaysEx', () => {
  const holidays = new Set<string>();

  it('같은 날이면 1 (당일 포함)', () => {
    const d = new Date('2026-04-06');
    expect(differenceInBusinessDaysEx(d, d, holidays)).toBe(1);
  });
  it('월~금 = 5영업일', () => {
    const start = new Date('2026-03-30'); // 월
    const end = new Date('2026-04-03');   // 금
    expect(differenceInBusinessDaysEx(start, end, holidays)).toBe(5);
  });
  it('주말 포함 기간에서 주말 제외', () => {
    const start = new Date('2026-04-03'); // 금
    const end = new Date('2026-04-06');   // 월
    expect(differenceInBusinessDaysEx(start, end, holidays)).toBe(2); // 금, 월
  });
  it('start > end 이면 0', () => {
    expect(differenceInBusinessDaysEx(new Date('2026-04-06'), new Date('2026-04-03'), holidays)).toBe(0);
  });
});
