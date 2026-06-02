/**
 * `weeklyReport.html`의 `REPORTS` 항목이 따르는 **통일 스키마** 타입 정의입니다.
 * (런타임 검증은 하지 않으며, 문서·IDE 자동완성용입니다.)
 */

export type WeeklyReportProgress = {
  plan?: number;
  actual?: number;
  text?: string;
};

/** 표 셀·본문에 쓰이는 중첩 불릿 `{ t, sub }` 형태 */
export type WeeklyReportContentBlock = string | { t: string; sub: string[] };

export type WeeklyReportStrategyRow = {
  div?: string;
  content?: string | string[];
  start?: string;
  plan?: string;
  end?: string;
  action?: string[];
  status?: string;
};

export type WeeklyReportIssueRow = {
  title: string;
  content?: string[];
  plan?: string[];
  result?: string[];
  status?: string;
  note?: string;
};

export type WeeklyReportProjectRow = {
  name: string;
  subtitle?: string;
  type?: string;
  period?: string;
  po?: string;
  pm?: string;
  pl?: string;
  ba?: string;
  prog?: WeeklyReportProgress;
  content?: WeeklyReportContentBlock[];
  tables?: unknown[];
  issue?: string;
  note?: string;
};

export type WeeklyReportSalesRow = {
  div?: string;
  client?: string;
  project?: string;
  amount?: string;
  when?: string;
  stage?: string;
  rate?: number;
  rateText?: string;
  content?: string[];
  note?: string;
};

export type WeeklyReportResearchRow = {
  name: string;
  org?: string;
  period?: string;
  lead?: string;
  fund?: string;
  exec?: number;
  content?: string[];
};

/** 한 조직(또는 한 보고 단위)의 통합 레코드 */
export type WeeklyReportRecord = {
  id: string;
  group: string;
  icon?: string;
  org: string;
  reporter: string;
  recipient?: string;
  strategy?: WeeklyReportStrategyRow[];
  issues?: WeeklyReportIssueRow[];
  projects?: WeeklyReportProjectRow[];
  sales?: WeeklyReportSalesRow[];
  research?: WeeklyReportResearchRow[];
  nextWeek?: string[];
};
