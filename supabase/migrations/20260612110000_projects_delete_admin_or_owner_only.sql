-- 프로젝트 삭제 권한을 "만든 사람(소유자) + 운영자(시스템 관리자)"로 한정.
--
-- 배경(요청):
--   종전 projects_delete 정책은 can_admin_project_content()
--   = is_admin_user() OR is_internal_company_user()(@gmtc.kr 사내 계정) 까지 허용해,
--   사내 계정이면 누구나 남의 프로젝트를 삭제할 수 있었다(UI도 effectiveIsAdmin으로 삭제 버튼 노출).
--   이를 "소유자 본인 또는 운영자(profiles.is_admin/부트스트랩)만 삭제"로 좁힌다.
--   콘텐츠 "편집"(projects_update / tasks_*)은 종전대로 유지 — 좁히는 것은 "삭제"뿐이다.
--
-- 선행 정리: is_admin_user() 복구.
--   20260527150000_temp_is_admin_user_all_authenticated.sql 가 is_admin_user() 를
--   "인증된 모든 사용자 = 관리자"로 바꿔둔 임시 정의가 마이그레이션 체인의 마지막 정의로 남아 있다.
--   그대로면 projects_delete = is_admin_user() OR owner 가 "사실상 전원 삭제 가능"이 되어 버린다.
--   해당 임시 파일이 명시한 복구 지침대로 20260521160000 의 정상 정의
--   (profiles.is_admin 또는 부트스트랩 슈퍼관리자)로 되돌린 뒤 정책을 건다.
--   운영 DB는 이미 정상 정의 상태이므로(=실제 삭제가 거부되고 있었음) 이 복구는 멱등·무영향이다.
--
-- silent-0-row 주의: RLS가 DELETE를 막으면 오류 없이 0행이 삭제된다.
--   클라이언트(deleteProjectFromDB)는 "읽혔는데 0행 삭제"를 권한 오류로 올려
--   서버 풀이 조용히 되살리지 않도록 처리한다.

-- ── is_admin_user() 정상 정의 복구 (임시 전원-관리자 정의 되돌림) ──────────────
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
    OR public.is_bootstrap_super_admin(
      coalesce(
        nullif(trim((SELECT p2.email::text FROM public.profiles p2 WHERE p2.id = auth.uid())), ''),
        nullif(trim((SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid())), '')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.profiles p WHERE p.id = p_user), false)
    OR public.is_bootstrap_super_admin(
      coalesce(
        nullif(trim((SELECT p2.email::text FROM public.profiles p2 WHERE p2.id = p_user)), ''),
        nullif(trim((SELECT u.email::text FROM auth.users u WHERE u.id = p_user)), '')
      )
    );
$$;

-- ── projects_delete: 운영자(is_admin_user) 또는 소유자만 ──────────────────────
DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects FOR DELETE
  USING (
    public.is_admin_user() OR
    owner_id = auth.uid()
  );
