-- 임시 운영: 로그인한 모든 사용자를 관리자로 간주 (RLS·RPC의 is_admin_user()).
-- 복구: supabase/migrations/20260521160000_is_admin_user_bootstrap_and_org_rls.sql 의
--       is_admin_user() / is_admin_user(uuid) 정의를 다시 적용하세요.
--
-- UI(메뉴·관리자 화면)는 profiles.is_admin / ensure_profile 을 따르므로,
-- 앱 쪽에서는 .env 에 VITE_FORCE_EVERYONE_ADMIN=true 를 넣어 주세요.

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL;
$$;

COMMENT ON FUNCTION public.is_admin_user() IS
  '임시: 인증 세션이 있으면 true. 정상 복구 시 profiles.is_admin + 부트스트랩 이메일 기준으로 되돌릴 것.';
COMMENT ON FUNCTION public.is_admin_user(uuid) IS
  '임시: 인자 UUID가 NULL이 아니면 true. 정상 복구 시 profiles + 부트스트랩 기준으로 되돌릴 것.';
