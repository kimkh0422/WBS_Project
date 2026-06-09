-- 개인 To-Do(칸반): 사용자별 개인 할일 보드. 본인만 조회·작성·수정·삭제(팀 공유 아님).
-- status(칸): 'todo'(할일) | 'in-progress'(진행중) | 'done'(완료) | 'etc'(기타)
-- sort_order: 같은 칸 안에서의 표시 순서(작을수록 위). 카드 이동/정렬 시 중간값으로 갱신.

CREATE TABLE IF NOT EXISTS personal_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo',
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_todos_user ON personal_todos(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_todos_user_status ON personal_todos(user_id, status, sort_order);

-- RLS: 개인 데이터이므로 모든 동작을 본인(user_id = auth.uid())으로 제한.
ALTER TABLE personal_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_todos_select_own" ON personal_todos;
CREATE POLICY "personal_todos_select_own" ON personal_todos FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todos_insert_own" ON personal_todos;
CREATE POLICY "personal_todos_insert_own" ON personal_todos FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todos_update_own" ON personal_todos;
CREATE POLICY "personal_todos_update_own" ON personal_todos FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todos_delete_own" ON personal_todos;
CREATE POLICY "personal_todos_delete_own" ON personal_todos FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- updated_at 자동 갱신 (기존 set_updated_at() 트리거 함수 재사용)
DROP TRIGGER IF EXISTS personal_todos_updated_at ON personal_todos;
CREATE TRIGGER personal_todos_updated_at
  BEFORE UPDATE ON personal_todos
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();
