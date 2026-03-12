-- 접근 가능한 프로젝트 소유자의 표시명만 반환하는 RPC (프로필 정책 미적용 시에도 소유자 이름 표시용)
-- get_user_project_ids() 기준으로 허용된 소유자만 반환

CREATE OR REPLACE FUNCTION public.get_project_owner_display_names(owner_ids uuid[])
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id AS user_id,
         COALESCE(NULLIF(trim(p.full_name), ''), p.email, '(이메일 없음)') AS display_name
  FROM profiles p
  WHERE p.id = ANY(owner_ids)
    AND p.id IN (
      SELECT owner_id FROM projects
      WHERE id = ANY(public.get_user_project_ids()) AND owner_id IS NOT NULL
    );
$$;
