-- profiles에 회원명(full_name) 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name text;

-- 기존 데이터: auth.users의 raw_user_meta_data에서 full_name 백필
UPDATE profiles p
SET full_name = COALESCE(
  NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
  NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
)
FROM auth.users u
WHERE p.id = u.id
  AND (p.full_name IS NULL OR p.full_name = '');

-- handle_new_user: 가입 시 full_name 동기화
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_admin)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      NULLIF(trim((new.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((new.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM public.profiles) = 0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ensure_profile: full_name 포함하여 프로필 생성
CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_admin boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('is_admin', false);
  END IF;

  INSERT INTO profiles (id, email, full_name, is_admin)
  SELECT
    v_user_id,
    u.email,
    COALESCE(
      NULLIF(trim((u.raw_user_meta_data->>'full_name')::text), ''),
      NULLIF(trim((u.raw_user_meta_data->>'name')::text), '')
    ),
    (SELECT count(*) FROM profiles) = 0
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (id) DO NOTHING;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_user_id;
  RETURN jsonb_build_object('is_admin', coalesce(v_is_admin, false));
END;
$$;
