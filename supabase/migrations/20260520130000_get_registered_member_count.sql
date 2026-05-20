-- 대시보드 전체 현황: 등록 회원 수 조회 (RLS와 무관하게 전체 profiles 집계)
CREATE OR REPLACE FUNCTION get_registered_member_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;

  RETURN (SELECT COUNT(*) FROM profiles);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_registered_member_count() TO authenticated;
