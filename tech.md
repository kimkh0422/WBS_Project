# WBS Manager - 기술 문서

## 1. 프로젝트 개요

**WBS Manager (지엠티 프로젝트 매니저)** 는 프로젝트의 WBS(Work Breakdown Structure)를 관리하는 웹 애플리케이션이다. 작업 분류 체계를 트리 구조로 구성하고, 간트 차트·칸반 보드·대시보드 등 다양한 뷰로 일정과 진행 상황을 시각화한다.

- **현재 버전**: v0.2.x
- **언어**: TypeScript (프론트엔드), SQL (DB 마이그레이션)
- **라이선스**: Private

---

## 2. 기술 스택

| 구분 | 기술 | 비고 |
|------|------|------|
| **프레임워크** | React 19 | Vite 6 빌드 |
| **언어** | TypeScript 5.8 | strict mode |
| **스타일링** | Tailwind CSS 4 | `@tailwindcss/vite` 플러그인 |
| **아이콘** | Lucide React | |
| **애니메이션** | Motion (Framer Motion) | |
| **드래그&드롭** | @dnd-kit/core, @dnd-kit/sortable | 칸반 카드 정렬 |
| **날짜 처리** | date-fns | 영업일·공휴일 계산 포함 |
| **엑셀 처리** | xlsx (SheetJS) | 가져오기/내보내기 |
| **ID 생성** | uuid v4 | |
| **백엔드/DB** | Supabase (PostgreSQL) | Auth, Realtime, RLS, Edge Functions |
| **AI 분석** | Google Gemini (`@google/genai`) | 작업 자동 생성·분석 |
| **폰트** | Pretendard Variable, Inter, JetBrains Mono | |

---

## 3. 프로젝트 구조

```
WBS_MG/
├── index.html                    # SPA 진입점
├── package.json
├── vite.config.ts                # Vite 설정 (버전·커밋정보·CHANGELOG 주입)
├── CHANGELOG.md                  # 버전별 변경 이력
├── scripts/                      # 릴리스·마이그레이션 유틸 스크립트
│   └── update-release.mjs
├── src/
│   ├── main.tsx                  # React 루트 렌더링
│   ├── App.tsx                   # 메인 앱 컴포넌트 (라우팅·레이아웃)
│   ├── types.ts                  # 핵심 타입 정의 (Task, Project, FilterState 등)
│   ├── env.d.ts                  # Vite 환경변수 타입 선언
│   ├── assets/                   # 로고 등 정적 리소스
│   ├── context/
│   │   ├── WBSContext.tsx        # 전역 상태 관리 (프로젝트·작업 CRUD, Undo/Redo)
│   │   ├── AuthContext.tsx       # Supabase 인증 상태 관리
│   │   └── LevelColorsContext.tsx # WBS 레벨별 색상 관리
│   ├── hooks/
│   │   └── usePresence.ts       # Supabase Realtime Presence (동시접속 사용자 표시)
│   ├── lib/
│   │   ├── supabase.ts          # Supabase 클라이언트 초기화, DB Row 타입 정의
│   │   ├── db.ts                # DB CRUD 함수 (프로젝트·작업·설정·멤버·감사로그)
│   │   ├── calendar.ts          # 영업일·공휴일(한국) 계산
│   │   ├── schedule.ts          # 일정 계산 (투입비율→기간, 의존관계 스케줄링)
│   │   ├── workload.ts          # 인원별 투입량 계산, 과부하 감지·자동 보정
│   │   ├── taskView.ts          # 트리 구조 정렬, WBS 코드 생성, 필터/정렬
│   │   ├── excel.ts             # Excel 가져오기·내보내기
│   │   ├── export.ts            # JSON 백업·복원, Markdown 내보내기
│   │   ├── levelColors.ts       # 레벨별 색상 유틸
│   │   ├── utils.ts             # 공통 유틸 (cn, randomUUID 등)
│   │   └── wbsCorrectionPrompt.ts # AI WBS 보정 프롬프트
│   └── components/
│       ├── WBSTable.tsx          # WBS 표 뷰 (트리 테이블)
│       ├── GanttChart.tsx        # 간트 차트 뷰
│       ├── KanbanBoard.tsx       # 칸반 보드 뷰
│       ├── Dashboard.tsx         # 대시보드 (요약·차트)
│       ├── ProjectsPage.tsx      # 프로젝트 목록 페이지
│       ├── AllocationOverviewPage.tsx # 투입 현황 개요
│       ├── TaskModal.tsx         # 작업 상세 편집 모달
│       ├── ProjectModal.tsx      # 프로젝트 생성·편집 모달
│       ├── AIAnalysisModal.tsx   # AI 분석 모달 (Gemini 연동)
│       ├── WBSSettingsModal.tsx  # 앱 설정 모달
│       ├── VersionManager.tsx    # 버전 이력 표시
│       ├── LoginScreen.tsx       # 로그인 화면
│       ├── SupabaseSetupScreen.tsx # Supabase 미설정 시 안내
│       ├── ExcelImportPreviewModal.tsx # Excel 가져오기 미리보기
│       ├── ExportModal.tsx       # 내보내기 모달
│       ├── BackupRestoreModal.tsx # JSON 백업·복원 모달
│       ├── ShareModal.tsx        # 프로젝트 공유·초대 링크
│       ├── MembersModal.tsx      # 회원 관리 (관리자)
│       ├── AuditLogModal.tsx     # 변경 이력 조회
│       ├── AdminPasswordModal.tsx # 관리자 비밀번호 모달
│       ├── BaselineView.tsx      # 베이스라인 비교 뷰
│       ├── OverloadWarningModal.tsx # 과부하 경고 모달
│       ├── ConfirmDialog.tsx     # 확인 다이얼로그
│       ├── ContextMenu.tsx       # 우클릭 컨텍스트 메뉴
│       └── Toast.tsx             # 토스트 알림
└── supabase/
    ├── functions/
    │   └── admin-delete-user/    # Edge Function: 관리자 회원 삭제
    └── migrations/               # DB 마이그레이션 SQL 파일들
        ├── 20250307000000_initial_schema.sql
        ├── ...약 20개 마이그레이션 파일
        └── FULL_SETUP_NEW_PROJECT.sql
```

