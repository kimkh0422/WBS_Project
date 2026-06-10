-- 업무 협조 요청: 담당(assignee) 타겟을 '인원' 또는 '조직(org_node)'으로 확장.
-- 조직 대상일 때는 member_progress(JSONB)에 멤버별 상태(완료 여부 등)를 저장해 추적한다.
--
-- member_progress 예시:
--   [
--     { "name": "홍길동", "department": "운영기술개발실", "position": "책임",
--       "status": "완료", "completedAt": "2026-06-10" },
--     { "name": "이몽룡", "department": "운영기술개발실", "position": "선임",
--       "status": "진행중" }
--   ]
-- - 인원 대상일 때(assignee_kind='person')는 member_progress = '[]' (사용하지 않음).
-- - 조직 대상일 때는 표(자료대장 행)에 표시되는 진척률은 멤버별 완료 비율(완료/전체).

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS assignee_kind text NOT NULL DEFAULT 'person',
  -- 조직(org_nodes) ID. org_nodes.id는 text PK라 FK는 걸지 않고 텍스트 참조만 유지(시드 재생성 시 안정성).
  ADD COLUMN IF NOT EXISTS assignee_org_id text,
  ADD COLUMN IF NOT EXISTS member_progress jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 유효 값 가드: 인원|조직 (확장 여지 위해 CHECK는 텍스트로만 제한).
ALTER TABLE cooperation_requests
  DROP CONSTRAINT IF EXISTS cooperation_requests_assignee_kind_check;
ALTER TABLE cooperation_requests
  ADD CONSTRAINT cooperation_requests_assignee_kind_check
  CHECK (assignee_kind IN ('person', 'org'));

CREATE INDEX IF NOT EXISTS idx_cooperation_requests_assignee_org ON cooperation_requests(assignee_org_id);
