-- wbs_settings 테이블에 config_json JSONB 컬럼 추가
-- statusConfigs, appTitle, showCriticalPath, wrapTextInCells, linkStatusAndProgress,
-- tableColumns, themeMode, favoriteProjectIds 등 모든 설정을 저장
ALTER TABLE wbs_settings ADD COLUMN IF NOT EXISTS config_json JSONB DEFAULT '{}'::jsonb;
