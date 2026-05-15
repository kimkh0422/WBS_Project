-- 액션 항목 플래그: 대시보드 액션 목록 등에 사용
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_action_item boolean DEFAULT false;
