-- 헤더 칩 등: 관리자 여부와 무관하게 인증 사용자가 최근 활동 기준 온라인 "인원 수"만 조회
-- (이름·user_id 목록은 get_online_presence_users가 관리자에게만 제공)

CREATE OR REPLACE FUNCTION public.get_online_presence_count(p_within_seconds integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  win_secs integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  win_secs := greatest(30, least(coalesce(p_within_seconds, 180), 86400));

  RETURN (
    SELECT COUNT(*)::int
    FROM public.user_presence up
    INNER JOIN public.profiles p ON p.id = up.user_id
    WHERE up.last_seen_at > (now() - make_interval(secs => win_secs))
  );
END;
$$;

COMMENT ON FUNCTION public.get_online_presence_count(integer) IS
  '인증 사용자 공통. 최근 활동 기준 온라인 인원 수(목록·이름 없음).';

GRANT EXECUTE ON FUNCTION public.get_online_presence_count(integer) TO authenticated;
