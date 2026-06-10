-- org_members 에 telegram_chat_id 컬럼 추가 — 협조 요청 텔레그램 알림 수신자 매핑용.
--
-- 매핑 규칙(Edge Function send-cooperation-telegram):
--   1) memberProgress 의 (name, department, position) 로 org_members 행을 찾는다
--   2) telegram_chat_id 가 비어 있지 않으면 해당 멤버에게 텔레그램 메시지 발송
--   3) 비어 있으면 스킵 (TELEGRAM_DEFAULT_CHAT_ID 그룹방이 설정돼 있으면 그룹방으로는 항상 발송)
--
-- chat_id 는 각 직원이 회사 알림봇에게 /start 를 보낸 뒤 getUpdates 로 확인한 숫자 문자열.
-- 그룹방 chat_id 는 음수(-100...)일 수 있어 text 로 저장한다. NULL 허용.

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- 협조요청 발송 시 chat_id 보유 멤버 조회 보조용 인덱스(필수는 아님).
CREATE INDEX IF NOT EXISTS idx_org_members_telegram_chat_id ON org_members(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

COMMENT ON COLUMN org_members.telegram_chat_id IS '협조 요청 등 자동 알림 텔레그램 수신 chat_id. NULL 이면 개인 발송 미수행.';
