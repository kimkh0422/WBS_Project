-- @gmtc.kr 사내 계정을 "프로젝트·작업 쓰기" 권한에서 관리자와 동일하게 취급.
--
-- 배경(버그):
--   UI는 effectiveIsAdmin = (is_admin OR @gmtc.kr 메일) 로 판정하여 사내 계정에게
--   모든 프로젝트의 편집·삭제·공유 버튼을 노출한다(App.tsx, "gmtc.kr 계정은 관리자와 동일").
--   그러나 DB RLS(projects_update 등)는 is_admin_user()(=profiles.is_admin) 또는
--   소유자/에디터 멤버만 허용했다. 그 결과 사내 "비(非)관리자" 계정이 타인 소유 프로젝트를
--   수정하면 UPDATE가 0행으로 "오류 없이" 거부되고, 이후 서버 풀(mergeProjectsDelta)이
--   로컬 변경을 서버 값으로 되돌려 "수정했는데 반영이 안 됨"이 발생했다.
--
-- 이 마이그레이션은 RLS를 UI 의도(gmtc.kr = 관리자)와 일치시켜 사내 계정이 모든
-- 프로젝트·작업을 실제로 저장할 수 있게 한다.
--
-- 범위 한정: 여기서 부여하는 것은 "프로젝트/작업 콘텐츠 쓰기"뿐이다.
--   profiles·역할 관리 등 시스템 관리(is_admin_user 기반)는 그대로 두어,
--   사내 일반 계정이 관리자 전용 기능까지 얻지는 않는다.
--   외부(외주) 도메인 계정은 종전대로 공유(project_members)된 프로젝트만 편집한다.

-- 현재 로그인 사용자의 이메일이 사내(@gmtc.kr) 도메인인지.
-- emailDomain.ts의 isInternalCompanyEmail(마지막 @ 뒤 도메인 == gmtc.kr)과 동일 규칙.
CREATE OR REPLACE FUNCTION public.is_internal_company_user()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(lower(auth.jwt() ->> 'email') ~ '@gmtc\.kr$', false);
$$;

-- 프로젝트·작업 콘텐츠 쓰기에서 관리자와 동일하게 취급할 대상: 시스템 관리자 OR 사내 계정.
CREATE OR REPLACE FUNCTION public.can_admin_project_content()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin_user() OR public.is_internal_company_user();
$$;

-- ── projects: INSERT / UPDATE / DELETE ──────────────────────────────────────
DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (
    public.can_admin_project_content() OR
    owner_id = auth.uid()
  );

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    public.can_admin_project_content() OR
    owner_id = auth.uid() OR
    id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (
    public.can_admin_project_content() OR
    owner_id = auth.uid()
  );

-- ── tasks: INSERT / UPDATE / DELETE ─────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    public.can_admin_project_content() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    public.can_admin_project_content() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    public.can_admin_project_content() OR
    project_id = ANY(public.get_user_editable_project_ids())
  );
