-- 변경 이력(감사 로그): 누가 언제 무엇을 생성/수정/삭제했는지 기록
CREATE TABLE IF NOT EXISTS wbs_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('task', 'project')),
  entity_id uuid,
  entity_name text,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'bulk_update')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display text,
  created_at timestamptz DEFAULT now(),
  changes jsonb
);

CREATE INDEX IF NOT EXISTS idx_wbs_audit_log_project_created ON wbs_audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wbs_audit_log_entity ON wbs_audit_log(entity_type, entity_id);

ALTER TABLE wbs_audit_log ENABLE ROW LEVEL SECURITY;

-- 조회: 해당 프로젝트를 볼 수 있는 사용자만(소유자 또는 멤버)
DROP POLICY IF EXISTS "wbs_audit_log_select" ON wbs_audit_log;
CREATE POLICY "wbs_audit_log_select" ON wbs_audit_log FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );

-- 삽입: 해당 프로젝트를 볼 수 있는 사용자만(소유자 또는 멤버)
DROP POLICY IF EXISTS "wbs_audit_log_insert" ON wbs_audit_log;
CREATE POLICY "wbs_audit_log_insert" ON wbs_audit_log FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      project_id IS NULL
      OR project_id IN (
        SELECT id FROM projects WHERE owner_id = auth.uid()
        UNION
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );
