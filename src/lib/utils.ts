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
    month: 'long',
    day: 'numeric',
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
