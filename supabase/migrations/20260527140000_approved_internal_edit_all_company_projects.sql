-- 사내 승인 회원(can_browse_all_company_projects): 멤버십과 무관하게 전 프로젝트 작업·메타 편집.
-- - RPC `get_user_editable_project_ids()`가 UI(canEdit)와 동일 기준이므로, 전사 탐색 허용 시 전체 ID 반환.
-- - 프로젝트 삭제(projects_delete)는 전사 편집과 분리: 관리자·소유자·멤버(owner/editor)만 (viewer·비멤버 승인자 제외).

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects FOR DELETE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid() OR
    id IN (
      SELECT project_id FROM public.project_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

CREATE OR REPLACE FUNCTION public.get_user_editable_project_ids()
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF public.is_admin_user() THEN
    RETURN (SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) FROM public.projects);
  END IF;
  IF public.can_browse_all_company_projects() THEN
    RETURN (SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) FROM public.projects);
  END IF;
  RETURN (
    SELECT coalesce(
      array_agg(DISTINCT pid) FILTER (WHERE pid IS NOT NULL),
      ARRAY[]::uuid[]
    )
    FROM (
      SELECT id AS pid FROM public.projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id AS pid FROM public.project_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'viewer')
    ) t
  );
END;
$$;

COMMENT ON FUNCTION public.get_user_editable_project_ids() IS
  '편집 가능 프로젝트 ID: 관리자는 전체. 사내 승인·비외주(can_browse_all_company_projects)도 전체. 그 외는 소유 + project_members(owner/editor/viewer).';
