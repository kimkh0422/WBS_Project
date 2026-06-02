/**
 * 사업부별 영업 아웃룩(수주·청구 계획) 워크북 파서·집계.
 *
 * 원본 엑셀("2026년 수주 및 청구 계획(안)") 공통 표 양식:
 *  - 계획 탭: 행3(그룹 머리글)·행4(열 라벨) + 데이터. 열 순서·라벨 문자열을 그대로 `planColumnsBySheet`·`cells`에 반영
 *  - 매출장: 1행 헤더, 프로젝트코드/발생일자/공급가액/세액/합계/사업부 등 (PJ별 '소계' 행 제외)
 *  - 상품원재료(원가 원장): 표시·파싱 대상에서 제외
 *
 * 보안: 이 데이터는 민감한 매출·재무 정보다. 서버(코드/DB)에 저장하지 않고,
 *       사용자가 업로드한 내용을 브라우저(IndexedDB)에만 보관한다.
 */

export interface OutlookPlanRow {
  division: string; // 사업부
  pjCode: string; // PJ코드
  category: string; // 구분 (이월/확정/예정/미정 ...)
  stage: string; // 업무단계 (기획/입찰/수행/완료 ...)
  bizType: string; // 사업형태 (제품/용역/유지/상품/해외)
  customerType: string; // 고객형태
  client: string; // 발주처
  name: string; // 사업명
  startDate: string; // 사업시작 (YYYY-MM-DD 또는 원문)
  endDate: string; // 사업종료
  orderMonth: string; // 수주월
  pm: string; // PM
  team: string; // 수행팀
  budget?: number; // 사업예산
  orderProb?: number; // 수주확률 (0~1)
  winRate?: number; // 낙찰률 (0~1)
  shareRate?: number; // 지분율 (0~1)
  expectedAmount?: number; // 예상수주금액
  carryOver?: number; // 이월액
  salesStatus: string; // 영업 현황
  bizCategory: string; // 사업구분
  /** 표준 표양식 전체 열 값(해당 시트 planColumns와 인덱스 정렬). 빈 셀은 null, 뒤쪽 빈 셀은 trim */
  cells: StdCellValue[];
}

export interface LedgerRow {
  pjCode: string; // 프로젝트코드
  project: string; // 프로젝트(명)
  date: string; // 발생일자
  month: number | null; // 월
  summary: string; // 적요
  taxType: string; // 세무구분
  client: string; // 거래처명
  bizRegNo: string; // 사업자등록번호
  supply: number; // 공급가액
  tax: number; // 세액
  total: number; // 합계
  division: string; // 사업부
  ntsStatus: string; // 국세청전송상태
}

/** 표준 표양식 셀 값 */
export type StdCellValue = string | number | null;

/** 표준 표양식 열 정의: 행3 병합 그룹 머리글 + 행4 라벨 + 값 종류 */
export interface StdColumn {
  /** 행3 병합 그룹명 (''=기본 정보 블록: 사업부~계약일) */
  group: string;
  /** 행4 라벨 (예: '1월-청구계획') */
  label: string;
  kind: 'text' | 'num' | 'rate' | 'date';
}

export interface SalesOutlookData {
  fileName: string;
  parsedAt: string; // ISO
  planSheetNames: string[];
  planRowsBySheet: Record<string, OutlookPlanRow[]>;
  /** 시트별 표준 표양식 열 정의. 시트마다 낙찰률/수주확률 순서 등이 달라 시트별 보관 */
  planColumnsBySheet: Record<string, StdColumn[]>;
  ledgerRows: LedgerRow[];
  /** 인식하지 못해 건너뛴 시트(원가 원장 등) */
  skippedSheets: string[];
}

export interface PlanSummary {
  count: number;
  totalExpected: number;
  totalBudget: number;
  byCategory: { key: string; count: number; expected: number }[];
  byDivision: { key: string; count: number; expected: number }[];
}

export interface LedgerSummary {
  count: number;
  totalSupply: number;
  totalTax: number;
  totalAmount: number;
  byMonth: { key: string; total: number }[];
  byDivision: { key: string; total: number }[];
}

type Cell = string | number | boolean | Date | null | undefined;
type SheetRows = Cell[][];

const norm = (v: Cell): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** 숫자 변환: 쉼표·통화·공백 제거. 비어 있으면 undefined */
export function toNum(v: Cell): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const cleaned = String(v).replace(/[,\s₩원]/g, '');
  if (cleaned === '' || cleaned === '-') return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 날짜 셀(YYYY-MM-DD). Date면 로컬 기준 포맷, 문자열이면 구분자 정규화 */
