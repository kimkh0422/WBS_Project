-- projects INSERT: 관리자 OR owner_id = auth.uid()
-- 기존 정책은 owner_id = auth.uid()만 허용. 관리자도 프로젝트 생성 가능하도록 추가

DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );
