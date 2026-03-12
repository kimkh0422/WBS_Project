-- 접근 가능한 프로젝트의 소유자(owner_id) 프로필을 조회할 수 있도록 정책 추가
-- 이렇게 해야 프로젝트 목록/헤더에서 소유자 이름을 표시할 때 "(알 수 없음)" 대신 이름이 보임

DROP POLICY IF EXISTS "profiles_select_project_owners" ON profiles;
CREATE POLICY "profiles_select_project_owners" ON profiles FOR SELECT
  USING (
    id IN (
      SELECT owner_id FROM projects
      WHERE id = ANY(public.get_user_project_ids()) AND owner_id IS NOT NULL
    )
  );
