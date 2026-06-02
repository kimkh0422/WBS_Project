import rawHtml from './weeklyReport.html?raw';
import { weeklyReportMeta } from './weeklyReportMeta';

/** iframe `srcDoc`용 HTML 문자열. 메타 플레이스홀더를 주입합니다. */
export function buildWeeklyReportSrcDoc(): string {
  const m = weeklyReportMeta;
  return rawHtml
    .replaceAll('__WEEKLY_META_TITLE__', m.documentTitle)
    .replaceAll('__WEEKLY_META_PERIOD__', m.reportPeriodLabel)
    .replaceAll('__WEEKLY_META_BASELINE__', m.baselineDate)
    .replaceAll('__WEEKLY_META_ORG_COUNT__', String(m.organizationCount))
    .replaceAll('__WEEKLY_META_FOOTER_NOTE__', m.footerNote);
}
