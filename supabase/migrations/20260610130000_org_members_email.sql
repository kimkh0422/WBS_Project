-- org_members 에 email 컬럼 추가 — 협조 요청 알림 메일 수신자 매핑용.
--
-- 매핑 규칙(애플리케이션):
--   1) memberProgress 의 (name, department, position) 로 org_members 행을 찾는다
--   2) email 이 비어 있지 않으면 해당 멤버에게 메일 발송
--   3) email 이 비어 있으면 메일 스킵(알림 UI에는 그대로 표시)
--
-- 관리자가 OrganizationModal 에서 email 을 입력/수정한다. 비어 있어도 무방(NULL 허용).

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS email text;

-- 같은 부서/이름이 둘 이상 있을 때 정확한 매칭 보조용 인덱스(필수는 아님).
CREATE INDEX IF NOT EXISTS idx_org_members_email ON org_members(email) WHERE email IS NOT NULL;

COMMENT ON COLUMN org_members.email IS '협조 요청 등 자동 알림 메일 수신 주소. NULL 이면 메일 미발송.';
