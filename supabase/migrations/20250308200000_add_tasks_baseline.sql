-- 작업별 베이스라인: tasks에 baseline_start_date, baseline_end_date, baseline_work_effort 추가

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS baseline_start_date date NULL,
  ADD COLUMN IF NOT EXISTS baseline_end_date date NULL,
  ADD COLUMN IF NOT EXISTS baseline_work_effort numeric(10,2) NULL;
