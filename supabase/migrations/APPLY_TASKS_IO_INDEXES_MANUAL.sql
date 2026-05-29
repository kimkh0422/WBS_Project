-- =============================================================================
-- tasks I/O 인덱스 — SQL Editor 타임아웃 시
--
-- ★ 권장: 터미널에서 (Editor 60초 제한 우회)
--   .env 에 SUPABASE_DB_PASSWORD 설정 후
--   npm run db:tasks-indexes
--
-- SQL Editor 사용 시: 아래를 한 줄씩만 실행 (두 줄 동시 X)
--   1) WBS 탭·동기화 모두 닫기
--   2) Compute 플랜 변경 후 10~30분 뒤 재시도
--
-- 앱은 인덱스 없이도 동작합니다(증분 pull 실패 시 전체 조회로 폴백).
-- =============================================================================

-- ── 0) 세션 제한 완화 (이 쿼리만 실행) ─────────────────────────────────────
SET statement_timeout = 0;
SET lock_timeout = '300s';

-- ── 1) 가장 중요: updated_at 증분 pull용 (이 쿼리만 실행 → Success 확인) ───
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON public.tasks (updated_at);

-- ── 2) 1번 성공 후, 새 쿼리 탭에서 이것만 실행 ─────────────────────────────
-- CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON public.tasks (project_id, updated_at DESC);

-- ── (선택) 여전히 타임아웃이면 CONCURRENTLY — Editor가 트랜잭션 밖 실행을 지원할 때만
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_updated_at ON public.tasks (updated_at);

-- 적용 확인:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'tasks' AND indexname LIKE 'idx_tasks_%';
