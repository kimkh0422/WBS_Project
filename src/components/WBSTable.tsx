import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useWBS } from '../context/WBSContext';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatPercent1, round2 } from '../lib/utils';
import { isTaskColumnMissingFromDb } from '../lib/db/tasks';
import { getUseWeightForProgressRollup, setUseWeightForProgressRollup, onProgressRollupOptionChange } from '../lib/rollupOptions';
import { computeTreeGuideStrings } from '../lib/treeGuides';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  X,
  CornerDownRight,
  Settings2,
  RefreshCw,
  Eye,
  EyeOff,
  RotateCcw,
  Unlink,
  Link2,
  Edit2,
  Equal,
  Trash2,
  GitBranch,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import { type TableColumnId, type TableDisplayColumnId, type WBSTableProps } from './wbsTableTypes';
import { useWbsTableKeyboard, getWbsTableCopyPlainText } from './hooks/useWbsTableKeyboard';
import { useRealtimeCellFocus } from './hooks/useRealtimeCellFocus';
import { useColumnResize, COLUMN_HEADER_LABELS } from './hooks/useColumnResize';
import { useWbsSummaryStats } from './hooks/useWbsSummaryStats';
import { useWbsBulkEdit } from './hooks/useWbsBulkEdit';
import { useWbsSelection } from './hooks/useWbsSelection';
import { useWbsDragDrop } from './hooks/useWbsDragDrop';
import { HeaderCell, PROGRESS_COLUMN_HELP_TEXT, WEIGHT_COLUMN_HELP_TEXT } from './WBSTable/HeaderCell';
import { SummaryBar } from './WBSTable/SummaryBar';
import { CellFormatToolbar } from './WBSTable/CellFormatToolbar';
import { SortableTaskRow } from './SortableTaskRow';
import type { Project, Task } from '../types';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { buildParentSet, buildVisibleTasks } from '../lib/taskView';
import { buildMarkdownFromTasks, parseMarkdownTable } from '../lib/export';
import { useToast } from './Toast';
import { getCriticalPathTaskIds } from '../lib/schedule';
import { useAuth } from '../context/AuthContext';
import { useOrganization } from '../context/OrganizationContext';
import { buildAssigneeCandidates, buildOrgMemberLabelMap, buildOrgMemberDisplayMetaMap, formatPersonDisplay } from '../lib/assigneeOptions';
import {
  buildProjectEffortUnitMap,
  DEFAULT_NEW_TASK_WORK_EFFORT,
  defaultEndDateForNewTask,
  normalizeWorkEffortUnit,
  workEffortUnitSuffixKo,
} from '../lib/workEffortUnits';
import { computePlannedProgressMap } from '../lib/plannedProgress';
import { buildWbsImprovementGuide } from '../lib/wbsImprovementGuide';
import { commitWbsInlineNameEditFromDom } from '../lib/wbsInlineNameCommit';
import { pasteClipboardTasks } from '../lib/wbsClipboard';
import { useWbsTableAutoFormatting } from '../hooks/useWbsTableAutoFormatting';
import { getSingleClickEdit, setSingleClickEdit, subscribeSingleClickEditChanged } from '../lib/wbsTableDisplayPrefs';
import { lazyWithRetry } from '../lib/lazyWithRetry';

// 첫 화면(표) 진입 경로에서 분리 — 사용자가 열 때만 로드한다.
// 특히 TaskModal은 tiptap + yjs(협업 에디터)를 동반하므로 분리 효과가 가장 크다.
// lazyWithRetry: 배포 직후 옛 청크 해시를 가져오다 실패하면 1회 자동 새로고침으로 새 번들 회수.
const TaskModal = lazyWithRetry(() => import('./TaskModal').then((m) => ({ default: m.TaskModal })));
const MdEditModal = lazyWithRetry(() => import('./MdEditModal').then((m) => ({ default: m.MdEditModal })));
const WbsImprovementGuideModal = lazyWithRetry(() =>
  import('./WbsImprovementGuideModal').then((m) => ({ default: m.WbsImprovementGuideModal })),
);
const ExcelGrid = lazyWithRetry(() => import('./ExcelGrid').then((m) => ({ default: m.ExcelGrid })));
const ForkTaskToProjectModal = lazyWithRetry(() => import('./ForkTaskToProjectModal').then((m) => ({ default: m.ForkTaskToProjectModal })));
type ForkTaskToProjectInputT = import('./ForkTaskToProjectModal').ForkTaskToProjectInput;

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

const DEFAULT_TABLE_COLUMNS: {
  id:
    | 'wbsId'
    | 'name'
    | 'startDate'
    | 'endDate'
    | 'workEffort'
    | 'weight'
    | 'assignee'
    | 'allocation'
    | 'status'
    | 'progress'
    | 'plannedProgress'
    | 'progressVariance'
    | 'deliverables'
    | 'dependencies'
    | 'actions';
  visible: boolean;
}[] = [
  { id: 'wbsId', visible: false },
  { id: 'name', visible: true },
  { id: 'startDate', visible: true },
  { id: 'endDate', visible: true },
  { id: 'workEffort', visible: true },
  { id: 'weight', visible: true },
  { id: 'assignee', visible: true },
  { id: 'allocation', visible: false },
  { id: 'status', visible: true },
  { id: 'plannedProgress', visible: true },
  { id: 'progress', visible: true },
  { id: 'progressVariance', visible: true },
  { id: 'deliverables', visible: false },
  { id: 'dependencies', visible: false },
  { id: 'actions', visible: false },
];

