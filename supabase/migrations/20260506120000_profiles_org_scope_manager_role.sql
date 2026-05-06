-- 조직 단위 책임자(팀장·사업부장 등): managed_org_node_id 설정 시 해당 org_nodes 하위 부서 회원만 is_admin 변경 가능

-- ─── 프로필 부서 및 조직 관리 범위 ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS managed_org_node_id text REFERENCES public.org_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles (department)
  WHERE department IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_managed_org ON public.profiles (managed_org_node_id)
  WHERE managed_org_node_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.department IS
  '앱 회원 계정 소속 부서명. org_members.department / org_nodes.department_aliases와 동일 문자열 매칭';
COMMENT ON COLUMN public.profiles.managed_org_node_id IS
  '비워두면 일반 회원. 지정 시 org_nodes 해당 노드 및 하위 부서 회원 프로필의 is_admin을 RPC로 변경할 수 있는 조직 책임자';

-- ─── 부서 문자열이 org 노드 subtree에 속하는지 (aliases 기준)
CREATE OR REPLACE FUNCTION public.profile_department_in_org_subtree(
  p_department text,
  p_root_node_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE sub AS (
    SELECT id FROM org_nodes WHERE id = p_root_node_id
    UNION ALL
    SELECT c.id FROM org_nodes c
    INNER JOIN sub ON c.parent_id = sub.id
  )
  SELECT EXISTS (
    SELECT 1 FROM org_nodes n
    INNER JOIN sub ON sub.id = n.id,
    LATERAL unnest(coalesce(n.department_aliases, ARRAY[]::text[])) AS alias
    WHERE p_department IS NOT NULL AND btrim(p_department) <> ''
      AND trim(alias) = trim(p_department)
  );
$$;

GRANT EXECUTE ON FUNCTION public.profile_department_in_org_subtree(text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.update_member_is_admin(uuid, boolean);

CREATE OR REPLACE FUNCTION public.update_member_is_admin(
  p_target_user_id uuid,
  p_is_admin boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_caller_admin boolean;
  v_caller_scope text;
  v_target_dept text;
  v_in_scope boolean;
  v_dummy int;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;

  IF p_target_user_id = v_caller THEN
    RETURN jsonb_build_object('success', false, 'error', '본인 역할은 변경할 수 없습니다.');
  END IF;

  SELECT 1 INTO v_dummy FROM public.profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '대상 회원을 찾을 수 없습니다.');
  END IF;

  SELECT coalesce(is_admin, false),
    CASE
      WHEN managed_org_node_id IS NULL THEN NULL
      ELSE trim(managed_org_node_id::text)
    END
  INTO v_caller_admin, v_caller_scope
  FROM public.profiles
  WHERE id = v_caller;

  IF coalesce(v_caller_admin, false) THEN
    UPDATE public.profiles SET is_admin = p_is_admin WHERE id = p_target_user_id;
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_caller_scope IS NOT NULL AND btrim(v_caller_scope) <> '' THEN
    SELECT department INTO v_target_dept FROM public.profiles WHERE id = p_target_user_id;

    IF v_target_dept IS NULL OR btrim(v_target_dept) = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',
        '대상 회원에 부서(department)가 없습니다. 시스템 관리자가 프로필에 부서를 먼저 지정해야 합니다.'
      );
    END IF;

    SELECT public.profile_department_in_org_subtree(v_target_dept, v_caller_scope) INTO v_in_scope;

    IF coalesce(v_in_scope, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', '소속 관리 범위 밖의 회원 역할은 변경할 수 없습니다.');
    END IF;

    UPDATE public.profiles SET is_admin = p_is_admin WHERE id = p_target_user_id;
    RETURN jsonb_build_object('success', true);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', '역할 변경 권한이 없습니다.');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_member_is_admin(uuid, boolean) TO authenticated;

-- ─── ensure_profile: 조직 책임자 판별용 필드 포함 ─────────────────────────
CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
  v_approved boolean;
  v_managed_org text;
  v_department text;
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
    (SELECT count(*) FROM profiles) = 0,
    true
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

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
