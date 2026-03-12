-- 관리자/소유자가 project_members의 role(보기/편집)을 변경할 수 있도록 UPDATE 정책 추가

DROP POLICY IF EXISTS "project_members_update" ON project_members;
CREATE POLICY "project_members_update" ON project_members FOR UPDATE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  )
  WITH CHECK (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_owned_project_ids())
  );
