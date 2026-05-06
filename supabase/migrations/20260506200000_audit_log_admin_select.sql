-- 관리자(profiles.is_admin = true)는 모든 프로젝트의 변경 이력을 조회 가능.
-- 기존 정책: 소유자 또는 멤버만 조회 → 관리자 절 추가.
DROP POLICY IF EXISTS "wbs_audit_log_select" ON wbs_audit_log;
CREATE POLICY "wbs_audit_log_select" ON wbs_audit_log FOR SELECT
  USING (
    public.is_admin_user()
    OR project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
