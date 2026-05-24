# 성능 리팩토링 감사 보고서

> 작성일: 2026-05-23
> 범위: `src/` 전체 (components 63 · lib 36 · context 4 · hooks 9 · 약 48,500 LOC)
> 방법: 영역별 정적 코드 감사 (런타임 프로파일링 없음). 코드 수정 없음 — **계획 문서**.
> 목적: 성능 관점의 핫스팟·구조 문제를 파일·라인 단위로 식별하고, 단계별 실행 계획을 수립.

---

## 0. TL;DR

| # | 가장 큰 병목 | 1줄 요약 | 영향 |
|---|--------------|----------|------|
| 1 | `SortableTaskRow`가 `useWBS()`/`useOrganization()`/`useLevelColors()`를 **행마다 직접 구독** | 작업 1건 수정 시 가시 행 수백 개가 모두 리렌더됨 (`React.memo` 무력화) | **매우 높음** — WBS 표 인터랙션 체감 지연의 1차 원인 |
| 2 | `WBSContext`가 50+ 필드를 **단일 value 객체**로 노출 + ops 훅 반환 객체가 매 렌더 새 객체 | Provider memoization이 사실상 동작 안 함 → 거의 모든 편집이 전역 리렌더 트리거 | **매우 높음** |
| 3 | `rollups.ts` / `schedule.ts`가 task 1건 변경에도 **프로젝트 전체** 재계산 + 새 `Task[]` 배열 반환 | task 편집마다 O(n) 메모리 churn + React 식별성 깨짐 | **높음** |
| 4 | `Dashboard.tsx`(2,978 LOC)에서 프로젝트별로 `allTasks.filter` 반복 → O(P×T) | 프로젝트·작업 많아질수록 대시보드 마운트 비용 폭발 | **높음** |
| 5 | `GanttChart`/`KanbanBoard`/`MembersModal`이 가상화 없이 수백~수천 행 직접 렌더 | 스크롤·DnD 프레임 드랍 | **높음** |

**가장 ROI가 큰 첫 PR**: `WBSContext` 4-way split + 컨텍스트 의존 ops 훅 반환값 `useMemo` 안정화 + `SortableTaskRow`에서 context 구독 제거. 이 셋만으로 인터랙티브 지표 대부분 개선 가능.

---

## 1. 코드베이스 현황

### 1.1 LOC 상위 컴포넌트 (>1,000 LOC)

| LOC | 파일 |
|-----|------|
| 2,978 | `src/components/Dashboard.tsx` |
| 2,019 | `src/components/WBSTable.tsx` |
| 1,712 | `src/components/SortableTaskRow.tsx` |
| 1,564 | `src/components/MindMapView.tsx` |
| 1,427 | `src/components/AppHeader.tsx` |
| 1,415 | `src/components/TaskModal.tsx` |
| 1,318 | `src/components/MembersModal.tsx` |
| 1,301 | `src/components/ProjectsPage.tsx` |
| 1,270 | `src/components/GanttChart.tsx` |
| 1,124 | `src/components/DashboardPersonAllocationSection.tsx` |
| 1,097 | `src/components/DashboardDetailPage.tsx` |
| 1,088 | `src/components/WeeklyReportModal.tsx` |
| 1,074 | `src/components/WBSSettingsModal.tsx` |
| 1,052 | `src/components/KanbanBoard.tsx` |

각 파일이 단일 책임을 넘어 **데이터 fetch + 파생 계산 + UI + 핸들러 + 모달 관리**를 한꺼번에 들고 있어, 메모이제이션·테스트·재사용이 모두 어렵습니다.

### 1.2 컨텍스트 구독 분포

| Context | Provider value `useMemo` | 노출 필드 수 | 핵심 문제 |
|---------|--------------------------|--------------|-----------|
| `WBSContext` | ✅ 있음 | **50+** | sub-ops 훅 반환 객체가 매 렌더 새 객체 → `useMemo` deps 항상 invalidate |
| `OrganizationContext` | ✅ 있음 | 6 | 트리·멤버 단일 컨텍스트 (대부분 소비자는 멤버만 필요) |
| `AuthContext` | ❌ **없음** | 12+ | 매 렌더 새 객체 |
| `LevelColorsContext` | ❌ **없음** | 7 | 매 렌더 새 객체 (행 컴포넌트가 구독) |

---

## 2. 영역별 핵심 발견

### 2.1 Components

#### 컨텍스트 구독·메모이제이션 (Highest impact)

- **`SortableTaskRow.tsx:320`** — `React.memo`로 감쌌으나 내부에서 `useWBS()`/`useOrganization()`/`useLevelColors()` 3중 구독. memo의 props 비교가 통과해도 컨텍스트 변경이 리렌더를 강제. → **수백 행 동시 리렌더**.
- **`Dashboard.tsx:177,288`**, **`DashboardPersonAllocationSection.tsx:272-273`**, **`KanbanBoard.tsx:133`**, **`GanttChart.tsx:73-74`**, **`FilterBar.tsx:52`**, **`TaskModal.tsx:146-147`** — 동일하게 전체 컨텍스트 구독.
  - 특히 `DashboardPersonAllocationSection`은 부모(`Dashboard`)가 이미 `projects`/`allTasks`를 props로 전달하면서 자식이 또 `useWBS()`를 호출 — **이중 구독**.

#### 인라인 객체/함수/배열 (memo 무력화 패턴)

- **`WBSTable.tsx:1258`** — `<SortableContext items={tasksForRender.map((t) => t.id)}>`. 매 렌더 새 배열.
- **`WBSTable.tsx:1277-1280`** — `onSetRowAnchor={(id) => { ... }}` 행마다 새 함수 prop.
- **`KanbanBoard.tsx:507`** — 컬럼별 `items={tasks.map((t) => t.id)}`.
- **`DashboardPersonAllocationSection.tsx:917`** — 행마다 `assignedProjectIds={new Set(items.map((i) => i.project.id))}`.
- **`ExcelGrid.tsx:135-159`** — AgGrid props (`defaultColDef`, `onCellValueChanged`)가 인라인 → AgGrid 내부 비교 매번 실패.
- **`GanttChart.tsx:1018-1022,1122`** — 사이드바 행마다 `style={{ ... }}` + `onDoubleClick={() => ...}`.

#### 가상화 누락 (High impact)

- **`GanttChart.tsx:1011-1033, 1086-1174`** — split view는 가상화하지만 standalone 사이드바·차트 본문은 `visibleTasks.map` 전체 DOM. 500+ 작업 프로젝트에서 즉시 체감.
- **`KanbanBoard.tsx:507-520`** — 컬럼당 카드 전체 렌더 + DnD context.
- **`MembersModal.tsx:752`** — `sortedMembers.map` 전체 tbody.
- **`MindMapView.tsx:1139-1220`** — 모든 노드/엣지 동시 렌더, viewport culling 없음.
- **`WBSTable.tsx:375`** — `shouldVirtualize = ... && !wrapTextInCells` → **줄바꿈 모드에서 가상화 OFF**. 동시에 455-485에서 `ResizeObserver`로 모든 행 측정 → 대형 WBS에서 직격탄.

#### 반복 재계산

- **`Dashboard.tsx:329-331`** — 프로젝트마다 `allTasksForDashboard.filter((t) => t.projectId === project.id)` (O(P×T)).
- **`Dashboard.tsx:716-733`** — division별 동일 패턴 3회 (`done`/`issue`/`assignee`).
- **`ProjectsPage.tsx:231-237`** — 프로젝트마다 `computeProjectAssigneeWorkEffort(allTasks, p.id)`.
- **`DashboardPersonAllocationSection.tsx:854,494`** — 행 렌더마다 `[...workEffort.values()].reduce(...)`.
- **`GanttChart.tsx:682-686`** — 가상화 fallback에서 `effectiveRowHeights.slice(0, i).reduce(...)` per row → O(n²).
- **`FilterBar.tsx:129-137`** — 드롭다운 IIFE 내부에서 매 렌더 `.toLowerCase().includes()`.

#### Effect 위험

- **`WBSTable.tsx:455-485`** — `wrapTextInCells` ON일 때 `querySelectorAll('[id^="task-row-"]')` + `ResizeObserver` 전체 측정.
- **`WBSTable.tsx:662-677`** — `activeTaskId`↔`lastSelectedId` 양방향 sync (`eslint-disable exhaustive-deps`).
- **`Dashboard.tsx:958-997`** — 마운트 시 Supabase RPC + 2 fetch 동기 실행.
- **`VersionManager.tsx:121-130`** — `if (!isOpen) return null` 후 hooks 호출 (`rules-of-hooks` disable).

#### 검색·tooltip 핫패스

- **`SearchModal.tsx:62-104`** — 매 keystroke마다 전체 `projects`+`allTasks`에 `.toLowerCase().includes(q)`. debounce 없음.
- **`SortableTaskRow.tsx:247-259, 41-78`** — 행마다 tooltip 문자열 미리 빌드. hover 시 lazy 가능.

#### Motion 오버헤드

- **`DashboardPersonAllocationSection.tsx:507,868`** — 행마다 `motion.div` 아바타 (애니메이션 prop 없음). 의미 없는 비용.
- **`GanttChart.tsx:1152-1161`** — bar `title` 거대 template string 매 렌더.

### 2.2 Lib

#### 알고리즘 복잡도

| 위치 | 현재 | 개선 후 | 영향 |
|------|------|---------|------|
| `workload.ts:67,146` | `tasks.filter(... !tasks.some(child))` 리프 판별 → **O(n²)** | `buildParentSet(tasks)` 1회 → O(n) | 과부하 검사 핫패스 |
| `rollups.ts:25-121, 423-462` | 변경 task 1건마다 조상마다 `allTasks.filter/find` 풀스캔 | `childrenByParent`/`taskById` 인덱스 + 단일 bottom-up pass | **편집 응답성** |
| `schedule.ts:137` | `sort((a,b) => taskIds.indexOf(a) - …)` | 사전 `topoIndex: Map` | sort O(n log n × n) → O(n log n) |
| `schedule.ts:374-382` | `depthOrder(parentId)` 반복 재귀, memo 없음 | post-order 1회 traversal | — |
| `excel.ts:918-919` | `fillWbs` 재귀마다 children filter | `buildChildrenByParent` | 내보내기 — 빈도 낮음 |

#### 식별성 보존 실패 (caller memo 무효화)

- **`rollups.ts:107-119`** — 변경이 없을 때도 새 `Task[]` 배열 반환 → React `useMemo` 캐시 깨짐 → 다운스트림 줄줄이 재계산.
- **`schedule.ts:408`** — `applyDependencySchedule`도 항상 새 배열.
- **`personAllocations.ts:50-60, 71-96`** — 같은 입력에도 새 row 배열.

#### 단일 task 편집 → 프로젝트 전체 재계산

- `useTaskOps.ts:426-432, 502, 664-673` — 편집마다 `applyDependencySchedule`(전체) + `recomputeProjectRollups`(전체).
- **권장**: dirty Set + ancestor closure만 갱신.

#### 정렬·날짜 파싱

- `actionItemDueFilter.ts:40-44` — sort 비교마다 `parseTaskDueDay` 2회.
- `workload.ts:73-74, 97-108` — 리프×영업일마다 `parseISO` + business-day 재계산.
- `schedule.ts:188-191` — `getCriticalPathTaskIds`에서 노드마다 `parseISO`.

#### 동기화 fingerprint

- `db/sync.ts:13-19, 47, 96` — `JSON.stringify(sort(...))` 풀스캔 비교. 빈도 매우 높음. → incremental hash 권장.

### 2.3 Context · Hooks

#### Sub-hook 반환 객체 불안정 (모든 문제의 뿌리)

**`useProjectOps.ts:349`**, **`useTaskOps.ts:862-875`**, **`useTaskMovement.ts:170-174`**, **`useBackupOps.ts:245-253`**, **`useModalStates.ts:80-137`**, **`useFileImportExport.ts:361-377`**, **`usePresence.ts:124`** — 전부 `return { a, b, c, ... }` 객체 리터럴, `useMemo` 없음.

→ `WBSContext`의 `contextValue` `useMemo`가 매번 invalidate → **모든 `useWBS()` 소비자 매 렌더 리렌더**. 이 한 줄짜리 누락이 컨텍스트 메모이제이션 전체를 무력화.

#### `collabPushNonce`가 context value에 포함 (`WBSContext.tsx:112-116, 1287-1313`)

편집 1회마다 `bumpDirty()` → `collabPushNonce++` → context value 변경 → 전 소비자 리렌더. App 자동저장에만 필요한 신호이므로 ref 또는 별도 EventTarget으로 분리.

#### 단일 거대 WBS Provider

