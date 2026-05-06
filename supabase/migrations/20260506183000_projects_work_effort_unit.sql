-- 프로젝트별 작업 공수(work_effort) 해석 단위: minute | hour | day | week (스케줄은 MD로 환산: 8h=1MD, 1주=5MD 영업일)
alter table projects
  add column if not exists work_effort_unit text not null default 'day';

alter table projects
  drop constraint if exists projects_work_effort_unit_check;

alter table projects
  add constraint projects_work_effort_unit_check
    check (work_effort_unit in ('minute', 'hour', 'day', 'week'));

comment on column projects.work_effort_unit is 'tasks.work_effort numeric is expressed in this unit per project';
