-- projects 테이블에 사용자 정의 그룹 ID 컬럼을 추가한다.
-- wbs_settings.config_json.projectGroups[].id 와 매칭되는 nullable text 컬럼.
-- 그룹 정의 자체는 글로벌 wbs_settings에 저장되므로 별도 FK는 두지 않는다.

alter table public.projects
  add column if not exists group_id text;

comment on column public.projects.group_id is
  '사용자 정의 그룹(폴더) ID. wbs_settings.config_json.projectGroups의 id와 매칭. nullable.';
