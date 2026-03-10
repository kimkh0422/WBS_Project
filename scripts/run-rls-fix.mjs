#!/usr/bin/env node
/**
 * RLS 무한 재귀 + 초기 데이터 저장 실패 수정
 *
 * 사용법:
 * 1. .env에 SUPABASE_DB_PASSWORD 또는 SUPABASE_DB_URL 설정
 * 2. npm run db:fix-rls
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

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

async function getDbUrl() {
  const envPath = join(process.cwd(), '.env');
  const projectRef = getProjectRef();
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
  } catch {}
  return process.env.SUPABASE_DB_URL || null;
}

async function main() {
  const dbUrl = await getDbUrl();
  if (!dbUrl) {
    console.error(`
[오류] 데이터베이스 연결 정보가 필요합니다.

방법 1: .env에 추가
  SUPABASE_DB_PASSWORD=여기에_비밀번호

방법 2: 환경 변수로 전달
  SUPABASE_DB_PASSWORD=xxx npm run db:fix-rls

방법 3: DB 비밀번호 없이 수동 적용
  npm run db:fix-rls-open
  → SQL이 클립보드에 복사되고 Supabase SQL Editor가 열립니다. 붙여넣기 후 Run 실행

비밀번호 확인: Supabase 대시보드 > Project Settings > Database > Database password
`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const sql = readFileSync(
      join(__dirname, '../supabase/migrations/FIX_RLS_RECURSION_NOW.sql'),
      'utf8'
    );
    await client.query(sql);
    console.log('[완료] RLS 정책 수정이 성공적으로 적용되었습니다.');
    console.log('[안내] 앱을 새로고침하면 초기 프로젝트 생성이 정상 동작합니다.');
  } catch (err) {
    console.error('[오류]', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
