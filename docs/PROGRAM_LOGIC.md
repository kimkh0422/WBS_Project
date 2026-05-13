# 지엠티 스마트시트 (WBS_MG) — 프로그램 로직 정의서

> **목적**: 코드 동작을 처음 들여다보는 개발자/AI가 "이 앱은 어떻게 굴러가는가"를 한 번에 파악할 수 있도록, **구현 관점**에서 핵심 로직·상태·데이터 흐름을 정리한다.
> 요구사항(WHAT) 관점 문서는 `docs/spec/00_index.md` 시리즈 참조. 이 문서는 HOW에 가깝다.
>
> 마지막 갱신: 2026-05-11 / 코드 기준 v0.4.155

---

## 1. 한 줄 요약

**다수 프로젝트의 WBS(작업 트리)를 표·간트·달력·칸반·마인드맵·대시보드의 6개 시점으로 보여주는 React SPA. 상태는 React Context 1개(`WBSContext`)에 집중되고, 저장은 localStorage + IndexedDB + Supabase(원격)의 3-tier로 자동 디바운스 동기화된다. 권한은 시스템 관리자 / 프로젝트 소유자 / 편집자 / 보기자 4단계.**

---

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 빌드/번들 | Vite + React 18 + TypeScript | `npm run dev` / `npm run build` |
| 스타일 | Tailwind CSS + `cn()` 유틸 | 디자인 토큰 `--color-*` 사용 |
| 라우팅 | react-router-dom + 내부 view state | URL은 페이지 새로고침용, 실제 화면 전환은 `view` state |
| 상태 | React Context (자체 작성) | 외부 상태 라이브러리 미사용 |
| 백엔드 | Supabase (PostgreSQL + Auth + Realtime + RPC + RLS) | DB·Auth·실시간 동기화 일체 |
| 가상 스크롤 | `@tanstack/react-virtual` | 표·간트 행 가상화 |
| 차트 | Recharts | 대시보드 |
| DnD | `@dnd-kit` | 표 행 드래그 정렬 |
| 날짜 | `date-fns` + `lib/calendar.ts` (한국 공휴일) | 영업일 계산 |
| Excel/Word/PPT | `xlsx`, `python-docx`(매뉴얼), `python-pptx`(설명자료) | I/O |

---

## 3. 진입점과 Provider 트리

[src/main.tsx](src/main.tsx) 기준:

```
<StrictMode>
  <BrowserRouter>
    <AuthProvider>            ← Supabase 세션·로그인/회원가입 OTP
      <OrganizationProvider>  ← 조직도(부서) 데이터·캐시
        <LevelColorsProvider> ← 사용자 정의 레벨별 색상
          <App />             ← WBSProvider + 라우팅 + 모달들
```

`<App />` 내부에서 `<WBSProvider>`가 한 번 더 감싸며, **편집 가능한 프로젝트 ID 목록(`editableProjectIds`)·관리자 여부(`isAdmin`)를 props로 주입**한다. 이 분리 덕에 권한 체크는 컨텍스트 외부(=상위)에서 정해진 결과만 받아 적용된다.

---

## 4. 데이터 모델

소스: [src/types.ts](src/types.ts), [src/lib/supabase.ts](src/lib/supabase.ts)

### 4.1 핵심 엔티티

| 엔티티 | 키 필드 | 핵심 관계 |
|---|---|---|
| `Project` | `id`, `name`, `ownerId`, `startDate`, `endDate`, `assignments[]`, `workEffortUnit`, `groupId` | 1 : N → Task |
| `Task` | `id`, `projectId`, `parentId`, `startDate`, `endDate`, `progress`, `workEffort`, `weight`, `dependencies[]`, `status`, `userLockedFields[]` | 트리(self-join) + 의존성(N:N within project) |
| `WBSSettings` | 단일 row | 전사 공통(상태 정의·표 컬럼·접두사 등) |
| `Profile` | `id`(=auth.users.id), `is_admin`, `approved`, `department`, `managed_org_node_id` | 회원 정보·승인/관리자 플래그 |
| `ProjectMember` | `project_id`, `user_id`, `role`(owner/editor/viewer) | 프로젝트 공유 |
| `PendingProjectInvitation` | `project_id`, `email`, `role` | 가입 전 사전 초대(가입 시 `ensure_profile` RPC가 members로 승격) |
| `ProjectAccessRequest` | `project_id`, `user_id`, `requested_role`, `status` | 비멤버가 보기·편집 권한 요청 |

