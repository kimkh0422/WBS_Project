-- 주간보고용 프로젝트 정보 (구분, 주관기관, 예산, 기간, 과제명 약어, 전체과제명)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS report_category text,
  ADD COLUMN IF NOT EXISTS report_agency text,
  ADD COLUMN IF NOT EXISTS report_budget_this_year text,
  ADD COLUMN IF NOT EXISTS report_total_period text,
  ADD COLUMN IF NOT EXISTS report_name_short text,
  ADD COLUMN IF NOT EXISTS report_name_full text;
