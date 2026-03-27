-- editor 멤버도 자신이 속한 프로젝트를 삭제할 수 있도록 허용
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (
    public.is_admin_user() OR
    id = ANY(public.get_user_editable_project_ids())
  );
