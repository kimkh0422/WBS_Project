-- 일별 접속(세션) 건수: visits 테이블 기준, 날짜 구간 전부 0 채움
CREATE OR REPLACE FUNCTION public.get_daily_visit_counts(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_days := LEAST(GREATEST(COALESCE(NULLIF(p_days, 0), 30), 1), 366);

  RETURN COALESCE(
    (
      WITH n AS (
        SELECT v_days AS days
      ),
      series AS (
        SELECT (CURRENT_DATE - (n.days - 1) + gs.i)::date AS visit_date
        FROM n
        CROSS JOIN LATERAL generate_series(0, n.days - 1) AS gs(i)
      ),
      counts AS (
        SELECT v.visit_date, COUNT(*)::bigint AS cnt
        FROM visits v
        WHERE v.visit_date >= (SELECT CURRENT_DATE - (days - 1) FROM n)
        GROUP BY v.visit_date
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'visit_date', to_char(s.visit_date, 'YYYY-MM-DD'),
          'count', COALESCE(c.cnt, 0)
        )
        ORDER BY s.visit_date
      )
      FROM series s
      LEFT JOIN counts c ON c.visit_date = s.visit_date
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_visit_counts(integer) TO authenticated;
