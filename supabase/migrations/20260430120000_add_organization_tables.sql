-- 조직 현황 (부서 트리 + 인원) — 정적 JSON에서 DB로 이관
-- - org_nodes: 부서/조직 트리 노드 (자기참조 트리)
-- - org_members: 인원 (부서명 텍스트로 노드와 매핑; 노드의 department_aliases로 그루핑)
-- 정책: 로그인 사용자는 조회 가능, 관리자(profiles.is_admin=true)만 변경 가능

-- ─── org_nodes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_nodes (
  id text PRIMARY KEY,
  name text NOT NULL,
  parent_id text REFERENCES org_nodes(id) ON DELETE CASCADE,
  -- 이 노드의 직속 부서명 별칭들. members.department가 이 배열에 들어 있으면
  -- "노드 직속" 인원으로 간주된다. 자식 노드 인원은 별도 노드로 매핑.
  department_aliases text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_nodes_parent ON org_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_nodes_sort ON org_nodes(sort_order);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.touch_org_nodes_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_nodes_touch_updated_at ON org_nodes;
CREATE TRIGGER trg_org_nodes_touch_updated_at
  BEFORE UPDATE ON org_nodes
  FOR EACH ROW EXECUTE FUNCTION public.touch_org_nodes_updated_at();

-- ─── org_members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department text NOT NULL,
  position text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_members_department ON org_members(department);
CREATE INDEX IF NOT EXISTS idx_org_members_name ON org_members(name);

CREATE OR REPLACE FUNCTION public.touch_org_members_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_members_touch_updated_at ON org_members;
CREATE TRIGGER trg_org_members_touch_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_org_members_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE org_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- SELECT: 로그인한 모든 사용자 조회 가능
DROP POLICY IF EXISTS "org_nodes_select_authenticated" ON org_nodes;
CREATE POLICY "org_nodes_select_authenticated" ON org_nodes FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "org_members_select_authenticated" ON org_members;
CREATE POLICY "org_members_select_authenticated" ON org_members FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT/UPDATE/DELETE: 관리자만 (profiles.is_admin = true)
DROP POLICY IF EXISTS "org_nodes_modify_admin" ON org_nodes;
CREATE POLICY "org_nodes_modify_admin" ON org_nodes FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

DROP POLICY IF EXISTS "org_members_modify_admin" ON org_members;
CREATE POLICY "org_members_modify_admin" ON org_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );
