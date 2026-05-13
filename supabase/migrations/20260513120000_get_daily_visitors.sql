-- 금일(서버 기준 CURRENT_DATE) 접속한 사용자 목록 — 대시보드 카드 클릭 시 표시
-- 사용자당 최신 방문 시각 한 행 (DISTINCT ON user_id)

CREATE OR REPLACE FUNCTION get_daily_visitors()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'user_id', sub.user_id::text,
          'display_name', sub.display_name,
          'visited_at', sub.visited_at::text
        )
        ORDER BY sub.visited_at DESC
      ),
      '[]'::jsonb
    )
  INTO result
  FROM (
    SELECT DISTINCT ON (v.user_id)
      v.user_id,
      COALESCE(NULLIF(trim(p.full_name), ''), '(이름 미등록)') AS display_name,
      v.visited_at
    FROM visits v
    LEFT JOIN profiles p ON p.id = v.user_id
    WHERE v.visit_date = CURRENT_DATE
      AND v.user_id IS NOT NULL
    ORDER BY v.user_id, v.visited_at DESC
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_visitors() TO authenticated;