### 4.2 Task의 특이 필드

- **`userLockedFields`**: 사용자가 직접 편집한 필드 목록. 자동 롤업·AI 갱신이 이 필드를 덮어쓰지 않는다.
  - 예: 사용자가 부모 작업의 `startDate`를 직접 입력 → `userLockedFields`에 `'startDate'` 추가 → 자식 변경으로 인한 롤업이 부모를 건드리지 않는다.
- **`baseline*`**: 기준 일정/공수 스냅샷. 간트에 점선 막대로 표시.
- **`weight`**: 진척률 가중치. 미지정 시 `workEffort`로 대체.
- **`customFields`**: 사용자 정의 컬럼 값(키=컬럼 id, 값=문자열).

### 4.3 DB Row ↔ 도메인 객체 매핑

snake_case ↔ camelCase 매핑은 [src/lib/db/mappers.ts](src/lib/db/mappers.ts)에서 `fromTaskRow` / `toTaskRow` / `fromProjectRow` 등이 담당. 클라이언트 도메인 객체는 항상 camelCase.

---

## 5. 상태 관리 — `WBSContext`

소스: [src/context/WBSContext.tsx](src/context/WBSContext.tsx), 타입: [src/context/wbsContextTypes.ts](src/context/wbsContextTypes.ts)

### 5.1 상태 분류

| 카테고리 | 변수 | 비고 |
|---|---|---|
| 도메인 | `projects`, `allTasks`, `wbsSettings` | 화면에 보이는 모든 데이터의 source of truth |
| UI 선택 | `currentProjectId`, `selectedTaskIds`, `treeExpandLevel` | 화면 상태 |
| 디버그·메타 | `deletedTaskIdsByProject`, `deletedProjectIds`, `hasLocalChangesSinceSync`, `collabPushNonce` | 동기화·자동 저장 트리거용 |
| 권한(주입) | `isAdmin`, `editableProjectIds` | App.tsx에서 계산 후 props로 |
| Refs | `projectsRef`, `currentProjectIdRef`, `wbsSettingsRef` 등 | 클로저용 latest-value mirror |

### 5.2 파생값(`useMemo`)

- `tasks`: `allTasks`에서 `currentProjectId` 기준 필터.
- `canEditCurrentProject`: 다음 중 하나면 true — (1) `isAdmin`, (2) 현재 프로젝트 소유자, (3) `editableProjectIds`에 포함. 그 외 false. (`'all'` 가상 프로젝트는 항상 false)
- `wbsMap` / `displayWbsMap`: 작업 id → "W1.2.3" 같은 WBS 번호 문자열.

### 5.3 Operations은 4개 하위 훅으로 분리

| 훅 | 책임 |
|---|---|
| [`useProjectOps`](src/context/hooks/useProjectOps.ts) | `addProject` / `updateProject` / `deleteProject` / `copyProject` |
| [`useTaskOps`](src/context/hooks/useTaskOps.ts) | `addTask` / `updateTask` / `deleteTask` / `updateTasksBulk` / `setBaseline*` / `renameAssignee` / `refreshProjectSchedule` |
| [`useTaskMovement`](src/context/hooks/useTaskMovement.ts) | `moveTask` / `indentTask` / `outdentTask` / `reorderTask` / `toggleExpand` |
| [`useBackupOps`](src/context/hooks/useBackupOps.ts) | `exportFullBackup` / `restoreBackup` / `mergeBackups` / `resetAllProjectsToNew` |

이 훅들은 `setAllTasks` / `setProjects`를 받아 **즉시 로컬 state를 갱신**하고 `bumpDirty()`를 호출한다. 실제 DB 동기화는 별도 디바운스로 일어난다(섹션 8).

### 5.4 Undo/Redo

[src/hooks/useWbsHistory.ts](src/hooks/useWbsHistory.ts)에서 `projects` + `allTasks` 스냅샷을 최대 50개 보관. Ctrl+Z / Ctrl+Y에서 호출.

---

## 6. 인증·권한 모델

소스: [src/context/AuthContext.tsx](src/context/AuthContext.tsx), [src/components/WBSAppShell.tsx](src/components/WBSAppShell.tsx) (또는 App.tsx 상단부)

### 6.1 로그인 흐름

1. **이메일/비번** (`signInWithEmail`) — Supabase Auth.
2. **회원가입** (`signUpWithEmail`) → 이메일로 6자리 OTP 발송 → `verifySignupOtp` 검증 시 세션 발급.
3. **비밀번호 재설정**: `requestPasswordResetOtp` → `verifyPasswordResetOtp` → 임시 세션 → `updatePassword`. 이 단계에서는 `isResettingPassword` 플래그가 true라 메인 화면 진입을 막는다.
4. **OAuth**: 구글/깃허브 (사용 시).

### 6.2 권한 등급(4-tier)

| 역할 | 식별 | 권한 범위 |
|---|---|---|
| **관리자** | `profiles.is_admin=true` **또는** 관리자 비밀번호 모드(`adminOverride`) | 모든 기능 |
| **소유자** | `projects.owner_id === user.id` | 본인이 만든 프로젝트의 모든 편집·삭제·공유 |
| **편집자** | `project_members.role='editor'` (서버 RPC `get_user_editable_project_ids()`가 owner+editor 반환) | 해당 프로젝트의 작업 CRUD |
| **보기자** | `project_members.role='viewer'` | 해당 프로젝트의 데이터 조회만 |

> 한 사용자가 프로젝트마다 다른 역할을 가질 수 있다. `editableProjectIds`는 owner + editor 프로젝트 id의 합집합.

### 6.3 회원 체험 모드(`memberPreview`)

관리자가 일반 사용자 시점으로 화면을 보고 싶을 때 토글. `effectiveIsAdmin = isAdmin && !memberPreview`로 모든 관리자 전용 UI를 일시 숨김. 본인 소유 프로젝트의 편집 권한은 유지.

### 6.4 RLS

DB Row Level Security가 클라이언트 권한과 동일 기준으로 시행됨. 클라이언트 권한 체크는 UX(편집 비활성·메뉴 숨김)용이고, 보안 경계는 DB가 책임진다.

- editor가 아닌 사용자가 작업을 update하면 `42501 row-level security`로 거부 → `WBSContext.handleDbError`가 한글 메시지로 변환 후 toast.

---

## 7. 라우팅과 View 시스템

### 7.1 View 종류

`view` state는 다음 중 하나:

| view | 화면 | 컴포넌트 |
|---|---|---|
| `'dashboard'` | 전체 현황·이슈·부서별 현황 | [Dashboard.tsx](src/components/Dashboard.tsx) |
| `'list'` | 표 + 간트 split view | [WBSTable](src/components/WBSTable.tsx) + [GanttChart](src/components/GanttChart.tsx) |
| `'table'` | 표 단독 (전체화면) | WBSTable (fillHeight) |
| `'gantt'` | 간트 단독 | GanttChart |
| `'kanban'` | 상태별 칸반 | (Kanban 컴포넌트) |
| `'mindmap'` | 마인드맵 | (관리자 전용) |
| `'projects'` | 프로젝트 관리 페이지 | |
| `'allocation'` | 인원별 투입현황 | **현재 일괄 숨김 (v0.4.155)** |

### 7.2 view 숨김 규칙

[src/App.tsx](src/App.tsx) `hiddenViews`:
- `VITE_HIDDEN_VIEWS` 환경변수로 기본 숨김 가능.
- **`'allocation'`은 모든 사용자에게 일괄 숨김** (관리자 포함).
- 비관리자에게 `'mindmap'` 추가 숨김.
- `useEffect` 가드가 숨겨진 view 진입 시 자동으로 `'table'`로 리다이렉트.

### 7.3 표+간트 split view

