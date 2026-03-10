# 새 Supabase 프로젝트 설정 가이드

본인 계정으로 새 Supabase 프로젝트를 만들고 WBS 앱을 연동하는 방법입니다.

## 1. Supabase 프로젝트 생성

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속 후 로그인
2. **New project** 클릭
3. Organization 선택, 프로젝트 이름 입력, DB 비밀번호 설정 후 **Create new project** 실행
4. 프로젝트가 준비될 때까지 대기 (1~2분)

## 2. API 키 확인

1. 왼쪽 메뉴 **Project Settings** → **API**
2. 아래 값을 복사:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** 키 → `VITE_SUPABASE_ANON_KEY`

## 3. .env 설정

프로젝트 루트의 `.env` 파일을 열고 다음을 설정합니다:

```env
VITE_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

(선택) CLI로 마이그레이션을 실행할 경우:

- **Project Settings** → **Database** → **Connection string** → URI 형식에서 비밀번호 확인
- `.env`에 추가: `SUPABASE_DB_PASSWORD="your_db_password"`

## 4. DB 스키마 적용 (마이그레이션)

### 방법 A: SQL Editor에서 실행 (권장)

1. `npm run db:open-migration` 실행
2. SQL이 클립보드에 복사되고 Supabase SQL Editor가 열림
3. 에디터에 **Ctrl+V**로 붙여넣기
4. **Run** 버튼 클릭
5. 에러 없이 완료되면 성공

### 방법 B: CLI로 실행

1. `.env`에 `SUPABASE_DB_PASSWORD` 설정
2. `npm run db:migrate-profiles` 실행

## 5. Auth 설정

1. 왼쪽 메뉴 **Authentication** → **Providers**
2. **Email** 활성화 (이메일/비밀번호 로그인)
3. (선택) **Google**, **GitHub** 등 OAuth 사용 시 해당 Provider 활성화
4. **Authentication** → **URL Configuration**:
   - **Site URL**: `http://localhost:5173` (로컬) 또는 배포 URL
   - **Redirect URLs**: `http://localhost:5173/**` 등 추가

## 6. Edge Function 배포 (관리자 회원 삭제 기능)

관리자가 회원을 삭제하려면 `admin-delete-user` Edge Function을 배포해야 합니다.

1. [Supabase CLI](https://supabase.com/docs/guides/cli) 설치
2. 프로젝트 루트에서 로그인: `supabase login`
3. 프로젝트 연결: `supabase link`
4. 함수 배포: `supabase functions deploy admin-delete-user`

배포 후 **Project Settings** → **API**에서 `SUPABASE_SERVICE_ROLE_KEY`가 Edge Function에 자동 주입됩니다.

## 7. 앱 실행

```bash
npm run dev
```

브라우저에서 로그인/회원가입 후 정상 동작하는지 확인합니다.

---

## 문제 해결

| 증상 | 해결 |
|------|------|
| `Could not find the table 'public.profiles'` | 4단계 마이그레이션을 실행했는지 확인 |
| `Unsupported provider` | Auth Providers에서 Email 또는 사용할 OAuth 활성화 |
| 프로젝트 PAUSED | Supabase 대시보드에서 프로젝트 복원 |
| RLS 오류 | `FULL_SETUP_NEW_PROJECT.sql` 전체를 다시 실행 |
