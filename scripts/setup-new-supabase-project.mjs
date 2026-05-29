#!/usr/bin/env node
/**
 * 새 Supabase 클라우드 프로젝트에 WBS 스키마 전체 적용 + .env.test 생성 + 연결 검증
 *
 * 1) https://supabase.com/dashboard/new-project 에서 새 프로젝트 생성 (리전: Northeast Asia 권장)
 * 2) .env.new.example 을 .env.new 로 복사 후 URL·anon key·DB pooler URL 입력
 * 3) npm run db:setup-new
 * 4) npm run dev:test
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import { listOrderedMigrations } from './lib/listMigrations.mjs';
const root = process.cwd();
const ENV_NEW = join(root, '.env.new');
const ENV_TEST = join(root, '.env.test');
const migrationsDir = join(root, 'supabase', 'migrations');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function buildEnvTestContent(cfg) {
  return [
    '# 새 Supabase 테스트 프로젝트 (npm run dev:test)',
    `VITE_SUPABASE_URL=${cfg.VITE_SUPABASE_URL}`,
    `VITE_SUPABASE_ANON_KEY=${cfg.VITE_SUPABASE_ANON_KEY}`,
    cfg.SUPABASE_DB_URL ? `SUPABASE_DB_URL=${cfg.SUPABASE_DB_URL}` : '',
    cfg.SUPABASE_DB_PASSWORD ? `SUPABASE_DB_PASSWORD=${cfg.SUPABASE_DB_PASSWORD}` : '',
    '# Realtime 부담 줄이기 (테스트용)',
    'VITE_BILLING_PLAN=free',
    'VITE_REALTIME_ENABLED=false',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function verifyRestApi(url, anonKey) {
  const base = url.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/projects?select=id&limit=1`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`REST API ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function verifyAuth(url, anonKey) {
  const base = url.replace(/\/$/, '');
  const res = await fetch(`${base}/auth/v1/health`, {
    headers: { apikey: anonKey },
  });
  if (!res.ok && res.status !== 401) {
    throw new Error(`Auth health ${res.status}`);
  }
}

async function main() {
  if (!existsSync(ENV_NEW)) {
    console.error(`
[오류] ${ENV_NEW} 파일이 없습니다.

1. .env.new.example 을 .env.new 로 복사
2. Supabase 새 프로젝트 > Settings > API / Database 에서 값 입력
3. npm run db:setup-new
`);
    process.exit(1);
  }

  const cfg = loadEnvFile(ENV_NEW);
  const supabaseUrl = cfg.VITE_SUPABASE_URL;
  const anonKey = cfg.VITE_SUPABASE_ANON_KEY;
  const dbUrl = cfg.SUPABASE_DB_URL;

  if (!supabaseUrl || !anonKey) {
    console.error('[오류] .env.new 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 가 필요합니다.');
    process.exit(1);
  }
  if (!dbUrl) {
    console.error(
      '[오류] .env.new 에 SUPABASE_DB_URL 이 필요합니다.\n' +
        '  Dashboard > Connect > Session mode (port 5432) URI 전체를 복사하세요.',
    );
    process.exit(1);
  }

  const migrations = listOrderedMigrations(migrationsDir);
  console.log(`[정보] 마이그레이션 ${migrations.length}개 적용 예정`);

  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 120_000,
    ssl: /\.supabase\.com/i.test(dbUrl) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log('[연결] Postgres 연결 성공');
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 600000');

    let applied = 0;
    let skipped = 0;
    for (const file of migrations) {
      const name = file.split(/[/\\]/).pop();
      const sql = readFileSync(file, 'utf8');
      try {
        await client.query(sql);
        applied++;
        console.log(`[OK] ${name}`);
      } catch (err) {
        const msg = String(err.message || err);
        if (/already exists|duplicate/i.test(msg)) {
          skipped++;
          console.log(`[건너뜀] ${name} — 이미 적용됨`);
        } else {
          console.error(`[실패] ${name}:`, msg);
          throw err;
        }
      }
    }
    console.log(`[완료] 마이그레이션 적용: ${applied}개, 건너뜀: ${skipped}개`);
  } finally {
    await client.end();
  }

  writeFileSync(ENV_TEST, buildEnvTestContent(cfg), 'utf8');
  console.log(`[저장] ${ENV_TEST}`);

  console.log('[검증] REST / Auth API 확인 중…');
  await verifyRestApi(supabaseUrl, anonKey);
  await verifyAuth(supabaseUrl, anonKey);
  console.log('[검증] API 응답 정상');

  const m = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  const ref = m ? m[1] : '';
  const configPath = join(root, 'supabase', 'config.toml');
  if (ref && existsSync(configPath)) {
    const toml = readFileSync(configPath, 'utf8');
  const next = toml.replace(/^(\s*project_id\s*=\s*).+$/m, `$1"${ref}"`);
    if (next !== toml) {
      writeFileSync(configPath, next, 'utf8');
      console.log(`[저장] supabase/config.toml project_id → ${ref}`);
    }
  }
  console.log(`
========================================
  새 DB 설정 완료
========================================

다음 단계:
  1) Authentication > URL Configuration
     Site URL: http://localhost:3000
     Redirect URLs: http://localhost:3000/**

  2) 로컬 테스트 실행:
     npm run dev:test

  3) 회원가입 후 profiles.approved = true (또는 관리자 승인 RPC)

대시보드: https://supabase.com/dashboard/project/${ref || 'YOUR_REF'}
`);
}

main().catch((err) => {
  console.error('[오류]', err.message);
  process.exit(1);
});
