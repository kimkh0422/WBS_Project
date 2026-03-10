-- =============================================================================
-- RLS 무한 재귀 + 저장 실패 즉시 수정 (Supabase SQL Editor에서 실행)
-- 1. projects ↔ project_members 순환 참조 제거
-- 2. projects INSERT 정책에 관리자 추가
-- 3. work_effort: integer → numeric (0.5일 등 소수 공수 지원)
-- =============================================================================

-- work_effort 소수 지원 (0.5, 1.5 등)
ALTER TABLE tasks
  ALTER COLUMN work_effort TYPE numeric(10,2) USING work_effort::numeric(10,2);

-- 0. is_admin_user (profiles RLS 재귀 방지)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

-- 1. SECURITY DEFINER 함수: RLS 우회하여 project_id 목록 반환
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

-- 2. projects 정책 (서브쿼리 제거 → 함수 사용)
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_project_ids())
  );

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_editable_project_ids())
  );

-- projects INSERT: 관리자 OR owner_id = auth.uid()
DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );

-- 3. project_members 정책
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids()) OR
    user_id = auth.uid()
  );

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

-- 4. project_invites 정책
DROP POLICY IF EXISTS "project_invites_select" ON project_invites;
CREATE POLICY "project_invites_select" ON project_invites FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_project_ids())
  );

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

-- 5. tasks 정책
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
