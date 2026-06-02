import { describe, it, expect } from 'vitest';
import {
  buildOutlookFromSheets,
  summarizePlan,
  summarizeLedger,
  toNum,
  toDateStr,
  formatRate,
  formatKRWCompact,
  inferStdKind,
  stdColShortLabel,
  formatStdCell,
} from '../salesOutlook';

// 계획 시트: 0행 제목, 3행 헤더, 4행~ 데이터. 헤더 순서를 일부 섞어 "이름 기반 매핑"을 검증.
const planSheet = [
  ['2026년 수주 및 청구 계획(안)'],
  [],
  [],
  [
    '사업부',
    'PJ코드',
    '구분',
    '업무단계',
    '사업형태',
    '고객형태',
    '발주처',
    '사업명',
    '사업시작',
    '사업종료',
    '수주월',
    'PM',
    '사업예산',
    '낙찰률',
    '수주확률',
    '지분율',
    '예상수주금액',
    '영업 현황',
    '이월액',
  ],
  [
    '모빌리티사업부',
    '3508',
    '이월',
    '수행',
    '제품',
    '기업-해양',
    '디케이엠텍',
    '해경 100톤급 ECDIS',
    new Date(2025, 0, 28),
    new Date(2026, 5, 30),
    '01월',
    '한영석',
    100000000,
    1,
    0.9,
    1,
    90000000,
    '협상',
    0,
  ],
  [
    '모빌리티사업부',
    '',
    '예정',
    '기획',
    '제품',
    '기업-해양',
    '강남조선',
    'ECDIS_해경 200톤급',
    new Date(2026, 0, 10),
    new Date(2027, 8, 30),
    '',
    '신현빈',
    240000000,
    1,
    0.5,
    1,
    120000000,
    '',
    0,
  ],
  // 범례 행(사업명 없음) → 제외되어야 함
  ['', '', '이월', '기획', '용역', '정부-해양'],
  // 합계 행(사업명 없음) → 제외
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 210000000],
];

// 매출장: 0행 헤더, 1행~ 데이터, '소계' 행 포함
const ledgerSheet = [
  [
    '프로젝트코드',
    '프로젝트',
    '발생일자',
    '월',
    '적요',
    '세무구분',
    '거래처명',
    '사업자등록번호',
    '공급가액',
    '세액',
    '합계',
    '회계일자',
    '사업부',
    '사업장',
    '국세청전송상태',
  ],
  [
    '3511',
    '13인치 단말기',
    new Date(2026, 0, 19),
    1,
    'A/S',
    '과세(매출세금계산서)',
    '한마음통신',
    '850-87-00653',
    273636,
    27364,
    301000,
    '20260119',
    '모빌리티',
    '(주)지엠티',
    '전송성공',
  ],
  [
    '3511',
    '13인치 단말기',
    new Date(2026, 1, 5),
    2,
    '국민1호',
    '과세(매출세금계산서)',
    '노아',
    '567-06-00562',
    1809091,
    180909,
    1990000,
    '20260205',
    '모빌리티',
    '(주)지엠티',
    '전송성공',
  ],
  ['소계', '3511 소계', '', '', '', '', '', '', 2082727, 208273, 2291000, '', '', '', ''],
];

// 원가 원장(차변/대변) → 인식 제외 대상
const costSheet = [
  ['계정명', '프로젝트코드', '회계일자', '월', '적요', '거래처', '차변', '대변', '잔액'],
  ['상품', '4041', new Date(2026, 0, 8), 1, '전자해도 구매', '한국해양조사협회', 90000, '', 9533892],
];

const sheetOrder = ['전체사업부', '매출장', '상품원재료'];
const sheetRows = { 전체사업부: planSheet, 매출장: ledgerSheet, 상품원재료: costSheet };

