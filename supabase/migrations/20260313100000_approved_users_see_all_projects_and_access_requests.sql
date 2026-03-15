-- 승인된 사용자(approved)는 전체 프로젝트 목록만 조회 가능. 내용(작업)은 멤버인 프로젝트만.
-- 권한 요청(project_access_requests) 테이블: 승인 사용자가 보기/편집 권한 요청, 관리자·소유자가 승인.

-- 1) is_approved_user: RLS에서 사용 (profiles 직접 참조 시 재귀 방지를 위해 SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT coalesce((SELECT approved FROM profiles WHERE id = auth.uid()), false);
$$;

-- 2) projects SELECT: 관리자 OR 승인된 사용자 OR 소유자 OR 멤버 → 승인 사용자는 전체 목록 조회 가능
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    public.is_admin_user() OR
    public.is_approved_user() OR
    owner_id = auth.uid() OR
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

-- 3) project_access_requests: 권한 요청 및 승인/거절
CREATE TABLE IF NOT EXISTS project_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role text NOT NULL CHECK (requested_role IN ('viewer', 'editor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_access_requests_project ON project_access_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_project_access_requests_user ON project_access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_project_access_requests_status ON project_access_requests(status);

ALTER TABLE project_access_requests ENABLE ROW LEVEL SECURITY;

-- 본인: 자신의 요청만 INSERT, SELECT
DROP POLICY IF EXISTS "project_access_requests_insert_own" ON project_access_requests;
CREATE POLICY "project_access_requests_insert_own" ON project_access_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "project_access_requests_select_own" ON project_access_requests;
CREATE POLICY "project_access_requests_select_own" ON project_access_requests FOR SELECT
  USING (user_id = auth.uid());

-- 관리자 또는 해당 프로젝트 소유자: 해당 프로젝트에 대한 요청 SELECT, UPDATE(승인/거절)
DROP POLICY IF EXISTS "project_access_requests_select_admin_or_owner" ON project_access_requests;
CREATE POLICY "project_access_requests_select_admin_or_owner" ON project_access_requests FOR SELECT
  USING (
    public.is_admin_user() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "project_access_requests_update_admin_or_owner" ON project_access_requests;
CREATE POLICY "project_access_requests_update_admin_or_owner" ON project_access_requests FOR UPDATE
  USING (
    public.is_admin_user() OR
    project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
  );

-- 본인: 거절된 요청을 다시 pending으로 재요청 가능 (status = 'pending', reviewed_* null 만 허용)
DROP POLICY IF EXISTS "project_access_requests_update_own_rerequest" ON project_access_requests;
CREATE POLICY "project_access_requests_update_own_rerequest" ON project_access_requests FOR UPDATE
  USING (user_id = auth.uid() AND status = 'rejected')
  WITH CHECK (user_id = auth.uid() AND status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL);