---

## 4. 핵심 데이터 모델

### 4.1 Project

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | 프로젝트 고유 ID |
| `name` | string | 프로젝트명 |
| `description` | string? | 설명 |
| `startDate` / `endDate` | ISO date? | 프로젝트 기간 |
| `assignments` | ProjectAssignment[]? | 투입인원별 투입비율 (월별 설정 가능) |
| `ownerId` | UUID? | 소유자 (Supabase auth user) |
| `minWorkEffortDays` | number? | 최소 공수 기준(일) |

### 4.2 Task

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | UUID | 작업 고유 ID |
| `projectId` | UUID | 소속 프로젝트 |
| `parentId` | UUID? | 상위 작업 (트리 구조) |
| `name` | string | 작업명 |
| `startDate` / `endDate` | ISO date | 시작일/종료일 |
| `progress` | 0-100 | 진행률(%) |
| `assignee` | string | 담당자 |
| `status` | string | 상태 (todo, in-progress, done 등 커스텀 가능) |
| `dependencies` | string[]? | 선행 작업 ID 목록 |
| `workEffort` | number? | 작업 공수(Man-days, 소수점 지원) |
| `assignments` | TaskAssignment[]? | 작업별 투입인원·비율 |
| `isMilestone` | boolean? | 마일스톤 여부 |
| `baselineStartDate` / `baselineEndDate` / `baselineWorkEffort` | | 베이스라인 일정 |
| `checklist` | {id, text, completed}[]? | 체크리스트 |
| `deliverables` | string? | 산출물 |
| `updatedAt` | ISO datetime? | 낙관적 잠금용 타임스탬프 |
| `userLockedFields` | string[]? | AI가 덮어쓰지 않을 수동 수정 필드 |

### 4.3 WBSSettings

| 필드 | 설명 |
|------|------|
| `appTitle` | 앱 타이틀 |
| `level1Prefix` ~ `level3Prefix` | WBS 코드 접두사 |
| `maxLevel` | 최대 계층 레벨 |
| `statusConfigs` | 커스텀 상태 목록 (id, name, progress, color) |
| `tableColumns` | 테이블 컬럼 표시/숨김 |
| `showCriticalPath` | 크리티컬 패스 표시 여부 |
| `wrapTextInCells` | 셀 줄바꿈 여부 |

---

## 5. 데이터베이스 (Supabase)

### 5.1 테이블 구조

| 테이블 | 설명 |
|--------|------|
| `projects` | 프로젝트 (assignments는 JSONB 컬럼) |
| `tasks` | 작업 (project_id FK → projects, parent_id 자기참조) |
| `wbs_settings` | 앱 설정 (싱글톤, id='default') |
| `profiles` | 사용자 프로필 (is_admin, approved, level_colors, full_name) |
| `project_members` | 프로젝트 멤버 (user_id, role: owner/editor/viewer) |
| `project_invites` | 초대 링크 (token, expires_at) |
| `wbs_audit_log` | 변경 이력 (entity_type, action, changes JSONB) |
| `visits` | 방문 기록 (방문 통계 집계용) |

### 5.2 보안 (RLS)

- Row Level Security 적용: 프로젝트 소유자 또는 멤버만 조회·수정 가능
- `SECURITY DEFINER` 함수로 RLS 무한 재귀 문제 해결
- 관리자(`is_admin=true`)는 전체 프로젝트 조회 가능
- `approved` 컬럼으로 회원 승인 관리 (미승인 시 로컬 전용)

### 5.3 주요 RPC 함수

| 함수 | 설명 |
|------|------|
| `ensure_profile` | 로그인 시 프로필 자동 생성 + 관리자/승인 여부 반환 |
| `accept_invite` | 초대 토큰으로 프로젝트 멤버 등록 |
| `get_member_visit_stats` | 회원별 접속 통계 조회 (관리자) |
| `get_project_owner_display_names` | 프로젝트 소유자 표시명 조회 |

### 5.4 Realtime

- `tasks` 테이블 Realtime Publication 활성화 (실시간 동기화)
- Presence 채널 (`wbs-presence-{projectId}`) 로 동시접속 사용자 표시

### 5.5 Edge Functions

- `admin-delete-user`: 관리자가 `auth.users`에서 회원을 삭제하는 서버리스 함수

---

## 6. 주요 기능

### 6.1 뷰 모드

| 뷰 | 설명 |
|----|------|
| **WBS 표 (list/table)** | 트리 구조 테이블. WBS 번호 자동 생성, 인라인 편집, 드래그 정렬 |
| **간트 차트 (gantt)** | 타임라인 기반 일정 시각화. 크리티컬 패스, 베이스라인 비교 |
| **칸반 보드 (kanban)** | 상태별 카드 뷰. 드래그로 상태 변경 |
| **대시보드 (dashboard)** | 프로젝트 요약, 진행률 차트, 통계 |
| **프로젝트 관리 (projects)** | 프로젝트 목록·생성·삭제 |
| **투입 현황 (allocation)** | 인원별 투입비율 현황 |

### 6.2 일정 계산

- **영업일 기반**: 주말(토·일) + 한국 공휴일 자동 제외
- **투입비율 반영**: 투입비율(10%~100%)에 따라 기간 자동 산출
- **월별 투입비율**: 월별로 다른 투입비율 설정 가능
- **의존관계 스케줄링**: 선행 작업 완료 후 자동 일정 조정 (위상 정렬)
- **과부하 감지**: 동일 인원이 같은 날 100% 초과 투입 시 경고 + 자동 보정

### 6.3 데이터 동기화

- **낙관적 잠금**: `updated_at` 기반 동시 수정 감지 (충돌 시 갱신 거부)
- **Realtime 동기화**: Supabase Realtime으로 다른 사용자 변경 즉시 반영
- **Presence**: 현재 프로젝트를 보고 있는 다른 사용자 표시
- **localStorage → Supabase 마이그레이션**: 기존 로컬 데이터 자동 이전

### 6.4 가져오기/내보내기

| 포맷 | 가져오기 | 내보내기 |
|------|----------|----------|
| Excel (.xlsx) | O (미리보기 후 매핑) | O |
| JSON 백업 | O (복원) | O (전체 백업) |
| Markdown | - | O |

### 6.5 AI 분석 (Gemini)

- 프로젝트 설명 기반 WBS 작업 자동 생성
- 기존 WBS 분석·보정 제안
- `GEMINI_API_KEY` 환경변수로 설정

### 6.6 협업

- **프로젝트 공유**: 초대 링크 생성 → 멤버 등록 (editor/viewer 권한)
- **회원 관리**: 관리자가 회원 승인·역할 변경·삭제
- **변경 이력 (Audit Log)**: 작업·프로젝트 변경 이력 자동 기록·조회
- **방문 통계**: 회원별 접속 횟수·마지막 접속 시각

### 6.7 기타

- **Undo/Redo**: 작업 변경 실행 취소·재실행
- **커스텀 상태**: 상태 명칭·색상·자동 진척도 커스텀
- **레벨별 색상**: 사용자별 WBS 레벨 색상 커스텀 (프로필 저장)
- **베이스라인 비교**: 기준 일정 대비 실제 일정 비교
- **마일스톤**: 이정표 작업 표시·필터
- **단축키**: 키보드 단축키 지원 (사이드바 안내)
- **프로젝트 복사**: 기존 프로젝트 + 작업을 복제

---

## 7. 환경 변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | O |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | O |
| `GEMINI_API_KEY` | Google Gemini API 키 | AI 기능 사용 시 |

---

## 8. 빌드 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 (포트 3000)
npm run dev

# 프로덕션 빌드
npm run build

# 버전 업데이트
npm run release              # patch
npm run version:minor        # minor
npm run version:major        # major

# 타입 체크
npm run lint
```

### Vite 빌드 시 주입되는 전역 변수

| 변수 | 설명 |
|------|------|
| `__APP_VERSION__` | package.json의 version |
| `__APP_COMMIT_DATE__` | 마지막 git 커밋 시각 |
| `__APP_CHANGELOG_JSON__` | CHANGELOG.md 파싱 결과 (버전·날짜·변경사항) |

---

## 9. DB 마이그레이션 이력

마이그레이션 파일은 `supabase/migrations/` 에 타임스탬프 순서로 관리된다.

| 파일 | 내용 |
|------|------|
| `20250307000000_initial_schema` | 초기 스키마 (projects, tasks, wbs_settings) |
| `20250308000000_add_tasks_updated_at` | tasks.updated_at 컬럼 (낙관적 잠금) |
| `20250308100000_add_tasks_is_milestone` | tasks.is_milestone 컬럼 |
| `20250308200000_add_tasks_baseline` | 베이스라인 컬럼 (baseline_start/end_date, baseline_work_effort) |
| `20250308300000_add_projects_assignments` | projects.assignments JSONB |
| `20250308000001_realtime_publication_tasks` | tasks Realtime Publication |
| `20250310000000_add_auth_and_sharing` | 인증·공유 (project_members, project_invites, RLS) |
| `20250310010000_add_profiles_and_admin` | profiles 테이블, 관리자 기능 |
| `20250310020000_fix_profiles_rls_recursion` | profiles RLS 무한 재귀 수정 |
| `20250310030000_admin_see_all_projects` | 관리자 전체 프로젝트 조회 |
| `20250310040000_fix_projects_rls_recursion` | projects RLS 재귀 수정 |
| `20250310050000_fix_projects_insert_admin` | 관리자 프로젝트 생성 권한 |
| `20250310060000_work_effort_numeric` | work_effort integer → numeric (소수 지원) |
| `20250310070000_add_profiles_full_name` | profiles.full_name |
| `20250310080000_add_profiles_level_colors` | profiles.level_colors JSONB |
| `20250310090000_add_visits_table` | visits 테이블 (방문 통계) |
| `20250310100000_optional_statement_timeout` | statement_timeout 설정 |
| `20250310110000_add_projects_end_date` | projects.end_date |
| `20250310120000_add_projects_min_work_effort_days` | projects.min_work_effort_days |
| `20250312010000_add_profiles_approved` | profiles.approved (회원 승인) |
| `20250312100000_project_members_update_policy` | project_members 업데이트 정책 |
| `20250312110000_add_wbs_audit_log` | wbs_audit_log 테이블 (변경 이력) |
| `20250312120000_profiles_select_project_owners` | 프로젝트 소유자 프로필 조회 정책 |
| `20250312140000_get_project_owner_display_names` | RPC: 소유자 표시명 |
| `20250312150000_get_member_visit_stats` | RPC: 회원 방문 통계 |

---

## 10. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────┐
│                   React SPA                      │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ WBSContext │  │AuthContext│  │LevelColors   │  │
│  │ (상태관리) │  │ (인증)    │  │  Context     │  │
│  └─────┬─────┘  └────┬─────┘  └──────────────┘  │
│        │              │                           │
│  ┌─────┴──────────────┴───────────────────────┐  │
│  │              Components                     │  │
│  │  WBSTable │ GanttChart │ KanbanBoard │ ...  │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │                              │
│  ┌─────────────────┴──────────────────────────┐  │
│  │              lib/ (비즈니스 로직)            │  │
│  │  db.ts │ schedule.ts │ workload.ts │ ...    │  │
│  └─────────────────┬──────────────────────────┘  │
└────────────────────┼────────────────────────────┘
                     │ Supabase JS Client
          ┌──────────┴──────────┐
          │     Supabase        │
          │  ┌──────────────┐   │
          │  │  PostgreSQL   │   │
          │  │  (RLS 적용)   │   │
          │  ├──────────────┤   │
          │  │  Auth         │   │
          │  ├──────────────┤   │
          │  │  Realtime     │   │
          │  ├──────────────┤   │
          │  │  Edge Funcs   │   │
          │  └──────────────┘   │
          └─────────────────────┘
```