```
list-split-view (flex flex-row h-full)
├─ list-table-pane (h-full, width: wbsTableWidth%)
│   └─ WBSTable (fillHeight={true})           ← 표 본문은 flex-1 min-h-0
│       ├─ SummaryBar (toolbar)
│       ├─ split header (overflow-x-auto)     ← 가로 스크롤바 위쪽
│       └─ body (overflow-auto)               ← 내부에 가로·세로 스크롤바
└─ list-gantt-pane (h-full, width: rest%)
    └─ GanttChart (hideSidebar=true, topSpacerHeight=sharedRowHeight)
        ├─ control bar
        ├─ header (overflow-x-auto)           ← 가로 스크롤바 위쪽
        ├─ body (overflow-y-auto)             ← 세로만, 가로는 헤더·하단 별도 바와 동기화
        └─ bottom scroll bar (12px)
```

**동기화**:
- 세로 scrollTop: [useScrollSync](src/hooks/useScrollSync.ts) 훅이 양쪽 ref에 scroll 이벤트 리스너 달아 미러링.
- 가로 scrollLeft: 간트 내부에서 `headerScrollRef ↔ syncScrollRef(body) ↔ bottomScrollRef` 3-way 동기화.
- 행 정렬: 표의 sticky [+ 새 작업 추가] 행과 동일 높이의 sticky `topSpacerHeight`를 간트에도 두어 시각적 정렬 맞춤.

---

## 8. 영속화 3-Tier (localStorage → IndexedDB → Supabase)

### 8.1 로컬 저장

[src/lib/persist.ts](src/lib/persist.ts):
- `localStorage`가 우선. 용량 초과/실패 시 `idb-keyval` 기반 IndexedDB로 폴백.
- 키 예: `wbs.projects.v1`, `wbs.allTasks.v1`, `wbs.settings.v1`, `wbs.currentProjectId`, `wbs.expandedTaskIds.{projectId}`.
- 저장은 모든 변경 후 1초 디바운스(`persistDebounceRef`).

### 8.2 Cloud 동기화

[src/lib/db/sync.ts](src/lib/db/sync.ts) + [src/lib/db/mappers.ts](src/lib/db/mappers.ts):

| 함수 | 역할 |
|---|---|
| `syncWithDb(scope, onProgress, opts)` | **양방향**: 로컬 미동기 변경 업로드 → 서버 최신 다시 받아 로컬 교체. 토스트로 결과 표시. |
| `pushChangesToDb(scope)` | **단방향**: 업로드만. 실시간 협업 자동 저장에서 사용. |
| `projectNeedsDbUpload(local, server)` | 프로젝트 메타 차이 비교 (`updated_at` 또는 fingerprint). |
| `collectTasksNeedingUpload(...)` | 변경된 작업만 추려 업로드 페이로드 구성. |
| `serverTaskRowMatchesLocalTask(...)` | 동시 수정 감지(낙관적 잠금) — 서버 `updated_at`이 로컬 기준치보다 새로우면 conflict. |

**디바운스 자동 저장**: 편집 시 `bumpDirty()` → `collabPushNonce` 증가 → App.tsx의 useEffect가 ~1초 디바운스로 `pushChangesToDb('current')` 호출.

### 8.3 Realtime

[src/hooks/usePresence.ts](src/hooks/usePresence.ts) + Supabase Realtime channel:
- `presenceOthers`: 같은 프로젝트를 보고 있는 다른 사용자(아바타·색상) 표시.
- `postgres_changes` 구독으로 `projects`/`tasks`/`wbs_settings` row 변경 수신 → 로컬 즉시 반영(=다른 사람의 편집이 화면에 흘러옴).

### 8.4 Backup (수동)

JSON 풀백업/복원·머지: [src/context/hooks/useBackupOps.ts](src/context/hooks/useBackupOps.ts) + [src/lib/export.ts](src/lib/export.ts).

---

## 9. 핵심 비즈니스 로직

### 9.1 일정 자동 산정 — [src/lib/schedule.ts](src/lib/schedule.ts)

