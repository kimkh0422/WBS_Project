-- 사내(@gmtc.kr) 계정은 관리자 승인 없이 항상 approved.
-- 기존 미승인 레코드 일괄 보정 + 로그인 시 ensure_profile에서 매번 동기화.

UPDATE public.profiles p
SET
  approved = true,
  is_external_partner = false
FROM auth.users u
WHERE p.id = u.id
  AND public.auth_email_is_gmtc_internal(coalesce(u.email::text, ''))
  AND (
    coalesce(p.approved, false) = false
    OR coalesce(p.is_external_partner, false) = true
  );

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid;
  v_is_admin    boolean;
  v_approved    boolean;
  v_external    boolean;
  v_managed_org text;
  v_department  text;
  v_email       text;
  v_full_name   text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'is_admin', false,
      'approved', false,
      'is_external_partner', false,
      'managed_org_node_id', null,
      'department', null,
      'is_org_scope_manager', false
    );
  END IF;

  INSERT INTO public.profiles (id, email, full_name, is_admin, approved, is_external_partner)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    ((SELECT count(*) FROM profiles) = 0 AND public.auth_email_is_gmtc_internal(u.email)) OR public.is_bootstrap_super_admin(u.email),
    true,
    NOT public.auth_email_is_gmtc_internal(u.email)
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.profiles p
  SET is_admin = true, approved = true
  FROM auth.users u
  WHERE p.id = v_user_id
    AND u.id = v_user_id
    AND public.is_bootstrap_super_admin(u.email);

  -- 사내(@gmtc.kr): 승인·외부 플래그 정합 (과거 데이터·수동 변경 대비)
  UPDATE public.profiles p
  SET approved = true,
      is_external_partner = false
  FROM auth.users u
  WHERE p.id = v_user_id
    AND u.id = v_user_id
    AND public.auth_email_is_gmtc_internal(coalesce(u.email::text, ''));

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

  PERFORM public.sync_profile_is_admin_for_team_leader(v_user_id);

  SELECT
    coalesce(is_admin, false),
    coalesce(approved, false),
    coalesce(is_external_partner, false),
    managed_org_node_id::text,
    department
  INTO v_is_admin, v_approved, v_external, v_managed_org, v_department
  FROM profiles
  WHERE id = v_user_id;

  v_is_admin := coalesce(v_is_admin, false)
    OR public.is_bootstrap_super_admin(
      coalesce(
        nullif(trim((SELECT p2.email::text FROM public.profiles p2 WHERE p2.id = v_user_id)), ''),
        nullif(trim(coalesce(v_email, '')), '')
      )
    );

  RETURN jsonb_build_object(
    'is_admin', v_is_admin,
    'approved', coalesce(v_approved, false),
    'is_external_partner', coalesce(v_external, false),
    'managed_org_node_id', v_managed_org,
    'department', v_department,
    'is_org_scope_manager',
    (v_managed_org IS NOT NULL AND btrim(coalesce(v_managed_org, '')) <> '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
