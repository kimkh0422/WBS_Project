-- 슈퍼관리자(시스템 관리자): kykim@gmtc.kr
-- profiles.is_admin = true → 회원 관리, 전체 삭제, 조직도, 모든 프로젝트 편집 등

CREATE OR REPLACE FUNCTION public.is_bootstrap_super_admin(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(btrim(p_email), '')) IN (
    lower('kykim@gmtc.kr')
  );
$$;

COMMENT ON FUNCTION public.is_bootstrap_super_admin(text) IS
  '가입·로그인 시 자동으로 profiles.is_admin=true 를 부여할 슈퍼관리자(시스템 관리자) 이메일 목록';

-- 기존 계정 즉시 승격
UPDATE public.profiles p
SET is_admin = true, approved = true
FROM auth.users u
WHERE p.id = u.id
  AND public.is_bootstrap_super_admin(u.email);

UPDATE public.profiles
SET is_admin = true, approved = true
WHERE public.is_bootstrap_super_admin(email);

-- 신규 가입 시 자동 부여
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first boolean;
BEGIN
  SELECT (count(*) = 0) INTO v_first FROM public.profiles;
  INSERT INTO public.profiles (id, email, full_name, is_admin, approved)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    v_first OR public.is_bootstrap_super_admin(new.email),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- 로그인 시 ensure_profile: 신규 생성 + 기존 계정 승격(멱등)
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_is_admin   boolean;
  v_approved   boolean;
  v_managed_org text;
  v_department text;
  v_email      text;
  v_full_name  text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_admin', false,
      'approved', false,
      'managed_org_node_id', null,
      'department', null,
      'is_org_scope_manager', false
    );
  END IF;

  INSERT INTO public.profiles (id, email, full_name, is_admin, approved)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM profiles) = 0 OR public.is_bootstrap_super_admin(u.email),
    true
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles p
  SET is_admin = true, approved = true
  FROM auth.users u
  WHERE p.id = v_user_id
    AND u.id = v_user_id
    AND public.is_bootstrap_super_admin(u.email);

  SELECT u.email, p.full_name
  INTO v_email, v_full_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user_id;

  IF (v_email IS NOT NULL AND length(btrim(v_email)) > 0)
     OR (v_full_name IS NOT NULL AND length(btrim(v_full_name)) > 0) THEN
    INSERT INTO public.project_members (project_id, user_id, role)
    SELECT DISTINCT pi.project_id, v_user_id, pi.role
    FROM public.pending_project_invitations pi
    WHERE
      (v_email IS NOT NULL AND pi.email IS NOT NULL AND lower(pi.email) = lower(v_email))
      OR (v_full_name IS NOT NULL AND pi.full_name IS NOT NULL AND pi.full_name = v_full_name)
    ON CONFLICT (project_id, user_id) DO NOTHING;

    DELETE FROM public.pending_project_invitations pi
    WHERE
      (v_email IS NOT NULL AND pi.email IS NOT NULL AND lower(pi.email) = lower(v_email))
      OR (v_full_name IS NOT NULL AND pi.full_name IS NOT NULL AND pi.full_name = v_full_name);
  END IF;

  SELECT
    coalesce(is_admin, false),
    coalesce(approved, false),
    managed_org_node_id::text,
    department
  INTO v_is_admin, v_approved, v_managed_org, v_department
  FROM profiles
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'is_admin', coalesce(v_is_admin, false),
    'approved', coalesce(v_approved, false),
    'managed_org_node_id', v_managed_org,
    'department', v_department,
    'is_org_scope_manager',
    (v_managed_org IS NOT NULL AND btrim(coalesce(v_managed_org, '')) <> '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
