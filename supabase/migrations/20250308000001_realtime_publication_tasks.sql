-- Realtime 수신: tasks 테이블 변경 시 다른 클라이언트에 알림
-- 대시보드 Database → Publications → supabase_realtime 에서 테이블을 켜도 됩니다.
-- 이미 추가된 경우 "already a member of publication" 오류는 무시하세요.

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
