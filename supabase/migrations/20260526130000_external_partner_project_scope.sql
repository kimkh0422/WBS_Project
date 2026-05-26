-- 외주(비 @gmtc.kr) 계정: 지엠티가 공유한 프로젝트(project_members)에 한해 조회·편집.
-- 사내 직원은 기존처럼 승인(approved) 시 전체 프로젝트·작업 목록 조회 가능.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_external_partner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_external_partner IS
  'true: @gmtc.kr 이외 이메일로 가입한 외주 등. 전사 프로젝트 탐색·조직도·전역 설정 수정 불가. 공유(project_members) 프로젝트만 접근.';

-- 기존 계정: Auth 이메일 도메인으로 소급 표시
UPDATE public.profiles p
SET is_external_partner = true
FROM auth.users u
WHERE p.id = u.id
  AND lower(btrim(split_part(coalesce(u.email::text, ''), '@', 2))) IS DISTINCT FROM 'gmtc.kr';

CREATE OR REPLACE FUNCTION public.auth_email_is_gmtc_internal(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(split_part(coalesce(p_email, ''), '@', 2))) = 'gmtc.kr';
$$;

COMMENT ON FUNCTION public.auth_email_is_gmtc_internal(text) IS
  '회원 이메일 도메인이 지엠티 사내(@gmtc.kr)인지. 외부 파트너 플래그 판별에 사용.';

CREATE OR REPLACE FUNCTION public.is_external_partner_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT is_external_partner FROM public.profiles WHERE id = auth.uid()), false);
$$;

COMMENT ON FUNCTION public.is_external_partner_user() IS
  '현재 세션 사용자가 외주(비사내 메일) 프로필인지. RLS에서 사용.';

CREATE OR REPLACE FUNCTION public.can_browse_all_company_projects()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT approved AND NOT coalesce(is_external_partner, false)
      FROM public.profiles
      WHERE id = auth.uid()
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.can_browse_all_company_projects() IS
  '사내 승인 회원만 true. 외주는 false → 전사 프로젝트/작업 RLS 탐색 비허용.';

-- 전사 조회: is_approved_user → can_browse_all_company_projects
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects FOR SELECT
  USING (
    public.is_admin_user() OR
    public.can_browse_all_company_projects() OR
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT
  USING (
    public.is_admin_user() OR
    public.can_browse_all_company_projects() OR
    project_id = ANY(public.get_user_project_ids())
  );

-- 외주는 신규 프로젝트 생성(소유) 불가 — 공유받은 프로젝트만 사용
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    (
      owner_id = auth.uid()
      AND NOT public.is_external_partner_user()
    )
  );

-- 전역 WBS 설정: 외주는 읽기만(기존 SELECT 유지), 쓰기 제한
DROP POLICY IF EXISTS "wbs_settings_insert" ON public.wbs_settings;
CREATE POLICY "wbs_settings_insert" ON public.wbs_settings FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.is_external_partner_user() OR public.is_admin_user());

DROP POLICY IF EXISTS "wbs_settings_update" ON public.wbs_settings;
CREATE POLICY "wbs_settings_update" ON public.wbs_settings FOR UPDATE
  TO authenticated
  USING (NOT public.is_external_partner_user() OR public.is_admin_user())
  WITH CHECK (NOT public.is_external_partner_user() OR public.is_admin_user());

-- 조직도: 외주는 DB 조회 불가(UI와 일치)
DROP POLICY IF EXISTS "org_nodes_select_authenticated" ON public.org_nodes;
CREATE POLICY "org_nodes_select_authenticated" ON public.org_nodes FOR SELECT
  USING (auth.uid() IS NOT NULL AND NOT public.is_external_partner_user());

DROP POLICY IF EXISTS "org_members_select_authenticated" ON public.org_members;
CREATE POLICY "org_members_select_authenticated" ON public.org_members FOR SELECT
  USING (auth.uid() IS NOT NULL AND NOT public.is_external_partner_user());

-- 회원 디렉터리: 외주는 본인 프로필만(공유 멤버 검색은 프로젝트 멤버 API로)
DROP POLICY IF EXISTS "profiles_select_all_approved_for_share" ON public.profiles;
CREATE POLICY "profiles_select_all_approved_for_share" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    approved = true
    AND (
      NOT public.is_external_partner_user()
      OR id = auth.uid()
    )
  );

-- 외주 플래그는 관리자만 변경 가능(본인 임의 해제 방지). 비관리자 본인 UPDATE 시 값 유지는 트리거로 보강.
CREATE OR REPLACE FUNCTION public.trg_profiles_preserve_is_external_partner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT public.is_admin_user() THEN
    NEW.is_external_partner := OLD.is_external_partner;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_preserve_is_external_partner ON public.profiles;
CREATE TRIGGER trg_profiles_preserve_is_external_partner
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_profiles_preserve_is_external_partner();

-- ─── handle_new_user: 외부 이메일이면 is_external_partner = true ───────────
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
  INSERT INTO public.profiles (id, email, full_name, is_admin, approved, is_external_partner)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    (v_first AND public.auth_email_is_gmtc_internal(new.email)) OR public.is_bootstrap_super_admin(new.email),
    true,
    NOT public.auth_email_is_gmtc_internal(new.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ─── ensure_profile (부트스트랩·초대 소비·팀장 동기화 포함, 최신본 기준) ───
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
