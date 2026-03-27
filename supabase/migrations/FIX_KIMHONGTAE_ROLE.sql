-- 김홍태 계정의 AI 팩토리 프로젝트 role이 NULL로 되어 있어 권한이 없는 문제 수정
-- role을 editor로 업데이트

UPDATE project_members
SET role = 'editor'
WHERE user_id = (SELECT id FROM auth.users WHERE email = '김홍태_이메일_주소_입력')
  AND project_id = (SELECT id FROM projects WHERE name = 'AI 팩토리')
  AND role IS NULL;

-- 적용 확인
SELECT pm.user_id, u.email, p.name AS project_name, pm.role
FROM project_members pm
JOIN auth.users u ON u.id = pm.user_id
JOIN projects p ON p.id = pm.project_id
WHERE u.email = '김홍태_이메일_주소_입력';
