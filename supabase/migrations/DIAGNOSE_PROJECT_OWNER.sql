-- 비관리자가 만든 프로젝트가 owner_id NULL로 저장돼 RLS가 거부하던 이슈 진단·복구.
-- Supabase SQL Editor에서 단계별로 실행한다(자동 마이그레이션 X).

-- ─── 1) 진단: owner_id 누락된 프로젝트 확인 ──────────────────────────────────
select id, name, owner_id, created_at
from public.projects
where owner_id is null
order by created_at desc;

-- ─── 2) 복구: 특정 사용자에게 그 프로젝트들의 소유권 부여 ──────────────────
-- 위 1)의 결과 중 본인이 만든 것을 식별한 뒤, 아래 SQL을 사용자 이메일에 맞춰 실행.
-- 단, 다른 사람의 프로젝트까지 잘못 점유하지 않도록 id를 직접 지정하는 방식을 권장.
--
-- 예: 특정 프로젝트 id 목록을 본인 소유로 업데이트
-- update public.projects
-- set owner_id = (select id from auth.users where email = '본인@gmtc.kr')
-- where id in ('<project-uuid-1>', '<project-uuid-2>')
--   and owner_id is null;
