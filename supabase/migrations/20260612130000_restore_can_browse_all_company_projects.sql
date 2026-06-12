-- ============================================================================
-- [핫픽스] 누락된 RLS 도우미 함수 복구: public.can_browse_all_company_projects()
-- ----------------------------------------------------------------------------
-- 증상:
--   프로젝트/작업 삭제·생성·수정 시
--     [42883] function public.can_browse_all_company_projects() does not exist
--   토스트가 뜨고, RLS가 막혀 DELETE/INSERT/UPDATE가 실패한다.
--
-- 원인:
--   tasks_insert / tasks_update / tasks_delete 정책(20260605200000)이
--     get_user_editable_project_ids()(20260527140000)를 호출하고,
--   그 함수가 내부에서 can_browse_all_company_projects()(20260526130000)를 부른다.
--   운영 DB에 이 말단 함수가 없다 →
--     · 20260526130000 이 운영 DB에 적용되지 않았거나,
--     · is_external_partner 컬럼을 DROP ... CASCADE 하면서 이 컬럼을 참조하는
--       두 함수(is_external_partner_user, can_browse_all_company_projects)가 함께 삭제됨.
--   (관리자가 아니면 is_admin_user()=false 라 OR 우변의 함수가 실제로 평가되어 터진다.
--    UI는 @gmtc.kr 을 관리자처럼 보여주지만 DB의 is_admin_user 는 profiles.is_admin 기준이다.)
--
-- 조치:
--   누락 시 컬럼·함수를 원래 정의(20260526130000)대로 (재)생성한다.
--   정책·데이터 변경은 건드리지 않는다(이후 마이그레이션이 정한 현재 상태 유지).
--
-- 안전성: 전부 멱등(IF NOT EXISTS / CREATE OR REPLACE). 이미 정상이면 무영향.
-- ============================================================================

-- 함수들이 참조하는 컬럼 보장 (DROP CASCADE로 사라졌던 경우 복구)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_external_partner boolean NOT NULL DEFAULT false;

-- 현재 세션 사용자가 외주(비사내) 프로필인지 — RLS 보조
CREATE OR REPLACE FUNCTION public.is_external_partner_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT is_external_partner FROM public.profiles WHERE id = auth.uid()), false);
$$;

COMMENT ON FUNCTION public.is_external_partner_user() IS
  '현재 세션 사용자가 외주(비사내 메일) 프로필인지. RLS에서 사용.';

-- 사내 승인 회원만 true → 전사 프로젝트/작업 RLS 탐색 허용.
-- get_user_editable_project_ids() 가 호출 → 없으면 작업/프로젝트 쓰기 RLS가 42883으로 실패.
CREATE OR REPLACE FUNCTION public.can_browse_all_company_projects()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT approved AND NOT coalesce(is_external_partner, false)
      FROM public.profiles
      WHERE id = auth.uid()
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.can_browse_all_company_projects() IS
  '사내 승인 회원만 true. 외주는 false → 전사 프로젝트/작업 RLS 탐색 비허용.';
