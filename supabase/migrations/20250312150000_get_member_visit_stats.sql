-- 회원별 접속 횟수·마지막 접속 시각 조회 (관리자 전용)
-- visits 테이블 기준으로 집계

CREATE OR REPLACE FUNCTION public.get_member_visit_stats()
RETURNS TABLE (user_id uuid, login_count bigint, last_visited_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v.user_id, COUNT(*)::bigint, MAX(v.visited_at)
  FROM visits v
  WHERE v.user_id IS NOT NULL
  GROUP BY v.user_id;
END;
$$;
