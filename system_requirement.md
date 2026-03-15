# 시스템 요구사항 명세서 (SRS)

> 구현·배포·**동일 프로그램 재구현**에 필요한 규정입니다.  
> **주의:** DB 보안·스키마의 **법적 진실 원천**은 `supabase/migrations/` 전체입니다. 아래는 구현 시 빠지지 않게 하기 위한 요약·절차입니다.

| 문서 | 역할 |
|------|------|
| [`user_requirement.md`](./user_requirement.md) | 사용자 기능·제약 (URS) |
| **본 SRS** | 스키마, RLS, RPC, 동기화, 로컬 키, API 계약 |

---

## 1. 시스템 개요

| 항목 | 내용 |
|------|------|
| 클라이언트 | React 19, TypeScript, Vite 6, Tailwind CSS 4, `@tailwindcss/vite` |
| 상태 | `WBSProvider` + `AuthProvider`, `ToastProvider` |
| 저장 | `localStorage` → 실패/용량 시 **IndexedDB** `wbs_mg` / store `kv` |
| 서버 | Supabase Postgres + Auth + (선택) Realtime |
| Edge | `admin-delete-user` (Deno) |

---

## 2. 기술 스택 (패키지)

`package.json` 기준: `react` `react-dom` `vite` `@vitejs/plugin-react` `typescript` `tailwindcss` `@tailwindcss/vite` `autoprefixer` `lucide-react` `clsx` `tailwind-merge` `date-fns` `uuid` `xlsx` `@supabase/supabase-js` `@dnd-kit/*` `@google/genai` `motion` `dotenv`(스크립트) 등.

---

## 3. 환경 변수

