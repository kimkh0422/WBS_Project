import { parseISO, format, addDays, isValid } from 'date-fns';

/** 로컬 기준 yyyy-MM-dd 문자열 (date-fns format보다 빠름 — 핫 루프에서 사용) */
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 토(6), 일(0) 비업무일 */
export function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/** 비업무일 여부: 주말 또는 공휴일 */
export function isNonWorkingDay(date: Date, holidays: Set<string>): boolean {
  if (isWeekend(date)) return true;
  return holidays.has(ymd(date));
}

/** 영업일만 카운트하여 start부터 days일 뒤 날짜 (start 제외, days개 영업일 경과) */
export function addBusinessDaysEx(start: Date, days: number, holidays: Set<string>): Date {
  if (!isValid(start) || days <= 0) return start;
  let current = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    current = addDays(current, 1);
    if (!isNonWorkingDay(current, holidays)) added += 1;
  }
  return current;
}

/** 영업일만 카운트하여 end부터 days일 이전 날짜 (end 제외, days개 영업일 역산) */
export function subtractBusinessDaysEx(end: Date, days: number, holidays: Set<string>): Date {
  if (!isValid(end) || days <= 0) return end;
  let current = new Date(end.getTime());
  let subtracted = 0;
  while (subtracted < days) {
    current = addDays(current, -1);
    if (!isNonWorkingDay(current, holidays)) subtracted += 1;
  }
  return current;
}

/** start ~ end (포함) 사이 영업일 수.
 *  날짜 구간을 하루씩 순회하지 않고 수식으로 계산(O(주말나머지 + 휴일수)) —
 *  구간이 수년에 달해도(잘못 입력된 먼 날짜 등) 폭주하지 않는다. 결과는 기존 순회 방식과 동일. */
export function differenceInBusinessDaysEx(start: Date, end: Date, holidays: Set<string>): number {
  if (!isValid(start) || !isValid(end)) return 0;
  // 로컬 자정으로 정규화해 달력일(양끝 포함) 수를 정확히 센다.
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (s.getTime() > e.getTime()) return 0;

  const MS_PER_DAY = 86_400_000;
  const totalDays = Math.round((e.getTime() - s.getTime()) / MS_PER_DAY) + 1; // 양끝 포함
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * 5; // 한 주마다 영업일 5

  // 나머지 날들(최대 6일)의 요일만 직접 판정
  const rem = totalDays - fullWeeks * 7;
  const startDow = s.getDay(); // 0=일 … 6=토
  for (let i = 0; i < rem; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }

  // 구간 내 "평일" 공휴일만 차감(주말 공휴일은 이미 영업일 집계에서 빠짐). 휴일 집합은 작다.
  const sStr = ymd(s);
  const eStr = ymd(e);
  for (const h of holidays) {
    if (h < sStr || h > eStr) continue;
    const hd = parseISO(h);
    if (!isValid(hd)) continue;
    const dow = hd.getDay();
    if (dow !== 0 && dow !== 6) count -= 1;
  }
  return count;
}

/** startDate(YYYY-MM-dd)부터 영업일 기준 numDays개의 날짜 문자열 배열 */
export function getBusinessDayStringsEx(startDate: string, numDays: number, holidays: Set<string>): string[] {
  const start = parseISO(startDate);
  if (!isValid(start) || numDays <= 0) return [];
  const out: string[] = [];
  let d = new Date(start.getTime());
  while (out.length < numDays) {
    if (!isNonWorkingDay(d, holidays)) out.push(format(d, 'yyyy-MM-dd'));
    d = addDays(d, 1);
  }
  return out;
}

/** 연도별 한국 공휴일 (신정, 삼일절, 어린이날, 현충일, 광복절, 개천절, 한글날, 크리스마스 + 설/추석/부처님오신날 해당연도) */
const KR_HOLIDAYS_BY_YEAR: Record<number, string[]> = {
  2024: [
    '2024-01-01',
    '2024-02-09',
    '2024-02-10',
    '2024-02-11',
    '2024-02-12', // 설날
    '2024-03-01',
    '2024-05-05',
    '2024-05-06',
    '2024-05-15', // 부처님오신날
    '2024-06-06',
    '2024-08-15',
    '2024-09-16',
    '2024-09-17',
    '2024-09-18', // 추석
    '2024-10-03',
    '2024-10-09',
    '2024-12-25',
  ],
  2025: [
    '2025-01-01',
    '2025-01-28',
    '2025-01-29',
    '2025-01-30',
    '2025-01-31', // 설날
    '2025-03-01',
    '2025-03-03',
    '2025-05-05',
    '2025-05-06', // 부처님오신날
    '2025-06-06',
    '2025-08-15',
    '2025-10-03',
    '2025-10-05',
    '2025-10-06',
    '2025-10-07',
    '2025-10-08', // 추석
    '2025-10-09',
    '2025-12-25',
  ],
  2026: [
    '2026-01-01',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-03-01',
    '2026-03-02',
    '2026-05-05',
    '2026-05-24',
    '2026-05-25',
    '2026-06-06',
    '2026-07-17',
    '2026-08-15',
    '2026-08-17',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-10-03',
    '2026-10-05',
    '2026-10-09',
    '2026-12-25',
  ],
  2027: [
    '2027-01-01',
    '2027-02-06',
    '2027-02-07',
    '2027-02-08',
    '2027-02-09',
    '2027-03-01',
    '2027-05-05',
    '2027-05-13',
    '2027-06-06',
    '2027-06-07',
    '2027-07-17',
    '2027-08-15',
    '2027-08-16',
    '2027-09-14',
    '2027-09-15',
    '2027-09-16',
    '2027-10-03',
    '2027-10-04',
    '2027-10-09',
    '2027-10-11',
    '2027-12-25',
    '2027-12-26',
    '2027-12-27',
  ],
  2028: [
    '2028-01-01',
    '2028-01-26',
    '2028-01-27',
    '2028-01-28',
    '2028-03-01',
    '2028-05-05',
    '2028-05-31',
    '2028-06-06',
    '2028-07-17',
    '2028-08-15',
    '2028-10-02',
    '2028-10-03',
    '2028-10-04',
    '2028-10-09',
    '2028-12-25',
  ],
};

/** 지정 연도 구간의 한국 공휴일 집합 (토·일 제외한 법정 휴일) */
export function getKoreanHolidaysSet(startYear: number, endYear: number): Set<string> {
  const set = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    const list = KR_HOLIDAYS_BY_YEAR[y];
    if (list) list.forEach((d) => set.add(d));
  }
  return set;
}

/** 작업 일정에서 추출한 연도 범위로 휴일 집합 생성 (없으면 최근 연도) */
export function getHolidaysForTaskDates(taskDates: { startDate?: string; endDate?: string }[]): Set<string> {
  let minY = new Date().getFullYear();
  let maxY = minY;
  for (const t of taskDates) {
    for (const d of [t.startDate, t.endDate]) {
      if (!d || d.length < 4) continue;
      const y = parseInt(d.slice(0, 4), 10);
      if (!Number.isNaN(y)) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return getKoreanHolidaysSet(minY, maxY);
}
