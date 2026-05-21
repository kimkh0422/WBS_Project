-- 기존 UI 기본 공수 0.5 → 1(프로젝트 저장 단위). 일 단위 프로젝트만 갱신(의도적 0.5시간 등은 제외).
UPDATE tasks AS t
SET work_effort = 1
FROM projects AS p
WHERE t.project_id = p.id
  AND COALESCE(p.work_effort_unit, 'day') = 'day'
  AND t.work_effort = 0.5;

UPDATE tasks AS t
SET baseline_work_effort = 1
FROM projects AS p
WHERE t.project_id = p.id
  AND COALESCE(p.work_effort_unit, 'day') = 'day'
  AND t.baseline_work_effort = 0.5;
