# 협조요청 텔레그램 알림 Edge Function (Telegram Bot API)

협조요청(`cooperation_requests`) 등록·갱신 시 텔레그램 봇으로 담당 멤버(개인 채팅)와 팀 그룹방에 알림 메시지를 자동 발송합니다.
외부 서비스 가입·도메인 인증 불필요 — 텔레그램 봇 하나만 만들면 끝.

## 1. 텔레그램 봇 만들기 (1회, 5분)

1. 텔레그램에서 **@BotFather** 검색 → 대화 시작
2. `/newbot` 입력 → 봇 이름(예: `GMTC 협조요청 알림`) → 봇 아이디(예: `gmtc_coop_bot`) 입력
3. BotFather가 주는 **봇 토큰**을 복사해 둡니다. 형식: `123456789:AAH4...`
   - 이 토큰이 곧 발송 권한입니다. 외부에 노출 금지.

## 2. chat_id 확보

텔레그램 봇은 **먼저 말을 건 상대에게만** 메시지를 보낼 수 있습니다. 두 가지 운용 방식:

### A. 팀 그룹방 1개로 운영 (가장 간단 — 권장 시작점)

1. 텔레그램 그룹방을 만들고 위에서 만든 봇을 **멤버로 초대**
2. 그룹방에 아무 메시지나 한 줄 입력
3. 브라우저에서 아래 URL 열기 (토큰 치환):
   ```
   https://api.telegram.org/bot<봇토큰>/getUpdates
   ```
4. 응답 JSON에서 `"chat":{"id":-100123456789,...}` 의 **음수 id**가 그룹방 chat_id
5. 이 값을 Secrets의 `TELEGRAM_DEFAULT_CHAT_ID`에 넣으면, 모든 협조요청 알림이 그룹방으로 발송됩니다.
   멤버별 chat_id 입력 없이도 텔레그램 알림이 동작합니다.

### B. 멤버별 개인 알림 (선택 — 점진 적용 가능)

1. 각 직원이 텔레그램에서 봇 아이디(예: `@gmtc_coop_bot`)를 검색해 **/start** 전송
2. 관리자가 `getUpdates` URL(위와 동일)에서 각 직원의 `"chat":{"id":987654321,...}` 양수 id 확인
   - 또는 직원이 **@userinfobot** 에게 말을 걸면 자기 id를 바로 알 수 있음
3. SQL로 `org_members.telegram_chat_id` 입력:
   ```sql
   update org_members set telegram_chat_id='987654321' where name='김길용' and department='운영기술개발실';
   ```
   입력 현황 확인:
   ```sql
   select name, department, telegram_chat_id from org_members order by department, name;
   ```

A·B는 동시 사용 가능 — 개인 chat_id가 있는 멤버는 개인 채팅으로도 받고, 그룹방에도 발송됩니다.

## 3. 마이그레이션 적용

Supabase SQL Editor에서 한 번 실행:

```sql
-- supabase/migrations/20260610140000_org_members_telegram_chat_id.sql 내용 실행
```

`org_members.telegram_chat_id` 컬럼이 추가됩니다. (그룹방 전용 운영이면 §2-B 입력은 생략 가능)

## 4. Edge Function Secrets 등록

Supabase 프로젝트 대시보드 → **Edge Functions → Manage secrets** 에서:

| 키 | 값 | 비고 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456789:AAH4...` | BotFather가 준 봇 토큰 (필수) |
| `TELEGRAM_DEFAULT_CHAT_ID` | `-100123456789` | 팀 그룹방 chat_id (선택, 권장) |
| `APP_URL` | `https://wbs-project-phi.vercel.app` | 메시지의 "앱에서 열기" 링크용 (선택) |

## 5. Edge Function 배포

```bash
# Supabase CLI 설치·프로젝트 연결이 안 돼 있으면 (한 번만)
npm install -g supabase
supabase link --project-ref <YOUR_PROJECT_REF>

# 배포
supabase functions deploy send-cooperation-telegram
```

