-- editor 멤버도 자신이 속한 프로젝트의 작업(T/W)을 삭제할 수 있도록 허용
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );
