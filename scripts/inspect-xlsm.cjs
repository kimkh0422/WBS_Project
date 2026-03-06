/* eslint-disable no-console */
const XLSX = require('xlsx');

const filePath =
  process.argv.slice(2).join(' ') ||
  'C:\\Users\\kimkilyong\\Downloads\\WBS_(내부) ECDIS 인증 개발 일정_v1.2_20260303 (1).xlsm';

const keywordRe = /작업|wbs|시작|종료|진행|담당|공수|산출물|일정|계획|완료|구분|항목|No\.?|ID|레벨|상위/i;

function norm(v) {
  return String(v ?? '').trim();
}

function scoreRow(row) {
  const s = row.join('|');
  let score = 0;
  if (/작업명|taskname|name/i.test(s)) score += 6;
  if (/wbs/i.test(s)) score += 3;
  if (/시작|start/i.test(s)) score += 3;
  if (/종료|end|완료/i.test(s)) score += 3;
  if (/담당|assignee|owner|부서/i.test(s)) score += 1;
  if (/진행|진척|progress|%/i.test(s)) score += 1;
  if (/상태|status|state/i.test(s)) score += 1;
  if (/공수|effort|md|man[- ]?day|duration/i.test(s)) score += 1;
  return score;
}

function main() {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  console.log('File:', filePath);
  console.log('Sheets:', wb.SheetNames);

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    console.log(`\n=== ${sheetName} (rows=${rows.length}) ===`);

    const lim = Math.min(80, rows.length);
    let best = { idx: -1, score: -1, row: null };

    for (let i = 0; i < lim; i++) {
      const row = Array.isArray(rows[i]) ? rows[i].map(norm) : [];
      const nonEmpty = row.filter(Boolean).length;
      if (!nonEmpty) continue;

      const sc = scoreRow(row);
      if (sc > best.score) best = { idx: i, score: sc, row };

      const joined = row.join('|');
      if (keywordRe.test(joined)) {
        console.log(String(i + 1).padStart(3, '0'), joined);
      }
    }

    if (best.idx >= 0) {
      console.log(`BestHeaderCandidate: row=${best.idx + 1}, score=${best.score}`);
      console.log('  ', best.row.join('|'));
    }
  }
}

try {
  main();
} catch (e) {
  console.error('Failed:', e?.message || e);
  process.exitCode = 1;
}

