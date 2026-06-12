-- 프로젝트 삭제 권한을 "만든 사람(소유자) + 운영자(시스템 관리자)"로 한정.
--
-- 배경(요청):
--   종전 projects_delete 정책은 can_admin_project_content()
--   = is_admin_user() OR is_internal_company_user()(@gmtc.kr 사내 계정) 까지 허용해,
--   사내 계정이면 누구나 남의 프로젝트를 삭제할 수 있었다(UI도 effectiveIsAdmin으로 삭제 버튼 노출).
--   이를 "소유자 본인 또는 운영자(profiles.is_admin)만 삭제"로 좁힌다.
--
--   주의: 콘텐츠 "편집"(projects_update / tasks_*)은 종전대로 사내 계정도 가능하게 유지한다.
--   여기서 좁히는 것은 프로젝트 "삭제"뿐이다.
--
--   silent-0-row 주의: RLS가 DELETE를 막으면 오류 없이 0행이 삭제된다.
--   클라이언트(deleteProjectFromDB)는 "읽혔는데 0행 삭제"를 권한 오류로 올려
--   서버 풀이 조용히 되살리지 않도록 처리한다.

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects FOR DELETE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );
