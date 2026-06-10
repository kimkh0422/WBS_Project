-- 협조 요청: 표준 요청서 양식의 "구체적 산출물(deliverables)" 항목 추가.
-- 부서간 협업 프로세스(안) V1.0 의 표준 요청서 4요소: 목적·산출물·기한·담당자 중 산출물 별도화.
-- 비어 있어도 무방(NULL 대신 빈 문자열 기본값).

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS deliverables text NOT NULL DEFAULT '';

COMMENT ON COLUMN cooperation_requests.deliverables IS '구체적 산출물 — 표준 요청서의 4요소(목적·산출물·기한·담당자) 중 산출물 항목.';
