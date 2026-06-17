-- 업무 협조 요청 아카이브(보관) 플래그.
-- 완료·취소 등으로 더 이상 활성 관리가 필요 없는 항목을 기본 목록에서 숨기되 이력은 보존한다.
-- 기본 목록·상태별 카운트·기한 알림은 archived=false 만, '보관함' 필터에서만 archived=true 노출.

ALTER TABLE cooperation_requests
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- 기본 조회는 활성(archived=false) 위주이므로 부분 인덱스로 활성 행 스캔을 가볍게.
CREATE INDEX IF NOT EXISTS idx_cooperation_requests_active
  ON cooperation_requests(request_date DESC)
  WHERE archived = false;

-- RLS: 기존 정책이 모든 컬럼을 USING(true)/WITH CHECK(true) 로 허용하므로 archived 도 별도 정책 불필요.
