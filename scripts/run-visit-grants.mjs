#!/usr/bin/env node
/**
 * visits 관련 RPC 권한(GRANT) 적용
 *
 * 사용법:
 * 1) .env에 추가:
 *    SUPABASE_DB_PASSWORD=여기에_비밀번호
 * 2) 실행:
 *    npm run db:grant-visits
 *
 * 또는 환경 변수로:
 *    SUPABASE_DB_PASSWORD=xxx npm run db:grant-visits
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

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
  // 우선순위: .env → .env.local → .env.production → .env.example
  return (
    getProjectRefFromEnvFile(join(process.cwd(), '.env')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.local')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.production')) ||
    getProjectRefFromEnvFile(join(process.cwd(), '.env.example')) ||
    null
  );
}

async function getDbUrl() {
  const projectRef = getProjectRef();
  const candidates = ['.env', '.env.local', '.env.production', '.env.example'].map((f) => join(process.cwd(), f));

  for (const envPath of candidates) {
    try {
      const env = readFileSync(envPath, 'utf8');
      for (const line of env.split('\n')) {
        const m = line.match(/^\s*SUPABASE_DB_URL\s*=\s*["']?(.+?)["']?\s*$/);
        if (m) return m[1].trim();
        const m2 = line.match(/^\s*SUPABASE_DB_PASSWORD\s*=\s*["']?(.+?)["']?\s*$/);
        if (m2 && projectRef) {
          const pw = m2[1].trim();
          return `postgresql://postgres:${encodeURIComponent(pw)}@db.${projectRef}.supabase.co:5432/postgres`;
        }
      }
    } catch {
      // ignore
    }
  }

  // 환경 변수 fallback
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  if (process.env.SUPABASE_DB_PASSWORD && projectRef) {
    const pw = String(process.env.SUPABASE_DB_PASSWORD);
    return `postgresql://postgres:${encodeURIComponent(pw)}@db.${projectRef}.supabase.co:5432/postgres`;
  }
  return null;
}

async function main() {
  const dbUrl = await getDbUrl();
  if (!dbUrl) {
    console.error(`
[오류] 데이터베이스 연결 정보가 필요합니다.

방법 1: .env에 추가
  SUPABASE_DB_PASSWORD=여기에_비밀번호

방법 2: 환경 변수로 전달
  SUPABASE_DB_PASSWORD=xxx npm run db:grant-visits

방법 3: DB 비밀번호 없이 수동 적용
  npm run db:grant-visits-open
  → SQL이 클립보드에 복사되고 Supabase SQL Editor가 열립니다. 붙여넣기 후 Run 실행
`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const sql = readFileSync(
      join(__dirname, '../supabase/migrations/20260312100000_grant_visit_rpcs.sql'),
      'utf8'
    );
    await client.query(sql);
    console.log('[완료] visits RPC 권한(GRANT)이 성공적으로 적용되었습니다.');
  } catch (err) {
    console.error('[오류]', err?.message ?? String(err));
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

