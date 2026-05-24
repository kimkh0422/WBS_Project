import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

/** crypto.randomUUID fallback for older browsers/environments */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidv4();
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 브라우저 로컬 시간 기준 오늘 날짜(푸터·로그인 등 표시용) */
export function formatTodayKoLongWithWeekday(): string {
  return new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/** 소수 2자리로 반올림 (저장·계산용) */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

/** 소수 2자리까지만 표시 (정수면 소수점 생략) */
export function formatNum2(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  const r = round2(n);
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(2);
}

/** 소수 1자리로 반올림 (저장·표시용) */
export function round1(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 10) / 10;
}

/** 소수 1자리까지만 표시 (정수면 소수점 생략). 가중치 등 한 자리만 의미 있는 수에 사용. */
export function formatNum1(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  const r = round1(n);
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
}

/** 진척률·투입율 등 % 숫자 부분: 소수 첫째 자리까지 항상 표기 (예: 0.0, 12.3, 100.0). */
export function formatPercent1(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return round1(n).toFixed(1);
}
