-- 프로젝트 항목: 연습·개인 추가 (앱 enum과 동일, DB는 text로 저장)
COMMENT ON COLUMN projects.project_kind IS '프로젝트 항목 구분: 상품, 연구, 용역, 유지, 제품, 내부, 연습, 개인, 기타 (연습·개인은 소유자 본인 UI에서만 타인에게 비노출)';
