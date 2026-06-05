-- 프로젝트 정식 과제명(가칭 name과 별도)
alter table public.projects
  add column if not exists formal_name text;

comment on column public.projects.formal_name is '정식명칭(전체 과제명). 가칭은 name 컬럼.';
