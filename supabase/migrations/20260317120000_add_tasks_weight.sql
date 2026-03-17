-- tasks 테이블: 가중치(weight) 컬럼 추가
-- 목적: 진척률 가중치를 DB에 저장해 동기화 후에도 유지 (상위 가중치 입력 시 하위 비율 재분배 값 반영)

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS weight numeric(10,2) NULL;
