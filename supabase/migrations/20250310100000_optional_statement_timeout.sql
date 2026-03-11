-- =============================================================================
-- 선택적: statement_timeout 증가 (일정 연쇄 저장 등 대량 upsert 시 57014 방지)
-- Supabase 대시보드 → SQL Editor에서 실행
-- 
-- 기본값: authenticated 8초, anon 3초
-- 이 스크립트로 30초로 상향 (최대 60초까지 설정 가능)
-- =============================================================================

-- authenticated 역할 (로그인 사용자): 8초 → 30초
ALTER ROLE authenticated SET statement_timeout = '30s';

-- anon 역할 (비로그인): 3초 → 15초
ALTER ROLE anon SET statement_timeout = '15s';

-- PostgREST 설정 리로드
NOTIFY pgrst, 'reload config';
