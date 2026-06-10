# 협조요청 메일 발송 Edge Function (회사 SMTP)

협조요청(`cooperation_requests`) 등록·갱신 시 회사 메일 서버(@gmtc.kr)로 담당 멤버에게 메일을 자동 발송합니다.
도메인 인증·외부 서비스 가입 불필요. 회사 IT 담당자에게 SMTP 정보만 받으면 끝.

## 1. 회사 IT 담당자에게 문의할 정보

```
1) SMTP 서버 주소      예: mail.gmtc.kr  또는  smtp.gmtc.kr
2) SMTP 포트          예: 465 (SSL) 또는 587 (STARTTLS) — 둘 다 가능하면 465 권장
3) 발송 전용 계정      예: noreply@gmtc.kr  또는 본인 메일
4) 계정 비밀번호       (계정에 대응하는 비밀번호 — 2단계 인증 시 "앱 비밀번호")
5) 외부 IP에서 SMTP 접속이 허용되는지 확인
   → Supabase Edge Function 은 외부에서 회사 메일 서버에 SMTP 연결을 시도합니다.
   → 사내망만 허용 정책이면 IT 에 화이트리스트 등록을 요청하거나
     이 메일은 발송이 불가능할 수 있습니다(이 때는 Gmail 등 외부 SMTP 사용).
```

## 2. 마이그레이션 적용

Supabase SQL Editor에서 한 번 실행:

```sql
-- supabase/migrations/20260610130000_org_members_email.sql 내용 실행
```

`org_members.email` 컬럼이 추가됩니다.

## 3. 멤버 이메일 입력

관리자가 SQL이나 OrganizationModal에서 인원별 이메일을 입력합니다. 예:

```sql
update org_members set email='gilyong.kim@gmtc.kr' where name='김길용' and department='운영기술개발실';
update org_members set email='yongsil.kim@gmtc.kr' where name='김영실' and department='운영기술개발실';
-- ...80명 일괄로 작업하시면 좋습니다.
```

전체 명단 확인:

```sql
select name, department, email from org_members order by department, name;
```

## 4. Edge Function Secrets 등록

Supabase 프로젝트 대시보드 → **Edge Functions → Manage secrets** 에서:

| 키 | 값 | 비고 |
|---|---|---|
| `SMTP_HOST` | `mail.gmtc.kr` | 회사 메일 서버 주소 |
| `SMTP_PORT` | `465` | 또는 `587` |
| `SMTP_USER` | `noreply@gmtc.kr` | 발송 계정 |
| `SMTP_PASS` | `(비밀번호)` | 계정 비밀번호 / 앱 비밀번호 |
| `MAIL_FROM` | `협조요청 <noreply@gmtc.kr>` | 발신자 표시명 (선택, 기본 SMTP_USER) |
| `APP_URL` | `https://wbs-project-phi.vercel.app` | 메일 본문 링크용 |

## 5. Edge Function 배포

로컬에서 Supabase CLI로:

```bash
# Supabase CLI 설치 (한 번만)
npm install -g supabase

# 프로젝트 연결 (한 번만)
supabase link --project-ref <YOUR_PROJECT_REF>

# 배포
supabase functions deploy send-cooperation-email
```

또는 Supabase 대시보드 → Edge Functions → New function → 코드 붙여넣기로 직접 배포해도 됩니다.

## 6. 동작 흐름

```
사용자가 협조 요청 등록/저장
        │
        ▼
insertCooperationRequest / updateCooperationRequest
        │
        ▼  (등록·내용변경·현황변경 시에만 트리거)
supabase.functions.invoke('send-cooperation-email', { requestId, mode })
        │
        ▼
Edge Function:
  1) cooperation_requests 행 조회
  2) member_progress 의 (name, dept, position) 들로 org_members 조회
  3) email 있는 멤버에게 회사 SMTP 로 BCC 일괄 발송
  4) email 없거나 상태가 완료/회신불가인 멤버는 자동 스킵
```

## 7. 트러블슈팅

### 메일이 안 옴
- Supabase 대시보드 → Edge Functions → send-cooperation-email → **Logs** 확인
- `org_members.email` 이 입력되어 있는지 SQL로 확인 (3번 참고)
- 회사 SMTP 가 외부 IP 차단인 경우 IT 에 Supabase Edge Function IP 화이트리스트 요청
- 일부 회사 메일은 발신자 계정과 From 주소가 동일해야 함 → `MAIL_FROM` 의 메일 주소를 `SMTP_USER` 와 같게 설정

### 응답 `{skipped: true, reason: "mail not configured"}`
- `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` 중 하나라도 미설정. 4번 참고.

### 응답 `{error: "smtp send failed", detail: ...}`
- SMTP 인증 실패 또는 연결 실패. `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` 확인.

## 8. 비활성화

메일 발송 기능을 끄려면:
- Supabase Edge Function Secrets 에서 `SMTP_HOST` 삭제
- 클라이언트는 200 응답으로 `{skipped: true}` 받고 진행 (협조요청 등록 자체는 정상)

## 9. 대안 (회사 SMTP 가 외부 차단인 경우)

회사 SMTP 가 외부에서 접속 불가하면 다음 대안 중 하나:

### A. Gmail SMTP
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`
- `SMTP_USER=your-gmail@gmail.com`
- `SMTP_PASS=` Google 계정의 **앱 비밀번호** ([2단계 인증 활성화 후 발급](https://myaccount.google.com/apppasswords))
- 1일 발송 한도 약 500통, 도메인 인증 불필요. 단점은 발신자 표시가 Gmail 주소.

### B. 네이버 메일 SMTP
- `SMTP_HOST=smtp.naver.com`, `SMTP_PORT=465`
- `SMTP_USER=your-id@naver.com`, `SMTP_PASS=` 네이버 계정 비밀번호
- 네이버 메일 설정 → POP/SMTP 사용 활성화 필요
- 1일 발송 한도 250통
