-- 프로젝트별 투입인원·투입비율 (JSONB 배열)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS assignments jsonb DEFAULT '[]'::jsonb;
