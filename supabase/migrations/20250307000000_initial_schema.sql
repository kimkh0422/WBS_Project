-- WBS 매니저 초기 스키마 (새 Supabase 프로젝트용)
-- projects, tasks, wbs_settings 기본 테이블 생성

-- projects
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  start_date date,
  assignments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- tasks
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  progress integer DEFAULT 0,
  assignee text DEFAULT '',
  status text DEFAULT 'todo',
  expanded boolean DEFAULT false,
  dependencies text[] DEFAULT '{}',
  work_effort integer,
  description text,
  checklist jsonb DEFAULT '[]'::jsonb,
  deliverables text,
  user_locked_fields text[] DEFAULT '{}'::text[],
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

-- wbs_settings (앱 설정)
CREATE TABLE IF NOT EXISTS wbs_settings (
  id text PRIMARY KEY DEFAULT 'default',
  level1_prefix text DEFAULT 'W',
  level2_prefix text DEFAULT 'W',
  level3_prefix text DEFAULT 'T',
  max_level integer DEFAULT 3
);

INSERT INTO wbs_settings (id, level1_prefix, level2_prefix, level3_prefix, max_level)
VALUES ('default', 'W', 'W', 'T', 3)
ON CONFLICT (id) DO NOTHING;