- **공수 단위**: 프로젝트별 `workEffortUnit` (minute/hour/day/week). 내부 스케줄링은 모두 MD(Man-Day)로 환산. 100% 투입 1MD = 1 영업일.
- **`computeEndDateFromEffort(startDate, workEffort, assignments, holidays)`**: 시작일 + 공수 + 투입비율 → 종료일(영업일). 토·일·한국 공휴일 제외.
- **`getTopologicalOrder(tasks)`**: 의존성 그래프 위상 정렬. 순환 시 best-effort.
- **`refreshProjectSchedule(projectId)`**: 선행관계·기간을 반영해 프로젝트 일정을 앞당기도록 재계산.
- **`getCriticalPathTaskIds(tasks)`**: 표시 토글 시에만 계산(`showCriticalPath`).
- **`userLockedFields`**: 사용자가 직접 잠근 필드는 자동 산정에서 제외.

### 9.2 부모 작업 롤업 — [src/lib/rollups.ts](src/lib/rollups.ts)

- **`syncParentRollups(allTasks, parentId, doneStatusIds, forceProgress, excludeParentIds)`**: 자식이 변경되면 부모의 `startDate=min(children)`, `endDate=max(children)`, `progress=가중평균(weight 또는 workEffort 기반)`을 재계산해 조상까지 재귀.
- `excludeParentIds`: 사용자가 막 편집한 부모는 자식 min/max로 덮어쓰지 않고 조상 롤업만 진행.
- 상태가 'done'인 부모는 자식 진척률로 덮어쓰지 않고 100% 유지.

### 9.3 진척률·상태 연동

`WBSSettings.linkStatusAndProgress = true`(기본)일 때:
- `statusConfigs[i].progress`를 기준으로 상태 변경 시 진척률 동기화.
- 사용자가 `userLockedFields`에 `'progress'`를 추가하면 잠금.

### 9.4 워크로드 — [src/lib/workload.ts](src/lib/workload.ts)

- 인원별 일별 부하(여러 작업의 투입비율 합).
- 100% 초과 시 `OverloadWarningModal`에서 (a) 기간 연장 / (b) 투입율 증가 전략 선택.

### 9.5 WBS 번호 생성 — [src/lib/taskView.ts](src/lib/taskView.ts)

- 트리 순서대로 "W1, W1.1, W1.1.1, T1.1.1.1" 형태 번호 생성. 접두사는 `WBSSettings.level{N}Prefix`.
- `wbsMap` (id → 번호) / `displayWbsMap` (번호 + 가시 위치 표기) 두 가지.

---

## 10. UI 패턴

### 10.1 헤더 — [src/components/AppHeader.tsx](src/components/AppHeader.tsx)

- 좌측: 로고·프로젝트 선택 드롭다운(그룹화·즐겨찾기 가능).
- 중앙: View 네비게이션 버튼(`hiddenViews` 미포함만 표시).
- 우측: 알림 벨 슬롯 · `...` 메뉴 · "새 작업" · 계정 메뉴.
- **`...` 메뉴 섹션**: 조직 → 데이터(가져오기/보내기) → 설정(환경설정/단축키/권한 안내) → 관리자 기능(회원관리/변경이력) → 부분/전체 삭제.

### 10.2 모달 시스템

[src/hooks/useModalStates.ts](src/hooks/useModalStates.ts)에서 모든 모달의 open/close state를 한 곳에 모아 관리. App.tsx에서 props로 분배. 패턴:
```tsx
<div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
<div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] ...">
```

### 10.3 권한 게이팅 컨벤션

**관리자 전용 UI는 `effectiveIsAdmin`으로만 게이팅** (회원 체험 모드 자동 적용). `isAdmin` 직접 사용 금지. 편집 기능은 `canEditCurrentProject` 사용.

### 10.4 F2 · 더블클릭 · 셀 클릭의 편집 진입

- 모두 [src/components/hooks/useWbsTableKeyboard.ts](src/components/hooks/useWbsTableKeyboard.ts) + [src/components/SortableTaskRow.tsx](src/components/SortableTaskRow.tsx)의 `beginEdit`에서 `canEdit` prop 체크. 권한 없으면 무시.

### 10.5 가상 스크롤 + 줄바꿈

`@tanstack/react-virtual`로 표·간트 행 가상화. `wrapTextInCells=true`면 행별 실제 높이를 측정해 표·간트 동기화(`rowHeights[]` prop).

---

## 11. 주요 파일 맵

```
src/
├─ main.tsx                              ─ 엔트리(Provider 트리)
├─ App.tsx                               ─ View 라우팅 · 권한 계산 · 모달 wiring
├─ types.ts                              ─ Project/Task/Filter 도메인 타입
├─ context/
│  ├─ AuthContext.tsx                    ─ Supabase 세션·OTP
│  ├─ OrganizationContext.tsx            ─ 조직도(부서) 캐시
│  ├─ LevelColorsContext.tsx             ─ 사용자 정의 레벨 색상
│  ├─ WBSContext.tsx                     ─ 메인 상태 컨테이너
│  ├─ wbsContextTypes.ts                 ─ 컨텍스트 타입 정의
│  └─ hooks/
│     ├─ useProjectOps.ts                ─ 프로젝트 CRUD
│     ├─ useTaskOps.ts                   ─ 작업 CRUD + 일정·베이스라인
│     ├─ useTaskMovement.ts              ─ 이동·들여쓰기·접기
│     └─ useBackupOps.ts                 ─ 백업·복원·머지·초기화
├─ hooks/
│  ├─ useWbsHistory.ts                   ─ Undo/Redo 50단계
│  ├─ useScrollSync.ts                   ─ 표↔간트 세로 스크롤 동기
│  ├─ usePresence.ts                     ─ Supabase Realtime presence
│  ├─ useModalStates.ts                  ─ 모든 모달 open state
│  ├─ useFileImportExport.ts             ─ Excel/JSON I/O 핸들러
│  └─ useAppKeyboardShortcuts.ts         ─ 전역 단축키
├─ lib/
│  ├─ supabase.ts                        ─ 클라이언트 + Row 타입
│  ├─ db/
│  │  ├─ sync.ts                         ─ 양방향 동기화 로직
│  │  └─ mappers.ts                      ─ snake_case ↔ camelCase
│  ├─ schedule.ts                        ─ 일정 자동 산정·CPM
│  ├─ rollups.ts                         ─ 부모 작업 롤업
│  ├─ workload.ts                        ─ 인원별 부하·과부하
│  ├─ taskView.ts                        ─ WBS 번호·visibleTasks
│  ├─ calendar.ts                        ─ 한국 공휴일·영업일
│  ├─ workEffortUnits.ts                 ─ 공수 단위 환산
│  ├─ wbsSettings.ts                     ─ 설정 기본값·파싱
│  ├─ persist.ts                         ─ localStorage + IDB 폴백
│  ├─ export.ts                          ─ 백업 JSON 포맷
│  └─ excel.ts                           ─ XLSX import/export
└─ components/
   ├─ AppHeader.tsx                      ─ 헤더 전체
   ├─ Dashboard.tsx                      ─ 대시보드 (요약·이슈·부서별·필터)
   ├─ WBSTable.tsx                       ─ 표 본체
   ├─ GanttChart.tsx                     ─ 간트 본체
   ├─ Gantt/                             ─ 간트 서브 컴포넌트(헤더·그리드·줌)
   ├─ SortableTaskRow.tsx                ─ 표 행 (DnD + 편집)
   ├─ PermissionGuideModal.tsx           ─ 권한 안내 모달
   ├─ MembersModal.tsx                   ─ 회원 관리(관리자)
   ├─ ShareModal.tsx                     ─ 프로젝트 공유
   ├─ ProjectModal.tsx                   ─ 프로젝트 생성·수정
   ├─ TaskModal.tsx                      ─ 작업 상세 편집
   ├─ ExportModal.tsx / BackupRestoreModal.tsx  ─ 데이터 입출력
   ├─ WBSSettingsModal.tsx               ─ 환경설정
   ├─ AuditLogModal.tsx                  ─ 변경 이력 (관리자)
   ├─ OrganizationModal.tsx              ─ 조직 현황
   ├─ AIAnalysisModal.tsx / WeeklyReportModal.tsx  ─ AI·주간보고
   ├─ TutorialModal.tsx                  ─ react-joyride 투어
   └─ OverloadWarningModal.tsx           ─ 과부하 자동 수정
```

---

## 12. 중요한 불변식·주의사항

1. **`canEditCurrentProject`는 컨텍스트 안에서 계산되지만, `editableProjectIds` 자체는 외부(App.tsx)에서 RPC로 받아 주입한다.** 새 멤버 추가 후 ID 목록 갱신을 깜빡하면 RLS는 통과하는데 UI가 잠겨 보이는 불일치 발생 가능 → visibilitychange/focus 시 재조회 로직 있음.

