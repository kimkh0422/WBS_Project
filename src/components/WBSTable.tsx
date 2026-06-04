import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useWBS } from '../context/WBSContext';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatPercent1 } from '../lib/utils';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  CornerDownRight,
  Settings2,
  RefreshCw,
  EyeOff,
  RotateCcw,
  Unlink,
  Link2,
  Edit2,
  Trash2,
} from 'lucide-react';
import { type TableColumnId, type WBSTableProps } from './wbsTableTypes';
import { useWbsTableKeyboard, getWbsTableCopyPlainText } from './hooks/useWbsTableKeyboard';
import { useRealtimeCellFocus } from './hooks/useRealtimeCellFocus';
import { useColumnResize } from './hooks/useColumnResize';
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
  normalizeWorkEffortUnit,
  workEffortUnitSuffixKo,
} from '../lib/workEffortUnits';
import { computePlannedProgressMap } from '../lib/plannedProgress';
import { buildWbsImprovementGuide } from '../lib/wbsImprovementGuide';
import { commitWbsInlineNameEditFromDom } from '../lib/wbsInlineNameCommit';

// 첫 화면(표) 진입 경로에서 분리 — 사용자가 열 때만 로드한다.
// 특히 TaskModal은 tiptap + yjs(협업 에디터)를 동반하므로 분리 효과가 가장 크다.
const TaskModal = React.lazy(() => import('./TaskModal').then((m) => ({ default: m.TaskModal })));
const MdEditModal = React.lazy(() => import('./MdEditModal').then((m) => ({ default: m.MdEditModal })));
const WbsImprovementGuideModal = React.lazy(() =>
  import('./WbsImprovementGuideModal').then((m) => ({ default: m.WbsImprovementGuideModal })),
);
const ExcelGrid = React.lazy(() => import('./ExcelGrid').then((m) => ({ default: m.ExcelGrid })));

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
    | 'dependencies';
  visible: boolean;
}[] = [
  { id: 'wbsId', visible: true },
  { id: 'name', visible: true },
  { id: 'startDate', visible: true },
  { id: 'endDate', visible: true },
  { id: 'workEffort', visible: true },
  { id: 'weight', visible: true },
  { id: 'assignee', visible: true },
  { id: 'allocation', visible: false },
  { id: 'status', visible: true },
  { id: 'progress', visible: true },
  { id: 'plannedProgress', visible: true },
  { id: 'progressVariance', visible: true },
  { id: 'deliverables', visible: true },
  { id: 'dependencies', visible: true },
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
  } = useWBS();

  const { push: pushToast, tipOnce } = useToast();
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
  const effectiveCriticalPathSet = showCriticalPath ? criticalPathSet : EMPTY_CRITICAL_PATH_SET;

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
  /** 편집 버튼으로 켜는 엑셀형 즉석 편집 모드: 셀 클릭만으로 해당 컬럼 편집 (F2로 토글) */
  const [tableEditMode, setTableEditMode] = useState(false);
  /** 전체를 스프레드시트(AG Grid) 뷰로 보는 모드 */
  const [excelView, setExcelView] = useState(false);
  /** 편집 모드에서 키보드로 이동할 때의 현재 셀 (편집 중이 아닐 때) */
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);

  // 엑셀 시트(AG Grid) 뷰로 전환할 때만 표 인라인 편집 모드를 종료한다.
  // (이전에는 !excelView && tableEditMode 일 때마다 초기화되어, 일반 표에서 F2/셀 클릭으로
  //  tableEditMode를 켜는 순간 바로 inlineEditingNameId까지 지워지는 버그가 있었음)
  useEffect(() => {
    if (excelView) {
      const id = inlineEditingNameIdRef.current;
      if (id && canEditCurrentProject) {
        commitWbsInlineNameEditFromDom(id, tasks, updateTask, canEditCurrentProject);
      }
      setTableEditMode(false);
      setEditingCell(null);
      setInlineEditingNameId(null);
      setFocusedCell(null);
    }
  }, [excelView, tasks, updateTask, canEditCurrentProject]);

  const toggleTableEditMode = useCallback(() => {
    setTableEditMode((wasOn) => {
      if (!wasOn) {
        queueMicrotask(() => {
          tipOnce('wbs-edit-mode-tip', '편집 모드: 셀을 클릭하여 직접 수정할 수 있습니다. Esc로 종료합니다.');
        });
      }
      return !wasOn;
    });
  }, [tipOnce]);
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
  /** 스플릿 뷰에서 헤더 가로 스크롤 동기화용 */
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);

  // handleMouseDown + resize useEffect — now in useColumnResize

  const customColumnNameById = useMemo(() => {
    const map = new Map<string, string>();
    const customColumns = Array.isArray(wbsSettings?.customColumns) ? wbsSettings.customColumns : [];
    for (const col of customColumns) {
      if (!col || typeof col.id !== 'string') continue;
      map.set(col.id, (col.name || '').trim() || col.id.replace(/^custom:/, ''));
    }
    return map;
  }, [wbsSettings?.customColumns]);

  const tableColumns: { id: TableColumnId; visible: boolean }[] = useMemo(() => {
    const cols = wbsSettings?.tableColumns;
    const incoming = Array.isArray(cols) && cols.length > 0 ? cols : DEFAULT_TABLE_COLUMNS;

    const allow = new Set<TableColumnId>(DEFAULT_TABLE_COLUMNS.map((c) => c.id));
    for (const id of customColumnNameById.keys()) allow.add(id as TableColumnId);
    const seen = new Set<string>();
    const cleaned = incoming
      .filter((c: { id: string; visible: boolean }) => c && typeof c.id === 'string')
      .map((c: { id: string; visible: boolean }) => ({ id: String(c.id) as TableColumnId, visible: c.visible !== false }))
      .filter((c: { id: TableColumnId; visible: boolean }) => allow.has(c.id))
      .filter((c: { id: TableColumnId; visible: boolean }) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    for (const d of DEFAULT_TABLE_COLUMNS) {
      if (!seen.has(d.id)) cleaned.push(d);
    }

    return cleaned.map((c) => (c.id === 'name' ? { ...c, visible: true } : c));
  }, [wbsSettings, customColumnNameById]);

  const visibleColumnIds = useMemo(() => tableColumns.filter((c) => c.visible).map((c) => c.id), [tableColumns]);
  /** 편집 모드에서 좌우 이동 시 사용할 편집 가능 컬럼 순서 (wbsId 제외) */
  const editableColumnIds = useMemo(() => visibleColumnIds.filter((id) => id !== 'wbsId') as TableColumnId[], [visibleColumnIds]);

  // gridStyle — moved below useColumnResize hook call

  // Bulk Edit State + executors — extracted to useWbsBulkEdit (declared below after useWbsSelection)

  // Row height (density): 부모에서 rowHeight 전달 시 동기화, 없으면 자체 state
  const [rowHeightState, setRowHeightState] = useState<number>(20);
  const rowHeight = propRowHeight ?? rowHeightState;

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
    const parts: string[] = [];
    parts.push(`${columnWidths.grip}px`);
    parts.push(`${columnWidths.checkbox}px`);
    parts.push(`${columnWidths.seq}px`);
    parts.push(`${columnWidths.expand}px`);
    for (const id of visibleColumnIds) {
      if (id === 'name') parts.push(`${columnWidths.name}px`);
      else parts.push(`${(columnWidths as Record<string, number>)[id] ?? 120}px`);
    }
    parts.push(`${columnWidths.actions}px`);
    return { gridTemplateColumns: parts.join(' ') } as React.CSSProperties;
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
  const plannedProgressById = useMemo(() => computePlannedProgressMap(baseTasks), [baseTasks]);
  const isTreeView = !(
    filters.status !== 'all' ||
    filters.assignee ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly
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

  /** 하단 고정 셀 서식 툴·일괄 수정 바 뒤에 행·퀵추가가 숨지 않도록 스크롤 영역 하단 패딩 */
  const tableScrollBottomPadding = useMemo(() => {
    if (excelView || editingTask) return undefined;
    const bulk = selectedTaskIds.size > 1;
    const showCellFormat = focusedCell != null && focusedCell.columnId !== 'wbsId' && tasks.some((t) => t.id === focusedCell.taskId);
    if (!showCellFormat && !bulk) return undefined;
    if (showCellFormat && bulk) {
      return 'calc(min(42dvh, 24rem) + env(safe-area-inset-bottom, 0px))';
    }
    if (showCellFormat) {
      return 'calc(7.5rem + env(safe-area-inset-bottom, 0px))';
    }
    return 'calc(12rem + env(safe-area-inset-bottom, 0px))';
  }, [excelView, editingTask, focusedCell, selectedTaskIds.size, tasks]);

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
    tableEditMode,
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
    setLastSelectedId,
    syncRangeAnchorForKeyboardFocus,
    setTableEditMode,
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

  /** 우클릭·메뉴 복사 등: 셀 드래그 TSV 대신 작업명만 클립보드에 넣음 (인라인 편집 필드는 제외) */
  const handleWbsTableCopyCapture = useCallback(
    (e: React.ClipboardEvent) => {
      if (!hotkeysEnabled || excelView) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const packed = getWbsTableCopyPlainText({
        focusedCell,
        lastSelectedId,
        tasks,
      });
      if (!packed) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', packed.text);
    },
    [hotkeysEnabled, excelView, focusedCell, lastSelectedId, tasks],
  );

  const handleInlineQuickAdd = (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    if (!canEditCurrentProject) return; // 편집 권한 없으면 인라인 추가 비활성화
    const name = quickAddInlineValue.trim();
    if (!name) return;

    const proj = projects.find((p) => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const newId = addTask(
      {
        name,
        parentId,
        startDate: filters.startDate || defaultDate,
        endDate: filters.endDate || defaultDate,
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
    const newId = addTask({
      name,
      startDate: filters.startDate || defaultDate,
      endDate: filters.endDate || defaultDate,
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
    }
  };

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
  const summaryStats = useWbsSummaryStats(baseTasks, projects);

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

  const renderHeaderCell = (id: TableColumnId) => (
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
          handleColumnHeaderDoubleClick(id as keyof typeof columnWidths);
        }}
      />
    </React.Fragment>
  );

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
        isSplitView={isSplitView}
        maxTreeLevel={maxTreeLevel}
        treeExpandLevel={treeExpandLevel}
        setTreeExpandLevel={setTreeExpandLevel}
        expandToLevel={expandToLevel}
        toggleTableEditMode={toggleTableEditMode}
        tableEditMode={tableEditMode}
        excelView={excelView}
        setExcelView={setExcelView}
        rowHeight={rowHeight}
        handleSetRowHeight={handleSetRowHeight}
        onAutoFitColumns={() => autoFitAllColumns(visibleColumnIds, { implicitOrToolbarAutoFit: true })}
        onOpenMdEditor={() => {
          const projectIdsInView = new Set(baseTasks.map((t) => t.projectId));
          const projectsInView = projects.filter((p) => projectIdsInView.has(p.id));
          setMdEditInitialMarkdown(buildMarkdownFromTasks(baseTasks, wbsMap, projectsInView, assigneeDisplayMetaByName));
          setIsMdEditModalOpen(true);
        }}
        onOpenImprovementGuide={() => setImprovementGuideOpen(true)}
      />
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
            className="flex-shrink-0 border-b border-slate-200 bg-slate-50/80 overflow-x-auto overflow-y-hidden"
            onScroll={(e) => {
              if (isSyncingScrollRef.current) return;
              const body = tableScrollRef.current;
              if (body) {
                isSyncingScrollRef.current = true;
                body.scrollLeft = e.currentTarget.scrollLeft;
                requestAnimationFrame(() => {
                  isSyncingScrollRef.current = false;
                });
              }
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
              <div
                className="col-header justify-center relative"
                title="펼침 · 더블클릭: 너비 초기화"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleColumnHeaderDoubleClick('expand');
                }}
                onContextMenu={(e) => handleHeaderContextMenu(e)}
              >
                <span className="text-slate-300">▾</span>
                {resizeGrip('expand')}
              </div>
              {visibleColumnIds.map(renderHeaderCell)}
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
              className={cn(
                // split: 가로는 상단 헤더 스크롤만 사용 — 본문 가로 스크롤바가 세로 뷰포트를 줄여 간트와 행 단위가 어긋나는 것을 방지
                isSplitView ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto',
                'relative outline-none focus:ring-0',
                !tableEditMode && 'wbs-view-mode',
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
                  requestAnimationFrame(() => {
                    isSyncingScrollRef.current = false;
                  });
                }
              }}
            >
              <div className="min-w-fit w-full bg-white relative">
                {/* Non-split: 컬럼 헤더만 sticky top — 새 작업 추가는 본문 맨 아래(행 직후)에 배치 */}
                {!isSplitView && (
                  <div className="sticky top-0 z-30 w-full bg-[var(--color-bg)] border-b border-[var(--color-line)] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
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
                      <div
                        className="col-header justify-center relative"
                        title="펼침 · 더블클릭: 너비 초기화"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleColumnHeaderDoubleClick('expand');
                        }}
                        onContextMenu={(e) => handleHeaderContextMenu(e)}
                      >
                        <span className="text-slate-300">▾</span>
                        {resizeGrip('expand')}
                      </div>
                      {visibleColumnIds.map(renderHeaderCell)}
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
                              onSelect={handleSelect}
                              onFocusRow={setLastSelectedId}
                              onSetRowAnchor={(id) => {
                                rangeAnchorRef.current = id;
                                setAnchorTaskId(id);
                              }}
                              canEdit={canEditCurrentProject}
                              onEdit={setEditingTask}
                              onDeleteClick={handleDeleteClick}
                              onContextMenu={handleContextMenu}
                              toggleExpand={toggleExpand}
                              gridStyle={gridStyle}
                              visibleColumnIds={visibleColumnIds}
                              isInlineEditingName={inlineEditingNameId === task.id}
                              setInlineEditingNameId={setInlineEditingNameIdCommitted}
                              editingCell={editingCell}
                              setEditingCell={setEditingCell}
                              focusedCell={focusedCell}
                              setFocusedCell={setFocusedCell}
                              tableEditMode={tableEditMode}
                              allAssignees={allAssignees}
                              assigneeOptionsByProjectId={assigneeOptionsByProjectId}
                              updateTask={updateTask}
                              statusConfigs={wbsSettings?.statusConfigs ?? []}
                              projectAssignmentsByProjectId={projectAssignmentsByProjectId}
                              criticalPathSet={effectiveCriticalPathSet}
                              allocationDisplayText={allocationDisplayByTaskId.get(task.id) ?? '—'}
                              otherFocusByCellKey={otherFocusByCellKey}
                              customColumnNameById={customColumnNameById}
                              projectEffortUnitByProjectId={projectEffortUnitByProjectId}
                              projectScheduleByProjectId={projectScheduleByProjectId}
                              prependDisplayWbsToTaskName={wbsSettings?.prependDisplayWbsToTaskName === true}
                              rollupTooltipBaseTasks={baseTasks}
                              plannedProgress={plannedProgressById.get(task.id)}
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

                                              lines.forEach((line) => {
                                                addTask({
                                                  name: line,
                                                  parentId: task.id,
                                                  startDate: filters.startDate || defaultDate,
                                                  endDate: filters.endDate || defaultDate,
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
                                <div className="data-cell"></div>
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                        {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
                      </SortableContext>
                    );
                  })()}
                </DndContext>

                {visibleTasks.length === 0 && tasks.length === 0 && (
                  <div className="p-12 text-center text-slate-400 italic font-serif bg-slate-50/30">
                    등록된 작업이 없습니다. 새 작업을 추가해 보세요.
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
                {canEditCurrentProject && (
                  <div className="min-w-fit w-full border-t border-indigo-200/70 bg-indigo-50/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
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
                      <div className="data-cell"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* 표+간트: 간트 하단 수평 스크롤바(12px)와 세로 뷰포트·스크롤 범위를 맞춤 */}
            {isSplitView && !excelView && (
              <div className="flex-shrink-0 border-t border-slate-200 overflow-x-hidden" style={{ height: 12 }} aria-hidden />
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

      {/* 포커스된 표 데이터 셀 서식(하단 고정). 다중 선택 시 일괄 수정 바(z-100)보다 위 레이어·충분한 bottom으로 가리지 않게 함 */}
      {focusedCell &&
        !excelView &&
        !editingTask &&
        createPortal(
          <div
            className="fixed left-0 right-0 z-[110] pointer-events-none flex justify-center px-3 sm:px-4"
            style={{
              bottom:
                selectedTaskIds.size > 1
                  ? 'calc(clamp(200px, 34dvh, 380px) + env(safe-area-inset-bottom, 0px))'
                  : 'max(16px, calc(16px + env(safe-area-inset-bottom, 0px)))',
            }}
          >
            <CellFormatToolbar
              focusedCell={focusedCell}
              selectedTaskIds={selectedTaskIds}
              tasks={tasks}
              canEdit={canEditCurrentProject}
              customColumnNameById={customColumnNameById}
              updateTask={updateTask}
            />
          </div>,
          document.body,
        )}

      {/* Bulk Action Bar — body 포털: overflow-hidden 조상에 가려지지 않도록. 하단 safe-area·여백 확보 */}
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

                <div className="h-4 w-px bg-slate-200" />

                {canEditCurrentProject && (
                  <button
                    onClick={() => setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) })}
                    className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium"
                    title="선택된 모든 작업 삭제"
                  >
                    <Trash2 size={14} />
                    삭제
                  </button>
                )}
                <button
                  onClick={() => setSelection(new Set())}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
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
                  const headerActions: ContextMenuAction[] = [];
                  if (colId) {
                    if (canSort) {
                      headerActions.push({
                        label: '이 컬럼으로 정렬',
                        icon: <ArrowUpDown size={14} />,
                        onClick: () => onSort(colId === 'wbsId' ? 'wbs' : (colId as keyof Task)),
                      });
                    }
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
                    if (headerActions.length > 0) headerActions.push({ divider: true });
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
                  }
                  headerActions.push({
                    label: '컬럼 설정...',
                    icon: <Settings2 size={14} />,
                    onClick: () => onOpenColumnSettings?.(),
                  });
                  return headerActions;
                })()
              : [
                  ...(contextMenu.columnId === 'progress' || contextMenu.columnId === 'status'
                    ? [
                        {
                          label: '갱신',
                          icon: <RefreshCw size={14} />,
                          onClick: handleSyncProgressFromStatus,
                        },
                      ]
                    : []),
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
                ]
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
    </>
  );
  return <div className={cn('flex flex-col min-h-0', fillHeight && 'h-full')}>{content}</div>;
}
