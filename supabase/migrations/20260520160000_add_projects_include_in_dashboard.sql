-- 프로젝트별 대시보드 집계·표시 반영 여부 (기본: 반영)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS include_in_dashboard boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.projects.include_in_dashboard IS 'false이면 대시보드 집계·카드 등에 포함하지 않음';
