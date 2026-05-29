-- Disk I/O 절감: 증분 pull(updated_at) 및 project 범위 조회 가속
-- 리소스 부족으로 타임아웃 시 → APPLY_TASKS_IO_INDEXES_MANUAL.sql (한 줄씩 수동 실행)

CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON public.tasks (updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_updated ON public.tasks (project_id, updated_at DESC);