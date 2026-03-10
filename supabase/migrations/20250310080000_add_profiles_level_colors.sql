-- profiles에 레벨별 색상(사용자 맞춤) 컬럼 추가
-- 형식: [{r,g,b}, {r,g,b}, ...] - 레벨 1~5, 6레벨 이상은 기본 회색
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level_colors jsonb;
