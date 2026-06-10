-- 개인 To-Do 카드 디테일(트렐로 스타일): 마감일·라벨·체크리스트
-- · 마감일: personal_todos에 due_date 컬럼 추가
-- · 라벨: 사용자별 정의(색·이름) → 카드와 N:M 매핑
-- · 체크리스트: 카드 1건에 다수 항목(텍스트·체크·순서)
-- 본인만 접근(RLS). junction/체크리스트는 user_id 컬럼을 함께 두어 RLS를 단순화.
-- 설명(description)은 기존 note 컬럼을 그대로 활용(별도 컬럼 추가 X).

-- ─────────────────────────────────────────────────────────
-- 1) personal_todos: 마감일 컬럼
ALTER TABLE personal_todos
  ADD COLUMN IF NOT EXISTS due_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_personal_todos_user_due ON personal_todos(user_id, due_date);

-- ─────────────────────────────────────────────────────────
-- 2) 라벨(사용자별 정의). color는 UI 측 팔레트 키('green' | 'yellow' | 'orange' | 'red' | 'purple' | 'blue' | 'sky' | 'pink' | 'gray').
CREATE TABLE IF NOT EXISTS personal_todo_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'gray',
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_todo_labels_user ON personal_todo_labels(user_id, sort_order);

ALTER TABLE personal_todo_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_todo_labels_select_own" ON personal_todo_labels;
CREATE POLICY "personal_todo_labels_select_own" ON personal_todo_labels FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_labels_insert_own" ON personal_todo_labels;
CREATE POLICY "personal_todo_labels_insert_own" ON personal_todo_labels FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_labels_update_own" ON personal_todo_labels;
CREATE POLICY "personal_todo_labels_update_own" ON personal_todo_labels FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_labels_delete_own" ON personal_todo_labels;
CREATE POLICY "personal_todo_labels_delete_own" ON personal_todo_labels FOR DELETE
  TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS personal_todo_labels_updated_at ON personal_todo_labels;
CREATE TRIGGER personal_todo_labels_updated_at
  BEFORE UPDATE ON personal_todo_labels
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 3) 카드 ↔ 라벨 매핑(N:M). user_id를 함께 두어 RLS·인덱스 단순화.
CREATE TABLE IF NOT EXISTS personal_todo_card_labels (
  todo_id uuid NOT NULL REFERENCES personal_todos(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES personal_todo_labels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_todo_card_labels_user ON personal_todo_card_labels(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_todo_card_labels_todo ON personal_todo_card_labels(todo_id);

ALTER TABLE personal_todo_card_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_todo_card_labels_select_own" ON personal_todo_card_labels;
CREATE POLICY "personal_todo_card_labels_select_own" ON personal_todo_card_labels FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_card_labels_insert_own" ON personal_todo_card_labels;
CREATE POLICY "personal_todo_card_labels_insert_own" ON personal_todo_card_labels FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_card_labels_delete_own" ON personal_todo_card_labels;
CREATE POLICY "personal_todo_card_labels_delete_own" ON personal_todo_card_labels FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────
-- 4) 체크리스트 항목
CREATE TABLE IF NOT EXISTS personal_todo_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id uuid NOT NULL REFERENCES personal_todos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  done boolean NOT NULL DEFAULT false,
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_todo_checklist_user ON personal_todo_checklist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_todo_checklist_todo ON personal_todo_checklist_items(todo_id, sort_order);

ALTER TABLE personal_todo_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_todo_checklist_items_select_own" ON personal_todo_checklist_items;
CREATE POLICY "personal_todo_checklist_items_select_own" ON personal_todo_checklist_items FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_checklist_items_insert_own" ON personal_todo_checklist_items;
CREATE POLICY "personal_todo_checklist_items_insert_own" ON personal_todo_checklist_items FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_checklist_items_update_own" ON personal_todo_checklist_items;
CREATE POLICY "personal_todo_checklist_items_update_own" ON personal_todo_checklist_items FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "personal_todo_checklist_items_delete_own" ON personal_todo_checklist_items;
CREATE POLICY "personal_todo_checklist_items_delete_own" ON personal_todo_checklist_items FOR DELETE
  TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS personal_todo_checklist_items_updated_at ON personal_todo_checklist_items;
CREATE TRIGGER personal_todo_checklist_items_updated_at
  BEFORE UPDATE ON personal_todo_checklist_items
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
