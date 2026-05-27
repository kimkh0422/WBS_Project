-- 사용자 본인: pending 상태에서 requested_role 변경(예: viewer → editor)
DROP POLICY IF EXISTS "project_access_requests_update_own_pending_role" ON public.project_access_requests;
CREATE POLICY "project_access_requests_update_own_pending_role" ON public.project_access_requests
  FOR UPDATE
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND requested_role IN ('viewer', 'editor')
  );

-- 사용자 본인: 승인된 보기 권한 요청 기록을 편집 권한 재요청(pending)으로 전환
DROP POLICY IF EXISTS "project_access_requests_update_own_approved_viewer_editor_reask" ON public.project_access_requests;
CREATE POLICY "project_access_requests_update_own_approved_viewer_editor_reask" ON public.project_access_requests
  FOR UPDATE
  USING (user_id = auth.uid() AND status = 'approved' AND requested_role = 'viewer')
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND requested_role = 'editor'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
  );

COMMENT ON POLICY "project_access_requests_update_own_pending_role" ON public.project_access_requests IS
  '본인이 대기 중인 요청의 희망 권한(viewer/editor)을 수정할 수 있음.';

COMMENT ON POLICY "project_access_requests_update_own_approved_viewer_editor_reask" ON public.project_access_requests IS
  '보기 승인 후 편집 권한을 추가로 요청할 때 기존 행을 pending+editor로 되돌림.';