2. **`userLockedFields`는 자동 산정·롤업·AI 갱신의 무기 회로 차단기**. 신규 자동 갱신 로직을 추가할 때 반드시 이 필드를 확인할 것.

3. **`syncParentRollups`는 재귀적이며 부모 변경 후 즉시 호출되어야 한다.** 빠뜨리면 부모 일정이 자식과 어긋난 채 저장됨 → 사용자가 다음 편집 때 혼란.

4. **세로 스크롤 동기화는 양쪽 컨테이너의 `scrollTop_max`가 같아야 정확하다.** 표·간트 split view에서 한쪽이 더 길면 scroll 끝에서 어긋남 — 양쪽 body가 같은 `flex-1 min-h-0` + 같은 toolbar/header 높이를 갖도록 유지해야 한다 (v0.4.153~에서 정렬).

5. **`memberPreview`(체험 모드)는 sessionStorage에 보관.** 페이지 새로고침은 유지, 새 탭에서는 초기화.

6. **`pushChangesToDb`는 디바운스되지만, 명시적 동기화(`syncWithDb`)는 진행률 콜백을 제공한다.** UI에서 둘을 혼동하지 말 것.

7. **삭제는 즉시 로컬에서 반영되지만 DB 반영은 별도 큐(`deletedTaskIdsByProject`, `deletedProjectIds`)에 쌓여 다음 push 때 함께 처리됨.**

8. **`'all'` 가상 프로젝트는 편집 불가.** `canEditCurrentProject`가 항상 false. 모든 프로젝트의 작업을 한 화면에 보기 위한 보기 전용 모드.

9. **관리자 가시 UI는 항상 `effectiveIsAdmin`으로**. 직접 `isAdmin`을 쓰면 회원 체험 모드에서 노출 사고 발생.

10. **'allocation' view는 v0.4.155부터 일괄 숨김**. 다시 살리려면 [src/App.tsx](src/App.tsx) `hiddenViews`에서 `set.add('allocation');` 줄을 제거.

---

## 13. 외부 의존성·환경변수

| 변수 | 용도 | 필수 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | ✅ (없으면 로컬 전용 모드) |
| `VITE_SUPABASE_ANON_KEY` | Supabase 익명 키 | ✅ |
| `VITE_HIDDEN_VIEWS` | 콤마 구분 view id (예: `"dashboard,allocation"`) | ❌ |
| `VITE_OPENAI_API_KEY` (또는 유사) | AI 분석·주간보고 | ❌ |

`.env` 미설정 시 [src/lib/supabase.ts](src/lib/supabase.ts)가 `isSupabaseConfigured=false`로 동작, 모든 DB 호출을 no-op 처리하고 순수 로컬 상태로 굴러간다.

---

## 14. 빌드·릴리즈 흐름

1. `npm run dev` — Vite dev server (HMR).
2. 커밋 시 husky + lint-staged가 prettier + eslint --fix 적용 후 자동으로 `package.json` 패치 버전 bump + `CHANGELOG.md` 항목 추가 + `version.txt` 갱신 (pre-commit 훅).
3. `npm run build` — Vite production build → `dist/`.
4. 헤더 우측에서 `appVersion` / `appCommitDate`로 빌드 정보 노출.

---

## 15. 알려진 가정·한계

- **단일 조직 전제**: 멀티테넌트 분리 없음. 모든 사용자가 같은 Supabase 프로젝트 = 같은 데이터 베이스를 공유한다.
- **모바일 미지원**: 반응형은 어느 정도 되지만, 데스크톱 표+간트 split view가 핵심 사용 시나리오.
- **CPM은 표시만 자동, 자원 평준화는 수동**: `fixOverload`로 항목별 수동 선택.
- **PPT/Word 매뉴얼 생성기는 별도 Python 스크립트**(저장소에 동봉, 본 앱과 무관).

---

> 본 문서는 코드와 코드 동작이 어긋날 때 코드 우선. 어긋난 부분을 발견하면 본 문서를 갱신해 단일 기준으로 유지.
