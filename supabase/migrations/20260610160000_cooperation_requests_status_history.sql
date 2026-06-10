-- 협조 요청: 단계(현황) 변경 이력 추적.
-- 각 행에 status_history jsonb 배열을 두고, INSERT 및 status 변경 시 자동 push.
--
-- 항목 1건 형태:
--   { "status": "진행중", "at": "2026-06-10T05:00:00.000Z" }
--
-- 화면(클라이언트): 가장 최근 entry 의 at 으로부터 현재까지의 경과 일/주 를 표시.
-- (개별 단계 정확한 진입 시각이 필요한 경우엔 history 의 해당 status 항목을 찾는다.)

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN cooperation_requests.status_history IS '협조 요청 현황(status) 변경 이력. INSERT/UPDATE 트리거로 자동 push.';

-- ─── 트리거 함수 ───
CREATE OR REPLACE FUNCTION public.cooperation_requests_track_status()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 신규 등록: 첫 상태로 history 초기화 (기존 값이 없거나 빈 배열일 때만)
    IF NEW.status_history IS NULL OR jsonb_typeof(NEW.status_history) <> 'array' OR jsonb_array_length(NEW.status_history) = 0 THEN
      NEW.status_history := jsonb_build_array(
        jsonb_build_object('status', COALESCE(NEW.status, '요청완료'), 'at', ts)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- 상태가 바뀐 경우에만 history 에 항목 추가
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.status_history := COALESCE(OLD.status_history, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('status', NEW.status, 'at', ts)
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 트리거 등록 ───
DROP TRIGGER IF EXISTS trg_cooperation_requests_track_status ON cooperation_requests;
CREATE TRIGGER trg_cooperation_requests_track_status
  BEFORE INSERT OR UPDATE ON cooperation_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.cooperation_requests_track_status();

-- ─── 기존 행 backfill ───
-- 이미 등록된 행의 history 가 비어 있으면, 현재 status + created_at(없으면 now) 으로 1건 채워 둔다.
-- 이후 변경 분부터는 트리거가 누적.
UPDATE cooperation_requests
SET status_history = jsonb_build_array(
  jsonb_build_object(
    'status', COALESCE(status, '요청완료'),
    'at', to_char(COALESCE(created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
)
WHERE status_history IS NULL OR jsonb_typeof(status_history) <> 'array' OR jsonb_array_length(status_history) = 0;
