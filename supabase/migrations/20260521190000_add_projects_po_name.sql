-- 프로젝트 PO(예: Product Owner / 과제 주관) 표시 이름
alter table public.projects
  add column if not exists po_name text;

comment on column public.projects.po_name is '프로젝트 PO 표시 이름(조직 회원 이름과 매칭 시 직급 표시). 선택 입력.';
