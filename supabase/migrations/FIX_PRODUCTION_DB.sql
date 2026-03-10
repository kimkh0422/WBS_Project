-- =============================================================================
-- 프로덕션 DB 수정 스크립트
-- Supabase 대시보드 → SQL Editor에서 전체 실행
--
-- 원인: owner_id, profiles 등 마이그레이션이 적용되지 않아
--       - 프로젝트/작업 저장 실패 (PGRST206: owner_id 없음)
--       - 사용자 설정(profiles) 404
--       - 가져온 데이터가 새로고침 시 사라짐
-- =============================================================================

-- 1. projects에 owner_id 추가
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

-- 2. project_members, project_invites 테이블
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  UNIQUE(token)
);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_token ON project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);

-- 3. profiles 테이블 (full_name, level_colors 포함)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  level_colors jsonb,
  created_at timestamptz DEFAULT now(),
  is_admin boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level_colors jsonb;

-- 4. 기존 auth.users → profiles 백필
INSERT INTO public.profiles (id, email, full_name, is_admin)
SELECT
  u.id,
  u.email,
  COALESCE(
    NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
    NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
  ),
  (row_number() OVER (ORDER BY u.created_at)) = 1
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = COALESCE(profiles.full_name, EXCLUDED.full_name);

-- 5. is_admin_user (profiles RLS 재귀 방지용 - SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

-- 6. RLS 우회 헬퍼 함수들
CREATE OR REPLACE FUNCTION public.get_user_project_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce(
    array_agg(DISTINCT pid) FILTER (WHERE pid IS NOT NULL),
    ARRAY[]::uuid[]
  )
  FROM (
    SELECT id AS pid FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id AS pid FROM project_members WHERE user_id = auth.uid()
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_user_editable_project_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce(
    array_agg(DISTINCT pid) FILTER (WHERE pid IS NOT NULL),
    ARRAY[]::uuid[]
  )
  FROM (
    SELECT id AS pid FROM projects WHERE owner_id = auth.uid()
    UNION
    SELECT project_id AS pid FROM project_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_user_owned_project_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[])
  FROM projects WHERE owner_id = auth.uid();
$$;

-- 7. ensure_profile RPC (로그인 시 프로필 생성)
CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false);
  END IF;

  INSERT INTO profiles (id, email, full_name, is_admin)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM profiles) = 0
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_user_id;
  RETURN jsonb_build_object('is_admin', coalesce(v_is_admin, false));
END;
$$;

-- 8. handle_new_user 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_admin)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM public.profiles) = 0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 9. RLS 활성화
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_settings ENABLE ROW LEVEL SECURITY;

-- 10. projects RLS
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_project_ids())
  );
DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (public.is_admin_user() OR owner_id = auth.uid());
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_editable_project_ids())
  );
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (public.is_admin_user() OR owner_id = auth.uid());

-- 11. tasks RLS
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_project_ids()));
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (public.is_admin_user() OR project_id = ANY(public.get_user_editable_project_ids()));
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_editable_project_ids()));
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_editable_project_ids()));

-- 12. project_members, project_invites RLS
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids()) OR
    user_id = auth.uid()
  );
DROP POLICY IF EXISTS "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members FOR INSERT
  WITH CHECK (public.is_admin_user() OR project_id = ANY(public.get_user_owned_project_ids()));
DROP POLICY IF EXISTS "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members FOR DELETE
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_owned_project_ids()));

DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_project_ids()));
DROP POLICY IF EXISTS "project_invites_insert" ON project_invites;
CREATE POLICY "project_invites_insert" ON project_invites FOR INSERT
  WITH CHECK (public.is_admin_user() OR project_id = ANY(public.get_user_owned_project_ids()));
DROP POLICY IF EXISTS "project_invites_delete" ON project_invites;
CREATE POLICY "project_invites_delete" ON project_invites FOR DELETE
  USING (public.is_admin_user() OR project_id = ANY(public.get_user_owned_project_ids()));

-- 13. profiles RLS (is_admin_user 사용으로 재귀 방지)
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT USING (public.is_admin_user());
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (public.is_admin_user());

-- 14. wbs_settings RLS
DROP POLICY IF EXISTS "wbs_settings_select" ON wbs_settings;
CREATE POLICY "wbs_settings_select" ON wbs_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "wbs_settings_insert" ON wbs_settings;
CREATE POLICY "wbs_settings_insert" ON wbs_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "wbs_settings_update" ON wbs_settings;
CREATE POLICY "wbs_settings_update" ON wbs_settings FOR UPDATE TO authenticated USING (true);

-- 15. accept_invite RPC (초대 링크 수락용)
CREATE OR REPLACE FUNCTION accept_invite(invite_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_role text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT project_id, role INTO v_project_id, v_role
  FROM project_invites
  WHERE token = invite_token AND expires_at > now()
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  END IF;

  INSERT INTO project_members (project_id, user_id, role)
  VALUES (v_project_id, v_user_id, v_role)
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  RETURN jsonb_build_object('success', true, 'project_id', v_project_id);
END;
$$;

-- 16. 기존 프로젝트에 owner_id 설정 (첫 번째 사용자를 소유자로)
UPDATE projects SET owner_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
WHERE owner_id IS NULL AND EXISTS (SELECT 1 FROM auth.users LIMIT 1);
