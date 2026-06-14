import { describe, it, expect } from 'vitest';
import { normalizeYmdInput } from '../ymdInput';

describe('normalizeYmdInput', () => {
  it('YYYY-MM-DD·ISO 일시 문자열은 앞 10자만', () => {
    expect(normalizeYmdInput('2026-06-15')).toBe('2026-06-15');
    expect(normalizeYmdInput('2026-06-15T12:00:00Z')).toBe('2026-06-15');
  });

  it('8자리 숫자(YYYYMMDD)', () => {
    expect(normalizeYmdInput('20260415')).toBe('2026-04-15');
  });

  it('점·슬래시 구분자와 한 자리 월·일', () => {
    expect(normalizeYmdInput('2026.4.5')).toBe('2026-04-05');
    expect(normalizeYmdInput('2026/12/31')).toBe('2026-12-31');
  });

  it('한글 년월일(ko-KR 표시 복붙, 끝의 "일"·공백 허용)', () => {
    expect(normalizeYmdInput('2050년 7월 16일')).toBe('2050-07-16');
  });

  it('연도 생략 월/일은 올해(로컬)로 보정', () => {
    const y = new Date().getFullYear();
    expect(normalizeYmdInput('6/12')).toBe(`${y}-06-12`);
    expect(normalizeYmdInput('06-12')).toBe(`${y}-06-12`);
    expect(normalizeYmdInput('6.1')).toBe(`${y}-06-01`);
  });

  it('유효하지 않은 값은 빈 문자열', () => {
    expect(normalizeYmdInput('')).toBe('');
    expect(normalizeYmdInput('abc')).toBe('');
    expect(normalizeYmdInput('2026-13-01')).toBe('');
    expect(normalizeYmdInput('202604')).toBe('');
    expect(normalizeYmdInput('13/1')).toBe('');
    expect(normalizeYmdInput('2/32')).toBe('');
  });
});
