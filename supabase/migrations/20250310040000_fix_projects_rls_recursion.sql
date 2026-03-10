-- projects RLS 무한 재귀 수정
-- projects_select가 project_members를 참조하고, project_members_select가 projects를 참조하여 순환 발생
-- SECURITY DEFINER 함수로 RLS 우회하여 접근 가능한 project_id 목록 반환

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

-- 편집 권한(owner/editor)이 있는 프로젝트 ID 목록
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

-- projects SELECT: 관리자 OR 소유자 OR 멤버 (재귀 제거)
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_project_ids())
  );

-- projects UPDATE: 관리자 OR 소유자 OR editor 이상 (재귀 제거)
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_editable_project_ids())
  );

-- project_members SELECT: 관리자 OR 프로젝트 소유자 OR 본인 (재귀 제거)
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids()) OR
    user_id = auth.uid()
  );

-- 소유자만 접근 가능한 프로젝트 ID (insert/delete용, project_members 참조 없음)
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

-- project_invites SELECT: 관리자 OR 프로젝트 소유자 (재귀 제거)
DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids())
  );

-- project_members INSERT/DELETE: 소유자만 (재귀 제거)
DROP POLICY IF EXISTS "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  );

DROP POLICY IF EXISTS "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  );

-- project_invites INSERT/DELETE: 소유자만 (재귀 제거)
DROP POLICY IF EXISTS "project_invites_insert" ON project_invites;
CREATE POLICY "project_invites_insert" ON project_invites FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  );

DROP POLICY IF EXISTS "project_invites_delete" ON project_invites;
CREATE POLICY "project_invites_delete" ON project_invites FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  );

-- tasks 정책: projects/project_members 서브쿼리 제거 (재귀 방지)
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids())
  );

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );
