-- work_effort: integer → numeric (0.5일 등 소수 공수 지원)
ALTER TABLE tasks
  ALTER COLUMN work_effort TYPE numeric(10,2) USING work_effort::numeric(10,2);