export function WBSTable({
  filters,
  sortConfig,
  onSort,
  syncScrollRef,
  splitHeaderScrollRef,
  rowHeight: propRowHeight,
  onRowHeightChange,
  onRowHeightsChange,
  syncRowHeights,
  hotkeysEnabled = true,
  onOpenColumnSettings,
  fillHeight = false,
  autoFitColumnsOnMount = false,
  onResetFilters,
  scrollToTaskId,
}: WBSTableProps) {
  const {
    tasks,
    projects,
    currentProjectId,
    toggleExpand,
    expandToLevel,
    treeExpandLevel,
    setTreeExpandLevel,
    deleteTask,
    updateTask,
    updateTasksBulk,
    addTask,
    moveTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    wbsSettings,
    updateWbsSettings,
    wbsMap,
    displayWbsMap,
    selectedTaskIds: sharedSelectedTaskIds,
    setSelectedTaskIds: setSharedSelectedTaskIds,
    activeTaskId,
    setActiveTaskId,
    refreshProjectSchedule,
    canEditCurrentProject,
    moveTaskRootsSibling,
    linkSequentialPredecessors,
    updateProject,
    forkTaskToProject,
    setCurrentProjectId,
  } = useWBS();

  const { push: pushToast } = useToast();
  const { user } = useAuth();
  const { orgMembers } = useOrganization();
  const currentUserId = user?.id ?? '';
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const currentUserDisplayName = useMemo(() => {
    const raw = String(user?.user_metadata?.full_name ?? user?.email ?? '').trim() || '(이름 없음)';
    if (raw === '(이름 없음)') return raw;
    return formatPersonDisplay(raw, { orgMetaByName: assigneeDisplayMetaByName }) || raw;
  }, [user, assigneeDisplayMetaByName]);
  /** 다중 선택 일괄 수정 바의 담당자 후보 (조직 회원 + 모든 프로젝트 등록 인원 + 작업 담당자 통합) */
  const bulkAssigneeCandidates = useMemo(() => buildAssigneeCandidates({ orgMembers, projects, tasks }), [orgMembers, projects, tasks]);
  const bulkAssigneeLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);

  const projectAssignmentsByProjectId = useMemo(() => new Map(projects.map((p) => [p.id, p.assignments ?? []])), [projects]);
  const projectScheduleByProjectId = useMemo(() => {
    const m = new Map<string, Pick<Project, 'startDate' | 'endDate'>>();
    for (const p of projects) {
      m.set(p.id, { startDate: p.startDate, endDate: p.endDate });
    }
    return m;
  }, [projects]);
  const projectEffortUnitByProjectId = useMemo(() => buildProjectEffortUnitMap(projects), [projects]);
  const criticalPathSet = useMemo(() => {
    try {
      const set = getCriticalPathTaskIds(tasks, projectAssignmentsByProjectId, projectEffortUnitByProjectId);
      return set instanceof Set ? set : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, [tasks, projectAssignmentsByProjectId, projectEffortUnitByProjectId]);
  const showCriticalPath = wbsSettings?.showCriticalPath === true;
  const wrapTextInCells = wbsSettings?.wrapTextInCells === true;
  const { showTableAutoFormatting, globalAutoFormattingOn, toggleUserHide } = useWbsTableAutoFormatting(wbsSettings);
  const effectiveCriticalPathSet = showCriticalPath ? criticalPathSet : EMPTY_CRITICAL_PATH_SET;

  /** 클릭 편집 모드: 켜면 셀 한 번 클릭으로 바로 편집, 끄면(기본) 더블클릭·F2로만 편집. 이 브라우저에만 저장. */
  const [singleClickEdit, setSingleClickEditState] = useState(getSingleClickEdit);
  useEffect(() => subscribeSingleClickEditChanged(() => setSingleClickEditState(getSingleClickEdit())), []);
  const toggleSingleClickEdit = useCallback(() => {
    const next = !getSingleClickEdit();
    setSingleClickEdit(next);
    setSingleClickEditState(next);
  }, []);

  // visibleTasks must be defined early - used by many hooks below
  // preserveDepthOnFiltered: 필터 후에도 레벨(depth)·색상 유지 (간트와 동기화)
  const visibleTasks = useMemo(
    () => buildVisibleTasks(tasks, filters, sortConfig, { preserveDepthOnFiltered: true }),
    [tasks, filters, sortConfig],
  );

  const workEffortHeaderTitle = useMemo(() => {
    const pids = filters.projectIds;
    let singlePid: string | undefined;
    if (currentProjectId !== 'all') singlePid = currentProjectId;
    else if (Array.isArray(pids) && pids.length === 1) singlePid = pids[0];
    if (!singlePid) return '공수';
    const u = normalizeWorkEffortUnit(projects.find((pr) => pr.id === singlePid)?.workEffortUnit);
    return `공수(${workEffortUnitSuffixKo(u)})`;
  }, [currentProjectId, filters.projectIds, projects]);

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  /** 분기된 자식 프로젝트 lookup: 부모 task id → 자식 프로젝트 */
  const forkedProjectsByTaskId = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) {
      if (p.sourceTaskId) m.set(p.sourceTaskId, p);
    }
    return m;
  }, [projects]);
  /** 분기 모달 상태: null이면 닫힘 */
  const [forkTarget, setForkTarget] = useState<{ sourceTask: Task; sourceProject: Project; descendantCount: number } | null>(null);
  // 선택 상태/로직 — extracted to useWbsSelection (called below after tableScrollRef)
  // 스크롤은 rowVirtualizer 선언 후 별도 useEffect에서 처리 (아래 scrollToSelectedTask)

  // Context Menu State (header: columnId = data column; task: columnId = progress | status)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'task' | 'header';
    taskId?: string;
    columnId?: TableColumnId | 'progress' | 'status';
  } | null>(null);

  // Clipboard state for copy-paste
  const CLIPBOARD_KEY = 'wbs-task-clipboard-v1';
  type ClipboardPayloadV1 = { version: 1; copiedAt: string; tasks: Task[] };
  const loadClipboardTasks = (): Task[] => {
    try {
      const raw = localStorage.getItem(CLIPBOARD_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ClipboardPayloadV1;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) return [];
      // Basic shape check
      return parsed.tasks.filter(
        (t) =>
          t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.startDate === 'string' && typeof t.endDate === 'string',
      ) as Task[];
    } catch {
      return [];
    }
  };
  const [copiedTasks, setCopiedTasks] = useState<Task[]>(() => {
    if (typeof window === 'undefined') return [];
    return loadClipboardTasks();
  });

  /** 하단/인라인「새 작업」입력은 제어 컴포넌트로 두어, 제출·프로젝트 전환 후에도 값이 남는 현상을 방지 */
  const [quickAddBottomValue, setQuickAddBottomValue] = useState('');
  const [quickAddInlineValue, setQuickAddInlineValue] = useState('');
  const bottomQuickAddInputRef = useRef<HTMLInputElement>(null);
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null);
  const [inlineAddingTaskId, setInlineAddingTaskId] = useState<string | null>(null);
  /** 엑셀 스타일 — 마지막 데이터 행 아래에 비어 있는 placeholder 행을 미리 표시. ↓로 진입, 클릭/Enter/F2/문자 입력으로 즉시 새 작업 생성 + 인라인 편집. */
  const GHOST_PLACEHOLDER_ROW_COUNT = 5;
  const [ghostFocusIdx, setGhostFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    setQuickAddBottomValue('');
    setQuickAddInlineValue('');
  }, [currentProjectId]);

  useEffect(() => {
    if (inlineAddingTaskId === null) {
      setQuickAddInlineValue('');
    }
  }, [inlineAddingTaskId]);

  // F2 Inline Name Edit state
  const [inlineEditingNameId, setInlineEditingNameId] = useState<string | null>(null);
  const inlineEditingNameIdRef = useRef<string | null>(null);
  inlineEditingNameIdRef.current = inlineEditingNameId;

  const setInlineEditingNameIdCommitted = useCallback(
    (next: string | null) => {
      const prev = inlineEditingNameIdRef.current;
      if (prev && next && prev !== next && canEditCurrentProject) {
        commitWbsInlineNameEditFromDom(prev, tasks, updateTask, canEditCurrentProject);
      }
      setInlineEditingNameId(next);
    },
    [tasks, updateTask, canEditCurrentProject],
  );

  /** 셀 단위 인라인 편집: { taskId, columnId } */
  const [editingCell, setEditingCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);
  /** 전체를 스프레드시트(AG Grid) 뷰로 보는 모드 */
  const [excelView, setExcelView] = useState(false);
  /** 편집 모드에서 키보드로 이동할 때의 현재 셀 (편집 중이 아닐 때) */
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);

  // 엑셀 시트(AG Grid) 뷰로 전환할 때 진행 중인 인라인 편집·셀 포커스를 정리한다.
  useEffect(() => {
    if (excelView) {
      const id = inlineEditingNameIdRef.current;
      if (id && canEditCurrentProject) {
        commitWbsInlineNameEditFromDom(id, tasks, updateTask, canEditCurrentProject);
      }
      setEditingCell(null);
      setInlineEditingNameId(null);
      setFocusedCell(null);
    }
  }, [excelView, tasks, updateTask, canEditCurrentProject]);
  // ─── Realtime: 표 셀 포커스 공유 — extracted to useRealtimeCellFocus ────
  const { otherCellFocus, otherFocusByCellKey, colorForUser } = useRealtimeCellFocus({
    currentProjectId,
    currentUserId,
    currentUserDisplayName,
    editingCell,
    focusedCell,
  });
  /** 편집 버튼 클릭 시 열리는 표-as-MD 편집 모달 */
  const [isMdEditModalOpen, setIsMdEditModalOpen] = useState(false);
  const [mdEditInitialMarkdown, setMdEditInitialMarkdown] = useState('');
  const [improvementGuideOpen, setImprovementGuideOpen] = useState(false);

  // Global list of assignees for datalist autocomplete (bulk edit 등): 프로젝트 투입인원 + 작업 담당자
  const allAssignees = useMemo(() => {
    const fromProjects = projects.flatMap((p) => (p.assignments ?? []).map((a) => a.assignee).filter(Boolean));
    const fromAssignee = tasks.map((t) => t.assignee).filter(Boolean);
    return Array.from(new Set([...fromProjects, ...fromAssignee])).sort();
  }, [projects, tasks]);

  // 프로젝트별 담당자 옵션: 프로젝트 등록 인원 + 해당 프로젝트 작업에 이미 배정된 인원
  const assigneeOptionsByProjectId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of projects) {
      const fromProject = (p.assignments ?? []).map((a) => a.assignee).filter(Boolean);
      const fromTasks = tasks
        .filter((t) => t.projectId === p.id)
        .map((t) => t.assignee)
        .filter(Boolean);
      map.set(p.id, Array.from(new Set([...fromProject, ...fromTasks])).sort());
    }
    return map;
  }, [projects, tasks]);

  // Column resize hook + gridStyle — moved below allocationDisplayByTaskId/taskIdToSeqNum
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  /** 분할(표+간트) 뷰에서 표 본문의 하단 가로 스크롤바 — 헤더·본문과 scrollLeft 동기화. */
  const tableBottomScrollRef = useRef<HTMLDivElement | null>(null);
  /** 스플릿 뷰에서 헤더 가로 스크롤 동기화용 */
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);

  // handleMouseDown + resize useEffect — now in useColumnResize

  const customColumnNameById = useMemo(() => {
    const map = new Map<string, string>();
    const customColumns = Array.isArray(wbsSettings?.customColumns) ? wbsSettings.customColumns : [];
    // 현재 프로젝트의 task에 실제 값이 들어있는 customField id 집합 (글로벌 레거시 컬럼의 표시 여부 판단용)
    const customIdsWithData = new Set<string>();
    if (currentProjectId !== 'all') {
      for (const t of tasks) {
        if (t.projectId !== currentProjectId) continue;
        const cf = t.customFields;
        if (!cf) continue;
        for (const k of Object.keys(cf)) {
          const v = cf[k];
          if (typeof v === 'string' && v.trim().length > 0) customIdsWithData.add(k);
        }
      }
    }
    for (const col of customColumns) {
      if (!col || typeof col.id !== 'string') continue;
      if (col.projectId) {
        // projectId가 있으면 그 프로젝트에서만 보임('all'에선 모두 표시).
        if (currentProjectId !== 'all' && col.projectId !== currentProjectId) continue;
      } else if (currentProjectId !== 'all') {
        // projectId가 없는 레거시(이전 임포트로 글로벌이 된) 컬럼은 현재 프로젝트의 task에 실제 값이 있을 때만 표시.
        // 다른 프로젝트에서 임포트되어 자기 데이터가 없는 컬럼은 자동으로 숨겨진다.
        if (!customIdsWithData.has(col.id)) continue;
      }
      map.set(col.id, (col.name || '').trim() || col.id.replace(/^custom:/, ''));
    }
    return map;
  }, [wbsSettings?.customColumns, currentProjectId, tasks]);

  const tableColumns: { id: TableDisplayColumnId; visible: boolean }[] = useMemo(() => {
    const cols = wbsSettings?.tableColumns;
    const incoming = Array.isArray(cols) && cols.length > 0 ? cols : DEFAULT_TABLE_COLUMNS;

    const allow = new Set<TableDisplayColumnId>(DEFAULT_TABLE_COLUMNS.map((c) => c.id));
    for (const id of customColumnNameById.keys()) allow.add(id as TableDisplayColumnId);
    const seen = new Set<string>();
    const cleaned = incoming
      .filter((c: { id: string; visible: boolean }) => c && typeof c.id === 'string')
      .map((c: { id: string; visible: boolean }) => ({ id: String(c.id) as TableDisplayColumnId, visible: c.visible !== false }))
      .filter((c: { id: TableDisplayColumnId; visible: boolean }) => allow.has(c.id))
      .filter((c: { id: TableDisplayColumnId; visible: boolean }) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    for (const d of DEFAULT_TABLE_COLUMNS) {
      if (!seen.has(d.id)) cleaned.push(d);
    }

    return cleaned.map((c) => (c.id === 'name' ? { ...c, visible: true } : c));
  }, [wbsSettings, customColumnNameById]);

  /** 가중치 진척 롤업 옵션의 React 거울(다른 곳에서 setter를 호출해도 UI 동기화). visibleColumnIds 메모에서 참조하므로 그 앞에 선언. */
  const [useWeightForRollup, setUseWeightForRollupState] = useState<boolean>(() => getUseWeightForProgressRollup());
  useEffect(() => {
    const off = onProgressRollupOptionChange((v) => setUseWeightForRollupState(v));
    return off;
  }, []);
  const toggleUseWeightForRollup = useCallback((v: boolean) => {
    setUseWeightForProgressRollup(v); // localStorage + 이벤트 발행 → WBSContext가 재계산
    setUseWeightForRollupState(v); // 즉시 UI 반영
  }, []);

  const showActionsColumn = useMemo(() => tableColumns.some((c) => c.id === 'actions' && c.visible), [tableColumns]);
  // 가중치 토글(OFF)이면 표에서 'weight' 컬럼도 함께 숨김(자동) — 진척률 롤업에 안 쓰이는 값이라 화면도 같이 정리.
  // 토글 ON(기본)으로 돌리면 자동으로 다시 표시됨. 사용자의 컬럼 visibility 설정은 보존되며 토글이 ON일 때만 적용된다.
  const visibleColumnIds = useMemo(
    () =>
      tableColumns
        .filter((c) => c.visible && c.id !== 'actions')
        .filter((c) => useWeightForRollup || c.id !== 'weight')
        .map((c) => c.id as TableColumnId),
    [tableColumns, useWeightForRollup],
  );
  /** 편집 모드에서 좌우 이동 시 사용할 편집 가능 컬럼 순서 (wbsId 제외) */
  const editableColumnIds = useMemo(() => visibleColumnIds.filter((id) => id !== 'wbsId') as TableColumnId[], [visibleColumnIds]);

  // gridStyle — moved below useColumnResize hook call

  // Bulk Edit State + executors — extracted to useWbsBulkEdit (declared below after useWbsSelection)

  // Row height (density): 부모에서 rowHeight 전달 시 동기화, 없으면 자체 state
  const [rowHeightState, setRowHeightState] = useState<number>(20);
  const rowHeight = propRowHeight ?? rowHeightState;

  /** 계획율 기준일(YYYY-MM-DD): 표·요약의 모든 계획율(%)·차이(%P)를 이 날짜 기준으로 산정.
   *  - 기본값: 오늘(localStorage에 저장된 값 우선) — 사용자가 입력 시 그 날짜로 즉시 재계산
   *  - 빈 값('') = "오늘 자동" 모드(매일 자동 갱신) */
  const [plannedRefDateIso, setPlannedRefDateIso] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem('wbs.plannedRefDate') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      if (plannedRefDateIso) window.localStorage.setItem('wbs.plannedRefDate', plannedRefDateIso);
      else window.localStorage.removeItem('wbs.plannedRefDate');
    } catch {
      /* ignore quota */
    }
  }, [plannedRefDateIso]);
  /** computePlannedProgressMap에 넘길 실제 ref date — 빈 문자열이면 undefined(=오늘 자동) */
  const effectivePlannedRef = plannedRefDateIso || undefined;

  /** DnD 일괄 이동: 체크박스 다중 선택과 동기화(간트 등에서 빈 배열로 해제된 경우도 반영) */
  const dndSelectedTaskIds = useMemo(() => new Set(sharedSelectedTaskIds ?? []), [sharedSelectedTaskIds]);

  // 드래그앤드롭 — extracted to useWbsDragDrop
  const { dndActiveId, dropTarget, sensors, handleDragStart, handleDragOver, handleDragCancel, handleDragEnd } = useWbsDragDrop({
    tasks,
    selectedTaskIds: dndSelectedTaskIds,
    moveTaskRootsSibling,
  });

  // 가상 스크롤링: wrapTextInCells=false(고정 행 높이)이고 50행 초과 시 활성화
  // 작업명 인라인 편집 중에는 가상 스크롤 비활성화 — 스크롤/범위 변경 시 행이 언마운트되면
  // input blur로 편집이 즉시 종료되며(F2 후 깜빡임), 빈 이름 셀에서 입력이 불가능해진다.
  const shouldVirtualize = !wrapTextInCells && visibleTasks.length > 50 && inlineAddingTaskId === null && inlineEditingNameId === null;

  // 드래그 중인 항목의 인덱스를 미리 계산 (virtualRangeExtractor 내 O(n) findIndex 제거)
  const dndActiveIndex = useMemo(
    () => (dndActiveId ? visibleTasks.findIndex((t) => t.id === dndActiveId) : -1),
    [dndActiveId, visibleTasks],
  );

  const virtualRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const base = defaultRangeExtractor(range);
      if (dndActiveIndex !== -1 && !base.includes(dndActiveIndex)) {
        return [...base, dndActiveIndex].sort((a, b) => a - b);
      }
      return base;
    },
    [dndActiveIndex],
  );

  const isSplitViewForVirtualizer = !!syncScrollRef;
  const rowVirtualizer = useVirtualizer({
    count: visibleTasks.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: (index) => {
      if (isSplitViewForVirtualizer && syncRowHeights && syncRowHeights.length === visibleTasks.length) {
        return syncRowHeights[index] ?? rowHeight;
      }
      return rowHeight;
    },
    overscan: 5,
    rangeExtractor: virtualRangeExtractor,
  });

  // scrollToTaskId prop: 외부에서 지정한 작업으로 스크롤 (가상 스크롤 + 프로젝트 전환 대응)
  useEffect(() => {
    if (!scrollToTaskId) return;
    const idx = visibleTasks.findIndex((t) => t.id === scrollToTaskId);
    if (idx < 0) return;
    requestAnimationFrame(() => {
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
      }
      setTimeout(() => {
        document.getElementById(`task-row-${scrollToTaskId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 200);
    });
  }, [scrollToTaskId, visibleTasks, shouldVirtualize, rowVirtualizer]);

  const scrollTaskIntoView = useCallback(
    (taskId: string) => {
      setActiveTaskId(taskId);
      const idx = visibleTasks.findIndex((t) => t.id === taskId);
      if (idx < 0) {
        pushToast('현재 필터·표시 범위에 해당 작업이 없습니다. 필터를 초기화한 뒤 다시 시도해 주세요.', { variant: 'info' });
        return;
      }
      requestAnimationFrame(() => {
        if (shouldVirtualize) {
          rowVirtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
        }
        setTimeout(() => {
          document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 200);
      });
    },
    [visibleTasks, shouldVirtualize, rowVirtualizer, setActiveTaskId, pushToast],
  );

  const maxTreeLevel = useMemo(() => {
    if (tasks.length === 0) return 1;
    const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t] as const));
    const memo = new Map<string, number>();
    const depth = (id: string): number => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      const t = taskMap.get(id);
      if (!t || !t.parentId || !taskMap.has(t.parentId)) {
        memo.set(id, 0);
        return 0;
      }
      const d = depth(t.parentId) + 1;
      memo.set(id, d);
      return d;
    };
    let maxDepth = 0;
    for (const t of tasks) maxDepth = Math.max(maxDepth, depth(t.id));
    return Math.max(1, maxDepth + 1); // 1-based level
  }, [tasks]);

  useEffect(() => {
    // Keep selection within bounds if data changes.
    setTreeExpandLevel((prev) => {
      const next = Math.min(Math.max(1, prev), Math.max(1, maxTreeLevel));
      return prev !== next ? next : prev;
    });
  }, [maxTreeLevel, setTreeExpandLevel]);

  // 줄바꿈 켜짐 + split view: 표 행 높이 측정 후 간트에 전달
  const lastHeightsRef = useRef<number[]>([]);
  const visibleTaskIdsKey = useMemo(() => visibleTasks.map((t) => t.id).join(','), [visibleTasks]);
  useEffect(() => {
    if (!wrapTextInCells || !tableScrollRef.current || !onRowHeightsChange) {
      if (onRowHeightsChange && !wrapTextInCells) onRowHeightsChange([]);
      return;
    }
    const measure = () => {
      const scrollEl = tableScrollRef.current;
      if (!scrollEl) return;
      const rows = scrollEl.querySelectorAll<HTMLElement>('[id^="task-row-"]');
      const heights = [...rows].map((el) => el.offsetHeight);
      if (heights.length === 0) return;
      // 변경된 경우에만 콜백 호출 (Maximum update depth 방지)
      const prev = lastHeightsRef.current;
      if (prev.length !== heights.length || prev.some((h, i) => h !== heights[i])) {
        lastHeightsRef.current = heights;
        // 다음 틱으로 지연해 동기적 setState 루프 방지
        const cb = onRowHeightsChange;
        queueMicrotask(() => cb(heights));
      }
    };
    const raf = requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure); // 한 프레임 더 대기 (줄바꿈 레이아웃 완료)
    });
    const observer = new ResizeObserver(measure);
    observer.observe(tableScrollRef.current);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [wrapTextInCells, syncScrollRef, visibleTaskIdsKey, onRowHeightsChange, rowHeight]);

  const handleSetRowHeight = useCallback(
    (h: number) => {
      if (propRowHeight == null) setRowHeightState(h);
      onRowHeightChange?.(h);
    },
    [onRowHeightChange, propRowHeight],
  );

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskIds: string[] }>({
    isOpen: false,
    taskIds: [],
  });

  // WBS ID Generation map logic was moved to WBSContext

  /** taskId ↔ 표 행 순번(1부터) 양방향 맵. 단일 패스로 생성 */
  const { taskIdToSeqNum, seqNumToTaskId } = useMemo(() => {
    const taskIdToSeqNum = new Map<string, number>();
    const seqNumToTaskId = new Map<number, string>();
    visibleTasks.forEach((t, i) => {
      taskIdToSeqNum.set(t.id, i + 1);
      seqNumToTaskId.set(i + 1, t.id);
    });
    return { taskIdToSeqNum, seqNumToTaskId };
  }, [visibleTasks]);

  /** 작업 행의 담당자에 해당하는 프로젝트 투입율만 표시(행마다 독립). 과거에는 행 간 shown 집합으로 두 번째 행부터 "—"만 나와 편집해도 안 바뀐 것처럼 보이는 문제가 있었음. */
  const allocationDisplayByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of visibleTasks) {
      const rawAssignments = task.projectId ? (projectAssignmentsByProjectId.get(task.projectId) ?? []) : [];
      const pctByAssignee = new Map<string, number>();
      for (const a of rawAssignments) {
        const name = (a.assignee || '').trim();
        if (!name) continue;
        pctByAssignee.set(name, Number(a.allocationPercent) || 0);
      }
      const current = (task.assignee || '').trim();
      if (!current) {
        map.set(task.id, '—');
        continue;
      }
      const pct = pctByAssignee.has(current) ? pctByAssignee.get(current)! : 100;
      map.set(task.id, `${formatPercent1(pct)}%`);
    }
    return map;
  }, [visibleTasks, projectAssignmentsByProjectId]);

  // Column resize — extracted to useColumnResize hook (placed after allocationDisplayByTaskId/taskIdToSeqNum)
  const {
    columnWidths,
    resizingCol,
    setResizingCol,
    measureText,
    measureRef,
    handleColumnHeaderDoubleClick,
    autoFitAllColumns,
    startColumnResize,
  } = useColumnResize({
    wbsSettings,
    updateWbsSettings,
    visibleTasks,
    displayWbsMap,
    allocationDisplayByTaskId,
    taskIdToSeqNum,
    customColumnNameById,
    assigneeDisplayMetaByName,
    criticalPathTaskIds: effectiveCriticalPathSet,
  });

  const tableAutoFitFilterKey = useMemo(() => {
    const p = filters.projectIds;
    if (p === 'all') return 'all';
    if (Array.isArray(p)) return p.slice().sort().join(',');
    return String(p);
  }, [filters.projectIds]);

  /** 표만 뷰: 암묵적 자동 맞춤이 허용될 때만, 첫 표시·프로젝트·프로젝트 필터 바뀔 때 컬럼을 데이터에 맞게 일괄 조정 */
  useEffect(() => {
    if (!autoFitColumnsOnMount) return;
    if (wbsSettings?.skipImplicitTableColumnAutoFit === true) return;
    if (visibleColumnIds.length === 0) return;
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        autoFitAllColumns(visibleColumnIds, { implicitOrToolbarAutoFit: true });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [
    autoFitColumnsOnMount,
    wbsSettings?.skipImplicitTableColumnAutoFit,
    visibleColumnIds,
    autoFitAllColumns,
    currentProjectId,
    tableAutoFitFilterKey,
  ]);

  const gridStyle = useMemo(() => {
    const cw = columnWidths as Record<string, number>;
    const parts: string[] = [];
    parts.push(`${cw.grip}px`);
    parts.push(`${cw.checkbox}px`);
    parts.push(`${cw.seq}px`);
    for (const id of visibleColumnIds) {
      if (id === 'name') parts.push(`${cw.name}px`);
      else parts.push(`${cw[id] ?? 120}px`);
    }
    if (showActionsColumn) parts.push(`${cw.actions}px`);
    return { gridTemplateColumns: parts.join(' ') } as React.CSSProperties;
  }, [columnWidths, showActionsColumn, visibleColumnIds]);

  /** 표 전체 그리드 가로폭(분할 뷰 하단 스크롤바의 내부 폭으로 사용) */
  const totalGridWidth = useMemo(() => {
    const cw = columnWidths as Record<string, number>;
    let sum = (cw.grip ?? 0) + (cw.checkbox ?? 0) + (cw.seq ?? 0);
    for (const id of visibleColumnIds) sum += id === 'name' ? (cw.name ?? 0) : (cw[id] ?? 120);
    if (showActionsColumn) sum += cw.actions ?? 0;
    return sum;
  }, [columnWidths, showActionsColumn, visibleColumnIds]);

  // 좌측 고정열(비분할 표): 앞 4개 컬럼(그립·체크·# + 첫 데이터열=작업명)을 가로 스크롤해도 고정.
  // 각 컬럼의 left 오프셋을 실제 폭에서 누적 계산해 CSS 변수(--frz-l1..4)로 전달한다.
  const frozenLeftVars = useMemo(() => {
    const cw = columnWidths as unknown as Record<string, number>;
    const widthOf = (id: string | undefined) => (id ? (id === 'name' ? cw.name : cw[id]) : undefined) ?? 120;
    const widths = [cw.grip, cw.checkbox, cw.seq, widthOf(visibleColumnIds[0])];
    const vars: Record<string, string> = {};
    let acc = 0;
    widths.forEach((w, i) => {
      vars[`--frz-l${i + 1}`] = `${acc}px`;
      acc += Number(w) || 0;
    });
    return vars as React.CSSProperties;
  }, [columnWidths, visibleColumnIds]);

  const baseTasks = useMemo(
    () => (filters.projectIds === 'all' ? tasks : tasks.filter((task) => task.projectId && filters.projectIds.includes(task.projectId))),
    [tasks, filters.projectIds],
  );

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);

  const improvementGuideSteps = useMemo(
    () =>
      buildWbsImprovementGuide(baseTasks, projectsById, wbsSettings.statusConfigs ?? [], {
        labelForTask: (t) => {
          const w = displayWbsMap.get(t.id);
          return w ? `${w} ${t.name}` : t.name;
        },
      }),
    [baseTasks, projectsById, wbsSettings.statusConfigs, displayWbsMap],
  );

  const hasChildrenSet = useMemo(() => buildParentSet(baseTasks), [baseTasks]);
  /** 작업별 계획율(0~100). 리프=영업일 경과 비율, 부모=자식 가중 롤업. 진척차이 컬럼 계산에도 사용 */
  const plannedProgressById = useMemo(() => computePlannedProgressMap(baseTasks, effectivePlannedRef), [baseTasks, effectivePlannedRef]);
  const isTreeView = !(
    filters.status !== 'all' ||
    filters.assignee ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly
  );

  /** 트리 가이드 선(작업명 들여쓰기의 │ ├ └). 트리 뷰일 때만 계산 — 정렬/필터 뷰에선 계층이 끊겨 생략. */
  const treeGuideByTaskId = useMemo(
    () => (isTreeView ? computeTreeGuideStrings(visibleTasks) : new Map<string, string>()),
    [isTreeView, visibleTasks],
  );

  // Selection Logic — extracted to useWbsSelection
  const {
    selectedTaskIds,
    lastSelectedId,
    setLastSelectedId: setLastSelectedIdRaw,
    setAnchorTaskId,
    rangeAnchorRef,
    setSelection,
    handleSelect,
    handleSelectAll,
  } = useWbsSelection({
    visibleTasks,
    sharedSelectedTaskIds,
    setSharedSelectedTaskIds: setSharedSelectedTaskIds,
    tableScrollRef,
  });

  /** 하단 일괄 수정 바 뒤에 행·퀵추가가 숨지 않도록 스크롤 영역 하단 패딩.
   *  (서식 툴바는 상단 도킹으로 이동했으므로 더 이상 하단 여백에 영향을 주지 않는다.) */
  const tableScrollBottomPadding = useMemo(() => {
    if (excelView || editingTask) return undefined;
    const bulk = selectedTaskIds.size > 1;
    if (!bulk) return undefined;
    return 'calc(12rem + env(safe-area-inset-bottom, 0px))';
  }, [excelView, editingTask, selectedTaskIds.size]);

  /** 상단 도킹 서식 툴바 표시 조건: 편집 가능 + (행 체크 선택 또는 WBS 외 셀 포커스). 엑셀뷰·행 편집 중엔 숨김. */
  const showCellFormatToolbar = useMemo(() => {
    if (excelView || editingTask || !canEditCurrentProject) return false;
    if (selectedTaskIds.size >= 1) return true;
    return focusedCell != null && focusedCell.columnId !== 'wbsId' && tasks.some((t) => t.id === focusedCell.taskId);
  }, [excelView, editingTask, canEditCurrentProject, selectedTaskIds, focusedCell, tasks]);

  // setLastSelectedId 호출 시 activeTaskId도 같은 사이클에서 함께 set한다.
  // (양방향 동기화 effect만으로는 키보드 repeat 같은 빠른 연속 호출에서 race로 두 state가 어긋나
  //  노란색 두 개가 동시에 보이는 회귀가 발생했음)
  const setLastSelectedId = useCallback(
    (id: string | null) => {
      setLastSelectedIdRaw(id);
      setActiveTaskId(id);
    },
    [setLastSelectedIdRaw, setActiveTaskId],
  );

  /** 키보드/탭으로 행 포커스만 옮길 때 Shift 범위 앵커와 동기화 (옛 클릭 앵커가 남아 ↑/↓+Shift가 어긋나는 현상 방지) */
  const syncRangeAnchorForKeyboardFocus = useCallback(
    (taskId: string | null) => {
      if (taskId == null) return;
      rangeAnchorRef.current = taskId;
      setAnchorTaskId(taskId);
    },
    [setAnchorTaskId],
  );

  /** 행 클릭·Shift 범위 등으로 행만 포커스될 때도 셀 링이 이전 행에 남지 않게 lastSelectedId와 맞춘다 */
  const handleFocusRow = useCallback(
    (taskId: string) => {
      setLastSelectedId(taskId);
      setFocusedCell((prev) => {
        const col =
          prev && editableColumnIds.includes(prev.columnId)
            ? prev.columnId
            : editableColumnIds.includes('name')
              ? 'name'
              : (editableColumnIds[0] ?? 'name');
        return { taskId, columnId: col };
      });
    },
    [setLastSelectedId, editableColumnIds],
  );

  // 행 포커스가 이동하면 단일 활성 행(activeTaskId)도 그 행으로 동기화한다.
  // 표↔간트 시각 강조를 일치시키기 위함이지만, 체크박스 상태(selectedTaskIds)는 건드리지 않는다
  // — 체크박스는 스페이스/Ctrl·Shift 클릭 등 명시적 조작으로만 토글되도록 유지.
  useEffect(() => {
    if (!lastSelectedId) return;
    if (activeTaskId === lastSelectedId) return;
    setActiveTaskId(lastSelectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelectedId]);

  // 역방향: 간트에서 activeTaskId가 바뀐 경우(키보드/클릭), 표의 lastSelectedId도 같이 옮겨
  // "표에 노란 표시 두 개" 현상과 표 키보드 핸들러가 옛 lastSelectedId 기준으로 이동하는 회귀를 막는다.
  // 두 동기화 effect는 서로 이미 같으면 set을 생략하므로 무한 루프가 발생하지 않는다.
  useEffect(() => {
    if (!activeTaskId) return;
    if (activeTaskId === lastSelectedId) return;
    setLastSelectedId(activeTaskId);
    // 간트만 클릭해 포커스가 옮겨진 경우: 표의 Shift 범위 앵커가 옛 행을 가리키면 연속 선택이 깨지므로 동기화
    syncRangeAnchorForKeyboardFocus(activeTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  // wbs-edit-* 편집 input에 포커스가 잡힐 때 기존 텍스트를 전체 선택 → F2/더블클릭 직후 바로 덮어쓰기 가능
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.id.startsWith('wbs-edit-')) {
        target.select();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const {
    bulkStatus,
    setBulkStatus,
    bulkAssignee,
    setBulkAssignee,
    bulkWorkEffort,
    setBulkWorkEffort,
    bulkProgress,
    setBulkProgress,
    bulkPlannedProgress,
    setBulkPlannedProgress,
    bulkWeight,
    setBulkWeight,
    bulkStartDate,
    setBulkStartDate,
    bulkEndDate,
    setBulkEndDate,
    bulkAllocation,
    setBulkAllocation,
    bulkTaskKind,
    setBulkTaskKind,
    resetBulkFields,
    executeBulkEdit,
    executeBulkAssignee,
    executeBulkClearDependencies,
    executeBulkLinkSequentialPredecessors,
  } = useWbsBulkEdit({
    selectedTaskIds,
    tasks,
    visibleTasks,
    wbsSettings,
    updateTask,
    updateTasksBulk,
    projects,
    updateProject,
    linkSequentialPredecessors,
    pushToast,
  });

  /**
   * Ghost(placeholder) 행 활성화 — 마지막 표시 행의 형제로 빈 새 작업을 추가하고 그 행 인라인 편집으로 진입.
   * 클릭, 또는 ↓로 ghost 포커스 진입한 뒤 Enter/F2/문자 입력 시 호출.
   * (useWbsTableKeyboard의 deps로 전달되므로 hook 호출보다 먼저 선언)
   */
  const activateGhostRow = useCallback(() => {
    if (!canEditCurrentProject) return;
    const lastVisible = visibleTasks[visibleTasks.length - 1];
    const proj = projects.find((p) => p.id === (lastVisible?.projectId || currentProjectId));
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const startIso = filters.startDate || defaultDate;
    const newId = addTask(
      {
        name: '',
        startDate: startIso,
        endDate: filters.endDate || defaultEndDateForNewTask(startIso),
        progress: 0,
        workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
        assignee: filters.assignee || '',
        status: 'todo',
        parentId: lastVisible?.parentId ?? null,
      },
      lastVisible?.id,
    );
    if (newId) {
      setGhostFocusIdx(null);
      setLastSelectedId(newId);
      setFocusedCell({ taskId: newId, columnId: 'name' });
      setInlineEditingNameIdCommitted(newId);
      requestAnimationFrame(() => {
        document.getElementById(`task-row-${newId}`)?.scrollIntoView({ block: 'nearest' });
      });
    }
  }, [
    canEditCurrentProject,
    visibleTasks,
    projects,
    currentProjectId,
    filters.startDate,
    filters.endDate,
    filters.assignee,
    addTask,
    setLastSelectedId,
    setFocusedCell,
    setInlineEditingNameIdCommitted,
  ]);

  // Keyboard Shortcuts — extracted to useWbsTableKeyboard
  useWbsTableKeyboard({
    hotkeysEnabled,
    excelView,
    selectedTaskIds,
    sharedSelectedTaskIds,
    lastSelectedId,
    visibleTasks,
    editingTask,
    editingCell,
    inlineEditingNameId,
    focusedCell,
    editableColumnIds,
    deleteConfirm,
    copiedTasks,
    tasks,
    sortConfig,
    filters,
    rowHeight,
    currentProjectId,
    projects,
    canEditCurrentProject,
    inlineAddingTaskId,
    setInlineAddingTaskId,
    ghostFocusIdx,
    setGhostFocusIdx,
    ghostPlaceholderRowCount: GHOST_PLACEHOLDER_ROW_COUNT,
    activateGhostRow,
    setLastSelectedId,
    syncRangeAnchorForKeyboardFocus,
    setFocusedCell,
    setInlineEditingNameId: setInlineEditingNameIdCommitted,
    setEditingCell,
    setSelection,
    setBulkStatus,
    setBulkAssignee,
    setBulkWorkEffort,
    setBulkProgress,
    setDeleteConfirm,
    setCopiedTasks,
    addTask,
    updateTask,
    moveTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    toggleExpand,
    handleSetRowHeight,
    handleSelectAll,
    handleSelect,
    pushToast,
    loadClipboardTasks,
    tableScrollRef,
    CLIPBOARD_KEY,
  });

  /** 체크박스로 선택된 표시 행들을 작업 단위 클립보드(내부 state + localStorage)에 저장. 복사된 작업 배열 반환 — Ctrl+C·우클릭 복사 공용 */
  const copyCheckedRowsToTaskClipboard = useCallback((): Task[] => {
    const rows = visibleTasks.filter((t) => selectedTaskIds.has(t.id));
    if (rows.length === 0) return [];
    const selected = rows.map((t) => {
      const { depth: _depth, ...rest } = t;
      return rest as Task;
    });
    setCopiedTasks(selected);
    try {
      const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
    return selected;
  }, [visibleTasks, selectedTaskIds, CLIPBOARD_KEY]);

  /** 일괄 복사 버튼·우클릭 메뉴 공용: 체크 선택 행을 작업 단위 복사 + 작업명을 시스템 클립보드에도 넣고 토스트 표시 */
  const handleBulkCopySelected = useCallback(() => {
    const copied = copyCheckedRowsToTaskClipboard();
    if (copied.length === 0) return;
    const namesText = copied
      .map((t) => (t.name ?? '').trim())
      .filter(Boolean)
      .join('\n');
    if (namesText) {
      try {
        void navigator.clipboard?.writeText(namesText);
      } catch {
        // ignore clipboard errors (permissions, insecure context)
      }
    }
    pushToast(`${copied.length}개 작업을 복사했습니다. 붙여넣기(Ctrl+V)로 추가할 수 있습니다.`, { variant: 'success' });
  }, [copyCheckedRowsToTaskClipboard, pushToast]);

  /** 일괄 붙여넣기 버튼 공용: 내부 작업 클립보드를 기준 행 뒤에 트리·선행관계 보존하며 붙여넣고 새 작업을 선택 */
  const handlePasteTasksFromClipboard = useCallback(() => {
    if (!canEditCurrentProject) {
      pushToast('보기 전용 프로젝트에서는 붙여넣을 수 없습니다.', { variant: 'info' });
      return;
    }
    const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
    if (clipboard.length === 0) {
      pushToast('붙여넣을 작업이 없습니다. 먼저 작업을 복사하세요.', { variant: 'info' });
      return;
    }
    const addedIds = pasteClipboardTasks({
      clipboard,
      targetId: lastSelectedId,
      visibleTaskIds: visibleTasks.map((t) => t.id),
      tasks,
      addTask,
      updateTask,
    });
    if (addedIds.length > 0) {
      setSelection(new Set(addedIds));
      const lastPasted = addedIds[addedIds.length - 1];
      setLastSelectedId(lastPasted);
      syncRangeAnchorForKeyboardFocus(lastPasted);
      pushToast(`${addedIds.length}개 작업을 붙여넣었습니다.`, { variant: 'success' });
    }
  }, [
    canEditCurrentProject,
    copiedTasks,
    lastSelectedId,
    visibleTasks,
    tasks,
    addTask,
    updateTask,
    setSelection,
    setLastSelectedId,
    syncRangeAnchorForKeyboardFocus,
    pushToast,
  ]);

  /** 클립보드 비우기 — 안내 칩의 '지우기'·복사 취소 */
  const clearTaskClipboard = useCallback(() => {
    setCopiedTasks([]);
    try {
      localStorage.removeItem(CLIPBOARD_KEY);
    } catch {
      // ignore
    }
  }, [CLIPBOARD_KEY]);

  /** 붙여넣기 대상 위치 안내 문구 — 포커스(노란 강조) 행 바로 아래, 없으면 맨 아래 */
  const pasteTargetLabel = useMemo(() => {
    const t = lastSelectedId ? tasks.find((x) => x.id === lastSelectedId) : null;
    const name = (t?.name ?? '').trim();
    if (!name) return '목록 맨 아래';
    const short = name.length > 14 ? `${name.slice(0, 14)}…` : name;
    return `「${short}」 바로 아래`;
  }, [lastSelectedId, tasks]);

  /** 우클릭·메뉴 복사 등: 체크박스 다중 선택 시 행(작업) 단위 복사, 그 외에는 작업명만 클립보드에 넣음 (인라인 편집 필드는 제외) */
  const handleWbsTableCopyCapture = useCallback(
    (e: React.ClipboardEvent) => {
      if (!hotkeysEnabled || excelView) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (selectedTaskIds.size >= 2) {
        const copied = copyCheckedRowsToTaskClipboard();
        if (copied.length > 0) {
          e.preventDefault();
          e.clipboardData.setData(
            'text/plain',
            copied
              .map((t) => (t.name ?? '').trim())
              .filter(Boolean)
              .join('\n'),
          );
          return;
        }
      }
      const packed = getWbsTableCopyPlainText({
        focusedCell,
        lastSelectedId,
        tasks,
      });
      if (!packed) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', packed.text);
    },
    [hotkeysEnabled, excelView, focusedCell, lastSelectedId, tasks, selectedTaskIds, copyCheckedRowsToTaskClipboard],
  );

  /** 빈 영역 클릭 판정: 행(.data-row)·헤더(.data-header)·입력/버튼 등 상호작용 요소 밖 */
  const isWbsTableEmptyArea = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return !!el && !el.closest?.('.data-row, .data-header, input, button, select, textarea, form, a');
  };
  /** 빈 영역에서 누르기 시작했는지 추적 — 행 드래그 후 빈 곳에서 놓을 때 click이 컨테이너로 합성돼 선택이 풀리는 것 방지 */
  const emptyAreaPressRef = useRef(false);

  const handleInlineQuickAdd = (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    if (!canEditCurrentProject) return; // 편집 권한 없으면 인라인 추가 비활성화
    const name = quickAddInlineValue.trim();
    if (!name) return;

    const proj = projects.find((p) => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const startIso = filters.startDate || defaultDate;
    const newId = addTask(
      {
        name,
        parentId,
        startDate: startIso,
        endDate: filters.endDate || defaultEndDateForNewTask(startIso),
        progress: 0,
        workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
        assignee: filters.assignee || '',
        status: 'todo',
      },
      insertTargetId || undefined,
    );

    setQuickAddInlineValue('');
    setInlineAddingTaskId(null);
    setInsertTargetId(null);

    // 포커스 행 지정 → 노란색 강조 + ↑/↓ 단축키로 즉시 이동 가능. 체크박스 자동 체크 X.
    setLastSelectedId(newId);
    if (newId) setFocusedCell({ taskId: newId, columnId: 'name' });
    // 표 본문에 포커스를 복귀시켜 마우스 없이 ↑/↓/F2로 연속 조작이 가능하게 한다(엑셀 스타일).
    requestAnimationFrame(() => {
      tableScrollRef.current?.focus();
    });
  };

  const handleSave = (updates: Partial<Task>) => {
    if (editingTask) {
      if (editingTask.id === '') {
        // Creating a new subtask
        const proj = projects.find((p) => p.id === (editingTask!.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
        addTask(
          {
            parentId: editingTask.parentId, // Default to initial parent
            assignee: filters.assignee || '',
            startDate: filters.startDate || defaultDate,
            endDate: filters.endDate || defaultDate,
            ...updates, // Override with form data if present
          },
          insertTargetId || undefined,
        );
        setInsertTargetId(null);
      } else {
        // Updating existing task
        updateTask(editingTask.id, updates);
      }
      setEditingTask(null);
    }
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditCurrentProject) return; // 편집 권한 없으면 빠른 추가 비활성화
    const name = quickAddBottomValue.trim();
    if (!name) return;

    const proj = projects.find((p) => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const startIso = filters.startDate || defaultDate;
    const newId = addTask({
      name,
      startDate: startIso,
      endDate: filters.endDate || defaultEndDateForNewTask(startIso),
      progress: 0,
      workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
      assignee: filters.assignee || '',
      status: 'todo',
      parentId: null,
    });
    setQuickAddBottomValue('');
    // input에서 포커스 빼야 ↑/↓ 단축키가 동작 (useWbsTableKeyboard의 inQuickAdd 가드)
    bottomQuickAddInputRef.current?.blur();
    if (newId) {
      // 포커스 행 지정 → 노란색 강조 + ↑/↓로 즉시 이동 가능. 체크박스는 자동 체크 X.
      setLastSelectedId(newId);
      setFocusedCell({ taskId: newId, columnId: 'name' });
    }
    // 표 본문에 포커스를 되돌려 줘야 마우스 없이 ↑/↓/F2로 연속 조작이 가능(엑셀 스타일).
    requestAnimationFrame(() => {
      tableScrollRef.current?.focus();
    });
  };

  /**
   * 지정한 작업 행의 "위"에 동일 레벨(형제) 새 작업을 추가하고, 그 새 행을 인라인 편집 모드로 진입.
   * - 작업명 인라인 편집 input의 Shift+Enter 처리에서 호출
   * - 동일 부모(parentId) 아래에 삽입. 기준 행 바로 앞 위치(visibleTasks에서 baseIndex-1 다음)에 들어감.
   */
  const insertRowAbove = useCallback(
    (baseTaskId: string) => {
      if (!canEditCurrentProject) return;
      const baseTask = tasks.find((t) => t.id === baseTaskId);
      if (!baseTask) return;
      const proj = projects.find((p) => p.id === (baseTask.projectId || currentProjectId));
      const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
      const baseIndex = visibleTasks.findIndex((t) => t.id === baseTask.id);
      const insertAfterId = baseIndex > 0 ? visibleTasks[baseIndex - 1].id : undefined;
      const startIso = filters.startDate || defaultDate;
      const newId = addTask(
        {
          name: '',
          startDate: startIso,
          endDate: filters.endDate || defaultEndDateForNewTask(startIso),
          progress: 0,
          workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
          assignee: filters.assignee || '',
          status: 'todo',
          parentId: baseTask.parentId ?? null,
        },
        insertAfterId,
      );
      if (newId) {
        setLastSelectedId(newId);
        setInlineEditingNameIdCommitted(newId);
      }
    },
    [
      canEditCurrentProject,
      tasks,
      visibleTasks,
      projects,
      currentProjectId,
      filters.startDate,
      filters.endDate,
      filters.assignee,
      addTask,
      setLastSelectedId,
      setInlineEditingNameIdCommitted,
    ],
  );

  /**
   * 작업명 인라인 편집 중 Enter 처리(엑셀 스타일 연속 입력):
   * 항상 현재 행 바로 아래에 빈 새 작업을 만들어 그 행 인라인 편집으로 진입한다.
   * - 다음 기존 행을 자동으로 편집 모드로 만들지 않는다(기존 작업명을 의도치 않게 수정하는 사고 방지).
   * - 새 행은 현재 행과 동일한 부모(레벨)로 형제 삽입.
   * - 연쇄 입력을 멈추려면 빈 입력 상태에서 Enter — SortableTaskRow의 input 핸들러가 처리.
   */
  const advanceInlineEditToNextRow = useCallback(
    (currentTaskId: string) => {
      if (!canEditCurrentProject) {
        requestAnimationFrame(() => {
          tableScrollRef.current?.focus();
        });
        return;
      }
      const currentTask = tasks.find((t) => t.id === currentTaskId);
      const proj = projects.find((p) => p.id === (currentTask?.projectId || currentProjectId));
      const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
      const startIso = filters.startDate || defaultDate;
      const newId = addTask(
        {
          name: '',
          startDate: startIso,
          endDate: filters.endDate || defaultEndDateForNewTask(startIso),
          progress: 0,
          workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
          assignee: filters.assignee || '',
          status: 'todo',
          parentId: currentTask?.parentId ?? null,
        },
        currentTaskId,
      );
      if (newId) {
        setLastSelectedId(newId);
        setFocusedCell({ taskId: newId, columnId: 'name' });
        setInlineEditingNameIdCommitted(newId);
        requestAnimationFrame(() => {
          document.getElementById(`task-row-${newId}`)?.scrollIntoView({ block: 'nearest' });
        });
      }
    },
    [
      setLastSelectedId,
      setFocusedCell,
      setInlineEditingNameIdCommitted,
      canEditCurrentProject,
      tasks,
      projects,
      currentProjectId,
      filters.startDate,
      filters.endDate,
      filters.assignee,
      addTask,
    ],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => {
      e.preventDefault();
      if (!selectedTaskIds.has(taskId)) {
        handleSelect(taskId, false, false);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', taskId, columnId });
    },
    [selectedTaskIds, handleSelect],
  );

  const handleSyncProgressFromStatus = () => {
    const idsToSync = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : contextMenu?.taskId ? [contextMenu.taskId] : [];
    const configs = wbsSettings?.statusConfigs ?? [];
    idsToSync.forEach((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const config = configs.find((c: StatusConfig) => c.id === task.status);
      if (config && config.progress !== undefined) {
        updateTask(id, { progress: config.progress });
      }
    });
    setContextMenu(null);
  };

  const handleHeaderContextMenu = (e: React.MouseEvent, columnId?: TableColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'header', columnId });
  };

  // 헤더 셀 인라인 편집(이름 바꾸기) — custom 컬럼 전용
  const [editingHeaderColId, setEditingHeaderColId] = useState<string | null>(null);

  const moveColumn = useCallback(
    (colId: string, direction: 'left' | 'right') => {
      const cols = wbsSettings?.tableColumns ?? [];
      if (cols.length === 0) return;
      const visibleIds = cols.filter((c) => c.visible !== false).map((c) => c.id);
      const pos = visibleIds.indexOf(colId);
      if (pos < 0) return;
      const targetVisIdx = direction === 'left' ? pos - 1 : pos + 1;
      if (targetVisIdx < 0 || targetVisIdx >= visibleIds.length) return;
      const otherId = visibleIds[targetVisIdx];
      const idxA = cols.findIndex((c) => c.id === colId);
      const idxB = cols.findIndex((c) => c.id === otherId);
      if (idxA < 0 || idxB < 0) return;
      const next = [...cols];
      [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
      updateWbsSettings({ tableColumns: next });
    },
    [wbsSettings?.tableColumns, updateWbsSettings],
  );

  const insertCustomColumn = useCallback(
    (anchorColId: string | null, side: 'left' | 'right') => {
      const newId = `custom:${Date.now()}`;
      const newName = '새 컬럼';
      const customCols = Array.isArray(wbsSettings?.customColumns) ? wbsSettings.customColumns : [];
      // 새 컬럼은 현재 프로젝트 전속으로 등록한다(다른 프로젝트에 노출되지 않게).
      // 전체보기('all')에서 추가한 경우는 글로벌(=projectId 없음)로 둔다.
      const newCol: { id: string; name: string; projectId?: string } =
        currentProjectId && currentProjectId !== 'all'
          ? { id: newId, name: newName, projectId: currentProjectId }
          : { id: newId, name: newName };
      const nextCustom = [...customCols, newCol];
      const cols = wbsSettings?.tableColumns ?? [];
      const idx = anchorColId ? cols.findIndex((c) => c.id === anchorColId) : -1;
      let nextCols;
      if (idx < 0) {
        nextCols = [...cols, { id: newId, visible: true }];
      } else {
        const insertAt = side === 'left' ? idx : idx + 1;
        nextCols = [...cols.slice(0, insertAt), { id: newId, visible: true }, ...cols.slice(insertAt)];
      }
      updateWbsSettings({ tableColumns: nextCols, customColumns: nextCustom });
      setEditingHeaderColId(newId);
    },
    [wbsSettings?.customColumns, wbsSettings?.tableColumns, updateWbsSettings, currentProjectId],
  );

  const deleteCustomColumn = useCallback(
    (colId: string) => {
      if (!colId.startsWith('custom:')) return;
      const ok = window.confirm('이 컬럼을 삭제하시겠습니까? (입력된 값은 작업 데이터에 보관됩니다)');
      if (!ok) return;
      const customCols = Array.isArray(wbsSettings?.customColumns) ? wbsSettings.customColumns : [];
      const nextCustom = customCols.filter((c) => c.id !== colId);
      const nextCols = (wbsSettings?.tableColumns ?? []).filter((c) => c.id !== colId);
      updateWbsSettings({ tableColumns: nextCols, customColumns: nextCustom });
    },
    [wbsSettings?.customColumns, wbsSettings?.tableColumns, updateWbsSettings],
  );

  const commitHeaderRename = useCallback(
    (colId: string, rawName: string) => {
      if (!colId.startsWith('custom:')) {
        setEditingHeaderColId(null);
        return;
      }
      const trimmed = rawName.trim();
      if (!trimmed) {
        setEditingHeaderColId(null);
        return;
      }
      const customCols = Array.isArray(wbsSettings?.customColumns) ? wbsSettings.customColumns : [];
      const exists = customCols.some((c) => c.id === colId);
      const nextCustom = exists
        ? customCols.map((c) => (c.id === colId ? { ...c, name: trimmed } : c))
        : [...customCols, { id: colId, name: trimmed }];
      updateWbsSettings({ customColumns: nextCustom });
      setEditingHeaderColId(null);
    },
    [wbsSettings?.customColumns, updateWbsSettings],
  );

  const handleDeleteClick = useCallback((taskId: string) => {
    setDeleteConfirm({ isOpen: true, taskIds: [taskId] });
  }, []);

  const executeDelete = () => {
    // 1. Fully identify all task IDs to be deleted (including descendants)
    const deleteSet = new Set<string>();
    const getIdsToDelete = (parentId: string) => {
      deleteSet.add(parentId);
      tasks.filter((t) => t.parentId === parentId).forEach((child) => getIdsToDelete(child.id));
    };
    deleteConfirm.taskIds.forEach((id) => getIdsToDelete(id));

    // 2. Determine the next selection before performing the delete
    const visibleIndices = visibleTasks.map((t, i) => (deleteSet.has(t.id) ? i : -1)).filter((i) => i !== -1);

    let nextSelectId: string | null = null;
    if (visibleIndices.length > 0) {
      const minIndex = Math.min(...visibleIndices);
      const maxIndex = Math.max(...visibleIndices);

      // Search forward for first non-deleted item
      for (let i = maxIndex + 1; i < visibleTasks.length; i++) {
        if (!deleteSet.has(visibleTasks[i].id)) {
          nextSelectId = visibleTasks[i].id;
          break;
        }
      }

      // If no task after, search backward
      if (!nextSelectId) {
        for (let i = minIndex - 1; i >= 0; i--) {
          if (!deleteSet.has(visibleTasks[i].id)) {
            nextSelectId = visibleTasks[i].id;
            break;
          }
        }
      }
    }

    // 3. Perform deletion
    deleteConfirm.taskIds.forEach((id) => deleteTask(id));
    setDeleteConfirm({ isOpen: false, taskIds: [] });

    // 4. Update selection - 체크박스는 해제, 포커스(노란색 강조)만 다음 행으로 이동
    setSelection(new Set());
    if (nextSelectId) {
      setLastSelectedId(nextSelectId);
      rangeAnchorRef.current = nextSelectId;
      setAnchorTaskId(nextSelectId);
    } else {
      setLastSelectedId(null);
      rangeAnchorRef.current = null;
      setAnchorTaskId(null);
    }

    // 5. 삭제 확인 후 포커스가 모달 등 표 밖에 남으면 ↑/↓가 `data-wbs-table` 가드에 막힘 — 표 본문으로 복귀
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tableScrollRef.current?.focus();
      });
    });

    // 6. 편집 모드 셀 링이 삭제된 taskId를 가리키면 행 하이라이트와 키보드 기준 행이 어긋남
    setFocusedCell((prev) => {
      if (!prev || !deleteSet.has(prev.taskId)) return prev;
      if (!nextSelectId) return null;
      const col = editableColumnIds.includes(prev.columnId)
        ? prev.columnId
        : editableColumnIds.includes('name')
          ? 'name'
          : (editableColumnIds[0] ?? 'name');
      return { taskId: nextSelectId, columnId: col };
    });
  };

  // Aggregate stats: 항상 현재 프로젝트 기준 전체 현황 (선택/필터/레벨/접힘과 무관)
  const summaryStats = useWbsSummaryStats(baseTasks, projects, effectivePlannedRef);

  const isSplitView = !!syncScrollRef;
  /** 헤더 클릭으로 정렬하지 않음(열 포커스·너비 조절과 혼동 방지). 정렬은 헤더 우클릭 →「이 컬럼으로 정렬」만 사용. */
  const headerSortClickEnabled = false;
  const headerStyle = isSplitView ? { ...gridStyle, height: 60, minHeight: 60 } : gridStyle;

  /** 컬럼 너비 조절용 그립: 헤더 오른쪽 가장자리 드래그.
   * stripe를 grip의 우측(border-r)에 그려야 visible stripe 위치 = grid cell 우측 끝 = 본문 셀의 우측 경계와 정확히 정렬된다.
   * 좌측(border-l)에 두면 stripe가 grid cell 끝에서 grip 너비(12px)만큼 안쪽에 그려져 본문과 어긋나 보임. */
  const resizeGrip = (col: keyof typeof columnWidths) => (
    <div
      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-20 shrink-0 border-r-2 border-slate-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
      title="컬럼 너비 조절 (드래그)"
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        startColumnResize(col, e.clientX);
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
      }}
    />
  );

  const renderHeaderCell = (id: TableColumnId) => {
    if (editingHeaderColId === id && id.startsWith('custom:')) {
      const initial = customColumnNameById.get(id) || id.replace(/^custom:/, '');
      return (
        <div key={id} className="col-header relative" onContextMenu={(e) => e.preventDefault()}>
          <input
            autoFocus
            defaultValue={initial}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitHeaderRename(id, (e.currentTarget as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditingHeaderColId(null);
              }
              e.stopPropagation();
            }}
            onBlur={(e) => commitHeaderRename(id, e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full bg-white border border-[var(--color-accent)] rounded px-1.5 py-0.5 text-[13px] font-medium text-[var(--color-ink)] outline-none"
            placeholder="컬럼 이름"
          />
          {resizeGrip(id as keyof typeof columnWidths)}
        </div>
      );
    }
    return (
      <React.Fragment key={id}>
        <HeaderCell
          id={id}
          label={id.startsWith('custom:') ? customColumnNameById.get(id) : undefined}
          workEffortHeaderTitle={workEffortHeaderTitle}
          headerSortClickEnabled={headerSortClickEnabled}
          onSort={onSort}
          resizeGrip={resizeGrip(id as keyof typeof columnWidths)}
          onColContextMenu={(ev) => handleHeaderContextMenu(ev, id)}
          onColDoubleClick={(ev) => {
            ev.stopPropagation();
            if (id.startsWith('custom:')) {
              setEditingHeaderColId(id);
              return;
            }
            handleColumnHeaderDoubleClick(id as keyof typeof columnWidths);
          }}
        />
      </React.Fragment>
    );
  };

  const content = (
    <>
      {/* 컬럼 너비 자동 조정용 측정 요소 (화면 밖, 테이블과 동일 폰트) */}
      <div
        ref={measureRef}
        className="absolute left-[-9999px] top-0 text-[13px] font-medium font-sans tracking-[-0.01em] whitespace-nowrap invisible pointer-events-none"
        aria-hidden
      />
      {/* === Summary Bar (표 바로 위: 통계·레벨 펼치기·편집·줄간격) === */}
      <SummaryBar
        summaryStats={summaryStats}
        plannedRefDateIso={plannedRefDateIso}
        setPlannedRefDateIso={setPlannedRefDateIso}
        useWeightForRollup={useWeightForRollup}
        setUseWeightForRollup={toggleUseWeightForRollup}
        isSplitView={isSplitView}
        maxTreeLevel={maxTreeLevel}
        treeExpandLevel={treeExpandLevel}
        setTreeExpandLevel={setTreeExpandLevel}
        expandToLevel={expandToLevel}
        excelView={excelView}
        setExcelView={setExcelView}
        rowHeight={rowHeight}
        handleSetRowHeight={handleSetRowHeight}
        onOpenMdEditor={() => {
          const projectIdsInView = new Set(baseTasks.map((t) => t.projectId));
          const projectsInView = projects.filter((p) => projectIdsInView.has(p.id));
          setMdEditInitialMarkdown(buildMarkdownFromTasks(baseTasks, wbsMap, projectsInView, assigneeDisplayMetaByName));
          setIsMdEditModalOpen(true);
        }}
        onOpenImprovementGuide={() => setImprovementGuideOpen(true)}
        onAutoAlignSchedule={
          canEditCurrentProject
            ? () => {
                const ok = window.confirm(
                  [
                    '일정 자동 맞춤을 실행할까요?',
                    '',
                    '· 상위(요약) 작업의 시작일·종료일을 하위 작업 기간(최소 시작~최대 종료)으로 맞춥니다.',
                    '· 선행작업이 연결된 작업은 시작일을 "선행 종료일 + 1영업일"로 이동합니다.',
                    '',
                    '직접 입력해 둔 상위 작업·후행 작업의 날짜가 이 기준으로 덮어써집니다.',
                    '실행 후 Ctrl+Z로 되돌릴 수 있습니다.',
                  ].join('\n'),
                );
                if (!ok) return;
                refreshProjectSchedule();
                pushToast('일정 자동 맞춤을 적용했습니다. Ctrl+Z로 되돌릴 수 있습니다.', { variant: 'success' });
              }
            : undefined
        }
        tableAutoFormatting={{
          effectiveOn: showTableAutoFormatting,
          globalEnabled: globalAutoFormattingOn,
          onToggle: toggleUserHide,
        }}
        cellClickEdit={
          canEditCurrentProject
            ? {
                on: singleClickEdit,
                onToggle: toggleSingleClickEdit,
              }
            : undefined
        }
      />
      {/* 셀 서식 툴바(상단 도킹) — 셀 포커스 또는 행 체크 선택 시에만 표시.
          루트(relative) 최상단을 덮는 오버레이라 표 본문/헤더 위치를 밀지 않는다(분할뷰 표·간트 행 정렬 보존). */}
      {showCellFormatToolbar && (
        <div className="absolute inset-x-0 top-0 z-40">
          <CellFormatToolbar
            focusedCell={focusedCell}
            selectedTaskIds={selectedTaskIds}
            rowApplyColumnIds={editableColumnIds}
            tasks={tasks}
            canEdit={canEditCurrentProject}
            customColumnNameById={customColumnNameById}
            updateTask={updateTask}
            onDeleteTargets={(ids) => setDeleteConfirm({ isOpen: true, taskIds: ids })}
            onClose={() => {
              setSelection(new Set());
              setFocusedCell(null);
            }}
          />
        </div>
      )}
      <div
        className={cn('w-full flex flex-col min-h-0', fillHeight && 'flex-1')}
        style={{ '--row-height': `${rowHeight}px`, '--cell-padding': `${Math.max(2, (rowHeight - 20) / 2)}px` } as React.CSSProperties}
      >
        {/* Split view: 헤더를 스크롤 밖에 두되, 가로 스크롤은 본문과 동기화 */}
        {!excelView && isSplitView && (
          <div
            ref={(el) => {
              headerScrollRef.current = el;
              const r = splitHeaderScrollRef;
              if (typeof r === 'function') r(el);
              else if (r) (r as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className="flex-shrink-0 border-b border-[var(--color-line)] bg-gradient-to-b from-[var(--color-line-soft)] to-[var(--color-surface)]/90 overflow-x-auto overflow-y-hidden"
            onScroll={(e) => {
              if (isSyncingScrollRef.current) return;
              isSyncingScrollRef.current = true;
              const sl = e.currentTarget.scrollLeft;
              if (tableScrollRef.current) tableScrollRef.current.scrollLeft = sl;
              if (tableBottomScrollRef.current) tableBottomScrollRef.current.scrollLeft = sl;
              requestAnimationFrame(() => {
                isSyncingScrollRef.current = false;
              });
            }}
          >
            <div className="data-header flex-shrink-0" style={headerStyle}>
              <div
                className="col-header justify-center relative"
                title="드래그 · 더블클릭: 너비 초기화"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleColumnHeaderDoubleClick('grip');
                }}
                onContextMenu={(e) => handleHeaderContextMenu(e)}
              >
                {resizeGrip('grip')}
              </div>
              <div
                className="col-header justify-center relative"
                title="전체 선택 · 더블클릭: 너비 초기화"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleColumnHeaderDoubleClick('checkbox');
                }}
                onContextMenu={(e) => handleHeaderContextMenu(e)}
              >
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                  onChange={handleSelectAll}
                />
                {resizeGrip('checkbox')}
              </div>
              <div
                className="col-header justify-center relative"
                title="순번 · 더블클릭: 너비 초기화"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleColumnHeaderDoubleClick('seq');
                }}
                onContextMenu={(e) => handleHeaderContextMenu(e)}
              >
                #{resizeGrip('seq')}
              </div>
              {visibleColumnIds.map(renderHeaderCell)}
              {showActionsColumn && (
                <div
                  className="col-header justify-end relative"
                  title="작업 관리(편집·삭제 등) · 더블클릭: 너비 초기화"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleColumnHeaderDoubleClick('actions');
                  }}
                  onContextMenu={(e) => handleHeaderContextMenu(e)}
                >
                  관리
                  {resizeGrip('actions')}
                </div>
              )}
            </div>
          </div>
        )}
        {!excelView && (
          <div className={cn('flex flex-col min-h-0 bg-[var(--color-bg)]', fillHeight && 'flex-1')}>
            <div
              ref={(el) => {
                if (typeof syncScrollRef === 'function') syncScrollRef(el);
                else if (syncScrollRef) (syncScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                tableScrollRef.current = el;
              }}
              tabIndex={0}
              data-wbs-table
              onCopyCapture={handleWbsTableCopyCapture}
              onMouseDown={(e) => {
                emptyAreaPressRef.current = isWbsTableEmptyArea(e.target);
              }}
              onClick={(e) => {
                // 체크박스 다중 선택 상태에서 행·헤더·입력 요소 밖 빈 영역 클릭 → 체크 해제 (행 포커스·셀 링은 유지)
                const pressedOnEmpty = emptyAreaPressRef.current;
                emptyAreaPressRef.current = false;
                if (!pressedOnEmpty || !isWbsTableEmptyArea(e.target)) return;
                if (selectedTaskIds.size === 0) return;
                setSelection(new Set());
                resetBulkFields();
              }}
              className={cn(
                // split: 가로는 상단 헤더 스크롤만 사용 — 본문 가로 스크롤바가 세로 뷰포트를 줄여 간트와 행 단위가 어긋나는 것을 방지
                isSplitView ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto',
                'relative outline-none focus:ring-0',
                'wbs-view-mode',
                fillHeight ? 'flex-1 min-h-0' : 'min-h-[280px] max-h-[calc(100vh-14rem)]',
                wrapTextInCells && 'wrap-text-in-cells',
                // 마지막 행·퀵 추가 입력 아래 여백(셀 서식/일괄 바가 있으면 style로 더 큰 값 사용)
                !tableScrollBottomPadding && 'pb-6',
              )}
              style={tableScrollBottomPadding ? { paddingBottom: tableScrollBottomPadding } : undefined}
              onScroll={(e) => {
                const target = e.currentTarget;
                const header = headerScrollRef.current;
                if (!isSyncingScrollRef.current) {
                  isSyncingScrollRef.current = true;
                  if (isSplitView && header) header.scrollLeft = target.scrollLeft;
                  if (isSplitView && tableBottomScrollRef.current) tableBottomScrollRef.current.scrollLeft = target.scrollLeft;
                  requestAnimationFrame(() => {
                    isSyncingScrollRef.current = false;
                  });
                }
              }}
            >
              <div
                className={cn(
                  'min-w-fit w-full bg-[var(--color-surface)] relative shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]',
                  !isSplitView && 'wbs-frozen',
                )}
                style={!isSplitView ? frozenLeftVars : undefined}
              >
                {/* Non-split: 컬럼 헤더만 sticky top — 새 작업 추가는 본문 맨 아래(행 직후)에 배치 */}
                {!isSplitView && (
                  <div className="sticky top-0 z-30 w-full border-b border-[var(--color-line)] bg-[var(--color-bg)]/95 shadow-[0_2px_10px_-4px_rgba(15,23,42,0.08)] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--color-bg)]/80">
                    <div className={cn('data-header !relative !top-auto !z-0 border-b-0 shadow-none')} style={gridStyle}>
                      <div
                        className="col-header justify-center relative"
                        title="행 아무 곳이나 잡고 드래그해 순서 변경 · 다른 작업의 위/아래/하위로 이동(드롭 후 메뉴)"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleColumnHeaderDoubleClick('grip');
                        }}
                        onContextMenu={(e) => handleHeaderContextMenu(e)}
                      >
                        {resizeGrip('grip')}
                      </div>
                      <div
                        className="col-header justify-center relative"
                        title="전체 선택 · 더블클릭: 너비 초기화"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleColumnHeaderDoubleClick('checkbox');
                        }}
                        onContextMenu={(e) => handleHeaderContextMenu(e)}
                      >
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                          onChange={handleSelectAll}
                        />
                        {resizeGrip('checkbox')}
                      </div>
                      <div
                        className="col-header justify-center relative"
                        title="순번 · 더블클릭: 너비 초기화"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleColumnHeaderDoubleClick('seq');
                        }}
                        onContextMenu={(e) => handleHeaderContextMenu(e)}
                      >
                        #{resizeGrip('seq')}
                      </div>
                      {visibleColumnIds.map(renderHeaderCell)}
                      {showActionsColumn && (
                        <div
                          className="col-header justify-end relative"
                          title="작업 관리(편집·삭제 등) · 더블클릭: 너비 초기화"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleColumnHeaderDoubleClick('actions');
                          }}
                          onContextMenu={(e) => handleHeaderContextMenu(e)}
                        >
                          관리
                          {resizeGrip('actions')}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Rows */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {(() => {
                    // `displayWbsMap`은 `wbsSettings.maxLevel`보다 깊은 레벨에서 WBS 표기를 숨기기 위해 빈 문자열('')을 줄 수 있다.
                    // 하지만 하위 WBS 자체를 테이블에서 숨기면 "특정 레벨 이상 펼쳐지지 않는" 현상처럼 보일 수 있으므로,
                    // 렌더링은 유지하고 표기만 비운다.
                    const tasksForRender = visibleTasks;
                    const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : null;
                    const topPad = virtualItems ? (virtualItems[0]?.start ?? 0) : 0;
                    const bottomPad = virtualItems ? rowVirtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0) : 0;
                    const itemsToRender = virtualItems
                      ? virtualItems.map((v) => ({ task: tasksForRender[v.index], rowIndex: v.index }))
                      : tasksForRender.map((task, rowIndex) => ({ task, rowIndex }));
                    return (
                      <SortableContext items={tasksForRender.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
                        {itemsToRender.map(({ task, rowIndex }) => (
                          <React.Fragment key={task.id}>
                            <SortableTaskRow
                              rowIndex={rowIndex}
                              task={task}
                              dropIndicator={dropTarget?.overId === task.id ? dropTarget.position : null}
                              wbsId={wbsMap.get(task.id)}
                              displayWbsId={displayWbsMap.get(task.id)}
                              displayWbsMap={displayWbsMap}
                              taskIdToSeqNum={taskIdToSeqNum}
                              seqNumToTaskId={seqNumToTaskId}
                              isSelected={selectedTaskIds.has(task.id)}
                              isFocused={lastSelectedId === task.id || activeTaskId === task.id}
                              hasChildren={hasChildrenSet.has(task.id)}
                              isTreeView={isTreeView}
                              treeGuide={treeGuideByTaskId.get(task.id) ?? ''}
                              onSelect={handleSelect}
                              onFocusRow={handleFocusRow}
                              onSetRowAnchor={(id) => {
                                rangeAnchorRef.current = id;
                                setAnchorTaskId(id);
                              }}
                              canEdit={canEditCurrentProject && !task.mirroredFromTaskId}
                              onEdit={setEditingTask}
                              onDeleteClick={handleDeleteClick}
                              onContextMenu={handleContextMenu}
                              toggleExpand={toggleExpand}
                              gridStyle={gridStyle}
                              visibleColumnIds={visibleColumnIds}
                              showActionsColumn={showActionsColumn}
                              isInlineEditingName={inlineEditingNameId === task.id}
                              setInlineEditingNameId={setInlineEditingNameIdCommitted}
                              onInsertRowAbove={insertRowAbove}
                              onAdvanceInlineEditToNextRow={advanceInlineEditToNextRow}
                              editingCell={editingCell}
                              setEditingCell={setEditingCell}
                              focusedCell={focusedCell}
                              setFocusedCell={setFocusedCell}
                              allAssignees={allAssignees}
                              assigneeOptionsByProjectId={assigneeOptionsByProjectId}
                              updateTask={updateTask}
                              statusConfigs={wbsSettings?.statusConfigs ?? []}
                              projectAssignmentsByProjectId={projectAssignmentsByProjectId}
                              allProjectTasks={tasks}
                              updateProject={updateProject}
                              criticalPathSet={effectiveCriticalPathSet}
                              allocationDisplayText={allocationDisplayByTaskId.get(task.id) ?? '—'}
                              otherFocusByCellKey={otherFocusByCellKey}
                              customColumnNameById={customColumnNameById}
                              projectEffortUnitByProjectId={projectEffortUnitByProjectId}
                              projectScheduleByProjectId={projectScheduleByProjectId}
                              prependDisplayWbsToTaskName={wbsSettings?.prependDisplayWbsToTaskName === true}
                              rollupTooltipBaseTasks={baseTasks}
                              plannedProgress={plannedProgressById.get(task.id)}
                              showTableAutoFormatting={showTableAutoFormatting}
                              singleClickEdit={singleClickEdit}
                              forkedChildProject={forkedProjectsByTaskId.get(task.id)}
                              onOpenForkedChildProject={(childId) => setCurrentProjectId(childId)}
                            />
                            {inlineAddingTaskId === task.id && (
                              <div className="data-row bg-indigo-50/60 border-dashed" style={gridStyle}>
                                <div className="data-cell justify-center text-indigo-400 font-bold text-[10px]">*</div>
                                <div className="data-cell justify-center"></div>
                                <div className="data-cell justify-center"></div>
                                <div className="data-cell justify-center text-indigo-400">
                                  <CornerDownRight size={14} />
                                </div>
                                {visibleColumnIds.map((colId) => {
                                  if (colId === 'name') {
                                    return (
                                      <div
                                        key={colId}
                                        className="data-cell p-0"
                                        style={{ paddingLeft: `${((task.parentId === null ? 0 : task.depth || 0) + 1) * 20 + 12}px` }}
                                      >
                                        <form
                                          onSubmit={(e) => handleInlineQuickAdd(e, task.parentId)}
                                          className="flex w-full h-full relative group/form"
                                        >
                                          <input
                                            autoFocus
                                            autoComplete="off"
                                            data-quick-add
                                            type="text"
                                            value={quickAddInlineValue}
                                            onChange={(e) => setQuickAddInlineValue(e.target.value)}
                                            onBlur={() => {
                                              setInlineAddingTaskId(null);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape') {
                                                setInlineAddingTaskId(null);
                                              }
                                              e.stopPropagation();
                                            }}
                                            onPaste={(e) => {
                                              if (!canEditCurrentProject) return;
                                              const pasteText = e.clipboardData.getData('text');
                                              if (!pasteText || !pasteText.includes('\n')) {
                                                return;
                                              }
                                              e.preventDefault();
                                              const lines = pasteText
                                                .split(/\r?\n/)
                                                .map((line) => line.trim())
                                                .filter((line) => line.length > 0);
                                              if (lines.length === 0) return;

                                              const proj = projects.find((p) => p.id === (task.projectId || currentProjectId));
                                              const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

                                              const startIso = filters.startDate || defaultDate;
                                              const endIso = filters.endDate || defaultEndDateForNewTask(startIso);
                                              lines.forEach((line) => {
                                                addTask({
                                                  name: line,
                                                  parentId: task.id,
                                                  startDate: startIso,
                                                  endDate: endIso,
                                                  progress: 0,
                                                  workEffort: DEFAULT_NEW_TASK_WORK_EFFORT,
                                                  assignee: filters.assignee || '',
                                                  status: 'todo',
                                                });
                                              });

                                              setQuickAddInlineValue('');
                                              setInlineAddingTaskId(null);
                                              setInsertTargetId(null);
                                            }}
                                            placeholder="작업명 입력 후 Enter..."
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-indigo-600 placeholder:text-indigo-300 h-full py-2 px-2"
                                          />
                                          <button
                                            type="submit"
                                            onMouseDown={(e) => e.preventDefault()}
                                            className="absolute right-0 top-0 bottom-0 text-[10px] font-bold text-white bg-indigo-500 uppercase px-3 hover:bg-indigo-600 transition-colors opacity-0 group-hover/form:opacity-100"
                                          >
                                            확인
                                          </button>
                                        </form>
                                      </div>
                                    );
                                  }
                                  if (colId === 'wbsId') {
                                    return (
                                      <div key={colId} className="data-cell text-[10px] font-mono text-indigo-400">
                                        신규
                                      </div>
                                    );
                                  }
                                  return <div key={colId} className="data-cell"></div>;
                                })}
                                {showActionsColumn && <div className="data-cell"></div>}
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                        {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
                      </SortableContext>
                    );
                  })()}
                </DndContext>

                {visibleTasks.length === 0 && tasks.length === 0 && !canEditCurrentProject && (
                  <div className="p-12 text-center text-slate-400 italic font-serif bg-slate-50/30">등록된 작업이 없습니다.</div>
                )}
                {visibleTasks.length === 0 && tasks.length === 0 && canEditCurrentProject && (
                  <div className="px-4 py-2 text-[12px] text-slate-500 bg-slate-50/40 border-b border-slate-200/60">
                    아래 빈 행을 클릭하면 첫 작업이 추가되고 작업명 편집 모드로 진입합니다. ↓·Enter로도 가능.
                  </div>
                )}
                {visibleTasks.length === 0 && tasks.length > 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <p className="text-sm">필터 조건에 맞는 작업이 없습니다.</p>
                    <button type="button" onClick={() => onResetFilters?.()} className="text-xs text-[var(--color-accent)] hover:underline">
                      필터 초기화
                    </button>
                  </div>
                )}
                {/* 엑셀 스타일 placeholder 행: 마지막 데이터 행 아래에 빈 셀을 미리 표시.
                    클릭 / ↓ 화살표로 진입 → Enter/F2/문자 입력으로 즉시 새 작업 생성 + 인라인 편집.
                    빈 표(작업 0개)에서도 행을 표시해 엑셀처럼 즉시 입력 가능하게 한다. */}
                {(() => {
                  const isFullyEmpty = visibleTasks.length === 0 && tasks.length === 0;
                  const showGhost = canEditCurrentProject && (visibleTasks.length > 0 || isFullyEmpty);
                  if (!showGhost) return null;
                  const count = isFullyEmpty ? 10 : GHOST_PLACEHOLDER_ROW_COUNT;
                  return Array.from({ length: count }).map((_, gi) => {
                    const isFocused = ghostFocusIdx === gi;
                    return (
                      <div
                        key={`ghost-row-${gi}`}
                        data-ghost-row={gi}
                        className={cn(
                          'data-row flex-shrink-0 border-b border-dashed border-slate-200/60 cursor-cell select-none',
                          'transition-colors hover:bg-indigo-50/40',
                          isFocused && 'bg-indigo-50/70',
                        )}
                        style={{
                          ...gridStyle,
                          ...(isSplitView ? { height: rowHeight, minHeight: rowHeight, maxHeight: rowHeight } : undefined),
                          // 빈 표에서는 행이 더 또렷이 보이도록 opacity를 높게.
                          opacity: isFullyEmpty ? Math.max(0.35, 0.78 - gi * 0.04) : Math.max(0.25, 0.55 - gi * 0.06),
                        }}
                        onClick={() => activateGhostRow()}
                        title="클릭 또는 Enter로 새 작업 추가"
                      >
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        <div className="data-cell"></div>
                        {visibleColumnIds.map((colId) => {
                          if (colId !== 'name') return <div key={colId} className="data-cell"></div>;
                          return (
                            <div
                              key={colId}
                              className={cn(
                                'data-cell text-xs italic text-slate-400',
                                isFocused && 'ring-2 ring-indigo-400 ring-inset text-indigo-500',
                              )}
                            >
                              {gi === 0 ? (isFullyEmpty ? '+ 첫 작업 추가 — 클릭하여 시작' : '+ 새 작업 (클릭 또는 ↓ Enter)') : ''}
                            </div>
                          );
                        })}
                        {showActionsColumn && <div className="data-cell"></div>}
                      </div>
                    );
                  });
                })()}
                {canEditCurrentProject && (
                  <div
                    data-tourid="tour-quick-add"
                    className="min-w-fit w-full border-t border-indigo-200/70 bg-indigo-50/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                  >
                    <div
                      className="data-row flex-shrink-0 bg-indigo-50/70 border-b border-indigo-200/70 shadow-sm box-border"
                      style={{
                        ...gridStyle,
                        ...(isSplitView ? { height: rowHeight, minHeight: rowHeight, maxHeight: rowHeight } : undefined),
                      }}
                    >
                      <div className="data-cell"></div>
                      <div className="data-cell"></div>
                      <div className="data-cell"></div>
                      <div className="data-cell justify-center text-indigo-500">
                        <Plus size={14} />
                      </div>
                      {visibleColumnIds.map((colId) => {
                        if (colId !== 'name') return <div key={colId} className="data-cell"></div>;
                        return (
                          <div key={colId} className="data-cell p-0">
                            <form onSubmit={handleQuickAdd} className="flex w-full h-full">
                              <input
                                data-quick-add
                                ref={bottomQuickAddInputRef}
                                type="text"
                                autoComplete="off"
                                value={quickAddBottomValue}
                                onChange={(e) => setQuickAddBottomValue(e.target.value)}
                                placeholder="+ 새 작업 추가 (Enter 키 입력)..."
                                className="flex-1 min-w-0 bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-semibold text-indigo-900 placeholder:text-indigo-500 placeholder:font-medium h-full px-3"
                              />
                            </form>
                          </div>
                        );
                      })}
                      {showActionsColumn && <div className="data-cell"></div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* 표+간트: 표 본문 하단 가로 스크롤바 — 좌우 이동 가능. 헤더·본문과 scrollLeft 동기화.
                간트 하단 스크롤바(14px)와 같은 높이로 두 패널의 세로 뷰포트가 행 단위로 정렬되게 한다. */}
            {isSplitView && !excelView && (
              <div
                ref={tableBottomScrollRef}
                className="gantt-hscroll flex-shrink-0 overflow-x-scroll overflow-y-hidden border-t border-slate-200 bg-slate-100"
                style={{ height: 14 }}
                title="좌우로 드래그해 표 화면을 이동"
                onScroll={(e) => {
                  if (isSyncingScrollRef.current) return;
                  isSyncingScrollRef.current = true;
                  const sl = e.currentTarget.scrollLeft;
                  if (tableScrollRef.current) tableScrollRef.current.scrollLeft = sl;
                  if (headerScrollRef.current) headerScrollRef.current.scrollLeft = sl;
                  requestAnimationFrame(() => {
                    isSyncingScrollRef.current = false;
                  });
                }}
              >
                <div style={{ width: totalGridWidth, height: 1 }} />
              </div>
            )}
          </div>
        )}
        {excelView && (
          <div className="flex-1 min-h-[320px] border border-slate-200 rounded-xl overflow-hidden bg-white">
            <React.Suspense fallback={null}>
              <ExcelGrid tasks={visibleTasks} displayWbsMap={displayWbsMap} onTaskChange={updateTask} />
            </React.Suspense>
          </div>
        )}
      </div>

      {/* (셀 서식 툴바는 상단 도킹 오버레이로 이동 — content 상단의 showCellFormatToolbar 블록 참조) */}

      {/* 클립보드 안내 칩 — 복사하면 화면 좌측 하단에 계속 떠서 ① 복사됨 확인 ② 붙여넣기 위치 안내 ③ 붙여넣기/지우기 버튼 제공.
          토스트(잠깐 뜨고 사라짐)와 달리 복사한 작업이 남아 있는 동안 지속 표시되어 "어디서 어떻게 붙여넣는지"를 분명히 한다. */}
      {copiedTasks.length > 0 &&
        !excelView &&
        createPortal(
          <div
            className="fixed z-[95] pointer-events-none"
            style={{
              left: 'max(12px, env(safe-area-inset-left, 0px))',
              // 일괄 수정 바(하단 중앙, 높이 ~183px)가 떠 있으면 그 위로 올려 겹침 방지.
              bottom:
                selectedTaskIds.size > 1
                  ? 'calc(clamp(215px, 30dvh, 340px) + env(safe-area-inset-bottom, 0px))'
                  : 'max(12px, calc(12px + env(safe-area-inset-bottom, 0px)))',
            }}
          >
            <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-white/95 backdrop-blur-md shadow-xl ring-1 ring-emerald-500/10 px-3 py-2.5 animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-[min(92vw,440px)]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <ClipboardPaste size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-slate-800 leading-tight">작업 {copiedTasks.length}개 복사됨</div>
                <div className="text-[11px] text-slate-500 leading-snug truncate">
                  {canEditCurrentProject ? (
                    <>
                      붙여넣기 → <span className="font-semibold text-emerald-700">{pasteTargetLabel}</span>에 추가
                    </>
                  ) : (
                    '보기 전용 프로젝트 — 붙여넣기 불가'
                  )}
                </div>
              </div>
              {canEditCurrentProject && (
                <button
                  type="button"
                  onClick={handlePasteTasksFromClipboard}
                  className="shrink-0 flex items-center gap-1.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 px-3.5 py-1.5 rounded-lg transition-colors shadow-sm"
                  title={`복사한 ${copiedTasks.length}개 작업을 ${pasteTargetLabel}에 붙여넣습니다. 다른 행을 클릭하면 그 행 아래로 위치가 바뀝니다. (트리·선행관계 보존 · 단축키 Ctrl+V)`}
                >
                  <ClipboardPaste size={14} />
                  붙여넣기
                </button>
              )}
              <button
                type="button"
                onClick={clearTaskClipboard}
                className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                title="복사 취소 (클립보드 비우기)"
                aria-label="클립보드 비우기"
              >
                <X size={14} />
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Bulk Action Bar — body 포털: overflow-hidden 조상에 가려지지 않도록. 하단 safe-area·여백 확보. */}
      {selectedTaskIds.size > 1 &&
        createPortal(
          <div
            className="fixed left-0 right-0 z-[100] pointer-events-none flex justify-center px-3 sm:px-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
            style={{
              bottom: 'max(16px, calc(16px + env(safe-area-inset-bottom, 0px)))',
            }}
          >
            <div className="pointer-events-auto min-w-0 max-w-full w-max overflow-x-auto overflow-y-visible rounded-2xl border border-white/40 border-t-white bg-glass-elevated shadow-2xl">
              {/* Header */}
              <div className="bg-indigo-600/90 backdrop-blur-sm px-4 py-2 flex items-center justify-between gap-6">
                <span className="text-[11px] font-bold text-white tracking-widest uppercase">일괄 수정</span>
                <div className="flex items-center gap-2">
                  <span className="bg-white/20 text-white text-[10px] font-black px-2 py-0.5 rounded-full tracking-wide">
                    {selectedTaskIds.size}개 선택됨
                  </span>
                  <button
                    onClick={() => {
                      setSelection(new Set());
                      resetBulkFields();
                    }}
                    className="text-white/60 hover:text-white transition-colors hover:rotate-90 duration-300"
                    title="선택 해제"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Fields + Actions */}
              <div className="px-4 py-3 pb-4 flex flex-wrap items-end gap-3">
                {/* 상태 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">상태</label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    className={cn(
                      'px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer',
                      bulkStatus ? 'border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-500',
                    )}
                  >
                    <option value="">변경 없음</option>
                    {(wbsSettings?.statusConfigs ?? []).map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 작업 유형(마일스톤·이슈·액션) */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">유형</label>
                  <select
                    value={bulkTaskKind}
                    onChange={(e) => setBulkTaskKind(e.target.value as typeof bulkTaskKind)}
                    title="일괄로 마일스톤·이슈·액션 항목 여부를 지정합니다. 마일스톤은 종료일을 시작일에 맞추고 공수를 0으로 맞춥니다."
                    className={cn(
                      'px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white cursor-pointer min-w-[8.5rem]',
                      bulkTaskKind ? 'border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-500',
                    )}
                  >
                    <option value="">변경 없음</option>
                    <option value="plain">일반 작업</option>
                    <option value="milestone">마일스톤</option>
                    <option value="issue">이슈</option>
                    <option value="action">액션 항목</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">담당자</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        list="all-assignees"
                        value={bulkAssignee}
                        onChange={(e) => setBulkAssignee(e.target.value)}
                        placeholder="조직 회원에서 검색 또는 직접 입력"
                        title="조직 회원·프로젝트 등록 인원 목록에서 선택하거나 직접 입력. Enter로 적용."
                        className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-56"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') executeBulkAssignee();
                        }}
                      />
                      <datalist id="all-assignees">
                        {bulkAssigneeCandidates.map((name) => {
                          const label = bulkAssigneeLabelByName.get(name);
                          return label ? <option key={name} value={name} label={label} /> : <option key={name} value={name} />;
                        })}
                      </datalist>
                    </div>
                  </div>
                </div>

                {/* 공수 — 프로젝트 단위에 맞게 입력 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">
                    {workEffortHeaderTitle}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={bulkWorkEffort}
                    onChange={(e) => setBulkWorkEffort(e.target.value)}
                    placeholder={`${workEffortHeaderTitle} 일괄`}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-36"
                  />
                </div>

                {/* 진척율(%) — 0~100 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">진척율(%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={bulkProgress}
                    onChange={(e) => setBulkProgress(e.target.value)}
                    placeholder="0~100"
                    title={[
                      '선택한 작업에 동일한 진척률을 일괄 적용합니다.',
                      '',
                      PROGRESS_COLUMN_HELP_TEXT,
                      '',
                      '요약(하위 있음) 행에 적용한 뒤에도, 저장·동기화 후 자식 기준 롤업이 다시 덮어쓸 수 있습니다.',
                    ].join('\n')}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-28"
                  />
                </div>

                {/* 가중치 — 0 이상. 비워두면 기존값 유지 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">가중치</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={bulkWeight}
                    onChange={(e) => setBulkWeight(e.target.value)}
                    placeholder="가중치 일괄 지정..."
                    title={['선택한 작업에 동일한 가중치를 일괄 적용합니다.', '', WEIGHT_COLUMN_HELP_TEXT].join('\n')}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-32"
                  />
                </div>

                {/* 시작일 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">시작일</label>
                  <input
                    type="date"
                    value={bulkStartDate}
                    onChange={(e) => setBulkStartDate(e.target.value)}
                    className={cn(
                      'px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-36',
                      bulkStartDate ? 'border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-500',
                    )}
                  />
                </div>

                {/* 완료일(종료일) */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">완료일</label>
                  <input
                    type="date"
                    value={bulkEndDate}
                    onChange={(e) => setBulkEndDate(e.target.value)}
                    className={cn(
                      'px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-36',
                      bulkEndDate ? 'border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-500',
                    )}
                  />
                </div>

                {/* 투입율(%) — 0~100 */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">투입율(%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={bulkAllocation}
                    onChange={(e) => setBulkAllocation(e.target.value)}
                    placeholder="0~100"
                    title="선택된 작업의 담당자 투입율을 일괄 설정합니다."
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-28"
                  />
                </div>

                {/* 적용 버튼 - 상태, 유형, 담당자, 공수, 진척율, 가중치, 시작일, 완료일, 투입율 등 입력된 모든 항목 일괄 적용 */}
                <button
                  onClick={executeBulkEdit}
                  disabled={
                    !bulkStatus &&
                    !bulkTaskKind &&
                    !bulkAssignee.trim() &&
                    (bulkWorkEffort === '' || isNaN(parseFloat(bulkWorkEffort))) &&
                    (bulkProgress === '' || isNaN(parseFloat(bulkProgress))) &&
                    (bulkPlannedProgress === '' || isNaN(parseFloat(bulkPlannedProgress))) &&
                    (bulkWeight === '' || isNaN(parseFloat(bulkWeight))) &&
                    !bulkStartDate.trim() &&
                    !bulkEndDate.trim() &&
                    (bulkAllocation === '' || isNaN(parseFloat(bulkAllocation)))
                  }
                  className="self-end text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 px-5 py-1.5 rounded-lg transition-colors"
                  title="입력한 항목 모두 적용"
                >
                  적용
                </button>

                {canEditCurrentProject && selectedTaskIds.size >= 2 && (
                  <button
                    type="button"
                    onClick={executeBulkLinkSequentialPredecessors}
                    className="flex items-center gap-2 text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
                    title="표에 보이는 순서대로, 위에서 아래로 이전 행을 각 행의 선행작업으로 연결합니다."
                  >
                    <Link2 size={14} />
                    선행 순차 연결
                  </button>
                )}

                <button
                  onClick={executeBulkClearDependencies}
                  className="flex items-center gap-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
                  title="선택한 작업들의 선행작업을 모두 제거"
                >
                  <Unlink size={14} />
                  선행작업 지우기
                </button>

                {canEditCurrentProject && (
                  <button
                    type="button"
                    onClick={() => {
                      // 선택된 각 작업의 「진척률」을 「현재 계획율(자동 산정값)」으로 일괄 설정.
                      // 종료일이 지난 작업은 100%로, 진행 중인 작업은 일정 진행률(%)로 채워진다.
                      let n = 0;
                      for (const id of selectedTaskIds) {
                        const t = tasks.find((x) => x.id === id);
                        if (!t) continue;
                        const planned = plannedProgressById.get(t.id);
                        if (typeof planned !== 'number' || !Number.isFinite(planned)) continue;
                        const v = round2(planned);
                        if (Number(t.progress ?? 0) !== v) {
                          updateTask(t.id, { progress: v });
                          n += 1;
                        }
                      }
                      pushToast(
                        n > 0
                          ? `진척률을 현재 계획율로 맞췄습니다. (${n}개 작업, 기준일 ${effectivePlannedRef ?? '오늘'})`
                          : '변경 사항이 없습니다. (이미 진척률 = 계획율)',
                        { variant: n > 0 ? 'success' : 'info' },
                      );
                    }}
                    className="flex items-center gap-2 text-sky-700 hover:text-sky-800 hover:bg-sky-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
                    title={[
                      '선택한 각 작업의 「진척률(%)」을 「현재 계획율(자동 산정값)」으로 일괄 설정합니다.',
                      '- 종료일이 기준일을 지난 작업 → 100%로 채워짐',
                      '- 진행 중인 작업 → 일정 진행률(%)로 채워짐',
                      '- 시작 전 작업 → 0%',
                      '결과: 차이(%P) = 0 (계획대로 진행 중인 것으로 표시).',
                      '실행취소(Ctrl+Z)로 되돌릴 수 있습니다.',
                    ].join('\n')}
                  >
                    <Equal size={14} />
                    진척률 = 계획율
                  </button>
                )}

                <div className="h-4 w-px bg-slate-200" />

                {/* 행 단위 복사 (읽기 동작 — 권한 무관). 붙여넣기는 복사 후 화면에 떠 있는 '클립보드 안내 칩'에서 수행. */}
                <button
                  type="button"
                  onClick={handleBulkCopySelected}
                  className="flex items-center gap-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
                  title={`선택한 ${selectedTaskIds.size}개 작업을 복사합니다. 복사하면 화면 좌측 하단에 '붙여넣기' 안내가 나타납니다. (하위 구조·선행관계까지 그대로 추가)`}
                >
                  <Copy size={14} />
                  복사
                </button>

                {canEditCurrentProject && (
                  <button
                    onClick={() => setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) })}
                    className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
                    title="선택된 모든 작업 삭제"
                  >
                    <Trash2 size={14} />
                    삭제
                  </button>
                )}
                <button
                  onClick={() => setSelection(new Set())}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors self-end"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {editingTask && (
        <React.Suspense fallback={null}>
          <TaskModal
            isOpen
            onClose={() => setEditingTask(null)}
            onSave={handleSave}
            initialData={editingTask || undefined}
            parentOptions={tasks}
            onOpenTask={(task) => setEditingTask(task)}
          />
        </React.Suspense>
      )}

      {isMdEditModalOpen && (
        <React.Suspense fallback={null}>
          <MdEditModal
            isOpen={isMdEditModalOpen}
            onClose={() => {
              setIsMdEditModalOpen(false);
              setMdEditInitialMarkdown('');
            }}
            initialMarkdown={mdEditInitialMarkdown}
            onSave={(editedMarkdown) => {
              const rows = parseMarkdownTable(editedMarkdown);
              const wbsCodeToTaskId = new Map([...wbsMap].map(([id, code]) => [code, id]));
              let updated = 0;
              for (const row of rows) {
                const taskId = wbsCodeToTaskId.get(row.wbsCode);
                if (!taskId) continue;
                const updates: Partial<Task> = {
                  name: row.name,
                  progress: row.progress,
                  assignee: row.assignee,
                  status: row.status,
                };
                if (row.startDate) updates.startDate = row.startDate;
                if (row.endDate) updates.endDate = row.endDate;
                if (row.workEffort != null) updates.workEffort = row.workEffort;
                updateTask(taskId, updates);
                updated += 1;
              }
              if (updated > 0) {
                pushToast(`표가 마크다운 내용으로 반영되었습니다. (${updated}개 작업)`, { variant: 'success' });
              } else if (rows.length === 0) {
                pushToast('테이블 형식의 행을 찾을 수 없습니다. WBS 코드(**1**, **1.1** 등)가 있는 행만 반영됩니다.', {
                  variant: 'warning',
                });
              } else {
                pushToast('매칭되는 작업이 없어 반영되지 않았습니다. WBS 코드를 변경하지 마세요.', { variant: 'warning' });
              }
            }}
          />
        </React.Suspense>
      )}

      {improvementGuideOpen && (
        <React.Suspense fallback={null}>
          <WbsImprovementGuideModal
            isOpen
            onClose={() => setImprovementGuideOpen(false)}
            steps={improvementGuideSteps}
            onJumpToTask={scrollTaskIntoView}
          />
        </React.Suspense>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={
            contextMenu.type === 'header'
              ? (() => {
                  const colId = contextMenu.columnId;
                  const sortableColumns: TableColumnId[] = [
                    'name',
                    'startDate',
                    'endDate',
                    'workEffort',
                    'weight',
                    'progress',
                    'assignee',
                    'status',
                  ];
                  const canSort = colId && (sortableColumns.includes(colId) || colId === 'wbsId');
                  const canHide = colId && colId !== 'name';
                  const isCustom = !!colId && colId.startsWith('custom:');
                  const visibleIds = (wbsSettings?.tableColumns ?? []).filter((c) => c.visible !== false).map((c) => c.id);
                  const visPos = colId ? visibleIds.indexOf(colId) : -1;
                  const canMoveLeft = visPos > 0;
                  const canMoveRight = visPos >= 0 && visPos < visibleIds.length - 1;
                  const headerActions: ContextMenuAction[] = [];
                  if (colId) {
                    if (canSort) {
                      headerActions.push({
                        label: '이 컬럼으로 정렬',
                        icon: <ArrowUpDown size={14} />,
                        onClick: () => onSort(colId === 'wbsId' ? 'wbs' : (colId as keyof Task)),
                      });
                    }
                    if (isCustom) {
                      headerActions.push({
                        label: '이름 바꾸기',
                        icon: <Edit2 size={14} />,
                        onClick: () => setEditingHeaderColId(colId),
                      });
                    }
                    if (canMoveLeft || canMoveRight) {
                      if (headerActions.length > 0) headerActions.push({ divider: true });
                      if (canMoveLeft) {
                        headerActions.push({
                          label: '왼쪽으로 이동',
                          icon: <ArrowLeft size={14} />,
                          onClick: () => moveColumn(colId, 'left'),
                        });
                      }
                      if (canMoveRight) {
                        headerActions.push({
                          label: '오른쪽으로 이동',
                          icon: <ArrowRight size={14} />,
                          onClick: () => moveColumn(colId, 'right'),
                        });
                      }
                    }
                    headerActions.push({ divider: true });
                    headerActions.push({
                      label: '왼쪽에 컬럼 추가',
                      icon: <Plus size={14} />,
                      onClick: () => insertCustomColumn(colId, 'left'),
                    });
                    headerActions.push({
                      label: '오른쪽에 컬럼 추가',
                      icon: <Plus size={14} />,
                      onClick: () => insertCustomColumn(colId, 'right'),
                    });
                    headerActions.push({ divider: true });
                    if (canHide) {
                      headerActions.push({
                        label: '컬럼 숨기기',
                        icon: <EyeOff size={14} />,
                        onClick: () => {
                          const cols = (wbsSettings?.tableColumns ?? []).map((c) => (c.id === colId ? { ...c, visible: false } : c));
                          updateWbsSettings({ tableColumns: cols });
                        },
                      });
                    }
                    if ((columnWidths as Record<string, number>)[colId] !== undefined) {
                      headerActions.push({
                        label: '컬럼 너비 초기화',
                        icon: <RotateCcw size={14} />,
                        onClick: () => {
                          handleColumnHeaderDoubleClick(colId);
                        },
                      });
                    }
                    if (isCustom) {
                      headerActions.push({
                        label: '컬럼 삭제',
                        icon: <Trash2 size={14} />,
                        danger: true,
                        onClick: () => deleteCustomColumn(colId),
                      });
                    }
                  } else {
                    headerActions.push({
                      label: '전체 펼치기',
                      icon: <ChevronDown size={14} />,
                      onClick: () => expandToLevel(maxTreeLevel),
                    });
                    headerActions.push({
                      label: '전체 접기',
                      icon: <ChevronUp size={14} />,
                      onClick: () => expandToLevel(1),
                    });
                    headerActions.push({ divider: true });
                    headerActions.push({
                      label: '컬럼 추가',
                      icon: <Plus size={14} />,
                      onClick: () => insertCustomColumn(null, 'right'),
                    });
                  }
                  // 숨긴 컬럼을 헤더 우클릭으로 바로 다시 표시 (컬럼 설정 모달 없이도)
                  const hiddenCols = tableColumns.filter((c) => !c.visible && c.id !== 'actions');
                  if (hiddenCols.length > 0) {
                    headerActions.push({ divider: true });
                    for (const hc of hiddenCols) {
                      const hcId = hc.id;
                      const hcLabel =
                        customColumnNameById.get(hcId) || COLUMN_HEADER_LABELS[hcId as keyof typeof COLUMN_HEADER_LABELS] || hcId;
                      headerActions.push({
                        label: `${hcLabel} 표시`,
                        icon: <Eye size={14} />,
                        onClick: () => {
                          const cols = (wbsSettings?.tableColumns ?? []).map((c) => (c.id === hcId ? { ...c, visible: true } : c));
                          updateWbsSettings({ tableColumns: cols });
                        },
                      });
                    }
                  }
                  if (onOpenColumnSettings) {
                    headerActions.push({ divider: true });
                    headerActions.push({
                      label: '컬럼 설정...',
                      icon: <Settings2 size={14} />,
                      onClick: () => onOpenColumnSettings?.(),
                    });
                  }
                  return headerActions;
                })()
              : (() => {
                  // mirror task(자식 프로젝트의 거울)는 부모 프로젝트에서 read-only.
                  // 자식 프로젝트로 이동하는 단일 메뉴만 제공한다.
                  const taskForMenu = contextMenu.taskId ? tasks.find((t) => t.id === contextMenu.taskId) : undefined;
                  if (taskForMenu?.mirroredFromTaskId && taskForMenu?.mirroredFromProjectId) {
                    return [
                      {
                        label: '자식 프로젝트에서 열기',
                        icon: <GitBranch size={14} />,
                        onClick: () => {
                          setCurrentProjectId(taskForMenu.mirroredFromProjectId!);
                          setContextMenu(null);
                        },
                      },
                    ];
                  }
                  return [
                    ...(contextMenu.columnId === 'progress' || contextMenu.columnId === 'status'
                      ? [
                          {
                            label: '갱신',
                            icon: <RefreshCw size={14} />,
                            onClick: handleSyncProgressFromStatus,
                          },
                        ]
                      : []),
                    // 진척 셀 우클릭 — 진척률을 현재 계획율(자동)로 일괄 설정 (종료된 작업은 100%, 진행중은 일정 진행률).
                    ...(canEditCurrentProject && contextMenu.columnId === 'progress'
                      ? [
                          {
                            label: '진척률 = 계획율(자동)',
                            icon: <Equal size={14} />,
                            onClick: () => {
                              const ids =
                                selectedTaskIds.size > 1 && contextMenu.taskId && selectedTaskIds.has(contextMenu.taskId)
                                  ? Array.from(selectedTaskIds)
                                  : contextMenu.taskId
                                    ? [contextMenu.taskId]
                                    : [];
                              let n = 0;
                              for (const id of ids) {
                                const t = tasks.find((x) => x.id === id);
                                if (!t) continue;
                                const planned = plannedProgressById.get(t.id);
                                if (typeof planned !== 'number' || !Number.isFinite(planned)) continue;
                                const v = round2(planned);
                                if (Number(t.progress ?? 0) !== v) {
                                  updateTask(t.id, { progress: v });
                                  n += 1;
                                }
                              }
                              pushToast(n > 0 ? `진척률을 계획율로 맞췄습니다. (${n}개 작업)` : '변경 사항이 없습니다.', {
                                variant: n > 0 ? 'success' : 'info',
                              });
                              setContextMenu(null);
                            },
                          },
                        ]
                      : []),
                    // (계획율 수동 지정 기능 제거됨 — 계획율은 시작일·종료일 기반 자동 계산만 사용)
                    {
                      label: '수정',
                      icon: <Edit2 size={14} />,
                      onClick: () => {
                        const task = tasks.find((t) => t.id === contextMenu.taskId);
                        if (task) setEditingTask(task);
                      },
                    },
                    {
                      label: '하위 작업 추가',
                      icon: <CornerDownRight size={14} />,
                      onClick: () => {
                        const parent = tasks.find((t) => t.id === contextMenu.taskId);
                        if (parent) {
                          const proj = projects.find((p) => p.id === (parent.projectId || currentProjectId));
                          const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
                          setEditingTask({
                            id: '', // New task marker
                            parentId: parent.id,
                            name: '',
                            startDate: defaultDate,
                            endDate: defaultDate,
                            progress: 0,
                            assignee: '',
                            status: 'todo',
                          } as Task);
                        }
                      },
                    },
                    ...(contextMenu.taskId && canEditCurrentProject
                      ? (() => {
                          const taskId = contextMenu.taskId;
                          const already = forkedProjectsByTaskId.get(taskId);
                          if (already) {
                            return [
                              {
                                label: `분기 프로젝트로 이동 (${already.name})`,
                                icon: <GitBranch size={14} />,
                                onClick: () => {
                                  setCurrentProjectId(already.id);
                                  setContextMenu(null);
                                },
                              },
                            ];
                          }
                          return [
                            {
                              label: '신규 프로젝트로 분기...',
                              icon: <GitBranch size={14} />,
                              onClick: () => {
                                const task = tasks.find((t) => t.id === taskId);
                                if (!task) return;
                                const proj = projects.find((p) => p.id === task.projectId);
                                if (!proj) {
                                  pushToast('원본 프로젝트를 찾을 수 없습니다.', { variant: 'error' });
                                  return;
                                }
                                // descendants 개수 계산 (안내용)
                                const childrenBy = new Map<string, string[]>();
                                for (const t of tasks) {
                                  if (!t.parentId || t.projectId !== task.projectId) continue;
                                  const arr = childrenBy.get(t.parentId);
                                  if (arr) arr.push(t.id);
                                  else childrenBy.set(t.parentId, [t.id]);
                                }
                                let count = 0;
                                const stack = [taskId];
                                while (stack.length) {
                                  const id = stack.pop()!;
                                  const ch = childrenBy.get(id);
                                  if (!ch) continue;
                                  for (const cid of ch) {
                                    count++;
                                    stack.push(cid);
                                  }
                                }
                                setForkTarget({ sourceTask: task, sourceProject: proj, descendantCount: count });
                                setContextMenu(null);
                              },
                            },
                          ];
                        })()
                      : []),
                    // 체크박스 다중 선택 행 복사 — Ctrl+C와 동일 (복사는 읽기 동작이므로 편집 권한 불필요)
                    ...(selectedTaskIds.size >= 2 && contextMenu.taskId && selectedTaskIds.has(contextMenu.taskId)
                      ? [
                          {
                            label: `복사 (${selectedTaskIds.size})`,
                            icon: <Copy size={14} />,
                            onClick: () => {
                              handleBulkCopySelected();
                              setContextMenu(null);
                            },
                          },
                        ]
                      : []),
                    // 복사된 작업이 있으면 우클릭 메뉴에서도 붙여넣기 (기준 행 뒤에 추가)
                    ...(canEditCurrentProject && contextMenu.taskId && copiedTasks.length > 0
                      ? [
                          {
                            label: `붙여넣기 (${copiedTasks.length})`,
                            icon: <ClipboardPaste size={14} />,
                            onClick: () => {
                              handlePasteTasksFromClipboard();
                              setContextMenu(null);
                            },
                          },
                        ]
                      : []),
                    ...(canEditCurrentProject && selectedTaskIds.size >= 2 && contextMenu.taskId && selectedTaskIds.has(contextMenu.taskId)
                      ? [
                          {
                            label: '선행 순차 연결',
                            icon: <Link2 size={14} />,
                            onClick: () => {
                              const ordered = visibleTasks.filter((t) => selectedTaskIds.has(t.id)).map((t) => t.id);
                              if (ordered.length >= 2) linkSequentialPredecessors(ordered);
                              setContextMenu(null);
                            },
                          },
                        ]
                      : []),
                    ...(contextMenu.taskId &&
                    !(
                      sortConfig !== null ||
                      filters.status !== 'all' ||
                      filters.assignee ||
                      filters.startDate ||
                      filters.endDate ||
                      !!filters.milestoneOnly ||
                      !!filters.issueOnly
                    )
                      ? [
                          {
                            label: '위로 이동 (Alt+↑)',
                            icon: <ArrowUp size={14} />,
                            onClick: () => {
                              moveTask(contextMenu.taskId!, 'up');
                              setContextMenu(null);
                            },
                          },
                          {
                            label: '아래로 이동 (Alt+↓)',
                            icon: <ArrowDown size={14} />,
                            onClick: () => {
                              moveTask(contextMenu.taskId!, 'down');
                              setContextMenu(null);
                            },
                          },
                        ]
                      : []),
                    ...(canEditCurrentProject
                      ? [
                          {
                            label: `삭제 ${selectedTaskIds.size > 1 ? `(${selectedTaskIds.size})` : ''}`,
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onClick: () => {
                              if (selectedTaskIds.size > 1 && contextMenu.taskId && selectedTaskIds.has(contextMenu.taskId)) {
                                setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) });
                              } else if (contextMenu.taskId) {
                                handleDeleteClick(contextMenu.taskId);
                              }
                            },
                          },
                        ]
                      : []),
                    {
                      label: '컬럼 설정',
                      icon: <Settings2 size={14} />,
                      onClick: () => onOpenColumnSettings?.(),
                    },
                  ];
                })()
          }
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ ...deleteConfirm, isOpen: false })}
        onConfirm={executeDelete}
        title={deleteConfirm.taskIds.length > 1 ? `${deleteConfirm.taskIds.length}개 작업 삭제` : '작업 삭제'}
        message={
          deleteConfirm.taskIds.length > 1
            ? '선택한 작업들을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.'
            : '이 작업을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.'
        }
        confirmLabel="삭제"
        isDanger={true}
      />

      {forkTarget && (
        <React.Suspense fallback={null}>
          <ForkTaskToProjectModal
            isOpen={!!forkTarget}
            onClose={() => setForkTarget(null)}
            onConfirm={(input: ForkTaskToProjectInputT) => {
              const newId = forkTaskToProject(forkTarget.sourceTask.id, input);
              setForkTarget(null);
              if (newId) {
                pushToast('작업을 신규 프로젝트로 분기했습니다. 자식 프로젝트로 이동합니다.', { variant: 'success' });
              }
            }}
            sourceTask={forkTarget.sourceTask}
            sourceProject={forkTarget.sourceProject}
            defaultPmName={currentUserDisplayName}
            descendantCount={forkTarget.descendantCount}
            currentUserId={currentUserId}
          />
        </React.Suspense>
      )}
    </>
  );
  // relative: 상단 도킹 서식 툴바 오버레이(absolute)의 기준 컨테이너.
  return <div className={cn('relative flex flex-col min-h-0', fillHeight && 'h-full')}>{content}</div>;
}
