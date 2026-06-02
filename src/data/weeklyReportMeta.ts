/**
 * 주간업무보고 통합 대시보드(`weeklyReport.html`)의 **주차·표기 메타**만 모아 둔 설정입니다.
 * 레이아웃·차트·표 렌더러는 HTML을 수정하지 않고, 여기와 `REPORTS` 배열 내용만 갱신하는 방식으로
 * 「양식 통일 + 내용만 변경」을 유지합니다.
 */
export const weeklyReportMeta = {
  /** `<title>` 및 브라우저 탭 제목 */
  documentTitle: '지엠티(GMT) 주간업무보고 통합 대시보드 · 2026년 5월 4주차',
  /** 헤더 칩「보고기간」 */
  reportPeriodLabel: '2026년 5월 4주차',
  /** 헤더 칩「기준일」(YYYY-MM-DD 권장) */
  baselineDate: '2026-06-02',
  /**
   * 푸터「N개 보고 조직 통합」의 N.
   * `weeklyReport.html`의 `REPORTS.length`와 맞추는 것을 권장합니다.
   */
  organizationCount: 21,
  /** 푸터 마지막 문장(한 줄로 표시) */
  footerNote: '원문의 모든 전략회의/이슈/업무/영업/연구과제/차주계획 내용을 포함합니다.',
} as const;
