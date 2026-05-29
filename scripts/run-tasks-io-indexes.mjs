#!/usr/bin/env node
/**
 * tasks I/O 인덱스 적용 — Supabase SQL Editor 타임아웃 우회
 *
 * SQL Editor는 요금제와 관계없이 연결 타임아웃(~60초)이 있어 CREATE INDEX가 끊길 수 있습니다.
 * 이 스크립트는 DB에 직접 연결하고 statement_timeout 없이 한 개씩 인덱스를 만듭니다.
 *
 * 사용법:
 *   .env에 SUPABASE_DB_PASSWORD=... (또는 SUPABASE_DB_URL)
 *   npm run db:tasks-indexes
 */

import pg from 'pg';
import { resolveSupabaseDbUrl } from './lib/supabaseDbUrl.mjs';

const INDEXES = [
  {
    name: 'idx_tasks_updated_at',
    sql: 'CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON public.tasks (updated_at)',
  },
  {
    name: 'idx_tasks_project_updated',
    sql: 'CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON public.tasks (project_id, updated_at DESC)',
  },
];

async function main() {
  const dbUrl = resolveSupabaseDbUrl();
  if (!dbUrl) {
    console.error(`
[오류] DB 직접 연결 정보가 필요합니다.

.env에 추가 (Supabase > Project Settings > Database > Database password):
  SUPABASE_DB_PASSWORD=여기에_비밀번호

IPv4만 되는 PC에서는 db.*.supabase.co 대신 pooler URL을 쓰세요:
  SUPABASE_DB_URL=postgresql://postgres.프로젝트ID:비밀번호@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
  (대시보드 Connect > Session mode 에서 복사)

또는:
  SUPABASE_DB_PASSWORD=xxx npm run db:tasks-indexes
`);
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 120_000,
    query_timeout: 0,
    statement_timeout: 0,
    ssl: /\.supabase\.com/i.test(dbUrl) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log('[연결] DB 직접 연결 성공');

    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 600000');

    const { rows: sizeRows } = await client.query(`
      SELECT COUNT(*)::bigint AS n,
             COALESCE(pg_size_pretty(pg_total_relation_size('public.tasks')), '?') AS size
      FROM public.tasks
    `);
    const rowCount = Number(sizeRows[0]?.n ?? 0);
    const tableSize = sizeRows[0]?.size ?? '?';
    console.log(`[정보] public.tasks 행 수: ${rowCount}, 크기: ${tableSize}`);

    const { rows: existing } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tasks'
        AND indexname = ANY($1::text[])
    `, [INDEXES.map((i) => i.name)]);

    const have = new Set(existing.map((r) => r.indexname));

    for (const idx of INDEXES) {
      if (have.has(idx.name)) {
        console.log(`[건너뜀] ${idx.name} — 이미 존재`);
        continue;
      }
      console.log(`[실행] ${idx.name} 생성 중… (수 분 걸릴 수 있음)`);
      const t0 = Date.now();
      await client.query(idx.sql);
      console.log(`[완료] ${idx.name} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    }

    const { rows: final } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tasks'
        AND indexname LIKE 'idx_tasks_%'
      ORDER BY 1
    `);
    console.log('[확인] tasks 인덱스:', final.map((r) => r.indexname).join(', ') || '(없음)');
    console.log('[완료] 인덱스 적용이 끝났습니다. WBS 앱을 새로고침하세요.');
  } catch (err) {
    console.error('[오류]', err.message);
    if (/ENOTFOUND|getaddrinfo/i.test(String(err.message))) {
      console.error(`
[힌트] db.PROJECT.supabase.co 는 IPv6 전용이라 Windows에서 실패할 수 있습니다.
  .env에 Session pooler URL 전체를 넣으세요 (Connect > Session mode, port 5432):
  SUPABASE_DB_URL=postgresql://postgres.프로젝트ID:비밀번호@aws-1-리전.pooler.supabase.com:5432/postgres
`);
    } else if (/timeout|terminated/i.test(String(err.message))) {
      console.error(`
[힌트] 여전히 타임아웃이면:
  1) Supabase 대시보드 > Project Settings > Compute — 플랜 변경이 "Active"인지 확인 (반영까지 10~30분)
  2) WBS 탭을 모두 닫고 다시 npm run db:tasks-indexes
  3) 행 수가 매우 많으면(수십만) Supabase 지원 또는 유지보수 시간대에 재시도
`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
