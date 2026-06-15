-- 작업 일정 미입력 시 앱이 빈 문자열 대신 NULL을 저장할 수 있도록 제약 완화.
-- (Postgres date 컬럼에 ""를 넣으면 invalid input syntax 오류 발생)
ALTER TABLE tasks
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date DROP NOT NULL;