| 변수 | 용도 |
|------|------|
| `VITE_SUPABASE_URL` | 없으면 앱은 **로컬 전용 모드**(로그인·동기화 UI 비활성/우회) |
| `VITE_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `VITE_ENABLE_PRESENCE` | `1` 또는 `true`일 때만 Presence 채널 구독 |

**Edge Function (배포 환경):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, 선택 `WBS_ADMIN_PASSWORD` (기본값 미설정 시 코드에 폴백 있음 — 배포 시 반드시 시크릿으로 교체 권장).

---

## 4. 마이그레이션 적용 순서 (재구현 시)

새 DB에는 **`supabase/migrations/` 내 파일명 타임스탬프 오름차순**으로 전부 적용한다.  
`FIX_*.sql`, `FULL_SETUP_*.sql`는 수동 복구용이므로 **통상 파이프라인에는 numbered 마이그레이션만** 적용.

핵심이 되는 의존 관계:
1. `20250307000000_initial_schema` → projects, tasks, wbs_settings
2. `20250310000000_add_auth_and_sharing` → owner_id, members, invites, accept_invite, RLS
3. 이후 프로필·RLS 수정·visits·audit·report 필드·approved·access_requests·tasks_select 확장 순

---

## 5. 테이블·컬럼 (구현용 요약)

### 5.1 `projects`
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | gen_random_uuid() |
| name | text NOT NULL | |
| description | text | |
| start_date, end_date | date | |
| assignments | jsonb | `[{ assignee, allocation_percent, monthly_allocations? }]` |
| owner_id | uuid FK auth.users | ON DELETE CASCADE |
| min_work_effort_days | numeric | |
| report_category, report_agency, report_budget_this_year, report_total_period, report_name_short, report_name_full | text | 주간보고 |
| created_at | timestamptz | |

### 5.2 `tasks`
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | uuid PK | |
| project_id | uuid FK projects CASCADE | |
| parent_id | uuid FK tasks SET NULL | |
| name | text NOT NULL | |
| start_date, end_date | date NOT NULL | |
| progress | int default 0 | |
| assignee | text default '' | |
| status | text default 'todo' | |
| expanded | boolean default false | |
| dependencies | text[] default '{}' | 선행 task id |
| work_effort | numeric | 소수 허용 |
| description | text | |
| checklist | jsonb default '[]' | |
| deliverables | text | |
| sort_order | int default 0 | |
| created_at | timestamptz | |
| updated_at | timestamptz | 트리거로 자동 갱신 |
| is_milestone, is_issue | boolean | |
| baseline_start_date, baseline_end_date | date | |
| baseline_work_effort | numeric(10,2) | |

### 5.3 `wbs_settings`
| 컬럼 | 타입 |
|------|------|
| id | text PK `'default'` |
| level1_prefix, level2_prefix, level3_prefix | text |
| max_level | int |

### 5.4 `profiles`
| 컬럼 | 비고 |
|------|------|
| id | PK = auth.users.id CASCADE |
| email, full_name | |
| is_admin | boolean |
| approved | boolean (승인 후 동기화) |
| level_colors | jsonb `[{r,g,b},...]` |
| login_count | int (선택 집계) |
| created_at | |

트리거: `auth.users` INSERT → `handle_new_user` → profiles (첫 가입자 is_admin=true).

### 5.5 `project_members`
id uuid PK, project_id, user_id, role IN (`owner`,`editor`,`viewer`), invited_at, UNIQUE(project_id, user_id)

### 5.6 `project_invites`
id, project_id, token uuid UNIQUE, role editor|viewer, expires_at (기본 now()+7d), created_at

### 5.7 `project_access_requests`
id, project_id, user_id, requested_role viewer|editor, status pending|approved|rejected, created_at, reviewed_at, reviewed_by, UNIQUE(project_id, user_id)

### 5.8 `wbs_audit_log`
id, project_id, entity_type task|project, entity_id, entity_name, action create|update|delete|bulk_update, user_id, user_display, changes jsonb, created_at

### 5.9 `visits`
id, session_id uuid, user_id, visited_at, visit_date date, UNIQUE(session_id, visit_date)

---

## 6. SECURITY DEFINER 함수 (RLS·비즈니스)

| 함수 | 반환 | 용도 |
|------|------|------|
| `get_user_project_ids()` | uuid[] | 소유 + 멤버 프로젝트 id |
| `get_user_editable_project_ids()` | uuid[] | 소유 + owner/editor 멤버 |
| `get_user_owned_project_ids()` | uuid[] | 소유만 |
| `is_admin_user()` | boolean | profiles.is_admin |
| `is_approved_user()` | boolean | profiles.approved |
| `accept_invite(invite_token uuid)` | jsonb | success, project_id / error |
| `ensure_profile()` | jsonb | 로그인 시 프로필 보장, is_admin 반환 |
| `record_visit(p_session_id uuid)` | void | visits INSERT ON CONFLICT DO NOTHING |
| `get_visitor_stats()` | jsonb | daily, total (전체 visits 집계) |
| `get_member_visit_stats()` | set/table | 관리자용 회원별 방문 |
| `get_project_owner_display_names(owner_ids uuid[])` | table | 소유자 표시명 |
| `checkIsAdmin` 등 | 마이그레이션 참조 | 클라이언트에서 사용하는 RPC명은 `db.ts`와 일치시킬 것 |

---

## 7. RLS 정책 (최종 동작 요약)

**projects**
- **SELECT:** `is_admin_user() OR is_approved_user() OR owner_id = auth.uid() OR id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())`
- **INSERT:** `is_admin_user() OR owner_id = auth.uid()`
- **UPDATE:** `is_admin_user() OR owner_id = auth.uid() OR id = ANY(get_user_editable_project_ids())`
- **DELETE:** 소유자 (관리자 정책은 마이그레이션 확인)

**tasks** (승인 사용자 전역 읽기 반영 후)
- **SELECT:** `is_admin_user() OR is_approved_user() OR project_id = ANY(get_user_project_ids())`  
  ※ 마이그레이션 `20260313140000` 기준. 승인만으로는 **모든** task 행 읽기 가능.
- **INSERT/UPDATE/DELETE:** `is_admin_user() OR project_id = ANY(get_user_editable_project_ids())`

**project_members**
- SELECT: 관리자 OR `project_id = ANY(get_user_project_ids())` OR user_id = 본인
- INSERT/DELETE: 관리자 OR 소유 프로젝트
- UPDATE: 관리자 OR 소유자 (role 변경)

**project_invites:** 소유자·관리자가 생성/삭제/조회 (정책은 get_user_owned / get_user_project_ids 조합 — 마이그레이션대로)

**project_access_requests:** 본인 INSERT/SELECT; 소유자·관리자가 타인 요청 SELECT/UPDATE; 거절 건 본인 재요청 UPDATE

**wbs_settings:** authenticated 전원 SELECT/INSERT/UPDATE

**wbs_audit_log:** 해당 프로젝트 소유 또는 멤버만 SELECT/INSERT

**profiles:** 본인 SELECT/UPDATE; 관리자 전체 SELECT; `approved=true` 행은 authenticated 누구나 SELECT (멤버 초대용)

**visits:** 본인 INSERT만; 통계는 RPC

---

## 8. Edge Function `admin-delete-user`

**Method:** POST, JSON body.

**Headers:** `Authorization: Bearer <JWT>` (호출자 세션)

**Body:**
```json
{
  "userId": "<uuid 삭제 대상>",
  "wbsAdminPassword": "<선택, WBS_ADMIN_PASSWORD와 일치 시 is_admin 없이도 허용>"
}
```

**동작:**
1. JWT로 caller 검증
2. `userId` 필수, caller 본인 삭제 불가
3. caller의 `profiles.is_admin` 이거나 `wbsAdminPassword === env WBS_ADMIN_PASSWORD` 이면 허용
4. `auth.admin.deleteUser(userId)`

**응답:** 성공 시 JSON `{ "ok": true }` 형태; 오류 시 400/401/403/500 + message.

---

## 9. 클라이언트 ↔ Supabase 작업 목록 (`db.ts` 수준)

| 작업 | 메서드 |
|------|--------|
| 프로젝트 목록 | `from('projects').select('*').order('created_at')` |
| 작업 목록 | `from('tasks').select('*').order('sort_order')` |
| 설정 | `from('wbs_settings').eq('id','default').maybeSingle()` |
| 프로젝트 upsert/insert/update | `upsert` / `update` / `insert` (assignments 없는 구스키마 폴백) |
| 작업 upsert | 배치, 컬럼 누락 시 minimal row 재시도 |
| 작업 삭제 | `delete().in('id', ids)` |
| 프로젝트 삭제 | `delete().eq('id', id)` |
| 멤버 | `project_members` select/insert/update/delete |
| 초대 | `project_invites` insert/select/delete |
| 초대 수락 | `rpc('accept_invite', { invite_token })` |
| 접근 요청 | `project_access_requests` insert/select/update |
| 감사 로그 | `wbs_audit_log` insert/select |
| 프로필 | `profiles` select/update, `rpc('ensure_profile')` |
| 방문 | `rpc('record_visit', { p_session_id })`, `get_visitor_stats`, `get_member_visit_stats` |
| 소유자 이름 | `rpc('get_project_owner_display_names', { owner_ids })` |

---

## 10. 동기화 `syncWithDb` (의사코드 수준)

**전제:** `profiles.approved === true` 이고 Supabase 설정됨.

**scope:** `current` = 현재 프로젝트 id만 / `all` = 모든 로컬 프로젝트.

1. **1%** `동기화 준비 중…`
2. **scope=all:** 작업 0개인 **본인 소유** 프로젝트 자동 삭제(최소 1개 프로젝트 유지) → 로컬 상태 반영, tombstone 병합
3. **3%** `서버와 비교하는 중…` — `fetchProjects`, `fetchTaskRows`, `fetchSettingsRow` 병렬
4. **5~18%** 변경된 프로젝트만 `upsertProject` (지문 `fingerprintProjectRowForSync` 불일치 시)
5. **20%** `wbs_settings` 행과 로컬 `level/maxLevel` 등 비교 후 `upsertSettings` 또는 스킵
6. **22~64%** `collectTasksNeedingUpload`로 서버 row 지문과 다른 작업만 `upsertTasks` (콜백으로 진행)
7. **64~72%** 로컬 `deletedTaskIdsByProject` 집합을 DB `deleteTasksFromDB` 배치(200건)
8. **72~82%** scope=all 시 로컬 삭제된 프로젝트 id들 `deleteProjectFromDB`
9. tombstone 맵·삭제 프로젝트 id 정리
10. **84%** `서버에서 최신 데이터 받는 중…` — 다시 fetch 전체
11. **93~99%** 서버와 다른 프로젝트/작업만 로컬 state에 merge (설정 병합)
12. **100%** `DbSyncSummary` 반환 → 토스트

**지문:** 프로젝트는 이름·날짜·assignments JSON 등 정규화 후 문자열 비교. 작업은 DB row 스냅샷과 비교.

---

## 11. 로컬·세션 저장 키 (전체)

**PersistKey (IndexedDB/localStorage 공통 논리 키):**
- `wbs-projects`, `wbs-tasks`, `wbs-settings`
- `wbs-deleted-task-ids` (Record projectId → taskId[])
- `wbs-deleted-project-ids` (uuid[])

**localStorage (기타):**
- `wbs.lastExportPrefs`, `wbs.split.wbsTableWidth`, `wbs:gantt:sidebarWidth`
- `wbs-task-clipboard-v1`, `wbs-level-colors`, `gemini-api-key`, `wbs-correction-prompt` (또는 상수 키)
- `wbs.toast.tipSeen.*`, `wbs-kanban-order-v1-{projectId}`
- `wbs-init-blank-session` (초기화 직후 플래그)

**sessionStorage:**
- `wbs-admin-override`, `wbs-local-save-banner-dismissed`, `wbs-backup-banner-dismissed`
- `wbs-current-project`, `wbs-visit-session-id`
- `wbs.rpc.disabled.{fnName}`

---

## 12. JSON 백업 스키마 (`BackupData`)

```ts
{
  version: string;       // 앱 버전 문자열
  projects: Project[];
  tasks: Task[];
  settings: WBSSettings; // 전 필드 포함 (statusConfigs, tableColumns, appTitle 등)
  exportDate: string;    // ISO
}
```

가져오기 시 `projects`·`tasks` 배열 필수.

---

## 13. 기본 `WBSSettings` / 상태

**statusConfigs (기본 4종):**
| id | name | progress |
|----|------|----------|
| todo | 할 일 | 0 |
| in-progress | 진행 중 | 10 |
| blocked | 지연됨 | 50 |
| done | 완료 | 100 |

**레벨 접두어:** L1 `W`, L2 `W`, L3 `T`, **maxLevel 4**  
**appTitle:** `지엠티 프로젝트 매니저`  
**tableColumns:** wbsId, name, startDate, endDate, workEffort, assignee, allocation, status, progress, deliverables, dependencies (visible 플래그)

---

## 14. `FilterState` (전 필드)

- `projectIds`: `'all' | string[]`
- `status`: `TaskStatus | 'all'`
- `assignee`: string
- `assigneeUnassignedOnly?`: boolean
- `startDate`, `endDate`: string
- `milestoneOnly?`, `issueOnly?`: boolean
- `level?`: number | `'all'`
- `pastDueOnly?`, `completedThisWeekOnly?`: boolean

---

## 15. Excel보내기/가져오기 헤더 매핑

내부 키 ↔ 한글 헤더 (일부 별칭 인식):

| 키 | 한글 헤더 |
|----|-----------|
| wbsId | WBS번호 (별칭: WBS, WBS코드, …) |
| level | 레벨 (Level, Lvl, …) |
| id | 시스템ID |
| parentId | 상위작업ID |
| name | 작업명 |
| startDate | 시작일 |
| endDate | 종료일 |
| progress | 진행률 |
| assignee | 담당자 |
| status | 상태 |
| dependencies | 선행작업 |
| workEffort | 작업공수 |
| deliverables | 산출물 |

날짜: ISO 문자열 또는 Excel 시리얼.

---

## 16. 키보드 단축키 (구현 일치용)

- **공통:** Ctrl+Z 되돌리기, Ctrl+Alt+1~9 레벨 펼침, Ctrl +/- 줄높이, **Ctrl+S DB 동기화**
- **표:** ↑↓ 선택 이동, Alt+↑↓ 순서, Tab/Shift+Tab 들여/내어, Enter 동일레벨 추가, F2 수정, Delete 삭제, Ctrl+C/V, Ctrl+A
- **간트:** +/- 줌
- **마인드맵:** Ctrl+휠 줌

(입력 포커스 있을 때는 표 단축키 비활성 등 — 구현과 동일하게)

---

## 17. Realtime

- `tasks` 테이블 publication — 구독 시 타 클라이언트 변경 반영 가능
- Presence 채널: `wbs-presence-{projectId}`, payload: `user_id`, `display_name`

---

## 18. 빌드 주입

- Vite define: `__APP_CHANGELOG_JSON__`, `__APP_COMMIT_DATE__`, 앱 버전 문자열
- 소스: `CHANGELOG.md` 파싱, `version.txt`, git commit date 스크립트

---

## 19. 재구현 체크리스트 (세분화)

1. [ ] 동일 스택으로 SPA 구성
2. [ ] `types.ts` — Project, Task, TaskAssignment, ProjectAssignment, FilterState
3. [ ] `WBSSettings`, `StatusConfig`, undo/redo 히스토리 깊이
4. [ ] persist + tombstone + init-blank-session
5. [ ] **모든 마이그레이션** 적용 후 RLS 수동 테스트 (소유/멤버/승인만/관리자)
6. [ ] `syncWithDb` 단계·지문·merge 동일
7. [ ] 8뷰, 필터, Kanban 컬럼=`statusConfigs`
8. [ ] TaskModal 필드·프로젝트 모달 필드·Share/Members/AccessRequest/Audit/AdminPassword
9. [ ] Excel 파이프라인, ExportModal 다중 포맷, BackupRestore
10. [ ] AIAnalysisModal — Gemini, 3모드, 첨부, userLockedFields
11. [ ] WeeklyReportModal — 주 범위, scope, 복사
12. [ ] Edge Function 배포 + CORS + 시크릿

---

## 20. 문서만으로의 한계 (반드시 코드·마이그레이션 병행)

| 항목 | 이유 |
|------|------|
| RLS 최종 SQL | 정책이 여러 마이그레이션에 걸쳐 수정됨 → **마이그레이션 파일이 정본** |
| 스케줄·과부하 알고리즘 | `lib/schedule.ts`, `lib/workload.ts` 수식·엣지 케이스 |
| AI 프롬프트·파싱 | `AIAnalysisModal.tsx`, `wbsCorrectionPrompt.ts` 전문 |
| UI 레이아웃·CSS | 픽셀 단위 재현은 컴포넌트 소스 필요 |

**결론:** 본 SRS + **전체 마이그레이션 순차 적용** + **`src/types.ts`·`db.ts`·`WBSContext.tsx` 동작 복제**를 하면 동일 프로그램에 근접 가능. UI까지 픽셀 단위 동일을 원하면 기존 컴포넌트 트리를 기준으로 구현하는 것이 가장 빠르다.

---

*최종 수정: 저장소 구현 기준. 상충 시 `supabase/migrations` 및 `src/` 코드가 우선한다.*
