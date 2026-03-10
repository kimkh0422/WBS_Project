-- 접속자 통계: DB 기반 방문 기록
-- session_id: 브라우저 세션당 고유 ID (sessionStorage)
-- 하루에 같은 세션이 여러 번 방문해도 1건만 기록

CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  visited_at timestamptz DEFAULT now(),
  visit_date date NOT NULL DEFAULT (now()::date)
);

CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_session_date_unique ON visits (session_id, visit_date);

-- RLS
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- 인증 사용자만 자신의 방문 기록 INSERT
DROP POLICY IF EXISTS "visits_insert_authenticated" ON visits;
CREATE POLICY "visits_insert_authenticated" ON visits FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 통계 조회는 RPC로만 (RLS로 개별 행 SELECT 불필요)

-- 방문 기록: 세션당 하루 1회만 기록
CREATE OR REPLACE FUNCTION record_visit(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO visits (session_id, user_id, visited_at, visit_date)
  VALUES (p_session_id, auth.uid(), now(), current_date)
  ON CONFLICT (session_id, visit_date) DO NOTHING;
END;
$$;

-- 접속자 통계 조회: 금일/누적 (인증 사용자만 호출 가능)
CREATE OR REPLACE FUNCTION get_visitor_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daily bigint;
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('daily', 0, 'total', 0);
  END IF;

  SELECT COUNT(*) INTO v_daily
  FROM visits
  WHERE visit_date = CURRENT_DATE;

  SELECT COUNT(DISTINCT session_id) INTO v_total
  FROM visits;

  RETURN jsonb_build_object('daily', v_daily, 'total', v_total);
END;
$$;
