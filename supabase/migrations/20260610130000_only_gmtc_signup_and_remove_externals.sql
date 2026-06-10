-- ============================================================================
-- 회원가입 정책 변경: @gmtc.kr 사내 메일만 허용. 기존 외부(비-@gmtc.kr) 계정 일괄 제거.
-- ----------------------------------------------------------------------------
-- 배경:
--   기존에는 외주 파트너(비-@gmtc.kr) 계정도 회원가입 가능했고, RLS와 클라이언트
--   allowlist(is_external_partner)로 본인이 공유받은 프로젝트만 볼 수 있게 제한했었다.
--   요청에 따라 외부 계정 개념을 폐기하고 사내 메일 전용 시스템으로 전환한다.
--
-- 동작:
--   1) handle_new_user 트리거: 회원가입(=auth.users INSERT) 시 이메일이 @gmtc.kr이
--      아니면 예외를 발생시켜 가입 자체를 차단한다.
--   2) 기존 외부 계정이 소유한 프로젝트는 첫 번째 슈퍼관리자(profiles.is_admin=true)
--      에게 이관한다. 슈퍼관리자가 없으면 다음 단계의 CASCADE로 함께 삭제된다.
--   3) 외부 계정의 pending 초대를 정리한다.
--   4) auth.users에서 비-@gmtc.kr 사용자를 삭제한다(profiles·project_members 등은
--      FK ON DELETE CASCADE로 함께 삭제된다).
--
-- 안전성:
--   - 재실행 가능(idempotent). 이미 정리된 경우 변경 없음.
--   - 클라이언트(emailDomain.ts) 검증과 함께 다층 방어.
-- ============================================================================

-- ─── 1) 회원가입 트리거: @gmtc.kr 외 차단 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first boolean;
BEGIN
  -- 회원가입 차단: @gmtc.kr 이외 도메인은 예외를 던져 auth.users INSERT 자체를 실패시킨다.
  -- 슈퍼관리자 부트스트랩 이메일(is_bootstrap_super_admin)도 예외 통과시켜 운영 가능.
  IF NOT public.auth_email_is_gmtc_internal(new.email)
     AND NOT public.is_bootstrap_super_admin(new.email) THEN
    RAISE EXCEPTION '회원가입은 @gmtc.kr 사내 메일만 가능합니다. (입력: %)', new.email
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT (count(*) = 0) INTO v_first FROM public.profiles;
  INSERT INTO public.profiles (id, email, full_name, is_admin, approved, is_external_partner)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    (v_first AND public.auth_email_is_gmtc_internal(new.email)) OR public.is_bootstrap_super_admin(new.email),
    true,
    false  -- 외부 파트너 개념 폐기 — 신규 가입자는 항상 사내
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  '회원가입(auth.users INSERT) 시 @gmtc.kr 사내 메일만 허용. 그 외 도메인은 예외로 INSERT 자체를 차단.';

-- ─── 2) 외부 계정 소유 프로젝트 이관(슈퍼관리자가 있을 때만) ────────────────
DO $$
DECLARE
  v_new_owner uuid;
  v_transferred int := 0;
BEGIN
  -- 가장 오래된 슈퍼관리자 1명을 새 소유자로 선정
  SELECT p.id INTO v_new_owner
  FROM public.profiles p
  WHERE coalesce(p.is_admin, false) = true
  ORDER BY p.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_new_owner IS NOT NULL THEN
    UPDATE public.projects pr
    SET owner_id = v_new_owner
    FROM auth.users u
    WHERE pr.owner_id = u.id
      AND lower(coalesce(u.email::text, '')) NOT LIKE '%@gmtc.kr';
    GET DIAGNOSTICS v_transferred = ROW_COUNT;
    RAISE NOTICE '외부 계정 소유 프로젝트 % 건을 슈퍼관리자(%)에게 이관', v_transferred, v_new_owner;
  ELSE
    RAISE NOTICE '슈퍼관리자를 찾지 못해 프로젝트 이관 생략 — 외부 소유 프로젝트는 CASCADE로 함께 삭제됩니다';
  END IF;
END $$;

-- ─── 3) 비-@gmtc.kr 대상 pending 초대 정리 ─────────────────────────────────
DELETE FROM public.pending_project_invitations
WHERE email IS NOT NULL
  AND lower(email) NOT LIKE '%@gmtc.kr';

-- ─── 4) 외부 계정 일괄 삭제 ─────────────────────────────────────────────────
--   profiles·project_members·project_access_requests 등은 FK ON DELETE CASCADE로 자동 정리됨.
--   슈퍼관리자에게 이관되지 않은 소유 프로젝트는 함께 삭제된다(2단계 RAISE NOTICE 참고).
DELETE FROM auth.users
WHERE lower(coalesce(email::text, '')) NOT LIKE '%@gmtc.kr';

-- ─── 5) is_external_partner 플래그 일괄 false (잔여 정합성 보정) ─────────────
UPDATE public.profiles
SET is_external_partner = false
WHERE coalesce(is_external_partner, false) = true;

-- ─── 6) (선택) 기존 외부 파트너용 RLS·도우미 함수는 그대로 두어 호환 유지 ─────
--   can_browse_all_company_projects()는 여전히 NOT is_external_partner 조건을 사용하지만,
--   모든 사용자가 사내 메일이고 is_external_partner=false이므로 사실상 영향 없다.
--   추후 완전 제거를 원하면 별도 마이그레이션으로 외부 파트너 인프라(컬럼·함수·정책)를 단계적으로 드롭.
