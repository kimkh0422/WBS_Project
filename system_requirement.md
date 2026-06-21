# 시스템 요구사항 명세서 (SRS)

> 구현·배포·**동일 프로그램 재구현**에 필요한 규정입니다.
> **주의:** DB 보안·스키마의 **정본(진실 원천)** 은 `supabase/migrations/` 전체입니다. 아래는 구현 시 빠지지 않게 하기 위한 요약·절차이며, 현재 구현(앱 0.7.x) 기준입니다. 정책은 여러 마이그레이션에 걸쳐 수정되므로 **최종 정의는 마이그레이션 파일**을 확인합니다.

| 문서 | 역할 |
|------|------|
| [`user_requirement.md`](./user_requirement.md) | 사용자 기능·제약 (URS) |
| **본 SRS** | 스키마, RLS, RPC, Edge 함수, 동기화, 로컬 키, API 계약 |
| [`tech.md`](./tech.md) | 기술 스택·아키텍처 보충 |

---

## 1. 시스템 개요

| 항목 | 내용 |
|------|------|
| 클라이언트 | **React 19** + TypeScript 5.8, **Vite 6**, **Tailwind CSS 4**(`@tailwindcss/vite`), SPA |
| 라우팅 | `react-router-dom` 7 의 **`BrowserRouter`**(Data Router 미사용 — React 19 초기 렌더 크래시 회피). 첫 경로 세그먼트를 `ViewType`으로 해석 |
| 상태 | React Context 4종: `AuthProvider` → `OrganizationProvider` → `LevelColorsProvider` → (App 내) `WBSProvider` + `ToastProvider` |
| 로컬 저장 | **IndexedDB** `wbs_mg` / store `kv` (실패·미지원 시 **localStorage** 폴백) |
| 서버 | **Supabase** Postgres + Auth + RLS + (선택) Realtime + Edge Functions(Deno) |
| Edge Functions | `admin-delete-user`, `send-cooperation-email`, `send-cooperation-telegram` |
| 실시간 협업 | 작업 **설명** 필드만 **Yjs(CRDT)** + TipTap, 전송은 Supabase Realtime broadcast |
| 배포 | 정적 호스팅(Vercel — `vercel.json` SPA rewrite) + Supabase 백엔드 |

---

## 2. 기술 스택 (패키지)

`package.json`(name `wbs-mg`) 기준 주요 의존성:
- **코어:** `react` `react-dom`(19), `react-router-dom`(7), `typescript`(5.8), `vite`(6), `@vitejs/plugin-react`, `tailwindcss`(4) + `@tailwindcss/vite`, `autoprefixer`
- **UI/상호작용:** `lucide-react`(아이콘), `clsx` + `tailwind-merge`(`cn()`), `motion`(애니메이션), `@dnd-kit/core·sortable·utilities`(드래그), `@tanstack/react-virtual`(행 가상화)
- **데이터/날짜:** `@supabase/supabase-js`(2.x), `date-fns`(4), `uuid`(13)
- **문서 입출력:** `xlsx`(SheetJS, Excel 가져오기), `exceljs`(Excel 보내기), `html2canvas` + `jspdf`(PDF), `ag-grid-community`·`ag-grid-react`(읽기전용 그리드 일부)
- **협업 편집:** `@tiptap/*`(core·react·starter-kit·extension-collaboration·-collaboration-cursor), `yjs` `y-prosemirror` `y-protocols` `lib0`
- **개발/훅:** `vitest`, `eslint`(+ typescript-eslint, eslint-plugin-react-hooks), `prettier`, `simple-git-hooks`, `lint-staged`, `supabase` CLI, `pg`, `tsx`

> 과거 문서의 `@google/genai`는 **현재 미사용**입니다(환경변수 배선만 잔존). README는 외부 템플릿 잔재입니다.

---

## 3. 환경 변수

**클라이언트(`import.meta.env.VITE_*`, 빌드 시 인라인):**

