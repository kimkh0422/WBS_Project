-- 프로젝트 항목 구분: 연구 / 사업 / 기타
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_kind text;

COMMENT ON COLUMN projects.project_kind IS '프로젝트 항목 구분: 연구, 사업, 기타';
