-- ============================================================================
-- [근본 수정] 사내(@gmtc.kr) 회원은 approved/is_external_partner 값과 무관하게
--            전사 프로젝트·작업 목록을 조회할 수 있어야 한다.
-- ----------------------------------------------------------------------------
-- 증상:
--   일부 @gmtc.kr 회원이 대시보드에 프로젝트가 1개(본인 소유/멤버 등록분)만 보임.
--
-- 원인:
--   클라이언트(withInternalCompanyAutoApprove, src/lib/db/profiles.ts)는
--   @gmtc.kr 메일이면 DB 값과 무관하게 approved=true, is_external_partner=false 로
--   취급하여 프로젝트 필터를 걸지 않는다(전부 보여줄 준비).
--   그러나 DB RLS의 전사 조회 게이트 can_browse_all_company_projects() 는
--   실제 profiles.approved / is_external_partner 컬럼을 본다.
--   해당 회원의 row 가 approved=false(또는 is_external_partner=true)로 남아 있으면
--   projects_select / tasks_select 정책이 본인 소유·project_members 분만 반환 → 1개.
--   (20260615180000 의 데이터 보정이 운영 DB에 적용되지 않았거나 이후 드리프트로 재발.)
--
-- 조치:
--   can_browse_all_company_projects() 가 세션 사용자의 auth 이메일 도메인을
--   직접 본다. @gmtc.kr 사내 메일이면 컬럼 값과 무관하게 true → 데이터가 어긋나
--   있어도 전사 조회가 보장된다(클라이언트 정책과 일치).
--   기존 approved 기반 판정은 비사내(혹시 모를 잔존) 계정을 위해 OR 로 유지.
--
-- 영향:
--   이 함수를 호출하는 projects_select, tasks_select 정책이 함께 정정된다.
--   정책 자체는 변경하지 않는다(CREATE OR REPLACE FUNCTION 만으로 반영).
--
-- 안전성: 멱등(CREATE OR REPLACE). 관리자/운영자(is_admin) 판정과는 독립.
-- ============================================================================

-- 선행 보장: 운영 DB에 is_external_partner 컬럼이 없을 수 있다(과거 DROP CASCADE).
-- can_browse_all_company_projects() 가 이 컬럼을 참조하므로 멱등 보장.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_external_partner boolean NOT NULL DEFAULT false;

-- 선행 보장: 운영 DB에 20260526130000 이 적용되지 않아 auth_email_is_gmtc_internal()
-- 가 없을 수 있다(42883). 멱등 재생성하여 아래 함수가 항상 참조 가능하게 한다.
CREATE OR REPLACE FUNCTION public.auth_email_is_gmtc_internal(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(split_part(coalesce(p_email, ''), '@', 2))) = 'gmtc.kr';
$$;

COMMENT ON FUNCTION public.auth_email_is_gmtc_internal(text) IS
  '회원 이메일 도메인이 지엠티 사내(@gmtc.kr)인지. 외부 파트너 플래그·전사 조회 판별에 사용.';

CREATE OR REPLACE FUNCTION public.can_browse_all_company_projects()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- 사내 @gmtc.kr 메일은 승인·외부 플래그와 무관하게 전사 조회 허용.
    -- (UI의 withInternalCompanyAutoApprove 와 정책 일치, 데이터 드리프트에도 안전)
    public.auth_email_is_gmtc_internal(
      (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid())
    )
    OR coalesce(
      (
        SELECT approved AND NOT coalesce(is_external_partner, false)
        FROM public.profiles
        WHERE id = auth.uid()
      ),
      false
    );
$$;

COMMENT ON FUNCTION public.can_browse_all_company_projects() IS
  '전사 프로젝트/작업 RLS 탐색 허용 여부. @gmtc.kr 사내 메일이면 approved 값과 무관하게 true(UI와 일치). 그 외에는 approved AND NOT is_external_partner.';