50+ 필드 단일 컨텍스트. 분리 제안:
- `WBSDataContext` — 읽기 전용: `projects`, `allTasks`, `tasks`, `wbsSettings`, `wbsMap`, `displayWbsMap`, `isLoading`
- `WBSActionsContext` — 안정 ref 객체로 모든 mutator
- `WBSUIContext` — `currentProjectId`, `selectedTaskIds`, `activeTaskId`, `treeExpandLevel`
- `WBSSyncContext` — `hasLocalChangesSinceSync`, `syncWithDb`, `pushChangesToDb` (nonce는 ref)

#### History 훅의 cascade

`useWbsHistory.ts:34-40` — 모든 편집마다 `bumpDirty()` + `setCanUndo(true)`. `canUndo`/`canRedo`는 `AppHeader` 한 곳만 보지만 컨텍스트 value에 들어 있어 전 소비자에게 전파됨.

#### Auth · LevelColors `useMemo` 누락

`AuthContext.tsx:141-156`, `LevelColorsContext.tsx:132-140` — value 객체 `useMemo` 없음. 1줄 fix로 즉시 효과.

---

## 3. 우선순위별 실행 계획 (단계별 PR)

각 단계는 **독립 PR**로 머지 가능. 테스트 통과(193/193 유지)와 수동 회귀 시나리오를 함께 갱신.

### Phase 1 — 컨텍스트 메모이제이션 복구 (1~2일, 매우 낮은 위험)

회귀 위험이 거의 없는 "공짜 성능" 작업.

| # | 작업 | 파일 | 수정 라인 |
|---|------|------|-----------|
| 1.1 | `useProjectOps`/`useTaskOps`/`useTaskMovement`/`useBackupOps` 반환 객체 `useMemo` | `src/hooks/useProjectOps.ts:349` 외 4개 | < 30 |
| 1.2 | `useModalStates`/`useFileImportExport`/`usePresence` 반환 `useMemo` | `src/hooks/*.ts` | < 30 |
| 1.3 | `AuthContext` value `useMemo` + 메서드 `useCallback` | `src/context/AuthContext.tsx:141-156, 78-139` | ~80 |
| 1.4 | `LevelColorsContext` value `useMemo` | `src/context/LevelColorsContext.tsx:132-140` | < 20 |

**검증**: 기존 vitest 통과 + 수동 회귀 (편집·undo·redo·자동저장).

### Phase 2 — `collabPushNonce` 분리 (반나절, 낮은 위험)

`WBSContext.tsx:112-116`의 `collabPushNonce`를 ref + 구독 콜백으로 옮기고, App.tsx의 자동저장만 직접 구독. 컨텍스트 value에서 제거.

**효과**: 모든 편집의 전역 리렌더가 1회 줄어듦.

### Phase 3 — `SortableTaskRow` 컨텍스트 구독 제거 (1일, 중간 위험)

`SortableTaskRow.tsx:320, 186-228, 187` 의 `useWBS`/`useOrganization`/`useLevelColors`를 props로 변환:
- `WBSTable`이 한 번 빌드한 `orgMemberLabelByName`/`orgMemberDisplayMetaByName`/`levelBarBg` 등을 props로 전달.
- `tasks`/`projects`/`updateProject`도 필요한 슬라이스만 props로.

**효과**: 작업 1건 수정 시 행 리렌더 수가 "전체 가시 행" → "변경된 행 + 부모 체인"으로 감소. **체감 인터랙션 가장 큰 개선**.

**검증**: WBS 표 인라인 편집·DnD·키보드 이동·확장 토글·대규모 데이터셋 (500 task) 시연.

### Phase 4 — Lib 인덱스화 + 식별성 보존 (2~3일, 중간 위험)

| 작업 | 효과 |
|------|------|
| `workload.ts` 리프 판별 O(n²) → `buildParentSet` | 과부하 검사 즉시 개선 |
| `rollups.ts`에 `childrenByParent`/`taskById` 인덱스 추가 + `recomputeProjectRollups` 단일 bottom-up | task 편집 응답 |
| `rollups.ts`/`schedule.ts`/`personAllocations.ts` 변경 없을 때 입력 배열 참조 유지 | React 다운스트림 캐시 보존 |
| `schedule.ts:137` `indexOf` → `topoIndex: Map` | sort 비용 |
| `actionItemDueFilter.ts` Schwartzian sort | 대시보드 |

**검증**: 기존 vitest + golden test 추가 (편집 전후 task 식별성 보존, 무변경 시 동일 참조).

### Phase 5 — `WBSContext` 4-way split (3~5일, 높은 위험)

`WBSDataContext` / `WBSActionsContext` / `WBSUIContext` / `WBSSyncContext`로 분리.

- 모든 `useWBS()` 호출처를 적절한 hook (`useWBSData`, `useWBSActions`, …)로 마이그레이션.
- 새 hooks는 backwards-compat shim으로 시작 → 점진 전환.

**효과**: 검색 모달·대시보드·헤더 등 읽기 전용 소비자가 mutation에서 격리됨.

**검증**: 전 시나리오 회귀 + 시점별 React Profiler 비교.

### Phase 6 — 가상화 확대 (2~3일, 낮은 위험)

이미 `@tanstack/react-virtual` 설치돼 있음. 같은 패턴 복제:

| 위치 | 변경 |
|------|------|
| `GanttChart.tsx:1011-1033, 1086-1174` | standalone 사이드바·본문도 split view와 동일하게 가상화 |
| `KanbanBoard.tsx:507-520` | 컬럼 내 카드 가상 리스트 (DnD와 호환되는 fixed-size 우선) |
| `MembersModal.tsx:752` | tbody 가상화 또는 페이지네이션 |
| `WBSTable.tsx:375` | 줄바꿈 모드용 variable-size virtualizer |

**검증**: 1000+ 작업·500+ 멤버 fixture로 스크롤·DnD 60fps 확인.

### Phase 7 — Component 분해 (2~3주, 높은 위험)

LOC 상위 컴포넌트를 서브컴포넌트 + 도메인 훅으로 분해. **Phase 1~6이 모두 끝난 뒤** 진행하는 게 안전.

| 컴포넌트 | 분해 제안 |
|----------|-----------|
| `Dashboard.tsx` | `useDashboardProjectStats`, `useDashboardDivisionStats` 훅 + `DashboardIssuesSection`, `DashboardActionItemsSection`, `DashboardMilestonesSection` |
| `WBSTable.tsx` | `WbsTableHeader`, `WbsTableBody`, `useWbsTableVirtualization` |
| `SortableTaskRow.tsx` | `TaskNameCell`, `ProgressCell`, `DepsCell`, `useRowStyle` |
| `MindMapView.tsx` | `MindMapCanvas`, `MindMapToolbar`, `useMindMapLayout` |
| `AppHeader.tsx` | `ProjectSwitcher`, `HeaderToolbar` + props 그룹화 |
| `TaskModal.tsx` | 탭별 서브컴포넌트 + `useTaskForm` |

각 분해는 별도 PR로. 분해 자체가 메모이제이션을 자연스럽게 강화함.

### Phase 8 — 검색·툴팁·모션 청소 (1일, 낮은 위험)

- `SearchModal.tsx:62-104` — query debounce 200ms.
- `SortableTaskRow.tsx:247-259` — tooltip 문자열을 hover 시 lazy 빌드.
- `DashboardPersonAllocationSection.tsx:507,868` — 의미 없는 `motion.div` → `div`.
- `GanttChart.tsx:1152-1161` — bar `title` lazy.

---

## 4. 단일 PR로 즉시 가능한 "Top 10 Quick Wins"

각각 독립 mergeable. 합쳐도 < 1일.

| # | 변경 | 파일 | 노력 | 효과 |
|---|------|------|------|------|
| 1 | sub-ops 훅 반환 `useMemo` | `useProjectOps.ts:349`, `useTaskOps.ts:862-875`, `useTaskMovement.ts:170-174`, `useBackupOps.ts:245-253` | S | **High** |
| 2 | `AuthContext` value `useMemo` | `AuthContext.tsx:141-156` | XS | Med |
| 3 | `LevelColorsContext` value `useMemo` | `LevelColorsContext.tsx:132-140` | XS | Med |
| 4 | `workload.ts` O(n²) 리프 판별 fix | `workload.ts:67,146` | S | **High** |
| 5 | `schedule.ts:137` `indexOf` → `Map` | `schedule.ts:137` | XS | Med |
| 6 | WBSTable `visibleTaskIds`/`onSetRowAnchor` 안정화 | `WBSTable.tsx:1258, 1277-1280` | S | Med |
| 7 | `SearchModal` debounce | `SearchModal.tsx:62-104` | XS | Med |
| 8 | `Dashboard` `tasksByProjectId` 인덱스 + `projectStats`/`divisionStats` 재사용 | `Dashboard.tsx:329-342, 716-733` | S | **High** |
| 9 | `DashboardPersonAllocationSection` `motion.div` → `div` + 행 컴포넌트 추출 + `personTotalMdByName` 메모 | `DashboardPersonAllocationSection.tsx:507, 491-549, 854` | S | Med |
| 10 | `rollups.ts`/`schedule.ts` 변경 없을 때 입력 참조 반환 | `rollups.ts:107-119`, `schedule.ts:408` | S | **High** |

---

## 5. 측정·검증 전략

### 5.1 측정 지표 (제안)

성능 작업의 ROI를 가시화하기 위해 기준치를 먼저 잡습니다.

| 지표 | 측정 방법 | 목표 |
|------|-----------|------|
| WBS 표 인라인 편집 → 다음 입력 가능까지 | React DevTools Profiler (`commit` duration) | 500 task 데이터셋에서 200ms 이하 |
| Dashboard 첫 paint | Performance API + Lighthouse | 1.5s 이하 |
| Gantt 1,000 작업 스크롤 | Chrome DevTools Performance, dropped frames | 60fps 유지 |
| 검색 모달 키 입력 latency | Profiler `Interaction Tracking` | 50ms 이하 |
| 단일 task 편집 시 리렌더 횟수 | React DevTools `Highlight updates when components render` | 변경 행 + ancestor만 |

### 5.2 자동 회귀

- `npm test`(vitest 193개) — 모든 PR에서 통과 유지.
- 새로 추가할 골든 테스트:
  - `rollups.ts` no-op 시 입력 배열 참조 동일 (`expect(out).toBe(in)`).
  - `schedule.ts` no-op 시 동일.
  - `buildParentSet` ↔ 기존 리프 판별 결과 동치성.

### 5.3 수동 회귀 체크리스트

리팩토링 PR마다 확인:
1. 작업 추가·수정·삭제, undo/redo 5회 연속.
2. WBS 표 인라인 편집(이름·진척률·담당자·기간), 행 DnD.
3. 간트 차트 막대 드래그 일정 변경, split view 동기화.
4. 칸반 보드 카드 DnD.
5. 대시보드 필터 토글 + 인원별/프로젝트별 보기 전환.
6. 마인드맵 노드 추가·이동·접기.
7. 자동저장(`hasLocalChangesSinceSync`) 인디케이터.
8. 협업 동시 편집 (Yjs presence).

---

## 6. 위험 신호와 대응

| 위험 | 어디서 | 대응 |
|------|--------|------|
| 컨텍스트 분리로 컴포넌트 회귀 다수 발생 | Phase 5 | `useWBS()` shim 유지 → 점진 전환. 한 번에 몰아치지 않기 |
| 가상화 도입으로 키보드/포커스 깨짐 | Phase 6 | `tabIndex`/`aria-rowindex` 회귀 테스트 추가, 기존 split-view 동작과 비교 |
| 식별성 보존이 mutation 의도와 충돌 | Phase 4 | 변경 시 새 배열 반환, 무변경 시에만 입력 참조 — 명시적 단위 테스트 |
| WBSTable 줄바꿈 모드 가상화 도입 시 행 높이 측정 racing | Phase 6 | `@tanstack/react-virtual`의 `measureElement` + dynamic size 적용, ResizeObserver는 보조용으로만 |

---

## 7. 부록 A — 상세 발견 목록

전체 항목은 본 보고서 §2에 영역별로 정리되어 있습니다.
- **Components**: 11개 카테고리 / 약 60건
- **Lib**: 10개 카테고리 / 약 40건
- **Context · Hooks**: 4개 컨텍스트 + 9개 훅별 분석

각 항목은 `파일:라인` 단위로 인용되어 있어 그대로 PR로 옮기기 좋은 형태입니다.

## 8. 부록 B — 후속 작업 제안

이번 감사는 **성능**에 한정되었습니다. 별도 사이클이 필요한 영역:

- **타입 안전성** — `any` 사용 위치, strict 옵션 강화 가능성
- **테스트 커버리지** — 현재 lib 위주, 컴포넌트 인터랙션 테스트 부족
- **번들 크기** — `xlsx`, `ag-grid`, `motion` 등 lazy load 후보
- **접근성** — 가상화·DnD 도입 시 함께 점검

---

> 이 문서는 정적 감사 결과입니다. 실제 PR 진행 전에 **§5.1의 기준치를 먼저 측정**해 두면 각 단계의 효과를 정량적으로 보고할 수 있습니다.
