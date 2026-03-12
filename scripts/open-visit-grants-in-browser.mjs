#!/usr/bin/env node
/**
 * visits 관련 RPC 권한(GRANT) SQL을 클립보드에 복사하고 Supabase SQL 에디터를 엽니다.
 * 프로젝트 ref를 알 수 없으면 Supabase 대시보드로 이동합니다.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getProjectRefFromEnvFile(filePath) {
  try {
    const env = readFileSync(filePath, 'utf8');
    const m = env.match(/VITE_SUPABASE_URL=https?:\/\/([a-z0-9]+)\.supabase\.co/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getProjectRef() {
  return (
    getProjectRefFromEnvFile(join(process.cwd(), '.env')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.local')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.production')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.example')) ||
    null
  );
}

const projectRef = getProjectRef();
const sqlPath = join(__dirname, '../supabase/migrations/20260312100000_grant_visit_rpcs.sql');
const sql = readFileSync(sqlPath, 'utf8');
const url = projectRef
  ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
  : 'https://supabase.com/dashboard';

try {
  if (process.platform === 'win32') {
    const tmpFile = join(process.cwd(), 'temp-visit-grants.sql');
    writeFileSync(tmpFile, sql, 'utf8');
    execSync(`powershell -Command "Get-Content '${tmpFile.replace(/'/g, "''")}' -Raw | Set-Clipboard"`, { stdio: 'inherit' });
    writeFileSync(tmpFile, '', 'utf8');
  } else {
    execSync('pbcopy', { input: sql, encoding: 'utf8' });
  }
  console.log('[완료] visits RPC 권한(GRANT) SQL이 클립보드에 복사되었습니다.');
  console.log('[안내] Supabase SQL 에디터를 엽니다. Ctrl+V로 붙여넣기 후 Run을 누르세요.');
  if (!projectRef) {
    console.log('[주의] 프로젝트 ref를 찾지 못했습니다. 대시보드에서 대상 프로젝트의 SQL Editor로 이동해 실행하세요.');
  }
  execSync(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`, { shell: true });
} catch (e) {
  console.log('SQL 파일:', sqlPath);
  console.log('\nSupabase SQL Editor:', url);
  console.log('위 파일 내용을 복사해 SQL Editor에 붙여넣고 Run을 실행하세요.');
}

