-- 프로젝트 분기(fork) 메타: 어느 task에서 분기된 자식 프로젝트인지 표시
-- 자식 프로젝트의 진척률/일정/공수 요약을 부모 task에 mirror(자식→부모 일방향)하기 위함
alter table public.projects
  add column if not exists source_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists source_project_id uuid references public.projects(id) on delete set null;

create index if not exists idx_projects_source_task on public.projects(source_task_id);
create index if not exists idx_projects_source_project on public.projects(source_project_id);

comment on column public.projects.source_task_id is '분기 원본 task id (NULL이면 일반 프로젝트). 원본 task가 삭제되면 NULL로 해제되고 자식 프로젝트는 독립 프로젝트로 남는다.';
comment on column public.projects.source_project_id is '분기 원본 프로젝트 id. UI 백링크 표시·일관성 검증용.';
