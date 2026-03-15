-- 승인된 회원(approved=true)을 모든 인증 사용자(authenticated)가 조회할 수 있도록 허용
-- 프로젝트 공유 시 담당자도 전체 회원 목록에서 멤버를 선택할 수 있게 하기 위함

DROP POLICY IF EXISTS "profiles_select_all_approved_for_share" ON profiles;
CREATE POLICY "profiles_select_all_approved_for_share" ON profiles
  FOR SELECT
  TO authenticated
  USING (approved = true);

