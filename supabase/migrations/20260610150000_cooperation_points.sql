-- 협조 요청 포인트: 업무 협조 요청이 최종 '확인완료' 되면 담당자에게 포인트를 자동 지급한다.
--
-- 지급 규칙(요청 1건 단위로 '받아야 할 사람' 집합을 재계산해 ledger 와 동기화 = reconcile):
--   1) member_progress 항목 중 본인 상태가 '확인완료'인 멤버 → 지급
--      (요청자가 멤버 단위로 처리 내용을 최종 확인한 경우 — 그 멤버는 즉시 수령)
--   2) 요청 전체 status='확인완료' 면 → 취소되지 않은 모든 담당 멤버에게 지급
--   3) member_progress 가 비어 있는(레거시/단순) 행은 요청 '확인완료' 시 assignee 텍스트 1건으로 지급
--   포인트 양은 중요도 기준: 상 30 / 중 20 / 하 10.
--   지급 시점 값으로 고정 — 지급 후 중요도를 바꿔도 이미 지급된 포인트는 소급 변경하지 않는다.
--
-- 회수 규칙:
--   - 확인완료가 풀리거나(상태 되돌림) 멤버가 담당에서 빠지면 해당 ledger 행 삭제
--   - 협조 요청 자체가 삭제되면 CASCADE 로 함께 삭제 → 합계가 항상 현재 데이터와 일치
--
-- 클라이언트는 cooperation_points 를 SELECT 만 가능(지급/회수는 SECURITY DEFINER 트리거 함수만 수행).
-- 클라이언트 짝 코드: src/lib/db/cooperationPoints.ts (COOPERATION_POINTS_BY_PRIORITY · deriveCooperationPointEntries)

CREATE TABLE IF NOT EXISTS cooperation_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES cooperation_requests(id) ON DELETE CASCADE,
  -- 수령자 식별: member_progress 와 동일한 (이름, 부서, 직위) 스냅샷.
  -- org_members FK 대신 텍스트 — 조직 개편/명단 변경에도 지급 이력이 깨지지 않는다.
  member_name text NOT NULL,
  member_department text NOT NULL DEFAULT '',
  member_position text NOT NULL DEFAULT '',
  points integer NOT NULL,
  -- 지급 근거 스냅샷(지급 당시 중요도·관리ID·제목) — 이후 요청이 수정돼도 이력은 그대로.
  priority text NOT NULL DEFAULT '중',
  request_mgmt_id text NOT NULL DEFAULT '',
  request_title text NOT NULL DEFAULT '',
  awarded_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 요청에서 같은 사람에게 중복 지급 금지(트리거 재실행에도 안전).
  UNIQUE (request_id, member_name, member_department, member_position)
);

CREATE INDEX IF NOT EXISTS idx_cooperation_points_member ON cooperation_points(member_name, member_department, member_position);
CREATE INDEX IF NOT EXISTS idx_cooperation_points_awarded_at ON cooperation_points(awarded_at DESC);

-- RLS: 조회는 인증 사용자 전체(포인트 현황 공유), 쓰기 정책 없음 → 클라이언트 직접 지급/회수 불가(기본 거부).
ALTER TABLE cooperation_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cooperation_points_select_authenticated" ON cooperation_points;
CREATE POLICY "cooperation_points_select_authenticated" ON cooperation_points FOR SELECT
  TO authenticated
  USING (true);

-- 중요도 → 포인트. 클라이언트 상수 COOPERATION_POINTS_BY_PRIORITY 와 반드시 같은 값 유지.
CREATE OR REPLACE FUNCTION cooperation_point_value(p text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p WHEN '상' THEN 30 WHEN '하' THEN 10 ELSE 20 END;
$$;

-- 요청 1건의 ledger 동기화: 받아야 할 집합을 계산해 빠진 건 지급, 자격을 잃은 건 회수.
-- SECURITY DEFINER — cooperation_points 에는 클라이언트 쓰기 정책이 없으므로 트리거 경유로만 쓰기 가능.
CREATE OR REPLACE FUNCTION reconcile_cooperation_points(req cooperation_requests)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH members AS (
    SELECT
      coalesce(m->>'name', '')       AS name,
      coalesce(m->>'department', '') AS department,
      coalesce(m->>'position', '')   AS position,
      coalesce(m->>'status', '')     AS status
    FROM jsonb_array_elements(coalesce(req.member_progress, '[]'::jsonb)) AS m
    WHERE coalesce(m->>'name', '') <> ''
  ),
  deserving AS (
    SELECT name, department, position FROM members
    WHERE status = '확인완료'
       OR (req.status = '확인완료' AND status <> '취소됨')
    UNION
    SELECT trim(req.assignee) AS name, '' AS department, '' AS position
    WHERE req.status = '확인완료'
      AND trim(coalesce(req.assignee, '')) <> ''
      AND NOT EXISTS (SELECT 1 FROM members)
  ),
  revoked AS (
    DELETE FROM cooperation_points cp
    WHERE cp.request_id = req.id
      AND NOT EXISTS (
        SELECT 1 FROM deserving d
        WHERE d.name = cp.member_name AND d.department = cp.member_department AND d.position = cp.member_position
      )
    RETURNING 1
  )
  INSERT INTO cooperation_points
    (request_id, member_name, member_department, member_position, points, priority, request_mgmt_id, request_title, awarded_at)
  SELECT
    req.id, d.name, d.department, d.position,
    cooperation_point_value(req.priority),
    coalesce(req.priority, '중'),
    coalesce(req.mgmt_id, ''),
    coalesce(req.title, ''),
    -- 백필·엑셀 가져오기 등 과거 완료 건은 완료일을 지급일로, 실시간 지급은 now().
    CASE WHEN req.completed_date IS NOT NULL AND req.completed_date < current_date
         THEN req.completed_date::timestamptz
         ELSE now() END
  FROM deserving d
  ON CONFLICT (request_id, member_name, member_department, member_position) DO NOTHING;
END;
$$;

-- 직접 RPC 호출로 임의 행을 넘겨 포인트를 조작하는 경로 차단(트리거 경유만 허용).
REVOKE EXECUTE ON FUNCTION reconcile_cooperation_points(cooperation_requests) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION trg_sync_cooperation_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM reconcile_cooperation_points(NEW);
  RETURN NEW;
END;
$$;

-- sort_order 드래그 정렬 등 무관한 UPDATE 에는 실행되지 않도록 컬럼을 한정.
DROP TRIGGER IF EXISTS cooperation_points_sync ON cooperation_requests;
CREATE TRIGGER cooperation_points_sync
  AFTER INSERT OR UPDATE OF status, member_progress, assignee, priority ON cooperation_requests
  FOR EACH ROW
  EXECUTE PROCEDURE trg_sync_cooperation_points();

-- 기존 데이터 백필: 이미 '확인완료'인 요청·멤버에게 1회 지급(완료일 기준 지급일).
DO $$
DECLARE
  r cooperation_requests%ROWTYPE;
BEGIN
  FOR r IN SELECT * FROM cooperation_requests LOOP
    PERFORM reconcile_cooperation_points(r);
  END LOOP;
END;
$$;

COMMENT ON TABLE cooperation_points IS '업무 협조 요청 확인완료 포인트 지급 이력(트리거 자동 지급·회수, 클라이언트는 조회 전용)';
