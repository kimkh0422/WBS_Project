#!/usr/bin/env node
/**
 * RLS 수정 SQL(FIX_RLS_RECURSION_NOW.sql)을 클립보드에 복사하고 Supabase SQL 에디터를 엽니다.
 * DB 비밀번호 없이 수동 적용 시 사용: npm run db:fix-rls-open
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
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

const projectRef = getProjectRef();
const sqlPath = join(__dirname, '../supabase/migrations/FIX_RLS_RECURSION_NOW.sql');
const sql = readFileSync(sqlPath, 'utf8');
const url = projectRef
  ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
  : 'https://supabase.com/dashboard';

try {
  if (process.platform === 'win32') {
    const tmpFile = join(process.cwd(), 'temp-migration.sql');
    writeFileSync(tmpFile, sql, 'utf8');
    execSync(`powershell -Command "Get-Content '${tmpFile.replace(/'/g, "''")}' -Raw | Set-Clipboard"`, { stdio: 'inherit' });
    try { unlinkSync(tmpFile); } catch {}
  } else {
    execSync('pbcopy', { input: sql, encoding: 'utf8' });
  }
  console.log('[완료] RLS 수정 SQL이 클립보드에 복사되었습니다.');
  console.log('[안내] Supabase SQL 에디터를 엽니다. Ctrl+V로 붙여넣기 후 Run을 누르세요.');
  execSync(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`, { shell: true });
} catch (e) {
  console.log('SQL 파일:', sqlPath);
  console.log('\nSupabase SQL Editor:', url);
  console.log('위 파일 내용을 복사해 SQL Editor에 붙여넣고 Run을 실행하세요.');
}
