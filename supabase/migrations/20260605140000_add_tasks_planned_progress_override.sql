-- 계획율 수동 지정: 설정 시 일정 기반 계산 대신 이 값(0~100)을 표·집계에 사용
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS planned_progress_override numeric(6, 2) NULL;

COMMENT ON COLUMN tasks.planned_progress_override IS
  'Optional 0–100 planned progress %. When set, overrides schedule-derived planned % for this task.';
