-- 이슈 플래그: tasks.is_issue 추가
-- Supabase 대시보드 SQL 에디터에서 실행하거나, CLI로 적용하세요.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_issue boolean DEFAULT false;