describe('buildOutlookFromSheets', () => {
  const data = buildOutlookFromSheets(sheetOrder, sheetRows as never, 'test.xlsx', '2026-06-02T00:00:00.000Z');

  it('계획 시트를 인식하고 사업명 있는 행만 파싱', () => {
    expect(data.planSheetNames).toEqual(['전체사업부']);
    const rows = data.planRowsBySheet['전체사업부'];
    expect(rows).toHaveLength(2); // 범례·합계 행 제외
    expect(rows[0].name).toBe('해경 100톤급 ECDIS');
    expect(rows[0].pjCode).toBe('3508');
    expect(rows[0].category).toBe('이월');
  });

  it('헤더 이름 기반 매핑(낙찰률/수주확률 위치가 섞여도 정확)', () => {
    const r = data.planRowsBySheet['전체사업부'][0];
    expect(r.winRate).toBe(1); // 낙찰률
    expect(r.orderProb).toBe(0.9); // 수주확률
    expect(r.expectedAmount).toBe(90000000);
    expect(r.budget).toBe(100000000);
    expect(r.startDate).toBe('2025-01-28');
    expect(r.endDate).toBe('2026-06-30');
    expect(r.pm).toBe('한영석');
  });

  it('매출장을 인식하고 소계 행 제외', () => {
    expect(data.ledgerRows).toHaveLength(2);
    expect(data.ledgerRows[0].total).toBe(301000);
    expect(data.ledgerRows[1].month).toBe(2);
    expect(data.ledgerRows.every((r) => r.project !== '3511 소계')).toBe(true);
  });

  it('인식 못한 원가 시트는 skippedSheets로', () => {
    expect(data.skippedSheets).toEqual(['상품원재료']);
  });

  it('표준 표양식 열 정의(planColumnsBySheet)와 행 셀(cells)을 생성', () => {
    const cols = data.planColumnsBySheet['전체사업부'];
    expect(cols).toHaveLength(19); // 헤더 라벨 수
    expect(cols[0]).toEqual({ group: '', label: '사업부', kind: 'text' });
    expect(cols.find((c) => c.label === '예상수주금액')?.kind).toBe('num');
    expect(cols.find((c) => c.label === '낙찰률')?.kind).toBe('rate');
    // 첫 데이터 행의 셀: 사업부(0) 텍스트, 예상수주금액(16) 숫자
    const cells = data.planRowsBySheet['전체사업부'][0].cells;
    expect(cells[0]).toBe('모빌리티사업부');
    expect(cells[16]).toBe(90000000);
  });
});

describe('표준 표 헬퍼', () => {
  it('inferStdKind', () => {
    expect(inferStdKind('예상수주금액')).toBe('num');
    expect(inferStdKind('1월-청구계획')).toBe('num');
    expect(inferStdKind('낙찰률')).toBe('rate');
    expect(inferStdKind('영업-매입률(%)')).toBe('rate');
    expect(inferStdKind('사업시작')).toBe('date');
    expect(inferStdKind('사업부')).toBe('text');
  });
  it('stdColShortLabel: 그룹 접두 제거', () => {
    expect(stdColShortLabel('1월-청구계획')).toBe('청구계획');
    expect(stdColShortLabel('영업-영업이익')).toBe('영업이익');
    expect(stdColShortLabel('사업부')).toBe('사업부');
  });
  it('formatStdCell: 종류별 포맷', () => {
    expect(formatStdCell(90000000, 'num')).toBe('90,000,000');
    expect(formatStdCell(0.9, 'rate')).toBe('90%');
    expect(formatStdCell('2026-01-01', 'date')).toBe('2026-01-01');
    expect(formatStdCell(null, 'num')).toBe('');
  });
});

describe('summarizePlan', () => {
  it('합계·구분별·사업부별 집계', () => {
    const data = buildOutlookFromSheets(sheetOrder, sheetRows as never, 'f', '2026-06-02T00:00:00.000Z');
    const s = summarizePlan(data.planRowsBySheet['전체사업부']);
    expect(s.count).toBe(2);
    expect(s.totalExpected).toBe(210000000);
    expect(s.totalBudget).toBe(340000000);
    expect(s.byCategory.find((c) => c.key === '이월')?.expected).toBe(90000000);
    expect(s.byCategory.find((c) => c.key === '예정')?.expected).toBe(120000000);
    expect(s.byDivision[0].key).toBe('모빌리티사업부');
  });
});

describe('summarizeLedger', () => {
  it('공급가/세액/합계·월별 집계', () => {
    const data = buildOutlookFromSheets(sheetOrder, sheetRows as never, 'f', '2026-06-02T00:00:00.000Z');
    const s = summarizeLedger(data.ledgerRows);
    expect(s.count).toBe(2);
    expect(s.totalSupply).toBe(273636 + 1809091);
    expect(s.totalAmount).toBe(301000 + 1990000);
    expect(s.byMonth).toEqual([
      { key: '1월', total: 301000 },
      { key: '2월', total: 1990000 },
    ]);
  });
});

describe('숫자·날짜·포맷 헬퍼', () => {
  it('toNum: 콤마·통화·빈값 처리', () => {
    expect(toNum('1,234,000')).toBe(1234000);
    expect(toNum('90,000원')).toBe(90000);
    expect(toNum('')).toBeUndefined();
    expect(toNum('-')).toBeUndefined();
    expect(toNum(5000)).toBe(5000);
  });
  it('toDateStr: Date·문자열 정규화', () => {
    expect(toDateStr(new Date(2026, 0, 19))).toBe('2026-01-19');
    expect(toDateStr('2025/05/19')).toBe('2025-05-19');
    expect(toDateStr('')).toBe('');
  });
  it('formatRate / formatKRWCompact', () => {
    expect(formatRate(0.9)).toBe('90%');
    expect(formatRate(undefined)).toBe('-');
    expect(formatKRWCompact(120000000)).toBe('1.2억');
    expect(formatKRWCompact(90000)).toBe('9만');
  });
});
