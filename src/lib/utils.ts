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

/**
 * 작업 시작·종료일 등 표시용. 저장값(ISO·`YYYY-MM-DD`…)을 `2026-05-31` 형식으로 통일한다.
 * 날짜만 있는 문자열은 `Date` 파싱을 피해 타임존으로 일이 하루 밀리는 현상을 줄인다.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const head = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  try {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

/** 표 셀처럼 좁은 칸용: 연도 없이 '월 일'만 표시(예: 4월 1일). 저장값·편집 입력은 연도를 포함해 그대로 유지. */
export function formatMonthDay(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ko-KR', {
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

/** 릴리스·빌드 날짜 표기 — 예: 2026. 05. 27 */
export function formatReleaseDateDotKo(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}. ${m}. ${day}`;
  } catch {
    return isoDate;
  }
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

/**
 * 진척률·계획율 등 백분율 집계.
 * - useWeight=true: Σ(value×weight) ÷ Σweight 가중평균. Σweight가 0이면 단순평균으로 폴백.
 * - useWeight=false: 가중치를 무시한 단순 산술평균.
 * 결과는 0~100으로 클램프. 반올림 함수는 호출부가 지정(요약 바=round1, 대시보드=Math.round).
 */
export function aggregatePercentByWeight(
  items: ReadonlyArray<{ value: number; weight: number }>,
  useWeight: boolean,
  round: (n: number) => number = (n) => n,
): number {
  if (items.length === 0) return 0;
  const clamp = (n: number) => Math.min(100, Math.max(0, round(n)));
  const valueOf = (v: number) => (Number.isFinite(v) ? v : 0);
  const simpleAverage = () => clamp(items.reduce((s, it) => s + valueOf(it.value), 0) / items.length);
  if (!useWeight) return simpleAverage();
  let totalWeight = 0;
  let acc = 0;
  for (const it of items) {
    const w = Number.isFinite(it.weight) ? it.weight : 0;
    totalWeight += w;
    acc += valueOf(it.value) * w;
  }
  if (totalWeight > 0) return clamp(acc / totalWeight);
  return simpleAverage();
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
