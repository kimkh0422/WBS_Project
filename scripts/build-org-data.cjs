/**
 * "지엠티 조직도.xlsx"를 파싱하여 src/data/organizationMembers.json 으로 저장한다.
 * 엑셀 구조: 4 그룹 × 5컬럼(구분/성명/부서/직위/성별) + 그룹 사이 1칸 빈 컬럼.
 *
 * 실행: `node scripts/build-org-data.cjs`
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const INPUT = path.resolve(__dirname, '..', '지엠티 조직도.xlsx');
const OUTPUT = path.resolve(__dirname, '..', 'src', 'data', 'organizationMembers.json');

const wb = XLSX.readFile(INPUT);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const members = [];
for (let r = 3; r < rows.length; r++) {
  const row = rows[r];
  for (const start of [0, 6, 12, 18]) {
    const id = row[start];
    const name = row[start + 1];
    const dept = row[start + 2];
    const pos = row[start + 3];
    const gender = row[start + 4];
    if (typeof id !== 'number' || !name || !dept) continue;
    members.push({
      name: String(name).trim(),
      department: String(dept).trim(),
      position: String(pos).trim(),
      gender: String(gender).trim(),
    });
  }
}

const outDir = path.dirname(OUTPUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(members, null, 2), 'utf8');
console.log('Wrote', members.length, 'members →', OUTPUT);
