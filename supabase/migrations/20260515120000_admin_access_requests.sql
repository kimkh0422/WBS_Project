-- 시스템 관리자(DB profiles.is_admin) 권한 요청: 일반 회원이 요청하고, 기존 시스템 관리자가 승인/거절.

CREATE TABLE IF NOT EXISTS public.admin_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_access_requests_user ON public.admin_access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_access_requests_status ON public.admin_access_requests(status);

-- 동시에 대기 중인 요청은 사용자당 1건
CREATE UNIQUE INDEX IF NOT EXISTS admin_access_requests_one_pending_per_user
  ON public.admin_access_requests (user_id)
  WHERE status = 'pending';

ALTER TABLE public.admin_access_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_access_requests_insert_non_admin" ON public.admin_access_requests;
CREATE POLICY "admin_access_requests_insert_non_admin" ON public.admin_access_requests FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.is_admin_user(auth.uid())
  );

DROP POLICY IF EXISTS "admin_access_requests_select" ON public.admin_access_requests;
CREATE POLICY "admin_access_requests_select" ON public.admin_access_requests FOR SELECT
  USING (
    user_id = auth.uid()
    OR (public.is_admin_user(auth.uid()) AND status = 'pending')
  );

COMMENT ON TABLE public.admin_access_requests IS
  '시스템 관리자(is_admin) 권한 요청. 승인 시 profiles.is_admin이 true로 설정됩니다.';

-- ─── 승인: 대상 회원 is_admin = true + 요청 행 approved ─────────────────────
CREATE OR REPLACE FUNCTION public.approve_admin_access_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_target uuid;
BEGIN
  v_admin := auth.uid();
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;

  IF NOT public.is_admin_user(v_admin) THEN
    RETURN jsonb_build_object('success', false, 'error', '시스템 관리자만 승인할 수 있습니다.');
  END IF;

  SELECT user_id INTO v_target
  FROM public.admin_access_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '대기 중인 요청을 찾을 수 없습니다.');
  END IF;

  IF v_target = v_admin THEN
    RETURN jsonb_build_object('success', false, 'error', '본인 요청은 승인할 수 없습니다.');
  END IF;

  UPDATE public.profiles SET is_admin = true WHERE id = v_target;

  UPDATE public.admin_access_requests
  SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_admin_access_request(uuid) TO authenticated;

-- ─── 거절 ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_admin_access_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
  v_updated int;
BEGIN
  v_admin := auth.uid();
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '로그인이 필요합니다.');
  END IF;

  IF NOT public.is_admin_user(v_admin) THEN
    RETURN jsonb_build_object('success', false, 'error', '시스템 관리자만 거절할 수 있습니다.');
  END IF;

  UPDATE public.admin_access_requests
  SET status = 'rejected', reviewed_at = now(), reviewed_by = v_admin
  WHERE id = p_request_id AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '대기 중인 요청을 찾을 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_admin_access_request(uuid) TO authenticated;
