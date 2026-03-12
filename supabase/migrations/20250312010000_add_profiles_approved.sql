-- profiles에 승인(approved) 컬럼 추가
-- 회원가입 시 로컬 전용 사용, 관리자 승인 후 DB 동기화 가능

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved boolean DEFAULT false;

-- 기존 회원은 모두 승인된 것으로 처리
UPDATE profiles SET approved = true WHERE approved IS NULL;

-- handle_new_user: 신규 가입 시 approved = false (첫 번째 가입자만 관리자+승인)
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
    v_first  -- 첫 번째 가입자는 승인됨, 그 외는 미승인
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ensure_profile: 프로필 생성 시 approved 반환 (신규는 false, 첫 사용자는 true)
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

  INSERT INTO profiles (id, email, full_name, is_admin, approved)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM profiles) = 0,
    (SELECT count(*) FROM profiles) = 0  -- 첫 사용자만 승인
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
