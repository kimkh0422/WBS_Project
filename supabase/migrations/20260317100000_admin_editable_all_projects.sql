-- 관리자는 모든 프로젝트에 대해 편집 가능으로 간주 (공유/복사/편집/삭제 메뉴 표시 및 RLS와 일치)
-- get_user_editable_project_ids: 관리자일 때 전체 프로젝트 ID 반환

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
