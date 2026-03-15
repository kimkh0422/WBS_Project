-- 승인된 사용자(approved)는 모든 프로젝트의 작업(tasks)도 조회 가능 (읽기 전용)
-- 기존 RLS: 관리자 또는 프로젝트 멤버만 tasks SELECT 가능
-- 변경 RLS: 관리자 OR 승인된 사용자 OR 프로젝트 멤버

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (
    public.is_admin_user() OR
    public.is_approved_user() OR
    project_id = ANY(public.get_user_project_ids())
  );

