-- 프로젝트 멤버 사전 초대 (미가입자 권한 부여)
-- ============================================================================
-- 시나리오:
-- 1) 관리자/소유자가 ShareModal에서 아직 가입하지 않은 사람의 이름(또는 이메일)을 등록.
-- 2) 시스템은 매칭되는 profiles 행이 없을 때 pending_project_invitations에 저장.
-- 3) 그 사람이 회원가입 → ensure_profile 호출 시점에 자동으로
--    project_members에 권한 부여 + pending 행 삭제.
-- ============================================================================

-- ─── 1. 사전 초대 테이블 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_project_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email       text,
  full_name   text,
  role        text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 이메일 또는 이름 중 적어도 하나는 비어 있지 않아야 한다
  CONSTRAINT pending_inv_email_or_name CHECK (
    (email IS NOT NULL AND length(btrim(email)) > 0)
    OR (full_name IS NOT NULL AND length(btrim(full_name)) > 0)
  )
);

COMMENT ON TABLE public.pending_project_invitations IS
  '아직 회원가입하지 않은 사람을 프로젝트에 미리 초대해 두고, 그 사람이 가입하면 ensure_profile RPC가 자동으로 project_members에 옮긴다.';

-- 같은 프로젝트에 같은 이메일을 중복 초대하지 않도록 유니크 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS pending_inv_unique_project_email
  ON public.pending_project_invitations (project_id, lower(email))
  WHERE email IS NOT NULL;

-- 이메일 없이 이름만 있는 초대도 같은 프로젝트 내 중복 방지
CREATE UNIQUE INDEX IF NOT EXISTS pending_inv_unique_project_name
  ON public.pending_project_invitations (project_id, lower(full_name))
  WHERE full_name IS NOT NULL AND email IS NULL;

-- 가입 시 ensure_profile에서 빠르게 매칭하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_pending_inv_email
  ON public.pending_project_invitations (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_inv_full_name
  ON public.pending_project_invitations (lower(full_name))
  WHERE full_name IS NOT NULL;

-- ─── 2. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.pending_project_invitations ENABLE ROW LEVEL SECURITY;

-- 기존 정책 정리(재실행 시)
DROP POLICY IF EXISTS pending_inv_select ON public.pending_project_invitations;
DROP POLICY IF EXISTS pending_inv_insert ON public.pending_project_invitations;
DROP POLICY IF EXISTS pending_inv_delete ON public.pending_project_invitations;

-- SELECT: 관리자 / 프로젝트 소유자 / 본인(이메일·이름 매칭) — 본인 미해소 초대 안내용
CREATE POLICY pending_inv_select ON public.pending_project_invitations
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND coalesce(is_admin, false) = true)
    OR project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
    OR (
      email IS NOT NULL
      AND lower(email) = lower(coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), ''))
    )
    OR (
      full_name IS NOT NULL
      AND full_name = coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '')
    )
  );

-- INSERT: 관리자 / 프로젝트 소유자
CREATE POLICY pending_inv_insert ON public.pending_project_invitations
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND coalesce(is_admin, false) = true)
    OR project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
  );

-- DELETE: 관리자 / 프로젝트 소유자 (가입 자동 소비는 ensure_profile에서 SECURITY DEFINER로 동작)
CREATE POLICY pending_inv_delete ON public.pending_project_invitations
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND coalesce(is_admin, false) = true)
    OR project_id IN (SELECT id FROM public.projects WHERE owner_id = auth.uid())
  );

GRANT SELECT, INSERT, DELETE ON public.pending_project_invitations TO authenticated;

-- ─── 3. ensure_profile 갱신: 가입 후 미해소 초대를 자동 소비 ────────────────
-- 기존 함수 시그니처를 그대로 유지하되, 본문에 사전 초대 처리 로직을 추가한다.
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

  -- 1) profiles 행 생성/유지 (기존 로직 그대로)
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

  -- 2) 사전 초대 자동 소비
  --    auth.users.email 또는 profiles.full_name과 매칭되는 pending 행을
  --    project_members에 옮기고 pending 행은 삭제한다.
  SELECT u.email, p.full_name
  INTO v_email, v_full_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_user_id;

  IF (v_email IS NOT NULL AND length(btrim(v_email)) > 0)
     OR (v_full_name IS NOT NULL AND length(btrim(v_full_name)) > 0) THEN
    -- 멤버 추가 (이미 멤버이면 역할만 갱신하지 않고 보존 — owner/기존 권한 유지)
    INSERT INTO public.project_members (project_id, user_id, role)
    SELECT DISTINCT pi.project_id, v_user_id, pi.role
    FROM public.pending_project_invitations pi
    WHERE
      (v_email IS NOT NULL AND pi.email IS NOT NULL AND lower(pi.email) = lower(v_email))
      OR (v_full_name IS NOT NULL AND pi.full_name IS NOT NULL AND pi.full_name = v_full_name)
    ON CONFLICT (project_id, user_id) DO NOTHING;

    -- 매칭된 pending 행 정리 (1회 소비)
    DELETE FROM public.pending_project_invitations pi
    WHERE
      (v_email IS NOT NULL AND pi.email IS NOT NULL AND lower(pi.email) = lower(v_email))
      OR (v_full_name IS NOT NULL AND pi.full_name IS NOT NULL AND pi.full_name = v_full_name);
  END IF;

  -- 3) 응답용 데이터
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
