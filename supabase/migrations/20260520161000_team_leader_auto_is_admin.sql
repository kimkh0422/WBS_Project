-- 조직도(org_members)에서 직책이 팀장이면, 동일 이름·부서를 가진 회원(profiles)에 is_admin 자동 부여
-- - 부팀장은 제외
-- - 자동 해제는 하지 않음(수동 관리자·다른 사유로 is_admin 인 경우 보호)

CREATE OR REPLACE FUNCTION public.org_position_is_team_leader(p_position text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_position, '') <> ''
    AND btrim(p_position) NOT ILIKE '%부팀장%'
    AND (
      btrim(p_position) = '팀장'
      OR btrim(p_position) ~ '팀장$'
    );
$$;

COMMENT ON FUNCTION public.org_position_is_team_leader(text) IS
  'org_members.position 이 팀장 계열인지(부팀장 제외). 끝이 팀장으로 끝나는 표기(예: OO팀 팀장) 허용';

CREATE OR REPLACE FUNCTION public.sync_profile_is_admin_for_team_leader(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fn   text;
  v_dept text;
  v_hit  boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT nullif(btrim(full_name), ''), nullif(btrim(department), '')
  INTO v_fn, v_dept
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_fn IS NULL OR v_dept IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    WHERE lower(btrim(om.name)) = lower(v_fn)
      AND btrim(om.department) = v_dept
      AND public.org_position_is_team_leader(om.position)
  )
  INTO v_hit;

  IF coalesce(v_hit, false) THEN
    UPDATE public.profiles
    SET is_admin = true
    WHERE id = p_user_id
      AND coalesce(is_admin, false) IS DISTINCT FROM true;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sync_profile_is_admin_for_team_leader(uuid) IS
  'profiles.id 기준: org_members 에 동일 이름·부서 팀장 행이 있으면 is_admin=true';

CREATE OR REPLACE FUNCTION public.trg_profiles_sync_team_leader_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_profile_is_admin_for_team_leader(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_team_leader_admin ON public.profiles;
CREATE TRIGGER trg_profiles_team_leader_admin
AFTER INSERT OR UPDATE OF department, full_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trg_profiles_sync_team_leader_admin();

CREATE OR REPLACE FUNCTION public.trg_org_members_sync_team_leader_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.org_position_is_team_leader(NEW.position) THEN
    UPDATE public.profiles p
    SET is_admin = true
    WHERE lower(btrim(p.full_name)) = lower(btrim(NEW.name))
      AND btrim(p.department) = btrim(NEW.department)
      AND coalesce(p.is_admin, false) IS DISTINCT FROM true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_members_team_leader_admin ON public.org_members;
CREATE TRIGGER trg_org_members_team_leader_admin
AFTER INSERT OR UPDATE OF name, department, position ON public.org_members
FOR EACH ROW
EXECUTE FUNCTION public.trg_org_members_sync_team_leader_admin();

-- 기존 데이터 일괄 반영
UPDATE public.profiles p
SET is_admin = true
WHERE EXISTS (
  SELECT 1
  FROM public.org_members om
  WHERE lower(btrim(om.name)) = lower(btrim(p.full_name))
    AND btrim(om.department) = btrim(p.department)
    AND public.org_position_is_team_leader(om.position)
)
AND coalesce(p.is_admin, false) IS DISTINCT FROM true;

-- 로그인 시 ensure_profile 직전 상태 반영
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
