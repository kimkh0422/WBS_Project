-- 협조 요청: 담당 다중 선택 지원 (조직 여러 개 + 인원 여러 명 동시).
--
-- 변경 사항:
--   1) assignee_org_ids text[] 컬럼 추가 — 선택된 조직(org_nodes.id) 0..N개.
--      기존 단일 컬럼 assignee_org_id 는 호환을 위해 유지(첫 번째 값 미러).
--   2) assignee_kind CHECK 에 'mixed' 추가 — 조직 + 인원 혼합 선택 표기용.
--   3) 기존 단일 assignee_org_id 가 있는 행은 자동으로 assignee_org_ids 배열에 옮겨 둠.
--
-- 인원 다중 선택은 별도 컬럼이 아닌 member_progress(JSONB) 항목으로 표현된다:
--   { name, department, position, status, completedAt,
--     sourceOrgIds: [<orgId>...],   -- 어떤 조직(들)에 의해 자동 포함되었는지
--     direct: bool                  -- 인원 선택 picker로 직접 추가했는지
--   }
--   기존 항목에 위 두 필드가 없어도 호환되도록 애플리케이션에서 normalize.

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS assignee_org_ids text[] NOT NULL DEFAULT '{}';

-- CHECK: 'mixed' 추가
ALTER TABLE cooperation_requests
  DROP CONSTRAINT IF EXISTS cooperation_requests_assignee_kind_check;
ALTER TABLE cooperation_requests
  ADD CONSTRAINT cooperation_requests_assignee_kind_check
  CHECK (assignee_kind IN ('person', 'org', 'mixed'));

-- 기존 단일 org_id → 배열로 이행 (배열이 비어 있는 행만)
UPDATE cooperation_requests
SET assignee_org_ids = ARRAY[assignee_org_id]
WHERE assignee_org_id IS NOT NULL
  AND length(trim(assignee_org_id)) > 0
  AND (assignee_org_ids IS NULL OR cardinality(assignee_org_ids) = 0);

CREATE INDEX IF NOT EXISTS idx_cooperation_requests_assignee_org_ids
  ON cooperation_requests USING gin (assignee_org_ids);
