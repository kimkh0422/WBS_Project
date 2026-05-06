-- tasks.custom_fields: 사용자 정의 컬럼 값 저장. key는 환경설정의 customColumns.id, value는 셀 텍스트.
-- 코드는 컬럼 미존재 시 폴백으로 재조회하므로 필수는 아니지만, 첫 SELECT 400 노이즈를 없애기 위해 추가.
alter table tasks
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column tasks.custom_fields is 'User-defined column values. Keys correspond to wbs_settings.config_json.customColumns[].id.';
