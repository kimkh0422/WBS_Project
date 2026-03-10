-- profiles RLS 무한 재귀 수정
-- profiles_select_admin 정책이 profiles를 참조할 때 RLS가 다시 트리거되어 재귀 발생
-- SECURITY DEFINER 함수로 RLS 우회하여 확인

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (public.is_admin_user());
