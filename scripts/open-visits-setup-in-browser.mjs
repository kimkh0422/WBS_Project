#!/usr/bin/env node
/**
 * 방문 통계(visits) 전체 셋업 SQL을 클립보드에 복사하고 Supabase SQL Editor를 엽니다.
 * 포함: visits 테이블 + record_visit/get_visitor_stats + get_member_visit_stats + GRANT(존재 시)
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

function readMigration(relPath) {
  return readFileSync(join(__dirname, relPath), 'utf8').trim();
}

const projectRef = getProjectRef();
const url = projectRef
  ? `https://supabase.com/dashboard/project/${projectRef}/sql/new`
  : 'https://supabase.com/dashboard';

const sql = [
  '-- =============================================================================',
  '-- 방문 통계(visits) 전체 셋업 (한 번에 실행)',
  '-- =============================================================================',
  '',
  readMigration('../supabase/migrations/20250310090000_add_visits_table.sql'),
  '',
  readMigration('../supabase/migrations/20250312150000_get_member_visit_stats.sql'),
  '',
  readMigration('../supabase/migrations/20260312100000_grant_visit_rpcs.sql'),
  '',
].join('\n');

try {
  if (process.platform === 'win32') {
    const tmpFile = join(process.cwd(), 'temp-visits-setup.sql');
    writeFileSync(tmpFile, sql, 'utf8');
    execSync(`powershell -Command "Get-Content '${tmpFile.replace(/'/g, "''")}' -Raw | Set-Clipboard"`, {
      stdio: 'inherit',
    });
    writeFileSync(tmpFile, '', 'utf8');
  } else {
    execSync('pbcopy', { input: sql, encoding: 'utf8' });
  }
  console.log('[완료] visits 셋업 SQL이 클립보드에 복사되었습니다.');
  console.log('[안내] Supabase SQL 에디터를 엽니다. Ctrl+V로 붙여넣기 후 Run을 누르세요.');
  if (!projectRef) {
    console.log('[주의] 프로젝트 ref를 찾지 못했습니다. 대시보드에서 대상 프로젝트의 SQL Editor로 이동해 실행하세요.');
  }
  execSync(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`, { shell: true });
} catch (e) {
  console.log('\nSupabase SQL Editor:', url);
  console.log('아래 파일들을 순서대로 실행해도 됩니다:');
  console.log('- supabase/migrations/20250310090000_add_visits_table.sql');
  console.log('- supabase/migrations/20250312150000_get_member_visit_stats.sql');
  console.log('- supabase/migrations/20260312100000_grant_visit_rpcs.sql');
}

