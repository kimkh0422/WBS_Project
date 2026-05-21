-- 시스템 관리자(profiles.is_admin)가 "현재 접속 중" 사용자를 볼 수 있도록
-- user_presence: 로그인 사용자가 주기적으로 pulse RPC로 갱신하는 마지막 활동 시각

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid
);

COMMENT ON TABLE public.user_presence IS
  '로그인 사용자 마지막 활동 시각. pulse_presence로 갱신되며 get_online_presence_users는 관리자만 조회.';

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON public.user_presence (last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- 직접 테이블 접근 차단(RPC만 사용)
REVOKE ALL ON TABLE public.user_presence FROM PUBLIC;

-- 본인 활동 갱신(인증 사용자)
CREATE OR REPLACE FUNCTION public.pulse_presence(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen_at, session_id)
  VALUES (auth.uid(), now(), p_session_id)
  ON CONFLICT (user_id) DO UPDATE
  SET
    last_seen_at = now(),
    session_id = EXCLUDED.session_id;
END;
$$;

COMMENT ON FUNCTION public.pulse_presence(uuid) IS
  '현재 로그인 사용자의 마지막 활동 시각을 갱신합니다. 앱에서 주기적으로 호출하세요.';

-- 관리자만: 최근 p_within_seconds 초 이내 활동한 사용자 목록
CREATE OR REPLACE FUNCTION public.get_online_presence_users(p_within_seconds integer DEFAULT 180)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', sub.user_id::text,
          'display_name', sub.display_name,
          'last_seen_at', sub.last_seen_at::text
        )
        ORDER BY sub.last_seen_at DESC
      ),
      '[]'::jsonb
    )
  INTO result
  FROM (
    SELECT
      p.id AS user_id,
      COALESCE(NULLIF(trim(p.full_name), ''), '(이름 미등록)') AS display_name,
      up.last_seen_at
    FROM public.user_presence up
    INNER JOIN public.profiles p ON p.id = up.user_id
    WHERE up.last_seen_at > (now() - make_interval(secs => greatest(30, least(coalesce(p_within_seconds, 180), 86400))))
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_online_presence_users(integer) IS
  '시스템 관리자 전용. 최근 활동 기준 온라인 사용자 목록(JSON 배열).';

GRANT EXECUTE ON FUNCTION public.pulse_presence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_online_presence_users(integer) TO authenticated;
