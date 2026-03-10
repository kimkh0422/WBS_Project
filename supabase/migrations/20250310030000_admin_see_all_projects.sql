-- 관리자는 모든 프로젝트·작업 조회 가능
-- 로그인한 사용자는 프로젝트 생성 가능 (projects_insert는 이미 owner_id = auth.uid() 체크)

-- projects SELECT: 관리자 OR 소유자 OR 멤버
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

-- projects UPDATE: 관리자 OR 소유자 OR editor 이상
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

-- projects DELETE: 관리자 OR 소유자만
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );

-- tasks SELECT: 관리자 OR 소유 프로젝트 OR 멤버 프로젝트
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- tasks INSERT: 관리자 OR 소유 프로젝트 OR editor 이상
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- tasks UPDATE: 관리자 OR 소유 프로젝트 OR editor 이상
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    public.is_admin_user() OR
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- tasks DELETE: 관리자 OR 소유 프로젝트 OR editor 이상
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- project_members SELECT: 관리자 OR 프로젝트 소유자 OR 본인
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()) OR
    user_id = auth.uid()
  );

-- project_invites SELECT: 관리자 OR 프로젝트 소유자
DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );
