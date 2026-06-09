#!/usr/bin/env node
/**
 * 개인 To-Do 칸반의 행(personal_todo_rows) + personal_todos.row_id 마이그레이션을
 * 클립보드에 복사하고 Supabase SQL 에디터를 엽니다. 붙여넣기(Ctrl+V) 후 Run 하세요.
 *
 * 안전을 위해 기본 테이블(personal_todos) 마이그레이션도 함께 복사합니다(모두 멱등 — 재실행 무해).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getProjectRef() {
  try {
    const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
    const m = env.match(/VITE_SUPABASE_URL=https?:\/\/([a-z0-9]+)\.supabase\.co/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const base = join(__dirname, '../supabase/migrations/20260609120000_add_personal_todos.sql');
const rowsSql = join(__dirname, '../supabase/migrations/20260609130000_add_personal_todo_rows.sql');
const sql = [
  '-- (1) 개인 To-Do 기본 테이블 (이미 적용했다면 멱등하게 통과)',
  readFileSync(base, 'utf8'),
  '\n-- (2) 행(스윔레인) 테이블 + row_id 컬럼',
  readFileSync(rowsSql, 'utf8'),
].join('\n');

const projectRef = getProjectRef();
const url = projectRef ? `https://supabase.com/dashboard/project/${projectRef}/sql/new` : 'https://supabase.com/dashboard';

try {
  if (process.platform === 'win32') {
    const tmpFile = join(process.cwd(), 'temp-migration.sql');
    writeFileSync(tmpFile, sql, 'utf8');
    execSync(`powershell -Command "Get-Content '${tmpFile.replace(/'/g, "''")}' -Raw | Set-Clipboard"`, { stdio: 'inherit' });
    writeFileSync(tmpFile, '', 'utf8');
  } else {
    execSync('pbcopy', { input: sql, encoding: 'utf8' });
  }
  console.log('[완료] 개인 칸반(테이블 + 행) 마이그레이션 SQL이 클립보드에 복사되었습니다.');
  console.log('[안내] Supabase SQL 에디터를 엽니다. Ctrl+V로 붙여넣기 후 Run을 누르세요.');
  if (!projectRef) {
    console.log('[주의] .env에 VITE_SUPABASE_URL이 없습니다.');
  }
  execSync(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`, { shell: true });
} catch (e) {
  console.log('SQL 파일:', base, '+', rowsSql);
  console.log('\nSupabase SQL Editor:', url);
  console.log('위 두 파일 내용을 복사해 SQL Editor에 붙여넣고 Run을 실행하세요.');
}
