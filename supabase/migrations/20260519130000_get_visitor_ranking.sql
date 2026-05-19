-- 누적 접속 순위 (사용자별 방문 횟수, 내림차순) — 대시보드 누적 접속자 카드 클릭 시 표시

CREATE OR REPLACE FUNCTION public.get_visitor_ranking()
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
          'visit_count', sub.visit_count,
          'last_visited_at', sub.last_visited_at::text
        )
        ORDER BY sub.visit_count DESC, sub.last_visited_at DESC NULLS LAST
      ),
      '[]'::jsonb
    )
  INTO result
  FROM (
    SELECT
      v.user_id,
      COALESCE(NULLIF(trim(MAX(p.full_name)), ''), '(이름 미등록)') AS display_name,
      COUNT(*)::bigint AS visit_count,
      MAX(v.visited_at) AS last_visited_at
    FROM visits v
    LEFT JOIN profiles p ON p.id = v.user_id
    WHERE v.user_id IS NOT NULL
    GROUP BY v.user_id
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_visitor_ranking() TO authenticated;