export function toDateStr(v: Cell): string {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).trim();
  // 2025/05/19, 2025.05.19 → 2025-05-19
  const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  return s;
}

const STD_DATE_LABELS = new Set(['사업시작', '사업종료', '계약일']);
const STD_NUM_HINTS = [
  '청구계획',
  '청구실적',
  '수금',
  '매입계획',
  '매입실적',
  '지급',
  '영업이익',
  '예상매입액',
  '사업예산',
  '예상수주금액',
  '이월액',
  '매출예상',
];

/** 표준 표양식 열의 값 종류 추론 (행4 라벨 기준) */
export function inferStdKind(label: string): StdColumn['kind'] {
  const l = label.trim();
  if (l.endsWith('률(%)') || l === '낙찰률' || l === '수주확률' || l === '지분율') return 'rate';
  if (STD_DATE_LABELS.has(l)) return 'date';
  if (STD_NUM_HINTS.some((hint) => l.includes(hint))) return 'num';
  return 'text';
}

/** 표준 표 머리글 축약 표시: '1월-청구계획'→'청구계획', '영업-영업이익'→'영업이익' (그룹 머리글이 접두를 대신 보여줌) */
export function stdColShortLabel(label: string): string {
  const i = label.indexOf('-');
  return i > 0 ? label.slice(i + 1) : label;
}

/** 표준 표 셀 표시 문자열 (종류별 포맷) */
export function formatStdCell(v: StdCellValue, kind: StdColumn['kind']): string {
  if (v == null || v === '') return '';
  if (kind === 'rate') {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return String(v);
    return `${Math.round(Math.abs(n) <= 1.5 ? n * 100 : n)}%`;
  }
  if (kind === 'num') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : String(v);
  }
  return String(v);
}

