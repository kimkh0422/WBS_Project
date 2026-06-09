-- 업무 협조 요청 관리 대장: 팀 공유 문서(외주·발주처·사내 간 업무 협조 요청/회신 이력).
-- 인증된 사용자 모두 조회 + 등록/수정/삭제 가능(협업 문서). 작성자 추적용 created_by만 별도 저장.
--
-- 컬럼은 엑셀 양식(자료 검토 및 회신 관리대장 V1.08)의 항목을 그대로 반영하되,
-- 표현은 '업무 협조 요청'으로 정리. 요청구분의 한 종류로 '자료/검토/협의/기타'가 들어간다.
--   관리ID(REQ-###), 요청일, 요청구분(자료/검토/협의/기타), 제목, 상세내용,
--   요청자, 담당자, 중요도(상/중/하), 기한(완료예정일), 진척(%, 0~1),
--   현황(요청완료/진행중/지연/완료/회신불가), 결과·회신, 완료일, 지연사유, 비고

CREATE TABLE IF NOT EXISTS cooperation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 관리ID(REQ-### 등): 사람이 읽는 표시 ID. 화면에서 정렬/필터 기준으로 쓰이며 비어 있을 수 있다(자동 채번).
  mgmt_id text NOT NULL DEFAULT '',
  -- 선택적 프로젝트 연결. 프로젝트 무관한 일반 업무 협조 요청도 허용 → nullable.
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  request_date date,
  request_type text NOT NULL DEFAULT '자료',
  title text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  requester text NOT NULL DEFAULT '',
  assignee text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT '중',
  due_date date,
  -- 진척률: 0~1 (엑셀이 0.8/1로 저장되어 있어 비율로 통일). UI는 %로 표시/입력.
  progress numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT '요청완료',
  result text NOT NULL DEFAULT '',
  completed_date date,
  delay_reason text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  -- 표 안에서의 사용자 정의 정렬 순서(드래그 정렬 등). 작을수록 위.
  sort_order double precision NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cooperation_requests_project ON cooperation_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_cooperation_requests_request_date ON cooperation_requests(request_date DESC);
CREATE INDEX IF NOT EXISTS idx_cooperation_requests_mgmt_id ON cooperation_requests(mgmt_id);

-- RLS: 협업 문서 — 인증된 사용자 누구나 조회/등록/수정/삭제 가능(팀 단위 운영).
-- (필요 시 후속 마이그레이션에서 프로젝트 멤버십·소유자 기반으로 더 좁힐 수 있음.)
ALTER TABLE cooperation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cooperation_requests_select_authenticated" ON cooperation_requests;
CREATE POLICY "cooperation_requests_select_authenticated" ON cooperation_requests FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "cooperation_requests_insert_authenticated" ON cooperation_requests;
CREATE POLICY "cooperation_requests_insert_authenticated" ON cooperation_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "cooperation_requests_update_authenticated" ON cooperation_requests;
CREATE POLICY "cooperation_requests_update_authenticated" ON cooperation_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "cooperation_requests_delete_authenticated" ON cooperation_requests;
CREATE POLICY "cooperation_requests_delete_authenticated" ON cooperation_requests FOR DELETE
  TO authenticated
  USING (true);

DROP TRIGGER IF EXISTS cooperation_requests_updated_at ON cooperation_requests;
CREATE TRIGGER cooperation_requests_updated_at
  BEFORE UPDATE ON cooperation_requests
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();
