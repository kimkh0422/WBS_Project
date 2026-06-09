-- 개인 To-Do 칸반의 행(스윔레인) + personal_todos.row_id
-- 행: 사용자가 추가하는 가로 구분(예: 프로젝트·우선순위 등). 카드는 (행 × 상태) 칸에 위치.
-- 본인만 접근(RLS). 행 삭제 시 그 행의 카드는 기본(미분류) 행으로(row_id = NULL).
-- ※ 이 마이그레이션은 personal_todos 테이블이 먼저 있어야 합니다(20260609120000_add_personal_todos.sql).

CREATE TABLE IF NOT EXISTS personal_todo_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_todo_rows_user ON personal_todo_rows(user_id, sort_order);

ALTER TABLE personal_todo_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_todo_rows_select_own" ON personal_todo_rows;
CREATE POLICY "personal_todo_rows_select_own" ON personal_todo_rows FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_rows_insert_own" ON personal_todo_rows;
CREATE POLICY "personal_todo_rows_insert_own" ON personal_todo_rows FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_rows_update_own" ON personal_todo_rows;
CREATE POLICY "personal_todo_rows_update_own" ON personal_todo_rows FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_rows_delete_own" ON personal_todo_rows;
CREATE POLICY "personal_todo_rows_delete_own" ON personal_todo_rows FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS personal_todo_rows_updated_at ON personal_todo_rows;
CREATE TRIGGER personal_todo_rows_updated_at
  BEFORE UPDATE ON personal_todo_rows
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();

-- personal_todos에 행 배정 컬럼(NULL = 기본/미분류 행). 행 삭제 시 SET NULL.
ALTER TABLE personal_todos ADD COLUMN IF NOT EXISTS row_id uuid REFERENCES personal_todo_rows(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_personal_todos_user_row ON personal_todos(user_id, row_id);
