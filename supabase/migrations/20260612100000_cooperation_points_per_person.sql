-- 협조 포인트: 항상 '사람'에게만 지급(조직 이름 미지급) + 인원별 보강.
--
-- 두 가지를 한 번에 교정한다(reconcile_cooperation_points 교체 + 전체 재정산):
--   1) 조직(부서) 담당 요청은 조직 이름에 지급하지 않는다.
--      조직 지정은 알림 라우팅용 — 팀장/사업부장이 담당자를 member_progress 로 지정하면
--      그 담당자(개인)에게만 지급한다. 담당자 지정 전에는 지급 대상이 없다.
--      → 기존에 조직 이름("영업대표 - 공공사업" 등)으로 지급된 ledger 행은 재정산 시 자동 회수된다.
--   2) 순수 레거시(조직 지정도 없고 member_progress 도 빈) 행의 assignee 텍스트에 여러 명이 있으면
--      ("김길용, 홍길동") 한 덩어리가 아니라 개인 이름으로 분해해(쉼표·세미콜론·슬래시·가운뎃점 구분,
--      '외 N명' 꼬리표 제거) 각 사람에게 따로 지급한다.
--
-- 클라이언트 짝 코드: src/lib/db/cooperationPoints.ts (splitAssigneeNames · deriveCooperationPointEntries)
--   — 분해 규칙·조직 게이팅을 바꾸면 양쪽을 같이 바꾼다.

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
  -- 레거시 assignee 텍스트 → 개인 이름 분해(클라이언트 splitAssigneeNames 와 동일 규칙).
  -- 단, 조직이 지정된 요청(assignee_org_ids 비어 있지 않음)에서는 사용하지 않는다 — 아래 deserving 의 WHERE 참고.
  legacy_names AS (
    SELECT DISTINCT trim(regexp_replace(t, '\s*외\s*[0-9]+\s*명$', '')) AS name
    FROM regexp_split_to_table(coalesce(req.assignee, ''), '[,;/·]') AS t
  ),
  deserving AS (
    SELECT name, department, position FROM members
    WHERE status = '확인완료'
       OR (req.status = '확인완료' AND status <> '취소됨')
    UNION
    -- 순수 레거시 행만: 조직 지정이 없고(assignee_org_ids 비어 있음) member_progress 도 비어 있을 때.
    SELECT ln.name, '' AS department, '' AS position
    FROM legacy_names ln
    WHERE req.status = '확인완료'
      AND ln.name <> ''
      AND coalesce(array_length(req.assignee_org_ids, 1), 0) = 0
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
    CASE WHEN req.completed_date IS NOT NULL AND req.completed_date < current_date
         THEN req.completed_date::timestamptz
         ELSE now() END
  FROM deserving d
  ON CONFLICT (request_id, member_name, member_department, member_position) DO NOTHING;
END;
$$;

-- CREATE OR REPLACE 는 기존 권한을 유지하지만, 신규 환경 대비 차단을 다시 명시.
REVOKE EXECUTE ON FUNCTION reconcile_cooperation_points(cooperation_requests) FROM PUBLIC, anon, authenticated;

-- 기존 데이터 재정산: 조직 이름으로 잘못 지급된 건 회수하고, 레거시 다중 이름은 개인별 지급으로 교정.
DO $$
DECLARE
  r cooperation_requests%ROWTYPE;
BEGIN
  FOR r IN SELECT * FROM cooperation_requests LOOP
    PERFORM reconcile_cooperation_points(r);
  END LOOP;
END;
$$;