| 변수 | 용도 |
|------|------|
| `VITE_SUPABASE_URL` | 없으면 앱은 **로컬 전용 모드**(로그인·동기화 비활성) |
| `VITE_SUPABASE_ANON_KEY` | Supabase 클라이언트(ANON 키만 — 서비스롤 키는 클라이언트에 두지 않음) |
| `VITE_HIDDEN_VIEWS` | 추가로 숨길 뷰 목록(CSV) |
| `VITE_PROJECT_STATUS_ONLY` | 읽기전용 '프로젝트 현황' 배포(표·간트·칸반·프로젝트·마인드맵 숨김) |
| `VITE_FORCE_EVERYONE_ADMIN` | 임시: UI를 전원 관리자처럼 표시(대응 RLS 필요) |
| `VITE_BILLING_PLAN` | `free` 시 Realtime 최소화 |
| `VITE_REALTIME_ENABLED` | `false` 시 Realtime 비활성 |
| `VITE_ENABLE_PRESENCE` | `1`/`true` 일 때만 Presence 구독 |
| `VITE_COOPERATION_EMAIL_ENABLED` / `…_TELEGRAM_ENABLED` | 협조요청 자동 알림 채널(기본 OFF; localStorage 토글로도 제어) |

**Edge Function 시크릿(배포 환경, Deno `Deno.env`):**
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WBS_ADMIN_PASSWORD`(미설정 시 코드 폴백 — 운영 시 반드시 교체), `RESEND_API_KEY`, `MAIL_FROM`, `SMTP_HOST/PORT/USER/PASS`, `APP_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`.

---

## 4. 마이그레이션 적용 순서 (재구현 시)

새 DB에는 **`supabase/migrations/` 파일명 타임스탬프 오름차순으로 전부** 적용한다.
`FIX_*.sql`, `DIAGNOSE_*.sql`, `RESTORE_*.sql`, `FULL_SETUP_*.sql` 는 수동 복구/진단용이므로 **통상 파이프라인에는 numbered 마이그레이션만** 적용한다.

핵심 의존 순서:
1. `20250307000000_initial_schema` → projects, tasks, wbs_settings
2. `20250310000000_add_auth_and_sharing` → owner_id, project_members, project_invites, accept_invite, 기본 RLS
3. `20250310010000_…profiles` → profiles + handle_new_user 트리거
4. `20250310020000`·`20250310040000` → **RLS 재귀 회피용 `get_user_*_project_ids()` SECURITY DEFINER 헬퍼**
5. 이후: visits/audit/approved/access_requests, 조직(org_nodes/org_members), 협조요청·협조포인트, 개인할일, 주간보고, presence, gmtc 전용 가입·자동승인 순

> **주의(운영 정합):** `is_admin_user()` 가 한때 '로그인=전원 관리자' 임시본(`20260527150000`)으로 바뀌었다가 `20260612110000`에서 정상 복구됨. 파괴적 RLS 적용 전 **정상 정의를 먼저 확인**할 것. `20260610130000`은 비-@gmtc.kr 가입 차단 + 기존 외부 계정 정리를 수행한다.

---

## 5. 테이블·컬럼 (구현용 요약)

> jsonb 블롭은 핵심 형태만 표기. 전체는 마이그레이션·`src/lib/db/mappers.ts`·`src/types.ts` 참조.

### 5.1 `projects`
id(uuid PK), name, **formal_name**, description, start_date, end_date(참고용), **assignments** jsonb `[{assignee, allocation_percent, monthly_allocations?}]`, owner_id→auth.users CASCADE, min_work_effort_days, **work_effort_unit**(minute|hour|day|week), **project_kind**, **pm_name**, **po_name**, **include_in_dashboard**, **group_id**, report_*(주간보고 메타 6종), **source_task_id**→tasks·**source_project_id**→projects(작업분리 미러), created_at.

### 5.2 `tasks` (자기참조 트리)
id(uuid PK), project_id→projects **CASCADE**, parent_id→tasks **SET NULL**, name, start_date·end_date(**nullable** — `20260615190000`), **progress numeric**(0–100), assignee text, status text(기본 'todo'), expanded, **dependencies text[]**(선행 id), work_effort numeric, **weight** numeric(표시용), description, deliverables, checklist jsonb, **user_locked_fields text[]**, sort_order, **is_milestone·is_issue·is_action_item**, **baseline_start_date·baseline_end_date·baseline_work_effort**, **planned_progress_override**, **custom_fields jsonb**(사용자 컬럼 + 셀 서식 직렬화), created_at, **updated_at**(트리거·낙관적 잠금). 인덱스: project_id, parent_id. Realtime publication 포함.

> **매퍼 직렬화 정책:** `weight`·`planned_progress_override` 는 3-상태(유한수=저장 / `null`=null 저장 / `undefined`=페이로드에서 컬럼 생략으로 기존값 보존). `cellTextStyles`는 `custom_fields` 내부 키에 저장. **in-place 변형 금지**(변경분 diff가 놓쳐 저장 누락).

### 5.3 `profiles` (auth.users 와 1:1)
id(PK=auth.users.id CASCADE), email, full_name, **is_admin**(운영자), **approved**(동기화 게이트), **is_external_partner**(외부 파트너 — 현재 사실상 폐기), **department**, **managed_org_node_id**→org_nodes(설정 시 조직 책임자), level_colors jsonb, created_at.
트리거: auth.users INSERT → `handle_new_user`(비-@gmtc.kr 가입 예외 발생으로 차단). 로그인마다 `ensure_profile()` 로 보정.

### 5.4 `project_members`
id, project_id→projects CASCADE, user_id→auth.users CASCADE, **role** CHECK ∈ `owner|editor|viewer`, invited_at, UNIQUE(project_id, user_id).

### 5.5 공유·요청 테이블
- `project_invites`: token uuid UNIQUE, role editor|viewer, expires_at(기본 now()+7d). `accept_invite(token)` 로 소비.
- `pending_project_invitations`: 미등록자 사전초대(email/full_name), 가입 시 `ensure_profile`이 멤버로 승격 후 행 삭제.
- `project_access_requests`: (project_id, user_id, requested_role viewer|editor, status pending|approved|rejected …) UNIQUE(project_id,user_id).
- `admin_access_requests`: 운영자 권한 요청(user_id, message, status …) — 승인/거절은 RPC로만.

### 5.6 조직
- `org_nodes`(id text PK, name, parent_id→org_nodes CASCADE, **department_aliases text[]**, sort_order …) — 조직 트리. 부서 문자열↔노드 매핑.
- `org_members`(id, name, department, position, gender, sort_order, **email**, **telegram_chat_id** …) — 조직 명부(인증과 별개). (name,department)로 profiles와, (name,department,position)으로 협조포인트 수령자와 매칭.

### 5.7 업무 협조 요청·포인트
- `cooperation_requests`: mgmt_id, project_id→projects **SET NULL**(nullable), request_date, request_type, title, detail, **deliverables**, **informees**(참조자), requester, assignee, **assignee_kind**(person|org|mixed), **assignee_org_id/assignee_org_ids text[]**, **member_progress jsonb**(인원별 상태·완료일·RACI), **meeting_logs jsonb**, **status_history jsonb**(트리거 누적), priority, **due_date**, progress numeric(0–1), status, result, completed_date, delay_reason, note, **archived boolean**, sort_order, created_by, created_at, updated_at.
- `cooperation_points`: request_id→cooperation_requests **CASCADE**, member_name·member_department·member_position(스냅샷), points int, priority, request_mgmt_id, request_title, awarded_at, UNIQUE(request_id, name, dept, position). **트리거만 기록**, 클라이언트는 SELECT만.

### 5.8 개인·보고·감사·집계
- `personal_todos`(+ `personal_todo_rows`): user_id→auth.users CASCADE, title, note, status, sort_order double precision … — **소유자 전용**.
- `weekly_reports`: author_id, organization, reporter, week_start·week_end, title, content jsonb(`{projects[],issues[],nextWeek[]}`) — 사내 읽기/본인 쓰기.
- `wbs_audit_log`: project_id→projects CASCADE, entity_type(task|project), entity_id, entity_name, action(create|update|delete|bulk_update), user_id, user_display, **changes jsonb**(필드별 before→after), created_at.
- `visits`: session_id uuid, user_id, visited_at, visit_date, UNIQUE(session_id, visit_date) — 통계는 RPC로만.
- `user_presence`: user_id PK, last_seen_at, session_id — 직접 접근 차단, `pulse_presence`/`get_online_presence_*` RPC로만.

### 5.9 `wbs_settings` (단일 공유 설정 행)
id text PK `'default'`, level1/2/3_prefix, max_level, **config_json jsonb**(statusConfigs, appTitle, tableColumns, favoriteProjectIds, projectGroups, projectKinds, 대시보드 설정 등 대부분). `themeMode`는 의도적으로 per-user/로컬이며 **저장 안 함**. Realtime publication 포함.

---

## 6. SECURITY DEFINER 함수 (RLS·비즈니스)

| 함수 | 용도 |
|------|------|
| `get_user_project_ids()` | 소유 + 멤버 프로젝트 id (RLS 재귀 회피용 헬퍼) |
| `get_user_editable_project_ids()` | 관리자/전사열람 가능자=전체, 아니면 소유+멤버(owner/editor/**viewer**). 클라이언트 `getMyEditableProjectIds()`가 호출(실패 시 throw — 권한 강등 방지) |
| `get_user_owned_project_ids()` | 소유만 |
| `is_admin_user()` / `is_admin_user(uuid)` | `profiles.is_admin` 또는 부트스트랩 슈퍼관리자 이메일 |
| `is_approved_user()` | `profiles.approved` |
| `is_internal_company_user()` | JWT 이메일이 @gmtc.kr |
| `can_admin_project_content()` | `is_admin_user() OR is_internal_company_user()` — 프로젝트/작업 **내용 쓰기** 게이트 |
| `can_browse_all_company_projects()` | `approved AND NOT is_external_partner` — 전사 SELECT |
| `is_external_partner_user()` | `profiles.is_external_partner` |
| `ensure_profile()` | 프로필 upsert, 부트스트랩·@gmtc.kr 자동승인 정합, **사전초대 소비**, 팀장 자동 승격, 상태 JSON 반환 |
| `accept_invite(token uuid)` | 토큰 → project_members |
| `update_member_is_admin(target, is_admin)` | 관리자=전체, 조직 책임자=자기 서브트리만, 본인 차단 |
| `approve_admin_access_request(id)` / `reject_admin_access_request(id)` | 관리자 전용, 승인 시 is_admin 부여 |
| 방문/집계 | `record_visit`, `get_visitor_stats`, `get_member_visit_stats`(관리자), `get_daily_visitors`, `get_visitor_ranking`, `get_daily_visit_counts`, `get_registered_member_count` |
| Presence | `pulse_presence(session_id)`, `get_online_presence_count`, `get_online_presence_users`(관리자) |
| 표시명/조직 | `get_project_owner_display_names`, `profile_department_in_org_subtree` |
| `reconcile_cooperation_points` | **PUBLIC/authenticated EXECUTE 회수** — 트리거 전용 |

부트스트랩 슈퍼관리자(하드코딩): `kykim@gmtc.kr`, `wbsadmin@gmtc.kr` (Auth 사용자 자체는 별도 생성 필요).

---

## 7. RLS 정책 (최종 동작 요약)

> 모든 도메인 테이블 RLS ON, 기본 거부. 최종 정의는 마이그레이션 확인.

**projects**
- SELECT: `is_admin_user() OR can_browse_all_company_projects() OR owner OR member`
- INSERT: `can_admin_project_content() OR (owner_id=uid AND not external)`
- UPDATE: `can_admin_project_content() OR owner OR id = ANY(get_user_editable_project_ids())`
- **DELETE: `is_admin_user() OR owner_id = auth.uid()`** (운영자 또는 소유자만 — 내용편집보다 좁게)

**tasks**
- SELECT: `is_admin_user() OR can_browse_all_company_projects() OR project_id = ANY(get_user_project_ids())`
- INSERT/UPDATE/DELETE: `can_admin_project_content() OR project_id = ANY(get_user_editable_project_ids())`

**project_members:** SELECT 관리자/소속 프로젝트/본인; INSERT·DELETE 관리자/소유자; UPDATE 관리자/소유자(role).
**project_invites / pending_project_invitations:** 관리자/소유자(+ 본인 매칭). 사전초대 소비는 `ensure_profile`(DEFINER).
**project_access_requests:** 본인 INSERT/SELECT; 소유자·관리자 승인/거절; 거절 후 재요청.
**admin_access_requests:** 본인 INSERT(이미 관리자 아니면) / 본인·관리자 SELECT; 승인은 RPC.
**profiles:** 본인 SELECT/UPDATE; 관리자 전체; `approved` 행은 공유용으로 SELECT 가능; 외부는 본인만. 트리거가 비관리자의 외부 플래그 변경 차단·팀장 자동 승격.
**org_nodes / org_members:** authenticated(외부 제외) SELECT; **관리자만** INSERT/UPDATE/DELETE.
**cooperation_requests:** authenticated 전원 SELECT/INSERT/UPDATE/DELETE(팀 공유 문서).
**cooperation_points:** authenticated SELECT만(쓰기 정책 없음 → 트리거 전용).
**personal_todos:** 본인만 CRUD. **weekly_reports:** 사내 SELECT/본인 쓰기.
**wbs_audit_log:** 소유/멤버 SELECT·INSERT(+ 관리자 전역 SELECT). **wbs_settings:** authenticated SELECT, 외부 제외 쓰기.
**visits/user_presence:** 직접 접근 차단, RPC 경유.

**외부 파트너(`is_external_partner`)**: 전사 열람 불가(멤버 프로젝트만), 프로젝트 생성·소유 불가, 조직 테이블 열람 불가. — `20260610130000`(가입 @gmtc.kr 전용)로 사실상 폐기되었으나 enforcement는 잔존.

---

## 8. Edge Functions (Deno)

### 8.1 `admin-delete-user` (POST, JSON)
- Header `Authorization: Bearer <JWT>`. Body `{ userId, wbsAdminPassword? }`.
- caller가 `profiles.is_admin` **또는** `wbsAdminPassword === WBS_ADMIN_PASSWORD` 이면 허용. 본인 삭제 불가. → `auth.admin.deleteUser(userId)`(서비스롤). 배포: `npm run supabase:deploy-functions`.

### 8.2 `send-cooperation-email`
- 협조요청 알림 메일. **Resend API 우선**(`RESEND_API_KEY`), 미설정 시 denomailer **SMTP 폴백**(사내 SMTP는 외부/클라우드 차단 → Resend가 운영 경로; `MAIL_FROM`은 Resend 검증 도메인).
- 수신자 = 담당 멤버들의 부서 전체(org_members) + 선택 조직 노드를 트리로 확장 + `informees`의 이메일 토큰을 CC. 이메일은 `org_members.email` → `profiles.email`(이름 매칭) 순. 완료/회신불가/취소 상태 멤버는 제외. 미설정 시 200 `{skipped}`.

### 8.3 `send-cooperation-telegram`
- Telegram Bot API `sendMessage`(HTML, 4096자). `TELEGRAM_BOT_TOKEN` 필요. `TELEGRAM_DEFAULT_CHAT_ID`(개인·그룹, 콤마구분)는 항상 수신; 인원별은 `org_members.telegram_chat_id`(name,dept,position) 매칭.

> 클라이언트는 등록 시 자동(`notifyCooperation(id,'created')`, 채널별 토글 기본 OFF) 또는 수동 전파(`broadcastCooperation(id)` — 두 채널 동시, 행이 이미 저장돼 있어야 함)로 호출. 실패는 무시되어 협조요청 자체를 막지 않는다.

---

## 9. 클라이언트 ↔ Supabase 작업 (`src/lib/db/*`)

| 작업 | 메서드/위치 |
|------|------|
| 프로젝트/작업/설정 fetch | `projects.ts`/`tasks.ts`(1000행 페이지네이션)/`settings.ts` |
| 작업 upsert | **변경 행만** 배치 upsert; 누락 컬럼(PGRST204) 자동 제거 후 재시도(`TASK_OPTIONAL_DB_COLUMNS`) |
| 동기화 | `sync.ts` `syncWithDb(scope)` |
| 멤버/초대/접근요청 | `members.ts` (+ `accept_invite` RPC) |
| 프로필 | `profiles.ts` `getProfileStatus`→`ensure_profile` RPC, 자동승인 미러 |
| 조직 | `organization.ts` (org_nodes/org_members, 정적 JSON 폴백) |
| 협조요청/포인트 | `cooperationRequests.ts`(+ Edge invoke), `cooperationPoints.ts` |
| 개인할일/주간보고/감사 | `personalTodos.ts`, `weeklyReports.ts`, `audit.ts` |
| 백업 | `backup.ts` (스냅샷·롤백) |
| RPC 비활성 캐시 | not-found RPC는 `disableRpc()`로 세션 캐시 |

---

## 10. 동기화 `syncWithDb` (단계 요약)

**전제:** `profiles.approved === true` 이고 Supabase 설정됨. **scope:** `current`(현재 프로젝트) / `all`(전체).
1. 준비 → (all) 작업 0개인 **본인 소유** 프로젝트 자동 정리(최소 1개 유지), tombstone 병합
2. 서버 fetch(projects·tasks·settings 병렬)
3. **변경된 프로젝트만** upsert(지문 `fingerprintProjectRowForSync` 불일치 시)
4. 설정 비교 후 upsert/스킵
5. **`collectTasksNeedingUpload`로 서버 지문과 다른 작업만** upsert(진행 콜백)
6. 로컬 `deletedTaskIdsByProject` 배치 삭제(200건) → (all) 삭제 프로젝트 삭제
7. 최신 재fetch → 서버와 다른 것만 로컬 state에 **delta merge**(참조 보존)
8. `DbSyncSummary` 반환 → 토스트

보조: **5분 백그라운드 폴링** + 탭 포커스 시 pull(입력 포커스/미저장 중이면 스킵). Realtime DB 동기화 코드는 존재하나 기본 비활성(폴링이 활성 경로).

---

## 11. 로컬·세션 저장 키

**PersistKey(IndexedDB/localStorage 논리 키):** `wbs-projects`, `wbs-tasks`, `wbs-settings`, `wbs-deleted-task-ids`(Record projectId→taskId[]), `wbs-deleted-project-ids`.
**localStorage(기타):** `wbs.lastExportPrefs`, 분할 너비(`wbs.split.*`, `wbs:gantt:sidebarWidth`), `wbs-task-clipboard-v1`, `wbs-level-colors`, `wbs-kanban-order-v1-{projectId}`, `wbs.cooperation.myOnly`, `wbs.cooperationEmail.enabled`/`…Telegram.enabled`, `wbs.cooperationRequests.v1`(로컬 모드), 고급도구 토글, 투어/팁 본 적 플래그, `wbs-init-blank-session`.
**sessionStorage:** `wbs-admin-override`, 배너 dismiss 플래그, `wbs-current-project`, `wbs-visit-session-id`, `wbs.rpc.disabled.{fn}`. (devauth: `?devauth=1` 로컬 플래그)

---

## 12. JSON 백업 스키마 (`BackupData`)

```ts
{
  version: string;        // 앱 버전
  projects: Project[];
  tasks: Task[];
  settings: WBSSettings;  // statusConfigs, tableColumns, appTitle, projectGroups, projectKinds 등 전 필드
  exportDate: string;     // ISO
}
```
가져오기 시 `projects`·`tasks` 배열 필수. 부분 복원(특정 프로젝트로) 및 다중 백업 병합 지원.

---

## 13. 기본 설정·상태

- **상태(statusConfigs):** 기본은 사실상 **2-상태**(미완료 todo=0% / 완료 done=100%)이며 운영자가 이름·색·진척%·개수를 자유 정의(칸반 컬럼 = statusConfigs).
- **레벨 접두어/깊이:** 기본 L1 `W`, L2 `W`, L3 `T`, 표시 최대 레벨 설정 가능.
- **appTitle:** 표시 제목(예 "지엠티 스마트시트"), 설정에서 변경.
- **신규 작업 기본 공수:** 5일. **기간:** 양끝 포함 달력일.

---

## 14. `FilterState` (전 필드)

`projectIds`('all'|string[]), `status`, `assignee`(+`assigneeUnassignedOnly?`), `startDate`/`endDate`, `milestoneOnly?`/`issueOnly?`, `level?`, `pastDueOnly?`, `completedThisWeekOnly?`, `notStartedYetOnly?` 등. (정의: `src/types.ts`)

---

## 15. Excel 보내기/가져오기 헤더 매핑

내부 키 ↔ 한글 헤더(일부 별칭 인식): wbsId(WBS번호/WBS/WBS코드), level(레벨/Level), id(시스템ID), parentId(상위작업ID), name(작업명), startDate(시작일), endDate(종료일), progress(진행률), assignee(담당자), status(상태), dependencies(선행작업), workEffort(작업공수/공수), deliverables(산출물). 날짜는 ISO 문자열 또는 Excel 시리얼. 가져오기는 **컬럼 매핑 미리보기 모달** 제공.

---

## 16. 키보드 단축키 (구현 일치용)

- **공통:** Ctrl+Z/Y·Ctrl+Shift+Z(되돌리기/다시), Ctrl+Alt+1~9(레벨 펼침), Ctrl +/-(줄높이), **Ctrl+S(저장/동기화)**, Ctrl+K(검색), Shift+?(단축키 패널), **Shift+F12(고급 도구 토글)**.
- **표:** 화살표(셀 이동, Shift=마퀴 확장), Tab/Shift+Tab(이동 또는 들여/내어), Enter(아래·작업명 셀=새 행), Shift+Enter(위 형제), Insert/Shift+Insert(하위/형제), F2(편집), Delete(삭제), Alt+↑↓(순서·블록 이동), Shift+←→(접기/펼치기), Space(체크/마퀴), Ctrl+C/X/V, Ctrl+D/R(채우기), Ctrl+A.
- **간트:** +/- 줌, Ctrl+휠(커서 기준 줌). **마인드맵:** 화살표 이동·Tab 하위 추가·Shift+Tab 승격·Space 접기·Ctrl+휠 줌.
- 입력 포커스/IME 조합 중에는 표 단축키 비활성(`src/lib/ime.ts`).

---

## 17. Realtime / 협업

- **Presence:** 채널 `wbs-presence-{projectId}`(`VITE_ENABLE_PRESENCE`). **셀 포커스 커서:** 다른 사용자의 편집 셀 표시.
- **작업 설명 공동편집:** TipTap + Yjs, 전송은 **커스텀 SupabaseYjsProvider**(Supabase Realtime broadcast 채널로 sync/update/awareness를 base64로 터널링, 별도 y-websocket 서버 없음). `VITE_BILLING_PLAN=free`/`VITE_REALTIME_ENABLED=false` 시 비활성.
- **표 셀·행 구조·일괄 작업은 실시간 동기화 대상이 아님**(저장/폴링 기반).

---

## 18. 빌드 주입 / 버전

- Vite 가상 모듈 `virtual:app-release` → `APP_VERSION`·`APP_COMMIT_DATE`·`APP_CHANGELOG_JSON`(CHANGELOG.md 파싱, KST 고정) → 푸터에 버전·수정일·변경이력.
- **git 훅(`simple-git-hooks`):** pre-commit = lint-staged → `scripts/bump-version.mjs`(패치 +1, CHANGELOG에 로컬 `YYYY-MM-DD HH:mm` 기록, 같은 커밋에 add). pre-push = 릴리스 메타 출력.
- Rollup 수동 청크 분리(vendor-react/-supabase/-xlsx/-datefns/-dnd/-tiptap/-yjs/-motion 등) + `lazyWithRetry`.

---

## 19. 재구현 체크리스트

1. [ ] 동일 스택(React19/Vite6/Tailwind4/Supabase)으로 SPA + `BrowserRouter`
2. [ ] `src/types.ts`(Project, Task, ProjectAssignment, FilterState) + `WBSSettings`/`StatusConfig` + undo/redo
3. [ ] persist(IndexedDB+localStorage) + tombstone + init-blank-session + devauth 시드
4. [ ] **모든 마이그레이션 순차 적용** 후 RLS 수동 테스트(소유/멤버/사내/외부/운영자/조직책임자)
5. [ ] `syncWithDb` 단계·지문·delta merge + 변경행만 upsert + 5분 폴링
6. [ ] 13뷰, 필터, 칸반 컬럼=statusConfigs, 표+간트/표+칸반 분할
7. [ ] TaskModal(설명 Yjs 공동편집) / ProjectModal / Share·Members·AccessRequest·AdminPassword·Organization
8. [ ] 업무 협조 요청(상태·멤버·RACI·회의록·기한알림·보관·전파) + 협조 포인트 트리거
9. [ ] 알림 벨(작업·협조 기한) / 작업로그(필드 diff·Excel) / 주간보고 / 개인 칸반 / 투입현황 / 영업 아웃룩
10. [ ] Excel·MD·CSV·PDF 입출력, JSON 백업/복원/병합
11. [ ] Edge Function 3종 배포 + CORS + 시크릿
12. [ ] 버전 자동범프 훅 + virtual:app-release

---

## 20. 문서만으로의 한계 (반드시 코드·마이그레이션 병행)

| 항목 | 이유 |
|------|------|
| RLS 최종 SQL | 정책이 여러 마이그레이션에 걸쳐 수정됨 → **마이그레이션 파일이 정본** |
| 스케줄·롤업·계획진척·과부하 | `lib/schedule.ts`·`rollups.ts`·`plannedProgress.ts`·`workload.ts` 수식·엣지 케이스('growOnly' 등) |
| 협조 포인트·알림 규칙 | `lib/db/cooperationPoints.ts` + DB 트리거 / `lib/notifications/*` |
| 한국 공휴일·영업일 | `lib/calendar.ts`(2024–2028 하드코딩) |
| UI 레이아웃·CSS·다크모드 | 픽셀 단위 재현은 컴포넌트·`src/index.css` 필요 |

**결론:** 본 SRS + **전체 마이그레이션 순차 적용** + **`src/types.ts`·`lib/db/*`·`WBSContext.tsx` 동작 복제**로 동일 프로그램에 근접 가능. UI까지 동일을 원하면 기존 컴포넌트 트리를 기준으로 구현하는 것이 가장 빠르다.

---

*최종 수정: 저장소 구현(앱 0.7.x) 기준. 상충 시 `supabase/migrations/` 및 `src/` 코드가 우선한다.*
