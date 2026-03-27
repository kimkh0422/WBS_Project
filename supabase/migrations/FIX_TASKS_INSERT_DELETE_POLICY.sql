-- tasks INSERT/DELETE 정책을 최신 버전으로 재적용
-- (UPDATE는 되는데 INSERT/DELETE만 권한 오류 나는 경우)

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    public.is_admin_user() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

-- 적용된 정책 확인
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'tasks'
ORDER BY cmd;
