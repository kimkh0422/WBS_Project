-- 프로젝트별 작업 최소 공수 기준(일). 0.5, 1, 3 등. WBS 작업 세부 분류에 사용
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS min_work_effort_days numeric(6,2) NULL;
