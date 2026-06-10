-- 부서간 협업 프로세스(안) V1.0 후속 적용:
--   1) 공유처/참조자(informees) 컬럼 추가 — 메일 CC·텔레그램 알림 본문에 명시
--   2) 회의록 Action Plan / 멤버 RACI 는 기존 jsonb 컬럼 (meeting_logs, member_progress) 안에서
--      필드 확장으로 처리 → 스키마 변경 불필요.
--
-- 형식 안내(애플리케이션 수준):
--   informees: 쉼표·세미콜론·공백으로 구분된 사람/그룹 이름 또는 이메일 목록 (자유 텍스트)
--     예) "김지영, 이상재, 영업총괄@gmtc.kr"
--   meeting_logs[].actions: [
--     { id, assignee, task, dueDate(YYYY-MM-DD), done(boolean) }
--   ]
--   member_progress[].raci: 'R' | 'A' | 'C' | 'I'  (기본값 'R')

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS informees text NOT NULL DEFAULT '';

COMMENT ON COLUMN cooperation_requests.informees IS '공유처/참조자(쉼표/세미콜론/공백 구분, 이름 또는 이메일). 알림 메일 CC에 자동 반영.';
