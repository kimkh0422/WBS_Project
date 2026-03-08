import { parseExcelWithMeta } from '../src/lib/excel';

async function main() {
  const p = 'C:\\Users\\kimkilyong\\Downloads\\WBS_(내부) ECDIS 인증 개발 일정_v1.2_20260303 (1).xlsm';
  const fs = await import('node:fs/promises');
  const b = await fs.readFile(p);
  const file = new File([b], 'debug.xlsm');

  const res = await parseExcelWithMeta(file);
  console.log('sheet', res.meta.sheetName, 'headerRow', res.meta.headerRowIndex + 1, 'mode', res.meta.mode);
  console.log('headerRow(first 40)=', res.meta.headerRow.slice(0, 40));
  console.log('mapped=');
  for (const m of res.meta.mapped) {
    console.log(`- ${m.fieldId} ${m.fieldLabel}: col=${m.columnIndex} header="${m.header}" note=${m.note ?? ''}`);
  }
  console.log('unmapped count', res.meta.unmappedHeaders.length);
  console.log('tasks', res.tasks.length);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

