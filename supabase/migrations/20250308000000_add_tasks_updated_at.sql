-- 낙관적 잠금(동시 수정 방지)용: tasks.updated_at 추가
-- Supabase 대시보드 SQL 에디터에서 실행하거나, CLI로 적용하세요.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 기존 행에 updated_at 채우기
UPDATE tasks SET updated_at = now() WHERE updated_at IS NULL;

-- 갱신 시 자동으로 updated_at 갱신
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();
