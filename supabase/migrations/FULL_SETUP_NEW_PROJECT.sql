-- =============================================================================
-- WBS 매니저 - 새 Supabase 프로젝트 전체 설정
-- =============================================================================
-- 새로 만든 Supabase 프로젝트에서 이 파일 전체를 SQL Editor에 붙여넣고 Run 실행
-- =============================================================================

-- 1. 기본 테이블
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  start_date date,
  assignments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  progress integer DEFAULT 0,
  assignee text DEFAULT '',
  status text DEFAULT 'todo',
  expanded boolean DEFAULT false,
  dependencies text[] DEFAULT '{}',
  work_effort integer,
  description text,
  checklist jsonb DEFAULT '[]'::jsonb,
  deliverables text,
  user_locked_fields text[] DEFAULT '{}'::text[],
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS wbs_settings (
  id text PRIMARY KEY DEFAULT 'default',
  level1_prefix text DEFAULT 'W',
  level2_prefix text DEFAULT 'W',
  level3_prefix text DEFAULT 'T',
  max_level integer DEFAULT 3
);

INSERT INTO wbs_settings (id, level1_prefix, level2_prefix, level3_prefix, max_level)
VALUES ('default', 'W', 'W', 'T', 3)
ON CONFLICT (id) DO NOTHING;

-- 2. tasks 확장 컬럼
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone boolean DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_start_date date NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_end_date date NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS baseline_work_effort numeric(10,2) NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_locked_fields text[] DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projects;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE wbs_settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. 인증 및 공유 (owner_id, project_members, project_invites)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

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

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_token ON project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE wbs_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (owner_id = auth.uid() OR id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (owner_id = auth.uid() OR id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members FOR DELETE
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_invites_insert" ON project_invites;
CREATE POLICY "project_invites_insert" ON project_invites FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_invites_delete" ON project_invites;
CREATE POLICY "project_invites_delete" ON project_invites FOR DELETE
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

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

DROP POLICY IF EXISTS "wbs_settings_select" ON wbs_settings;
CREATE POLICY "wbs_settings_select" ON wbs_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "wbs_settings_insert" ON wbs_settings;
CREATE POLICY "wbs_settings_insert" ON wbs_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "wbs_settings_update" ON wbs_settings;
CREATE POLICY "wbs_settings_update" ON wbs_settings FOR UPDATE TO authenticated USING (true);

-- 4. profiles (회원 관리)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz DEFAULT now(),
  is_admin boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, is_admin)
  VALUES (new.id, new.email, (SELECT count(*) FROM public.profiles) = 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

INSERT INTO public.profiles (id, email, is_admin)
SELECT id, email, (row_number() OVER (ORDER BY created_at)) = 1
FROM auth.users
ON CONFLICT (id) DO NOTHING;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- is_admin_user: RLS 우회하여 관리자 여부 확인 (무한 재귀 방지)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (public.is_admin_user());
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (id = auth.uid());
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (public.is_admin_user());

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
  INSERT INTO profiles (id, email, is_admin)
  SELECT v_user_id, u.email, (SELECT count(*) FROM profiles) = 0
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_user_id;
  RETURN jsonb_build_object('is_admin', coalesce(v_is_admin, false));
END;
$$;
