-- 비관리자도 본인 프로젝트(owner_id = auth.uid()) 및 editor 멤버 프로젝트를 자유롭게 편집 가능하도록 보장.
-- 관리자는 기존처럼 모든 프로젝트에 접근 가능.
-- ※ 이 마이그레이션은 기존 정책을 덮어쓰는 방식으로 안전하게 재적용합니다.

-- 1) get_user_editable_project_ids 재확인
--    관리자: 전체 프로젝트
--    비관리자: owner 또는 project_members(owner/editor)
CREATE OR REPLACE FUNCTION public.get_user_editable_project_ids()
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF public.is_admin_user() THEN
    RETURN (SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) FROM projects);
  END IF;
  RETURN (
    SELECT coalesce(
      array_agg(DISTINCT pid) FILTER (WHERE pid IS NOT NULL),
      ARRAY[]::uuid[]
    )
    FROM (
      SELECT id AS pid FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id AS pid FROM project_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_editable_project_ids() TO authenticated;

-- 2) tasks RLS: 관리자 OR 편집 가능 프로젝트
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

-- 3) projects RLS: 관리자 OR owner OR editor 멤버
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );
