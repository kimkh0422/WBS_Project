-- 슈퍼관리자(부트스트랩 이메일 + profiles.is_admin) 권한 일원화
-- 1) is_admin_user(): profiles.is_admin 이 아직 false여도 is_bootstrap_super_admin(email)이면 true
--    (프로필·Auth 이메일 중 비어 있지 않은 값으로 판별)
-- 2) org_nodes / org_members: 기존 EXISTS(profiles.is_admin) 정책을 is_admin_user()로 통일
--    → 부트스트랩 슈퍼관리자가 조직 데이터 INSERT/UPDATE/DELETE 가능

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
    OR public.is_bootstrap_super_admin(
      coalesce(
        nullif(trim((SELECT p2.email::text FROM public.profiles p2 WHERE p2.id = auth.uid())), ''),
        nullif(trim((SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid())), '')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = p_user), false)
    OR public.is_bootstrap_super_admin(
      coalesce(
        nullif(trim((SELECT p2.email::text FROM public.profiles p2 WHERE p2.id = p_user)), ''),
        nullif(trim((SELECT u.email::text FROM auth.users u WHERE u.id = p_user)), '')
      )
    );
$$;

COMMENT ON FUNCTION public.is_admin_user() IS
  'RLS·RPC용: profiles.is_admin 또는 부트스트랩 슈퍼관리자 이메일이면 true';
COMMENT ON FUNCTION public.is_admin_user(uuid) IS
  '특정 사용자 UUID가 시스템 관리자인지: profiles.is_admin 또는 부트스트랩 이메일';

-- 조직 테이블: 관리자 판정을 is_admin_user()로 통일 (부트스트랩 이메일 포함)
DROP POLICY IF EXISTS "org_nodes_modify_admin" ON public.org_nodes;
CREATE POLICY "org_nodes_modify_admin" ON public.org_nodes FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "org_members_modify_admin" ON public.org_members;
CREATE POLICY "org_members_modify_admin" ON public.org_members FOR ALL
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ensure_profile 응답의 is_admin 과 RLS용 is_admin_user() 정합 (부트스트랩만 해당·프로필 플래그 지연 시)
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

  PERFORM public.sync_profile_is_admin_for_team_leader(v_user_id);

  SELECT
    coalesce(is_admin, false),
    coalesce(approved, false),
    managed_org_node_id::text,
    department
  INTO v_is_admin, v_approved, v_managed_org, v_department
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
    'managed_org_node_id', v_managed_org,
    'department', v_department,
    'is_org_scope_manager',
    (v_managed_org IS NOT NULL AND btrim(coalesce(v_managed_org, '')) <> '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
