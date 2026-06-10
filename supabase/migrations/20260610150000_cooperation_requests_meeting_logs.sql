-- 협조 요청: 회의록(meeting_logs) 추가.
-- 각 요청에 N건의 회의 기록을 누적 저장.
--
-- 회의록 1건 (JSONB 항목 형태):
--   {
--     "id": "<uuid>",              -- 행 식별(편집/삭제)
--     "date": "YYYY-MM-DD",        -- 회의일
--     "title": "...",              -- 회의 제목/안건(선택)
--     "content": "...",            -- 회의 내용
--     "createdAt": "ISO timestamp",
--     "createdBy": "<user uuid|null>"
--   }
--
-- 기존 결과·회신(result text)과는 별도. 결과·회신은 최종 회신/결과 요약, meeting_logs는 회의 단위 시계열 기록.

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS meeting_logs jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN cooperation_requests.meeting_logs IS '협조 요청에 누적된 회의록 기록 배열. 진행 중 회의 결과를 시계열로 남긴다.';
