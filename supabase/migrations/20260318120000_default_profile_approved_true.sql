-- 로컬/소규모 사용: 신규 가입자도 곧바로 DB 동기화·목록 정책과 맞추기 위해 기본 승인
-- (클라이언트는 승인 여부와 무관 저장하나, RLS의 is_approved_user()는 DB 값을 따름)

ALTER TABLE public.profiles ALTER COLUMN approved SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first boolean;
BEGIN
  SELECT (count(*) = 0) INTO v_first FROM public.profiles;
  INSERT INTO public.profiles (id, email, full_name, is_admin, approved)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    v_first,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
  v_approved boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false, 'approved', false);
  END IF;

  INSERT INTO public.profiles (id, email, full_name, is_admin, approved)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM profiles) = 0,
    true
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  SELECT is_admin, coalesce(approved, false) INTO v_is_admin, v_approved
  FROM profiles WHERE id = v_user_id;
  RETURN jsonb_build_object(
    'is_admin', coalesce(v_is_admin, false),
    'approved', coalesce(v_approved, false)
  );
END;
$$;

-- 기존 미승인 계정도 서버 기준 목록·동기화와 맞춤 (원치 않으면 이 줄만 제거)
UPDATE public.profiles SET approved = true WHERE coalesce(approved, false) = false;
