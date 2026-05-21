-- 슈퍼관리자 부트스트랩: wbsadmin@gmtc.kr (기존 kykim@gmtc.kr 유지)
-- 가입·로그인 시 ensure_profile 등에서 profiles.is_admin = true 자동 부여
--
-- 주의: 이 SQL은 auth.users를 만들지 않습니다. 로그인하려면 Supabase 대시보드
-- Authentication → Users에서 동일 이메일 사용자를 생성하거나, 앱 회원가입으로 가입해야 합니다.

CREATE OR REPLACE FUNCTION public.is_bootstrap_super_admin(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(btrim(p_email), '')) IN (
    lower('kykim@gmtc.kr'),
    lower('wbsadmin@gmtc.kr')
  );
$$;

COMMENT ON FUNCTION public.is_bootstrap_super_admin(text) IS
  '가입·로그인 시 자동으로 profiles.is_admin=true 를 부여할 슈퍼관리자(시스템 관리자) 이메일 목록';

-- 이미 가입된 wbsadmin@gmtc.kr 계정 즉시 승격
UPDATE public.profiles p
SET is_admin = true, approved = true
FROM auth.users u
WHERE p.id = u.id
  AND public.is_bootstrap_super_admin(u.email);

UPDATE public.profiles
SET is_admin = true, approved = true
WHERE public.is_bootstrap_super_admin(email);
