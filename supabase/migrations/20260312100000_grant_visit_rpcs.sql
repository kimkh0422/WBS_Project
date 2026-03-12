-- 방문 통계 RPC 실행 권한 보강
-- PostgREST(Supabase)에서 rpc 호출 시, 함수 EXECUTE 권한이 없으면 실패할 수 있음

DO $$
BEGIN
  -- 함수가 아직 생성되지 않은 환경에서도 이 스크립트가 실패하지 않도록, 존재할 때만 GRANT

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_visit'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_visit(uuid) TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_visitor_stats'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_visitor_stats() TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_member_visit_stats'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_member_visit_stats() TO authenticated';
  END IF;
END
$$;