또는 Supabase 대시보드 → Edge Functions → New function → 코드 붙여넣기로 직접 배포해도 됩니다.

## 5-1. 클라이언트에서 텔레그램 발송 활성화

배포 + Secrets 등록이 끝나면, 클라이언트에서 호출을 켭니다. **두 방법 중 하나**:

### A. 환경변수 (권장 — Vercel 등 빌드 시 한 번에 처리)

Vercel 프로젝트 설정 → Environment Variables 에 추가:

```
VITE_COOPERATION_TELEGRAM_ENABLED=1
```

저장 후 재배포하면 클라이언트가 협조요청 저장 시마다 Edge Function 호출.

### B. 브라우저 토글 (테스트·검증용)

브라우저 콘솔에서 한 줄로:

```js
localStorage.setItem('wbs.cooperationTelegram.enabled', '1');
```

해당 브라우저만 즉시 활성화. 끄려면 `'0'` 또는 `removeItem`.

### 기본은 OFF인 이유

Edge Function 미배포 상태에서 클라이언트가 fetch 를 시도하면 콘솔에 CORS 에러가 찍힙니다.
이 토글이 OFF면 fetch 자체가 일어나지 않아 콘솔이 깨끗합니다. 운영에서 §5까지 마친 후 켜세요.
(메일 알림 토글 `VITE_COOPERATION_EMAIL_ENABLED` 와는 독립 — 텔레그램만, 메일만, 둘 다 모두 가능)

## 6. 동작 흐름

```
사용자가 협조 요청 등록/저장
        │
        ▼
insertCooperationRequest / updateCooperationRequest
        │
        ▼  (등록·내용변경·현황변경 시에만 트리거)
supabase.functions.invoke('send-cooperation-telegram', { requestId, mode })
        │
        ▼
Edge Function:
  1) cooperation_requests 행 조회
  2) member_progress 의 (name, dept, position) 들로 org_members.telegram_chat_id 조회
  3) chat_id 있는 멤버 개인 채팅 + TELEGRAM_DEFAULT_CHAT_ID 그룹방에 발송
  4) chat_id 없거나 상태가 완료/회신불가인 멤버는 자동 스킵
```

수동 테스트 (배포 후, 터미널에서):

```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/send-cooperation-telegram" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"<협조요청 UUID>","mode":"created"}'
```

## 7. 트러블슈팅

### 메시지가 안 옴
- Supabase 대시보드 → Edge Functions → send-cooperation-telegram → **Logs** 확인
- 응답의 `failures` 배열에 텔레그램 API 에러 설명이 들어 있음
- `Forbidden: bot was blocked by the user` → 해당 직원이 봇을 차단했거나 /start 를 안 보냄
- `Bad Request: chat not found` → chat_id 오타 또는 봇과 대화 이력 없음
- 그룹방인데 안 옴 → 봇이 그룹방에서 강퇴됐는지, chat_id가 음수 그대로인지 확인
  (그룹이 "슈퍼그룹"으로 전환되면 chat_id가 바뀝니다 → getUpdates 로 재확인)

### 응답 `{skipped: true, reason: "telegram not configured"}`
- `TELEGRAM_BOT_TOKEN` 미설정. §4 참고.

### 응답 `{sent: 0, skipped: "no telegram chat ids"}`
- 담당 멤버 전원 chat_id 미입력 + `TELEGRAM_DEFAULT_CHAT_ID` 도 미설정. §2 참고.

## 8. 비활성화

텔레그램 알림을 끄려면:
- Supabase Edge Function Secrets 에서 `TELEGRAM_BOT_TOKEN` 삭제, 또는
- 클라이언트 토글(`VITE_COOPERATION_TELEGRAM_ENABLED`/localStorage) OFF
- 어느 쪽이든 협조요청 등록 자체는 정상 동작
