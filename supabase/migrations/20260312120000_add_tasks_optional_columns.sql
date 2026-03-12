-- tasks 테이블: optional 컬럼 추가 (구 환경 호환)
-- 목적: 클라이언트가 쓰는 필드(is_issue/is_milestone/baseline_*)를 DB에도 반영해
--      JSON 임포트/DB 저장 시 PGRST204(컬럼 없음) 오류를 근본적으로 제거한다.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_issue boolean NOT NULL DEFAULT false;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_milestone boolean NOT NULL DEFAULT false;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS baseline_start_date date NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS baseline_end_date date NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS baseline_work_effort numeric(10,2) NULL;

