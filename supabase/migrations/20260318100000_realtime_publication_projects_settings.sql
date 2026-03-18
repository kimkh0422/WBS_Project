-- Realtime: 프로젝트·설정 변경도 다른 클라이언트에 전달 (tasks는 기존 마이그레이션에 있음)
-- 대시보드 Database → Publications → supabase_realtime 에서 수동으로 켜도 동일
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projects;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wbs_settings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
