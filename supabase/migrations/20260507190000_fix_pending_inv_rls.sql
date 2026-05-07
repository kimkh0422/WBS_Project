-- 프로젝트 사전 초대 RLS 정책 보완
-- ============================================================================
-- 증상: 사전 등록(INSERT)는 성공하는데 SELECT가 빈 배열 반환 → 가입 대기 카드 미표시.
-- 원인: 기존 SELECT 정책의 본인 매칭 분기가 (SELECT email FROM auth.users)를 참조했는데,
--       authenticated 권한으로는 auth.users 직접 SELECT가 막혀 정책 평가가 부분 실패.
--       프로젝트 소유자/관리자 분기는 통과해야 하지만, 일부 환경에서 OR 평가가
--       단축 평가되지 않아 전체 정책이 거짓이 되는 케이스 있음.
-- 수정:
--  1) auth.users 참조 대신 auth.jwt() ->> 'email' 사용 (JWT 클레임에서 직접 추출)
--  2) 보조 함수 is_admin_user(), is_project_owner()를 SECURITY DEFINER로 분리해
--     RLS 평가 안정화.
-- ============================================================================

-- ─── 1. 보조 함수 (관리자 / 소유자 판정) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin_user(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(is_admin, false)
  FROM public.profiles
  WHERE id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(p_user uuid, p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project AND owner_id = p_user
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_owner(uuid, uuid) TO authenticated;

-- ─── 2. 정책 재정의 ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pending_inv_select ON public.pending_project_invitations;
DROP POLICY IF EXISTS pending_inv_insert ON public.pending_project_invitations;
DROP POLICY IF EXISTS pending_inv_delete ON public.pending_project_invitations;

CREATE POLICY pending_inv_select ON public.pending_project_invitations
  FOR SELECT
  USING (
    public.is_admin_user(auth.uid())
    OR public.is_project_owner(auth.uid(), project_id)
    OR (
      email IS NOT NULL
      AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    OR (
      full_name IS NOT NULL
      AND full_name = coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '')
    )
  );

CREATE POLICY pending_inv_insert ON public.pending_project_invitations
  FOR INSERT
  WITH CHECK (
    public.is_admin_user(auth.uid())
    OR public.is_project_owner(auth.uid(), project_id)
  );

CREATE POLICY pending_inv_delete ON public.pending_project_invitations
  FOR DELETE
  USING (
    public.is_admin_user(auth.uid())
    OR public.is_project_owner(auth.uid(), project_id)
  );
