-- 클라이언트에서 "편집 가능한 프로젝트 ID 목록" 조회용 RPC 허용
-- 승인된 사용자는 모든 프로젝트를 보지만, 편집은 이 목록에 있는 프로젝트만 가능

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_user_editable_project_ids'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_editable_project_ids() TO authenticated';
  END IF;
END
$$;
