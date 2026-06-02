/**
 * 영업 아웃룩 시드 데이터 생성기.
 *
 * 원본 엑셀을 앱 파서(buildOutlookFromSheets)로 그대로 파싱해
 * `src/data/salesOutlookData.ts` (SALES_OUTLOOK_DATA)를 생성한다.
 * 앱은 업로드 없이 이 데이터를 바로 시각화한다.
 *
 * 매월 갱신: 새 파일 경로를 SRC에 넣고(또는 인자로 전달) 다시 실행.
 *   npx tsx scripts/gen-sales-outlook.ts ["엑셀경로"]
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { buildOutlookFromSheets } from '../src/lib/salesOutlook';

const SRC = process.argv[2] || 'C:/Users/ejavm/Downloads/2026. 4월 사업부별 영업아웃룩_v1.4.xlsx';
const FILE_LABEL = path.basename(SRC);
// 데이터 기준 시점(자료 버전). 표시·정렬에만 사용하므로 고정값으로 둔다.
const AS_OF_ISO = '2026-04-01T00:00:00.000Z';

const wb = XLSX.read(fs.readFileSync(SRC), { type: 'buffer', cellDates: true });
const sheetRows: Record<string, unknown[][]> = {};
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  if (!ws) continue;
  sheetRows[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][];
}

// buildOutlookFromSheets는 Cell[][] 기반 순수 함수 (브라우저 의존성 없음)
const data = buildOutlookFromSheets(wb.SheetNames, sheetRows as never, FILE_LABEL, AS_OF_ISO);

const out =
  `// AUTO-GENERATED — 원본 "${FILE_LABEL}"에서 scripts/gen-sales-outlook.ts로 생성. 직접 수정 금지.\n` +
  `// 갱신: npx tsx scripts/gen-sales-outlook.ts "<새 엑셀 경로>"\n` +
  `/* eslint-disable */\n` +
  `import type { SalesOutlookData } from '../lib/salesOutlook';\n\n` +
  `export const SALES_OUTLOOK_DATA: SalesOutlookData = ${JSON.stringify(data, null, 2)};\n`;

const outPath = path.resolve('src/data/salesOutlookData.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');

const planCounts = Object.fromEntries(Object.entries(data.planRowsBySheet).map(([k, v]) => [k, v.length]));
console.log('generated', outPath);
console.log('plan sheets:', planCounts);
console.log('ledger rows:', data.ledgerRows.length, '| skipped:', data.skippedSheets, '| bytes:', out.length);
