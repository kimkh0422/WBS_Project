-- 승인되어 project_members에 등록된 회원은 역할이 viewer여도 보기·편집 동일하게
-- 작업(tasks) 및 프로젝트 메타(projects UPDATE)를 다룰 수 있도록 한다.
-- (기존: owner/editor 멤버만 get_user_editable_project_ids에 포함)

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
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'viewer')
    ) t
  );
END;
$$;

COMMENT ON FUNCTION public.get_user_editable_project_ids() IS
  '비관리자: 본인 소유 프로젝트 또는 project_members(owner/editor/viewer). 승인 멤버는 viewer여도 편집 가능.';
