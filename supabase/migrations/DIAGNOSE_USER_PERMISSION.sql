-- ================================================================
-- 김홍태 계정 권한 진단 쿼리
-- 아래 쿼리를 순서대로 실행하고 결과를 확인하세요.
-- ================================================================

-- 1. 김홍태의 user ID 확인 (이메일 주소로 수정 후 실행)
SELECT id, email
FROM auth.users
WHERE email = '김홍태_이메일_주소_입력';

-- ================================================================

-- 2. 해당 user ID로 소유 프로젝트 확인 (1번 결과의 id로 교체)
SELECT id, name, owner_id
FROM projects
WHERE owner_id = '1번에서_나온_user_id';

-- ================================================================

-- 3. project_members 등록 여부 확인 (1번 결과의 id로 교체)
SELECT project_id, role
FROM project_members
WHERE user_id = '1번에서_나온_user_id';

-- ================================================================

-- 4. 편집 가능 프로젝트 목록 확인 (소유 + editor 멤버 합산)
SELECT p.id, p.name, p.owner_id, pm.role
FROM projects p
LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = '1번에서_나온_user_id'
WHERE p.owner_id = '1번에서_나온_user_id'
   OR (pm.user_id = '1번에서_나온_user_id' AND pm.role IN ('owner', 'editor'));
