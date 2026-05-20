-- 프로젝트 PM(표시 이름). 조직도 직급은 클라이언트에서 이름 매칭으로 표시.
alter table public.projects
  add column if not exists pm_name text;

comment on column public.projects.pm_name is '프로젝트 PM 표시 이름(조직 회원 이름과 매칭 시 직급 표시)';
