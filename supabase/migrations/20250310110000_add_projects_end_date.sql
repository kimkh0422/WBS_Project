-- 프로젝트 종료일 추가. WBS 작업은 이 기간 범위를 벗어날 수 없음
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS end_date date NULL;
