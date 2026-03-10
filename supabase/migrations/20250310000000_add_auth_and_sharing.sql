-- 사용자 인증 및 프로젝트 공유 기능
-- projects에 owner_id, project_members, project_invites 테이블 및 RLS 정책

-- projects에 owner_id 추가 (auth.users 참조)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- project_members: 프로젝트 공유 멤버
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- project_invites: 초대 링크 (토큰 기반)
CREATE TABLE IF NOT EXISTS project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'viewer')),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  UNIQUE(token)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_token ON project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);

-- RLS 활성화
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invites ENABLE ROW LEVEL SECURITY;

-- wbs_settings RLS (기존 테이블 - 모든 인증 사용자 읽기/쓰기)
ALTER TABLE wbs_settings ENABLE ROW LEVEL SECURITY;

-- projects RLS 정책
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- tasks RLS 정책 (project 접근 권한 상속)
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

-- project_members RLS
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()) OR
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members FOR DELETE
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

-- project_invites RLS (owner만 생성/조회/삭제)
DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_invites_insert" ON project_invites;
CREATE POLICY "project_invites_insert" ON project_invites FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "project_invites_delete" ON project_invites;
CREATE POLICY "project_invites_delete" ON project_invites FOR DELETE
  USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

-- accept_invite RPC: 토큰으로 초대 수락 (현재 사용자를 project_members에 추가)
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

-- wbs_settings: 모든 인증 사용자 접근 (단일 설정 공유)
DROP POLICY IF EXISTS "wbs_settings_select" ON wbs_settings;
CREATE POLICY "wbs_settings_select" ON wbs_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "wbs_settings_insert" ON wbs_settings;
CREATE POLICY "wbs_settings_insert" ON wbs_settings FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "wbs_settings_update" ON wbs_settings;
CREATE POLICY "wbs_settings_update" ON wbs_settings FOR UPDATE
  TO authenticated USING (true);
