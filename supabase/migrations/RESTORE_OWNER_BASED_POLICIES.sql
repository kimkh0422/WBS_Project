-- 권한 모델 복원:
-- - 관리자: 모든 프로젝트/작업 CRUD
-- - 일반 회원: 본인 owner인 프로젝트만 수정/삭제, 본인 프로젝트 내 작업 CRUD
-- - 모든 승인 사용자: SELECT(보기)는 전체 가능 (기존 유지)

-- ─── projects ──────────────────────────────────────────────────────────────
-- INSERT: 인증 사용자가 owner_id를 본인으로 INSERT 가능 (관리자도 OK)
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert
  with check (
    public.is_admin_user()
    or owner_id = auth.uid()
  );

-- UPDATE: 관리자이거나 본인 owner인 프로젝트만 수정 가능
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update
  using (
    public.is_admin_user()
    or owner_id = auth.uid()
  )
  with check (
    public.is_admin_user()
    or owner_id = auth.uid()
  );

-- DELETE: 관리자이거나 본인 owner인 프로젝트만 삭제 가능
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete
  using (
    public.is_admin_user()
    or owner_id = auth.uid()
  );

-- ─── tasks ─────────────────────────────────────────────────────────────────
-- INSERT: 관리자이거나, 그 프로젝트가 본인 owner인 경우에만 작업 추가
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert
  with check (
    public.is_admin_user()
    or exists (
      select 1 from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );

-- UPDATE: 관리자이거나, 그 작업이 속한 프로젝트가 본인 owner
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update
  using (
    public.is_admin_user()
    or exists (
      select 1 from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  )
  with check (
    public.is_admin_user()
    or exists (
      select 1 from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );

-- DELETE: 관리자이거나, 그 작업이 속한 프로젝트가 본인 owner
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete
  using (
    public.is_admin_user()
    or exists (
      select 1 from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );

-- SELECT 정책은 그대로 유지 (승인 사용자 모두 보기 가능)