/** 헤더 라벨 → 열 인덱스 맵 (정규화·중복 시 첫 번째 우선) */
function headerIndexMap(headerRow: Cell[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = norm(cell);
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

/** 여러 후보 라벨 중 처음 매칭되는 열 인덱스 */
function colOf(map: Map<string, number>, ...labels: string[]): number {
  for (const l of labels) {
    const idx = map.get(l);
    if (idx != null) return idx;
  }
  return -1;
}

type SheetKind = 'plan' | 'ledger' | 'other';

/** 시트 종류 판별: 헤더 행 후보(첫 6행)에서 특징 컬럼으로 분류 */
function classifySheet(rows: SheetRows): { kind: SheetKind; headerRowIndex: number } {
  const limit = Math.min(rows.length, 6);
  for (let r = 0; r < limit; r++) {
    const labels = new Set((rows[r] ?? []).map(norm).filter(Boolean));
    if (labels.has('사업명') && (labels.has('예상수주금액') || labels.has('발주처'))) {
      return { kind: 'plan', headerRowIndex: r };
    }
    if (labels.has('공급가액') && labels.has('거래처명') && (labels.has('세무구분') || labels.has('합계'))) {
      return { kind: 'ledger', headerRowIndex: r };
    }
  }
  return { kind: 'other', headerRowIndex: -1 };
}

function parsePlanSheet(rows: SheetRows, headerRowIndex: number): { rows: OutlookPlanRow[]; columns: StdColumn[] } {
  const labelRow = rows[headerRowIndex] ?? [];
  const groupRow = headerRowIndex > 0 ? (rows[headerRowIndex - 1] ?? []) : [];
  const h = headerIndexMap(labelRow);
  const get = (row: Cell[], idx: number): Cell => (idx >= 0 ? row[idx] : undefined);

  // 표준 표양식 열 정의: 행4 라벨이 있는 모든 열. 행3 그룹 머리글은 병합이라 앞 열에만 값 존재 → 앞으로 채움(forward-fill).
  const columns: StdColumn[] = [];
  const colSrcIdx: number[] = []; // columns[i] ↔ 원본 열 인덱스
  let lastGroup = '';
  for (let c = 0; c < labelRow.length; c++) {
    const g = norm(groupRow[c]);
    if (g) lastGroup = g;
    const label = norm(labelRow[c]);
    if (!label) continue;
    columns.push({ group: lastGroup, label, kind: inferStdKind(label) });
    colSrcIdx.push(c);
  }

  const ci = {
    division: colOf(h, '사업부'),
    pjCode: colOf(h, 'PJ코드', 'PJ 코드', '프로젝트코드'),
    category: colOf(h, '구분'),
    stage: colOf(h, '업무단계'),
    bizType: colOf(h, '사업형태'),
    customerType: colOf(h, '고객형태'),
    client: colOf(h, '발주처'),
    name: colOf(h, '사업명'),
    startDate: colOf(h, '사업시작'),
    endDate: colOf(h, '사업종료'),
    orderMonth: colOf(h, '수주월'),
    pm: colOf(h, 'PM'),
    team: colOf(h, '수행팀'),
    budget: colOf(h, '사업예산'),
    orderProb: colOf(h, '수주확률'),
    winRate: colOf(h, '낙찰률'),
    shareRate: colOf(h, '지분율'),
    expectedAmount: colOf(h, '예상수주금액'),
    carryOver: colOf(h, '이월액'),
    salesStatus: colOf(h, '영업 현황', '영업현황'),
    bizCategory: colOf(h, '사업구분'),
  };

  const out: OutlookPlanRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = norm(get(row, ci.name));
    if (!name) continue; // 사업명이 없는 행(범례·합계·빈 행) 제외
    const cells: StdCellValue[] = colSrcIdx.map((c, i) => {
      const kind = columns[i]!.kind;
      const raw = row[c];
      if (kind === 'date') return toDateStr(raw) || null;
      if (kind === 'num' || kind === 'rate') return toNum(raw) ?? null;
      return norm(raw) || null;
    });
    let cellEnd = cells.length; // 뒤쪽 빈 셀 trim (저장 용량 절감)
    while (cellEnd > 0 && cells[cellEnd - 1] == null) cellEnd--;
    out.push({
      division: norm(get(row, ci.division)),
      pjCode: norm(get(row, ci.pjCode)),
      category: norm(get(row, ci.category)),
      stage: norm(get(row, ci.stage)),
      bizType: norm(get(row, ci.bizType)),
      customerType: norm(get(row, ci.customerType)),
      client: norm(get(row, ci.client)),
      name,
      startDate: toDateStr(get(row, ci.startDate)),
      endDate: toDateStr(get(row, ci.endDate)),
      orderMonth: norm(get(row, ci.orderMonth)),
      pm: norm(get(row, ci.pm)),
      team: norm(get(row, ci.team)),
      budget: toNum(get(row, ci.budget)),
      orderProb: toNum(get(row, ci.orderProb)),
      winRate: toNum(get(row, ci.winRate)),
      shareRate: toNum(get(row, ci.shareRate)),
      expectedAmount: toNum(get(row, ci.expectedAmount)),
      carryOver: toNum(get(row, ci.carryOver)),
      salesStatus: norm(get(row, ci.salesStatus)),
      bizCategory: norm(get(row, ci.bizCategory)),
      cells: cells.slice(0, cellEnd),
    });
  }
  return { rows: out, columns };
}

function parseLedgerSheet(rows: SheetRows, headerRowIndex: number): LedgerRow[] {
  const h = headerIndexMap(rows[headerRowIndex] ?? []);
  const get = (row: Cell[], idx: number): Cell => (idx >= 0 ? row[idx] : undefined);
  const ci = {
    pjCode: colOf(h, '프로젝트코드'),
    project: colOf(h, '프로젝트'),
    date: colOf(h, '발생일자'),
    month: colOf(h, '월'),
    summary: colOf(h, '적요'),
    taxType: colOf(h, '세무구분'),
    client: colOf(h, '거래처명'),
    bizRegNo: colOf(h, '사업자등록번호'),
    supply: colOf(h, '공급가액'),
    tax: colOf(h, '세액'),
    total: colOf(h, '합계'),
    division: colOf(h, '사업부'),
    ntsStatus: colOf(h, '국세청전송상태'),
  };
  const out: LedgerRow[] = [];
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const pjCode = norm(get(row, ci.pjCode));
    const project = norm(get(row, ci.project));
    // '소계'/합계 행, 빈 행 제외
    if (!pjCode && !project) continue;
    if (pjCode === '소계' || project.includes('소계') || project.includes('합계')) continue;
    out.push({
      pjCode,
      project,
      date: toDateStr(get(row, ci.date)),
      month: toNum(get(row, ci.month)) ?? null,
      summary: norm(get(row, ci.summary)),
      taxType: norm(get(row, ci.taxType)),
      client: norm(get(row, ci.client)),
      bizRegNo: norm(get(row, ci.bizRegNo)),
      supply: toNum(get(row, ci.supply)) ?? 0,
      tax: toNum(get(row, ci.tax)) ?? 0,
      total: toNum(get(row, ci.total)) ?? 0,
      division: norm(get(row, ci.division)),
      ntsStatus: norm(get(row, ci.ntsStatus)),
    });
  }
  return out;
}

/** 시트명→행배열 맵으로부터 아웃룩 데이터 구성 (순수 함수, 테스트 대상) */
export function buildOutlookFromSheets(
  sheetOrder: string[],
  sheetRows: Record<string, SheetRows>,
  fileName: string,
  parsedAtIso: string,
): SalesOutlookData {
  const planSheetNames: string[] = [];
  const planRowsBySheet: Record<string, OutlookPlanRow[]> = {};
  const planColumnsBySheet: Record<string, StdColumn[]> = {};
  let ledgerRows: LedgerRow[] = [];
  const skippedSheets: string[] = [];

  for (const name of sheetOrder) {
    const rows = sheetRows[name] ?? [];
    const { kind, headerRowIndex } = classifySheet(rows);
    if (kind === 'plan') {
      const parsed = parsePlanSheet(rows, headerRowIndex);
      planSheetNames.push(name);
      planRowsBySheet[name] = parsed.rows;
      planColumnsBySheet[name] = parsed.columns;
    } else if (kind === 'ledger') {
      // 여러 매출장 시트가 있으면 누적
      ledgerRows = ledgerRows.concat(parseLedgerSheet(rows, headerRowIndex));
    } else {
      skippedSheets.push(name);
    }
  }

  return { fileName, parsedAt: parsedAtIso, planSheetNames, planRowsBySheet, planColumnsBySheet, ledgerRows, skippedSheets };
}

/** 계획 시트 요약 집계 */
export function summarizePlan(rows: OutlookPlanRow[]): PlanSummary {
  let totalExpected = 0;
  let totalBudget = 0;
  const cat = new Map<string, { count: number; expected: number }>();
  const div = new Map<string, { count: number; expected: number }>();
  for (const r of rows) {
    const e = r.expectedAmount ?? 0;
    totalExpected += e;
    totalBudget += r.budget ?? 0;
    const ck = r.category || '(미지정)';
    const c = cat.get(ck) ?? { count: 0, expected: 0 };
    c.count += 1;
    c.expected += e;
    cat.set(ck, c);
    const dk = r.division || '(미지정)';
    const d = div.get(dk) ?? { count: 0, expected: 0 };
    d.count += 1;
    d.expected += e;
    div.set(dk, d);
  }
  const toSorted = (m: Map<string, { count: number; expected: number }>) =>
    [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.expected - a.expected);
  return { count: rows.length, totalExpected, totalBudget, byCategory: toSorted(cat), byDivision: toSorted(div) };
}

/** 매출장 요약 집계 */
export function summarizeLedger(rows: LedgerRow[]): LedgerSummary {
  let totalSupply = 0;
  let totalTax = 0;
  let totalAmount = 0;
  const month = new Map<number, number>();
  const div = new Map<string, number>();
  for (const r of rows) {
    totalSupply += r.supply;
    totalTax += r.tax;
    totalAmount += r.total;
    if (r.month != null) month.set(r.month, (month.get(r.month) ?? 0) + r.total);
    const dk = r.division || '(미지정)';
    div.set(dk, (div.get(dk) ?? 0) + r.total);
  }
  return {
    count: rows.length,
    totalSupply,
    totalTax,
    totalAmount,
    byMonth: [...month.entries()].sort((a, b) => a[0] - b[0]).map(([m, total]) => ({ key: `${m}월`, total })),
    byDivision: [...div.entries()].map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total),
  };
}

/** 통화 표기(원). 백만 단위 이상은 그대로 천단위 콤마 */
export function formatKRW(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/** 억/백만 단위 요약 표기 (대시보드 카드용) */
export function formatKRWCompact(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return Math.round(n).toLocaleString('ko-KR');
}

/** 확률(0~1)을 % 문자열로 */
export function formatRate(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return `${Math.round(n * 100)}%`;
}

/** 엑셀 파일 파싱(브라우저). xlsx를 동적 import 해 초기 번들 영향 최소화 */
export async function parseSalesOutlookWorkbook(file: File): Promise<SalesOutlookData> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetRows: Record<string, SheetRows> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    sheetRows[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as SheetRows;
  }
  // parsedAt은 호출 측에서 주입할 수도 있으나, 앱 런타임에서는 현재 시각 사용
  const parsedAtIso = new Date().toISOString();
  return buildOutlookFromSheets(wb.SheetNames, sheetRows, file.name, parsedAtIso);
}
