-- 주간보고 등록: 사용자가 작성한 주간업무보고를 서버에 저장(팀 전체 공유).
-- content(jsonb): { projects:[{name,period,owner,planPct,actualPct,content,issue,note}],
--                   issues:[{title,content,plan,result,note}], nextWeek:[string], etc:string }

CREATE TABLE IF NOT EXISTS weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization text NOT NULL DEFAULT '',
  reporter text NOT NULL DEFAULT '',
  week_start date,
  week_end date,
  title text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_author ON weekly_reports(author_id);

-- RLS: 인증 사용자는 모두 조회(팀 공유), 작성·수정·삭제는 본인 보고만.
ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_reports_select_authenticated" ON weekly_reports;
CREATE POLICY "weekly_reports_select_authenticated" ON weekly_reports FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "weekly_reports_insert_own" ON weekly_reports;
CREATE POLICY "weekly_reports_insert_own" ON weekly_reports FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "weekly_reports_update_own" ON weekly_reports;
CREATE POLICY "weekly_reports_update_own" ON weekly_reports FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "weekly_reports_delete_own" ON weekly_reports;
CREATE POLICY "weekly_reports_delete_own" ON weekly_reports FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- updated_at 자동 갱신 (기존 set_updated_at() 트리거 함수 재사용)
DROP TRIGGER IF EXISTS weekly_reports_updated_at ON weekly_reports;
CREATE TRIGGER weekly_reports_updated_at
  BEFORE UPDATE ON weekly_reports
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();
