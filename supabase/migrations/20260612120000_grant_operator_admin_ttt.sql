-- 운영자 지정: ttt@gmtc.kr 를 시스템 관리자(profiles.is_admin=true)로 승격.
--
-- 새 projects_delete 정책(소유자 + 운영자만 삭제)에서 ttt@gmtc.kr 가
-- 자기 소유가 아닌 프로젝트도 삭제할 수 있으려면 운영자(is_admin)여야 한다.
-- 기존 슈퍼관리자(kykim@gmtc.kr, wbsadmin@gmtc.kr) 유지.
--
-- 부트스트랩 목록에 추가하면 가입·로그인 시 ensure_profile 등에서 is_admin=true 가
-- 멱등하게 자동 부여된다(계정 재생성에도 유지). 더는 운영자가 아니어야 하면
-- 이 목록에서 제거하거나 회원 관리에서 역할을 내리면 된다.

CREATE OR REPLACE FUNCTION public.is_bootstrap_super_admin(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(btrim(p_email), '')) IN (
    lower('kykim@gmtc.kr'),
    lower('wbsadmin@gmtc.kr'),
    lower('ttt@gmtc.kr')
  );
$$;

COMMENT ON FUNCTION public.is_bootstrap_super_admin(text) IS
  '가입·로그인 시 자동으로 profiles.is_admin=true 를 부여할 슈퍼관리자(시스템 관리자) 이메일 목록';

-- 이미 가입된 계정 즉시 승격(멱등)
UPDATE public.profiles p
SET is_admin = true, approved = true
FROM auth.users u
WHERE p.id = u.id
  AND public.is_bootstrap_super_admin(u.email);

UPDATE public.profiles
SET is_admin = true, approved = true
WHERE public.is_bootstrap_super_admin(email);
