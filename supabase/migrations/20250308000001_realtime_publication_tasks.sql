-- Realtime 수신: tasks 테이블 변경 시 다른 클라이언트에 알림
-- 대시보드 Database → Publications → supabase_realtime 에서 테이블을 켜도 됩니다.
-- 이미 추가된 경우 오류 무시 (재실행 안전)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
