import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useWBS } from '../context/WBSContext';
import { cn, formatDate } from '../lib/utils';
import { ChevronRight, ChevronDown, ChevronUp, Plus, Trash2, Edit2, ArrowUpDown, ArrowUp, ArrowDown, X, MoreHorizontal, CornerDownRight, GripVertical, CalendarDays, Clock, TrendingUp, ListChecks, Settings2, RefreshCw, Flag, EyeOff, RotateCcw, Unlink, Lock, Bug } from 'lucide-react';
import { Task, TaskStatus, FilterState, SortConfig } from '../types';
import { TaskModal } from './TaskModal';
import { MdEditModal } from './MdEditModal';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragCancelEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { v4 as uuidv4 } from 'uuid';
import { buildParentSet, buildVisibleTasks } from '../lib/taskView';
import { buildMarkdownFromTasks, parseMarkdownTable } from '../lib/export';
import { levelRowBg } from '../lib/levelColors';
import { useToast } from './Toast';
import { getCriticalPathTaskIds } from '../lib/schedule';

interface WBSTableProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  syncScrollRef?: React.RefObject<HTMLDivElement>;
  /** 표·간트 공통 줄간격(px). 전달 시 부모와 동기화(양쪽 슬라이더 모두 적용) */
  rowHeight?: number;
  onRowHeightChange?: (h: number) => void;
  /** 줄바꿈 켜짐 시 측정된 행 높이 배열을 전달 (표·간트 동기화용) */
  onRowHeightsChange?: (heights: number[]) => void;
  hotkeysEnabled?: boolean;
  onOpenColumnSettings?: () => void;
}

type TableColumnId = 'wbsId' | 'name' | 'startDate' | 'endDate' | 'workEffort' | 'assignee' | 'allocation' | 'status' | 'progress' | 'deliverables' | 'dependencies';

/** 컬럼 헤더 마우스 오버 시 툴팁 */
const COLUMN_TOOLTIPS: Record<TableColumnId, string> = {
  wbsId: 'WBS 식별자',
  name: '작업명 (클릭하여 정렬)',
  startDate: '시작일 (클릭하여 정렬)',
  endDate: '종료일 (클릭하여 정렬)',
  workEffort: '공수(일 단위) (클릭하여 정렬)',
  assignee: '담당자 (클릭하여 정렬)',
  allocation: '투입율 (%)',
  status: '상태 (클릭하여 정렬)',
  progress: '진척률 (%) (클릭하여 정렬)',
  deliverables: '산출물',
  dependencies: '선행작업(의존성)',
};

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

const DEFAULT_TABLE_COLUMNS: { id: 'wbsId' | 'name' | 'startDate' | 'endDate' | 'workEffort' | 'assignee' | 'allocation' | 'status' | 'progress' | 'deliverables' | 'dependencies'; visible: boolean }[] = [
  { id: 'wbsId', visible: true },
  { id: 'name', visible: true },
  { id: 'startDate', visible: true },
  { id: 'endDate', visible: true },
  { id: 'workEffort', visible: true },
  { id: 'assignee', visible: true },
  { id: 'allocation', visible: true },
  { id: 'status', visible: true },
  { id: 'progress', visible: true },
  { id: 'deliverables', visible: true },
  { id: 'dependencies', visible: true },
];

const StatChip = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div className="flex items-center gap-1.5 px-3 py-1">
    <span className="text-stone-400">{icon}</span>
    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</span>
    <span className="text-xs font-semibold text-[var(--color-ink)]">{value}</span>
  </div>
);

const Divider = () => <div className="w-px h-4 bg-stone-200 flex-shrink-0" />;

/** 작업명 마우스 오버 시 표시할 상세 툴팁 텍스트 */
function getTaskDetailTooltip(
  task: Task | null | undefined,
  statusConfigs: Array<{ id: string; name: string; progress?: number }> | null | undefined,
  displayWbsMap: Map<string, string> | null | undefined,
  isCritical?: boolean
): string {
  if (!task) return '';
  const lines: string[] = [];
  const statusName = Array.isArray(statusConfigs) ? statusConfigs.find((c) => c.id === task.status)?.name ?? task.status : task.status;
  const assigneeText =
    task.assignments && task.assignments.length > 0
      ? task.assignments.map((a) => `${a.assignee} (${a.allocationPercent}%)`).join(', ')
      : (task.assignee || '—');
  lines.push(`작업명: ${task.name ?? ''}`);
  if (task.isMilestone) lines.push('유형: 마일스톤');
  if (task.isIssue) lines.push('이슈: 예');
  if (isCritical) lines.push('크리티컬 패스: 예');
  lines.push(`기간: ${formatDate(task.startDate)} ~ ${formatDate(task.endDate)}`);
  lines.push(`공수: ${task.workEffort != null ? `${task.workEffort}일` : '—'}`);
  lines.push(`담당: ${assigneeText}`);
  lines.push(`상태: ${statusName}`);
  lines.push(`진척률: ${typeof task.progress === 'number' ? `${task.progress}%` : '—'}`);
  if (task.description?.trim()) lines.push(`설명: ${task.description.trim()}`);
  if (task.deliverables?.trim()) lines.push(`산출물: ${task.deliverables.trim()}`);
  const deps = task.dependencies;
  if (deps && Array.isArray(deps) && deps.length > 0 && displayWbsMap) {
    const depLabels = deps.map((id) => displayWbsMap.get(id) ? `#${displayWbsMap.get(id)}` : id);
    lines.push(`선행작업: ${depLabels.join(', ')}`);
  }
  return lines.join('\n');
}

export function WBSTable({ filters, sortConfig, onSort, syncScrollRef, rowHeight: propRowHeight, onRowHeightChange, onRowHeightsChange, hotkeysEnabled = true, onOpenColumnSettings }: WBSTableProps) {
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
    refreshProjectSchedule,
  } = useWBS();

  const { push: pushToast } = useToast();

  const projectAssignmentsByProjectId = useMemo(
    () => new Map(projects.map((p) => [p.id, p.assignments ?? []])),
    [projects]
  );
  const criticalPathSet = useMemo(() => {
    try {
      const set = getCriticalPathTaskIds(tasks, projectAssignmentsByProjectId);
      return set instanceof Set ? set : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, [tasks, projectAssignmentsByProjectId]);
  const showCriticalPath = wbsSettings?.showCriticalPath === true;
  const wrapTextInCells = wbsSettings?.wrapTextInCells === true;
  const effectiveCriticalPathSet = showCriticalPath ? criticalPathSet : EMPTY_CRITICAL_PATH_SET;

  // visibleTasks must be defined early - used by many hooks below
  // preserveDepthOnFiltered: 필터 후에도 레벨(depth)·색상 유지 (간트와 동기화)
  const visibleTasks = useMemo(
    () => buildVisibleTasks(tasks, filters, sortConfig, { preserveDepthOnFiltered: true }),
    [tasks, filters, sortConfig]
  );

  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [anchorTaskId, setAnchorTaskId] = useState<string | null>(null);

  // Context Menu State (header: columnId = data column; task: columnId = progress | status)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'task' | 'header'; taskId?: string; columnId?: TableColumnId | 'progress' | 'status' } | null>(null);

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
      return parsed.tasks.filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.startDate === 'string' && typeof t.endDate === 'string') as Task[];
    } catch {
      return [];
    }
  };
  const [copiedTasks, setCopiedTasks] = useState<Task[]>(() => {
    if (typeof window === 'undefined') return [];
    return loadClipboardTasks();
  });

  const [quickAddName, setQuickAddName] = useState('');
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null);
  const [inlineAddingTaskId, setInlineAddingTaskId] = useState<string | null>(null);

  // F2 Inline Name Edit state
  const [inlineEditingNameId, setInlineEditingNameId] = useState<string | null>(null);

  /** 셀 단위 인라인 편집: { taskId, columnId } */
  const [editingCell, setEditingCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);
  /** 편집 버튼으로 켜는 엑셀형 즉석 편집 모드: 셀 클릭만으로 해당 컬럼 편집 (F2로 토글) */
  const [tableEditMode, setTableEditMode] = useState(false);
  /** 편집 버튼 클릭 시 열리는 표-as-MD 편집 모달 */
  const [isMdEditModalOpen, setIsMdEditModalOpen] = useState(false);
  const [mdEditInitialMarkdown, setMdEditInitialMarkdown] = useState('');

  // Global list of assignees for datalist autocomplete (bulk edit 등): 프로젝트 투입인원 + 작업 담당자
  const allAssignees = useMemo(() => {
    const fromProjects = projects.flatMap(p => (p.assignments ?? []).map(a => a.assignee).filter(Boolean));
    const fromAssignee = tasks.map(t => t.assignee).filter(Boolean);
    const fromAssignments = tasks.flatMap(t => (t.assignments || []).map(a => a.assignee).filter(Boolean));
    return Array.from(new Set([...fromProjects, ...fromAssignee, ...fromAssignments])).sort();
  }, [projects, tasks]);

  // 프로젝트별 담당자 옵션: 프로젝트 등록 인원 + 해당 프로젝트 작업에 이미 배정된 인원
  const assigneeOptionsByProjectId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of projects) {
      const fromProject = (p.assignments ?? []).map(a => a.assignee).filter(Boolean);
      const fromTasks = tasks
        .filter(t => t.projectId === p.id)
        .flatMap(t => [t.assignee, ...(t.assignments || []).map(a => a.assignee)].filter(Boolean));
      map.set(p.id, Array.from(new Set([...fromProject, ...fromTasks])).sort());
    }
    return map;
  }, [projects, tasks]);

  // Custom Column Widths
  const DEFAULT_COLUMN_WIDTHS = {
    grip: 32,
    checkbox: 40,
    seq: 48,
    expand: 40,
    wbsId: 60,
    name: 300,
    startDate: 85,
    endDate: 85,
    workEffort: 56,
    assignee: 70,
    allocation: 72,
    status: 70,
    progress: 70,
    deliverables: 120,
    dependencies: 120,
    actions: 70
  };
  const [columnWidths, setColumnWidths] = useState({ ...DEFAULT_COLUMN_WIDTHS });
  const columnWidthsRef = useRef(columnWidths);
  const hasRestoredColumnWidths = useRef(false);
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
  }, [columnWidths]);
  useEffect(() => {
    const saved = wbsSettings?.columnWidths;
    if (hasRestoredColumnWidths.current || !saved || Object.keys(saved).length === 0) return;
    setColumnWidths(prev => ({ ...DEFAULT_COLUMN_WIDTHS, ...saved }));
    hasRestoredColumnWidths.current = true;
  }, [wbsSettings]);

  const [resizingCol, setResizingCol] = useState<keyof typeof columnWidths | null>(null);
  const resizeStartRef = useRef<{ col: keyof typeof columnWidths; startX: number; startWidth: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, col: keyof typeof columnWidths) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = { col, startX: e.clientX, startWidth: columnWidths[col] };
    setResizingCol(col);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const diff = e.clientX - start.startX;
      const newWidth = Math.max(30, start.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [start.col]: newWidth }));
    };

    const handleMouseUp = () => {
      resizeStartRef.current = null;
      setResizingCol(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      updateWbsSettings({ columnWidths: columnWidthsRef.current });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, updateWbsSettings]);

  const tableColumns: { id: TableColumnId; visible: boolean }[] = useMemo(() => {
    const cols = (wbsSettings as any)?.tableColumns;
    const incoming = Array.isArray(cols) && (cols.length > 0) ? cols : DEFAULT_TABLE_COLUMNS;

    const allow = new Set(DEFAULT_TABLE_COLUMNS.map(c => c.id));
    const seen = new Set<string>();
    const cleaned = incoming
      .filter((c: any) => c && typeof c.id === 'string')
      .map((c: any) => ({ id: String(c.id) as TableColumnId, visible: c.visible !== false }))
      .filter((c: any) => allow.has(c.id))
      .filter((c: any) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    for (const d of DEFAULT_TABLE_COLUMNS) {
      if (!seen.has(d.id)) cleaned.push(d);
    }

    return cleaned.map(c => c.id === 'name' ? { ...c, visible: true } : c);
  }, [wbsSettings]);

  const visibleColumnIds = useMemo(() => tableColumns.filter(c => c.visible).map(c => c.id), [tableColumns]);

  const gridStyle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${columnWidths.grip}px`);
    parts.push(`${columnWidths.checkbox}px`);
    parts.push(`${columnWidths.seq}px`);
    parts.push(`${columnWidths.expand}px`);
    for (const id of visibleColumnIds) {
      if (id === 'name') parts.push(`${columnWidths.name}px`);
      else parts.push(`${(columnWidths as any)[id]}px`);
    }
    parts.push(`${columnWidths.actions}px`);
    return { gridTemplateColumns: parts.join(' ') } as React.CSSProperties;
  }, [columnWidths, visibleColumnIds]);

  // Bulk Edit State
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | ''>('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkWorkEffort, setBulkWorkEffort] = useState('');
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkStartDate, setBulkStartDate] = useState('');
  const [bulkEndDate, setBulkEndDate] = useState('');

  // Row height (density): 부모에서 rowHeight 전달 시 동기화, 없으면 자체 state
  const [rowHeightState, setRowHeightState] = useState<number>(20);
  const rowHeight = propRowHeight ?? rowHeightState;

  const maxTreeLevel = useMemo(() => {
    if (tasks.length === 0) return 1;
    const taskMap = new Map<string, Task>(tasks.map(t => [t.id, t] as const));
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
    setTreeExpandLevel(prev => {
      const next = Math.min(Math.max(1, prev), Math.max(1, maxTreeLevel));
      return prev !== next ? next : prev;
    });
  }, [maxTreeLevel, setTreeExpandLevel]);

  // 줄바꿈 켜짐 + split view: 표 행 높이 측정 후 간트에 전달
  const lastHeightsRef = useRef<number[]>([]);
  const visibleTaskIdsKey = useMemo(() => visibleTasks.map(t => t.id).join(','), [visibleTasks]);
  useEffect(() => {
    if (!wrapTextInCells || !syncScrollRef?.current || !onRowHeightsChange) {
      if (onRowHeightsChange && !wrapTextInCells) onRowHeightsChange([]);
      return;
    }
    const measure = () => {
      const scrollEl = syncScrollRef.current;
      if (!scrollEl) return;
      const rows = scrollEl.querySelectorAll<HTMLElement>('[id^="task-row-"]');
      const heights = Array.from(rows).map(el => el.offsetHeight);
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
    observer.observe(syncScrollRef.current);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [wrapTextInCells, syncScrollRef, visibleTaskIdsKey, onRowHeightsChange, rowHeight]);

  const handleSetRowHeight = useCallback((h: number) => {
    if (propRowHeight == null) setRowHeightState(h);
    onRowHeightChange?.(h);
  }, [onRowHeightChange, propRowHeight]);

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskIds: string[] }>({
    isOpen: false,
    taskIds: [],
  });

  // WBS ID Generation map logic was moved to WBSContext

  /** taskId → 표 행 순번(1부터). 선행작업 셀에서 #1, #2 형태로 표시 */
  const taskIdToSeqNum = useMemo(() => {
    const m = new Map<string, number>();
    visibleTasks.forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }, [visibleTasks]);

  /** 표 행 순번(1부터) → taskId. 선행작업 숫자 입력 시 변환용 */
  const seqNumToTaskId = useMemo(() => {
    const m = new Map<number, string>();
    visibleTasks.forEach((t, i) => m.set(i + 1, t.id));
    return m;
  }, [visibleTasks]);

  /** 담당자별로 투입율을 한 번만 표기: 행 순서대로 이미 표시한 담당자 집합을 유지하고, 해당 행에 표시할 텍스트만 반환 */
  const allocationDisplayByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    const shown = new Set<string>();
    for (const task of visibleTasks) {
      const assignments = task.assignments?.length
        ? task.assignments
        : (task.projectId ? projectAssignmentsByProjectId.get(task.projectId) ?? [] : []);
      const currentAssignee = (task.assignee || '').trim();
      const relevant = currentAssignee
        ? assignments.filter(a => (a.assignee || '').trim() === currentAssignee)
        : assignments;
      const toShow = relevant.filter(a => {
        const key = (a.assignee || '').trim() || '(미지정)';
        if (shown.has(key)) return false;
        shown.add(key);
        return true;
      });
      const text = toShow.length ? toShow.map(a => `${a.allocationPercent}%`).join(', ') : '—';
      map.set(task.id, text);
    }
    return map;
  }, [visibleTasks, projectAssignmentsByProjectId]);

  /** 컬럼 헤더 더블클릭 시 텍스트에 맞춰 너비 자동 조정용 측정 요소 */
  const measureRef = useRef<HTMLDivElement | null>(null);
  const measureText = useCallback((text: string): number => {
    const el = measureRef.current;
    if (!el) return 60;
    el.style.whiteSpace = 'nowrap';
    el.textContent = text || '0';
    return Math.ceil(el.getBoundingClientRect().width) + 1;
  }, []);

  /** 데이터 컬럼별 헤더 표시 텍스트 */
  const COLUMN_HEADER_LABELS: Record<TableColumnId, string> = {
    wbsId: 'WBS',
    name: '작업명',
    startDate: '시작일',
    endDate: '종료일',
    workEffort: '공수(d)',
    assignee: '담당자',
    allocation: '투입율',
    status: '상태',
    progress: '진척(%)',
    deliverables: '산출물',
    dependencies: '선행작업',
  };

  /** 컬럼 헤더 더블클릭: 해당 컬럼 너비를 텍스트에 맞게 자동 조정 (고정 컬럼은 기본값으로 복원) */
  const handleColumnHeaderDoubleClick = useCallback((col: keyof typeof columnWidths) => {
    const fixedCols: (keyof typeof columnWidths)[] = ['grip', 'checkbox', 'seq', 'expand', 'actions'];
    if (fixedCols.includes(col)) {
      setColumnWidths(prev => ({ ...prev, [col]: DEFAULT_COLUMN_WIDTHS[col] }));
      updateWbsSettings({ columnWidths: { ...columnWidthsRef.current, [col]: DEFAULT_COLUMN_WIDTHS[col] } });
      return;
    }
    const colId = col as TableColumnId;
    let maxW = measureText(COLUMN_HEADER_LABELS[colId] ?? String(colId));
    for (const task of visibleTasks) {
      let cellText = '';
      if (colId === 'wbsId') cellText = displayWbsMap?.get(task.id) ?? '';
      else if (colId === 'name') cellText = (displayWbsMap?.get(task.id) ? `${displayWbsMap.get(task.id)} ` : '') + (task.name ?? '');
      else if (colId === 'startDate') cellText = formatDate(task.startDate);
      else if (colId === 'endDate') cellText = formatDate(task.endDate);
      else if (colId === 'workEffort') cellText = task.workEffort != null ? task.workEffort.toFixed(1) : '-';
      else if (colId === 'assignee') {
        cellText = task.assignments?.length
          ? task.assignments.map(a => `${a.assignee} (${a.allocationPercent}%)`).join(', ')
          : (task.assignee || '—');
      } else if (colId === 'allocation') cellText = allocationDisplayByTaskId.get(task.id) ?? '—';
      else if (colId === 'status') {
        const name = (wbsSettings?.statusConfigs ?? []).find((c: { id: string }) => c.id === task.status);
        cellText = (name as { name?: string } | undefined)?.name ?? task.status ?? '—';
      } else if (colId === 'progress') cellText = typeof task.progress === 'number' ? `${task.progress}%` : '—';
      else if (colId === 'deliverables') cellText = (task.deliverables?.trim() ?? '') || '—';
      else if (colId === 'dependencies') {
        const nums = (task.dependencies ?? [])
          .map(id => taskIdToSeqNum.get(id))
          .filter((n): n is number => n != null)
          .sort((a, b) => a - b);
        cellText = nums.length > 0 ? nums.join(', ') : '';
      }
      const w = measureText(cellText);
      if (w > maxW) maxW = w;
    }
    const padding = 24;
    const newWidth = Math.max(30, Math.min(800, maxW + padding));
    setColumnWidths(prev => ({ ...prev, [col]: newWidth }));
    updateWbsSettings({ columnWidths: { ...columnWidthsRef.current, [col]: newWidth } });
  }, [visibleTasks, displayWbsMap, allocationDisplayByTaskId, taskIdToSeqNum, wbsSettings?.statusConfigs, measureText, updateWbsSettings]);

  const baseTasks = useMemo(
    () =>
      filters.projectIds === 'all'
        ? tasks
        : tasks.filter((task) => task.projectId && filters.projectIds.includes(task.projectId)),
    [tasks, filters.projectIds]
  );

  const hasChildrenSet = useMemo(() => buildParentSet(baseTasks), [baseTasks]);
  const isTreeView = !(
    filters.status !== 'all' ||
    filters.assignee ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly
  );

  // Selection Logic
  const setSelection = (next: Set<string>) => {
    setSelectedTaskIds(next);
    setSharedSelectedTaskIds(Array.from(next));
  };

  const handleSelect = (taskId: string, multi: boolean, range: boolean) => {
    const newSelected = new Set<string>(multi ? selectedTaskIds : ([] as string[]));

    if (range && anchorTaskId) {
      const currentIndex = visibleTasks.findIndex(t => t.id === taskId);
      const anchorIndex = visibleTasks.findIndex(t => t.id === anchorTaskId);

      if (currentIndex !== -1 && anchorIndex !== -1) {
        const start = Math.min(currentIndex, anchorIndex);
        const end = Math.max(currentIndex, anchorIndex);

        for (let i = start; i <= end; i++) {
          newSelected.add(visibleTasks[i].id);
        }
      } else {
        newSelected.add(taskId);
      }
    } else {
      if (multi) {
        if (newSelected.has(taskId)) {
          newSelected.delete(taskId);
        } else {
          newSelected.add(taskId);
        }
      } else {
        newSelected.add(taskId);
      }
      setAnchorTaskId(taskId);
    }

    setSelection(newSelected);
    setLastSelectedId(taskId);
  };

  const handleSelectAll = () => {
    if (selectedTaskIds.size === visibleTasks.length) {
      setSelection(new Set());
    } else {
      setSelection(new Set(visibleTasks.map(t => t.id)));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  type DropPosition = 'before' | 'inside' | 'after';
  const [dropTarget, setDropTarget] = useState<{ overId: string; position: DropPosition } | null>(null);

  /**
   * 드롭 위치 결정 규칙
   * - 행 상단 1/3: 위(before)
   * - 행 중간 1/3: 하위(inside)
   * - 행 하단 1/3: 아래(after)
   */
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }

    const overId = over.id as string;
    const activeRect = active.rect.current.translated ?? active.rect.current.initial;
    const overRect = over.rect;

    if (!activeRect || !overRect) {
      setDropTarget({ overId, position: 'inside' });
      return;
    }

    const draggedCenterY = activeRect.top + activeRect.height / 2;
    const rel = (draggedCenterY - overRect.top) / Math.max(1, overRect.height);
    const position: DropPosition = rel < 0.33 ? 'before' : rel > 0.66 ? 'after' : 'inside';

    setDropTarget(prev => (prev?.overId === overId && prev.position === position ? prev : { overId, position }));
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setDropTarget(null);
  };

  /** 드래그한 작업을 놓은 위치에 따라 상하 이동 또는 하위(자식) 이동 */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }

    const draggedId = active.id as string;
    const overId = over.id as string;

    const draggedTask = tasks.find(t => t.id === draggedId);
    const overTask = tasks.find(t => t.id === overId);
    if (!draggedTask || !overTask || draggedTask.projectId !== overTask.projectId) {
      setDropTarget(null);
      return;
    }

    // 순환 방지: over가 드래그한 작업의 자손이면 무시 (어떤 드롭 포지션이든 안전하게 차단)
    const descendantIds = new Set<string>();
    const collectDescendants = (parentId: string) => {
      for (const t of tasks) {
        if (t.parentId === parentId) {
          descendantIds.add(t.id);
          collectDescendants(t.id);
        }
      }
    };
    collectDescendants(draggedId);
    if (descendantIds.has(overId)) {
      setDropTarget(null);
      return;
    }

    const position: DropPosition = dropTarget?.overId === overId ? dropTarget.position : 'inside';

    if (position === 'inside') {
      updateTask(draggedId, { parentId: overId });
      if (!overTask.expanded) updateTask(overId, { expanded: true });
      setDropTarget(null);
      return;
    }

    // before/after: overTask와 같은 부모 레벨(형제)로 이동 + 표시 순서도 같이 이동
    const targetParentId = overTask.parentId ?? null;
    updateTask(draggedId, { parentId: targetParentId });
    reorderTask(draggedId, overId);
    setDropTarget(null);
  };

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      // Esc: 편집 중지 (셀 편집 → 작업명 편집 → 테이블 편집 모드 순으로 해제)
      if (e.key === 'Escape') {
        if (editingCell) {
          setEditingCell(null);
          e.preventDefault();
          return;
        }
        if (inlineEditingNameId) {
          setInlineEditingNameId(null);
          e.preventDefault();
          return;
        }
        if (tableEditMode) {
          setTableEditMode(false);
          e.preventDefault();
          return;
        }
        // Esc: 선택 모두 취소
        if (selectedTaskIds.size > 0) {
          setSelection(new Set());
          setBulkStatus('');
          setBulkAssignee('');
          setBulkWorkEffort('');
          setBulkProgress('');
          e.preventDefault();
          return;
        }
      }
      // Ignore if editing a task (modal open), a cell, or typing in an input
      const target = e.target as HTMLElement;
      if (editingTask || deleteConfirm.isOpen || editingCell || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (target.tagName === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        if (type !== 'checkbox' && type !== 'radio') return;
      }
      if (target.tagName === 'SELECT') return;

      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통)
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        handleSetRowHeight(Math.min(64, rowHeight + 2));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleSetRowHeight(Math.max(15, rowHeight - 2));
        return;
      }

      // Allow paste even when no row is selected (e.g. focus on empty space)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        // Paste copied tasks into current project (supports cross-project via localStorage clipboard)
        e.preventDefault();
        const clipboard = copiedTasks.length > 0 ? copiedTasks : loadClipboardTasks();
        if (clipboard.length === 0) return;

        // Paste target: if a row is selected, insert after it; otherwise append to the end.
        const fallbackInsertAfterId = visibleTasks.length > 0 ? visibleTasks[visibleTasks.length - 1].id : undefined;
        const baseInsertAfterId: string | undefined = lastSelectedId ?? fallbackInsertAfterId;

        // If a row is selected, paste as siblings under its parent; otherwise paste as root items.
        const selectedTask = lastSelectedId ? tasks.find(t => t.id === lastSelectedId) : undefined;
        const pasteParentId: string | null = selectedTask?.parentId ?? null;

        // IMPORTANT:
        // addTask() generates a NEW id. If we precompute ids and set parentId/dependencies
        // with those fake ids, children become orphans and won't render.
        // So we build mapping from OLD -> ACTUAL NEW id returned from addTask().
        const clipboardIdSet = new Set(clipboard.map(t => t.id));
        const idToNewId = new Map<string, string>();

        let insertAfterId: string | undefined = baseInsertAfterId;
        const addedIds: string[] = [];

        // Add tasks ensuring parents are created before children.
        const pending = [...clipboard];
        let safety = 0;
        while (pending.length > 0 && safety < clipboard.length * 4) {
          const idx = pending.findIndex(t => !t.parentId || !clipboardIdSet.has(t.parentId) || idToNewId.has(t.parentId));
          const t = idx === -1 ? pending[0] : pending[idx];
          pending.splice(idx === -1 ? 0 : idx, 1);

          const isRootOfCopy = !(t.parentId && clipboardIdSet.has(t.parentId));
          const newParentId = isRootOfCopy
            ? pasteParentId
            : (idToNewId.get(t.parentId!) ?? pasteParentId);

          // Strip fields that shouldn't be copied as-is / computed fields.
          // We also postpone dependency remap until all ids exist.
          const { id: _id, projectId: _pid, depth: _depth, dependencies: _deps, ...rest } = t as any;
          const addedId = addTask(
            {
              ...rest,
              parentId: newParentId,
              expanded: true,
              dependencies: undefined,
            },
            isRootOfCopy ? insertAfterId : undefined
          );

          if (isRootOfCopy) insertAfterId = addedId;
          idToNewId.set(t.id, addedId);
          addedIds.push(addedId);
          safety += 1;
        }

        // Remap dependencies inside the copied set after all ids are known
        for (const t of clipboard) {
          const newId = idToNewId.get(t.id);
          if (!newId) continue;
          const mappedDeps = (t.dependencies ?? [])
            .filter(depId => clipboardIdSet.has(depId))
            .map(depId => idToNewId.get(depId))
            .filter(Boolean) as string[];
          if (mappedDeps.length > 0) {
            updateTask(newId, { dependencies: mappedDeps, userLockedFields: ['dependencies'] });
          }
        }

        // Select newly pasted tasks
        if (addedIds.length > 0) {
          setSelection(new Set(addedIds));
          setLastSelectedId(addedIds[addedIds.length - 1]);
        }
        return;
      }

      // Select all (works even when no row is selected yet)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      const effectiveSelectedIds =
        selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (sharedSelectedTaskIds || []);

      // Copy (works as long as there's a selection)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Copy selected tasks preserving hierarchy
        e.preventDefault();
        if (selectedTaskIds.size > 0) {
          // Gather selected tasks in their visual order
          const selected = visibleTasks
            .filter(t => selectedTaskIds.has(t.id))
            .map((t) => {
              // Strip computed fields like depth
              const { depth: _depth, ...rest } = t as any;
              return rest as Task;
            });
          setCopiedTasks(selected);
          try {
            const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
            localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
          } catch {
            // ignore storage errors (private mode, quota, etc.)
          }
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
        e.preventDefault();
        if (effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      // If nothing is selected yet, allow arrow keys to move focus (체크는 변경하지 않음)
      if (!lastSelectedId) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const first = visibleTasks[0];
          const last = visibleTasks[visibleTasks.length - 1];
          const next = e.key === 'ArrowDown' ? first : last;
          if (next) {
            setLastSelectedId(next.id);
            document.getElementById(`task-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
        return;
      }

      // Space: toggle selection (checkbox) of the focused row
      if (e.key === ' ') {
        e.preventDefault();
        const next = new Set(selectedTaskIds);
        if (next.has(lastSelectedId)) next.delete(lastSelectedId);
        else next.add(lastSelectedId);
        setSelection(next);
        return;
      }

      // WBS 정렬일 때만 순서/레벨 변경 허용 (다른 정렬·필터 시 표시 순서와 트리 순서가 달라 혼동 방지)
      const isSortedOrFiltered = (sortConfig !== null && sortConfig.key !== 'wbs') ||
        filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate || !!filters.milestoneOnly || !!filters.issueOnly;

      const currentIndex = visibleTasks.findIndex(t => t.id === lastSelectedId);
      if (currentIndex === -1) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (e.altKey) {
          if (!isSortedOrFiltered && selectedTaskIds.size === 1) {
            moveTask(lastSelectedId, 'up');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else {
          const prevTask = visibleTasks[currentIndex - 1];
          if (prevTask) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleSelect(prevTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            } else {
              setLastSelectedId(prevTask.id);
            }
            document.getElementById(`task-row-${prevTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.altKey) {
          if (!isSortedOrFiltered && selectedTaskIds.size === 1) {
            moveTask(lastSelectedId, 'down');
            requestAnimationFrame(() => document.getElementById(`task-row-${lastSelectedId}`)?.scrollIntoView({ block: 'nearest' }));
          }
        } else {
          const nextTask = visibleTasks[currentIndex + 1];
          if (nextTask) {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleSelect(nextTask.id, e.ctrlKey || e.metaKey, e.shiftKey);
            } else {
              setLastSelectedId(nextTask.id);
            }
            document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (!isSortedOrFiltered && selectedTaskIds.size > 0) {
          // Tab: 레벨 한 단계 내리기(들여쓰기), Shift+Tab: 레벨 한 단계 올리기(내어쓰기)
          const orderedIds = visibleTasks.filter(t => selectedTaskIds.has(t.id)).map(t => t.id);
          if (e.shiftKey) {
            outdentTasks(orderedIds);
          } else {
            indentTasks(orderedIds);
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedTaskIds.size === 1) {
          const task = tasks.find(t => t.id === lastSelectedId);
          if (task) {
            setInsertTargetId(task.id);
            setInlineAddingTaskId(task.id);
            setQuickAddName(''); // reset input
          }
        }
      } else if (e.key === 'Insert') {
        e.preventDefault();
        if (selectedTaskIds.size === 1) {
          const task = tasks.find(t => t.id === lastSelectedId);
          if (task) {
            // Add a subtask
            const proj = projects.find(p => p.id === (task.projectId || currentProjectId));
            const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
            const newId = addTask({
              name: '새 하위 작업',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: task.id
            }, task.id);

            // Expand the parent so the new task is visible
            if (!task.expanded) {
              updateTask(task.id, { expanded: true });
            }

            setSelection(new Set([newId]));
            setLastSelectedId(newId);
            setInlineEditingNameId(newId);
          }
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        // F2: 기존 편집 모드(셀 클릭 즉석 편집) 토글
        setTableEditMode((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, selectedTaskIds, sharedSelectedTaskIds, lastSelectedId, visibleTasks, editingTask, editingCell, inlineEditingNameId, tableEditMode, deleteConfirm, moveTask, indentTask, outdentTask, indentTasks, outdentTasks, tasks, sortConfig, filters, copiedTasks, addTask, rowHeight, handleSetRowHeight, handleSelectAll]);

  const handleQuickAddCancel = () => {
    setInlineAddingTaskId(null);
    setInsertTargetId(null);
  };

  const handleInlineQuickAdd = (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    if (!quickAddName.trim()) return;

    const proj = projects.find(p => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const newId = addTask({
      name: quickAddName.trim(),
      parentId,
      startDate: filters.startDate || defaultDate,
      endDate: filters.endDate || defaultDate,
      progress: 0,
      workEffort: 0.5,
      assignee: filters.assignee || '',
      status: 'todo'
    }, insertTargetId || undefined);

    setQuickAddName('');
    setInlineAddingTaskId(null);
    setInsertTargetId(null);

    // Select the newly added task so pressing Enter again adds below it
    setSelection(new Set([newId]));
    setLastSelectedId(newId);
  };

  const handleSave = (updates: any) => {
    if (editingTask) {
      if (editingTask.id === '') {
        // Creating a new subtask
        const proj = projects.find(p => p.id === (editingTask!.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
        addTask({
          parentId: editingTask.parentId, // Default to initial parent
          assignee: filters.assignee || '',
          startDate: filters.startDate || defaultDate,
          endDate: filters.endDate || defaultDate,
          ...updates, // Override with form data if present
        }, insertTargetId || undefined);
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
    if (!quickAddName.trim()) return;

    const proj = projects.find(p => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    addTask({
      name: quickAddName,
      startDate: filters.startDate || defaultDate,
      endDate: filters.endDate || defaultDate,
      progress: 0,
      workEffort: 0.5,
      assignee: filters.assignee || '',
      status: 'todo',
      parentId: null,
    });
    setQuickAddName('');
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => {
    e.preventDefault();
    if (!selectedTaskIds.has(taskId)) {
      handleSelect(taskId, false, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', taskId, columnId });
  };

  const handleSyncProgressFromStatus = () => {
    const idsToSync = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (contextMenu?.taskId ? [contextMenu.taskId] : []);
    const configs = wbsSettings?.statusConfigs ?? [];
    idsToSync.forEach((id) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const config = configs.find((c: any) => c.id === task.status);
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

  const handleDeleteClick = (taskId: string) => {
    setDeleteConfirm({ isOpen: true, taskIds: [taskId] });
  };

  const executeDelete = () => {
    // 1. Fully identify all task IDs to be deleted (including descendants)
    const deleteSet = new Set<string>();
    const getIdsToDelete = (parentId: string) => {
      deleteSet.add(parentId);
      tasks.filter(t => t.parentId === parentId).forEach(child => getIdsToDelete(child.id));
    };
    deleteConfirm.taskIds.forEach(id => getIdsToDelete(id));

    // 2. Determine the next selection before performing the delete
    const visibleIndices = visibleTasks
      .map((t, i) => deleteSet.has(t.id) ? i : -1)
      .filter(i => i !== -1);

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
    deleteConfirm.taskIds.forEach(id => deleteTask(id));
    setDeleteConfirm({ isOpen: false, taskIds: [] });

    // 4. Update selection
    if (nextSelectId) {
      setSelection(new Set([nextSelectId]));
      setLastSelectedId(nextSelectId);
      setAnchorTaskId(nextSelectId);
    } else {
      setSelection(new Set());
      setLastSelectedId(null);
      setAnchorTaskId(null);
    }
  };

  const executeBulkEdit = () => {
    const updates: Partial<Task> = {};
    if (bulkStatus) {
      updates.status = bulkStatus;
      const config = (wbsSettings?.statusConfigs ?? []).find(c => c.id === bulkStatus);
      if (config && config.progress !== undefined) updates.progress = config.progress;
    }
    if (bulkAssignee.trim()) updates.assignee = bulkAssignee.trim();
    if (bulkWorkEffort !== '') {
      const val = parseFloat(bulkWorkEffort);
      if (!isNaN(val) && val >= 0) updates.workEffort = val;
    }
    if (bulkProgress !== '') {
      const val = parseInt(bulkProgress, 10);
      if (!isNaN(val) && val >= 0 && val <= 100) updates.progress = val;
    }
    if (bulkStartDate.trim()) updates.startDate = bulkStartDate.trim();
    if (bulkEndDate.trim()) updates.endDate = bulkEndDate.trim();
    if (Object.keys(updates).length === 0) return;
    const ids = Array.from(selectedTaskIds);
    // updateTasksBulk는 일정/공수/선행작업 변경 시 스킵하므로, 해당 필드가 있으면 개별 updateTask로 적용
    const hasScheduleField = Object.prototype.hasOwnProperty.call(updates, 'workEffort') ||
      Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'dependencies');
    if (hasScheduleField) {
      ids.forEach(id => updateTask(id, updates));
    } else {
      updateTasksBulk(ids, updates);
    }
    setBulkStatus('');
    setBulkAssignee('');
    setBulkWorkEffort('');
    setBulkProgress('');
    setBulkStartDate('');
    setBulkEndDate('');
  };

  const executeBulkWorkEffort = () => {
    const value = parseFloat(bulkWorkEffort);
    if (isNaN(value) || value < 0) return;
    const taskById = new Map(tasks.map(t => [t.id, t]));
    Array.from(selectedTaskIds).forEach(id => {
      const prev = taskById.get(id);
      const locked = new Set(prev?.userLockedFields ?? []);
      locked.add('workEffort');
      updateTask(id, { workEffort: value, userLockedFields: Array.from(locked) });
    });
    setBulkWorkEffort('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkStatus = () => {
    if (!bulkStatus) return;
    const updates: Partial<Task> = { status: bulkStatus };
    if ((wbsSettings as any)?.statusProgress?.[bulkStatus] !== undefined) {
      updates.progress = (wbsSettings as any).statusProgress[bulkStatus];
    }
    updateTasksBulk(Array.from(selectedTaskIds), updates);
    setBulkStatus('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkAssignee = () => {
    const value = bulkAssignee.trim();
    if (!value) return;
    updateTasksBulk(Array.from(selectedTaskIds), { assignee: value });
    setBulkAssignee('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkClearDependencies = () => {
    const taskById = new Map(tasks.map(t => [t.id, t]));
    Array.from(selectedTaskIds).forEach(id => {
      const prev = taskById.get(id);
      const locked = new Set(prev?.userLockedFields ?? []);
      locked.add('dependencies');
      updateTask(id, { dependencies: [], userLockedFields: Array.from(locked) });
    });
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const SortIcon = ({ column }: { column: keyof Task | 'wbsId' }) => {
    const isActive = sortConfig?.key === column || (column === 'wbsId' && sortConfig?.key === 'wbs');
    if (!isActive) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortConfig!.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  // Aggregate stats: 항상 현재 프로젝트 기준 전체 현황 (선택/필터/레벨/접힘과 무관)
  const summaryStats = useMemo(() => {
    const source = baseTasks;
    if (source.length === 0) return null;

    const totalEffort = source.reduce((sum, t) => sum + (t.workEffort || 0), 0);
    const avgProgress = Math.round(source.reduce((sum, t) => sum + (t.progress || 0), 0) / source.length);
    const startDate = source.reduce((min, t) => t.startDate < min ? t.startDate : min, source[0].startDate);
    const endDate = source.reduce((max, t) => t.endDate > max ? t.endDate : max, source[0].endDate);
    const leafTasks = source.filter(t => !source.some(other => other.parentId === t.id));

    return { totalEffort, avgProgress, startDate, endDate, taskCount: source.length, leafCount: leafTasks.length, isSelection: false };
  }, [baseTasks]);

  const formatSummaryDate = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
  };

  const isSplitView = !!syncScrollRef;
  const headerStyle = isSplitView ? { ...gridStyle, height: 60, minHeight: 60 } : gridStyle;

  /** 컬럼 너비 조절용 그립: 헤더 오른쪽 가장자리 드래그 */
  const resizeGrip = (col: keyof typeof columnWidths) => (
    <div
      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-20 shrink-0 border-l-2 border-stone-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
      title="컬럼 너비 조절 (드래그)"
      onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, col); }}
    />
  );

  const renderHeaderCell = (id: TableColumnId) => {
    const commonResize = resizeGrip(id as keyof typeof columnWidths);

    const onColContextMenu = (ev: React.MouseEvent) => handleHeaderContextMenu(ev, id);
    const onColDoubleClick = (ev: React.MouseEvent) => {
      ev.stopPropagation();
      handleColumnHeaderDoubleClick(id as keyof typeof columnWidths);
    };
    switch (id) {
      case 'wbsId':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('wbs')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title="WBS 순서 (클릭하여 정렬) · 더블클릭: 너비 자동"
          >
            WBS <SortIcon column="wbsId" />
            {commonResize}
          </div>
        );
      case 'name':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('name')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.name + ' · 더블클릭: 너비 자동'}
          >
            작업명 <SortIcon column="name" />
            {commonResize}
          </div>
        );
      case 'startDate':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('startDate')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.startDate + ' · 더블클릭: 너비 자동'}
          >
            시작일 <SortIcon column="startDate" />
            {commonResize}
          </div>
        );
      case 'endDate':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('endDate')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.endDate + ' · 더블클릭: 너비 자동'}
          >
            종료일 <SortIcon column="endDate" />
            {commonResize}
          </div>
        );
      case 'workEffort':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('workEffort')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.workEffort + ' · 더블클릭: 너비 자동'}
          >
            공수(d) <SortIcon column="workEffort" />
            {commonResize}
          </div>
        );
      case 'progress':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('progress')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.progress + ' · 더블클릭: 너비 자동'}
          >
            진척(%) <SortIcon column="progress" />
            {commonResize}
          </div>
        );
      case 'assignee':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('assignee')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.assignee + ' · 더블클릭: 너비 자동'}
          >
            담당자 <SortIcon column="assignee" />
            {commonResize}
          </div>
        );
      case 'allocation':
        return (
          <div key={id} className="col-header relative" onDoubleClick={onColDoubleClick} onContextMenu={onColContextMenu} title={COLUMN_TOOLTIPS.allocation + ' · 더블클릭: 너비 자동'}>
            투입율
            {commonResize}
          </div>
        );
      case 'status':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('status')}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.status + ' · 더블클릭: 너비 자동'}
          >
            상태 <SortIcon column="status" />
            {commonResize}
          </div>
        );
      case 'deliverables':
        return (
          <div key={id} className="col-header relative" onDoubleClick={onColDoubleClick} onContextMenu={onColContextMenu} title={COLUMN_TOOLTIPS.deliverables + ' · 더블클릭: 너비 자동'}>
            산출물
            {commonResize}
          </div>
        );
      case 'dependencies':
        return (
          <div key={id} className="col-header relative" onDoubleClick={onColDoubleClick} onContextMenu={onColContextMenu} title={COLUMN_TOOLTIPS.dependencies + ' · 더블클릭: 너비 자동'}>
            선행작업
            {commonResize}
          </div>
        );
      default:
        return null;
    }
  };

  const content = (
    <>
      {/* 컬럼 너비 자동 조정용 측정 요소 (화면 밖, 테이블과 동일 폰트) */}
      <div
        ref={measureRef}
        className="absolute left-[-9999px] top-0 text-xs font-sans whitespace-nowrap invisible pointer-events-none"
        aria-hidden
      />
      {/* === Summary Bar (표 바로 위: 통계·레벨 펼치기·편집·줄간격) === */}
      <div className={cn(
        // split view에서는 높이를 고정해 간트와 행 시작 위치를 완전히 맞춤
        isSplitView
          ? "min-h-12 flex items-center gap-0 border-b px-4 py-1.5 text-xs bg-stone-50 flex-shrink-0 overflow-x-auto overflow-y-visible whitespace-nowrap"
          : "flex items-center gap-0 border-b px-4 py-2 text-xs bg-stone-50 flex-wrap flex-shrink-0",
        "border-[var(--color-line)]"
      )}>
          {summaryStats ? (
            <>
              <StatChip icon={<ListChecks size={12} />} label="작업" value={`${summaryStats.taskCount}개 (단말 ${summaryStats.leafCount}개)`} />
              <Divider />
              <StatChip icon={<Clock size={12} />} label="총 공수" value={`${summaryStats.totalEffort.toLocaleString()}일`} />
              <Divider />
              <StatChip icon={<TrendingUp size={12} />} label="평균 진척" value={`${summaryStats.avgProgress}%`} />
              <Divider />
              <StatChip icon={<CalendarDays size={12} />} label="기간" value={`${formatSummaryDate(summaryStats.startDate)} ~ ${formatSummaryDate(summaryStats.endDate)}`} />

              <div className="ml-auto flex items-center gap-3">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">레벨 펼치기</span>
                <select
                  className="h-7 rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={treeExpandLevel}
                  onChange={(e) => {
                    const lv = parseInt(e.target.value, 10);
                    setTreeExpandLevel(lv);
                    expandToLevel(lv);
                  }}
                  title="레벨 기준 펼치기"
                >
                  {Array.from({ length: Math.max(1, maxTreeLevel) }, (_, i) => i + 1).map(lv => (
                    <option key={lv} value={lv}>{lv}레벨</option>
                  ))}
                </select>
                <Divider />
                <button
                  type="button"
                  onClick={() => {
                    const projectIdsInView = new Set(baseTasks.map((t) => t.projectId));
                    const projectsInView = projects.filter((p) => projectIdsInView.has(p.id));
                    setMdEditInitialMarkdown(buildMarkdownFromTasks(baseTasks, wbsMap, projectsInView));
                    setIsMdEditModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors shrink-0 bg-slate-100 text-slate-600 hover:bg-slate-200"
                  title="표 내용을 마크다운(.md)으로 열어 직접 수정"
                >
                  <Edit2 size={12} />
                  편집
                </button>
                <span className={cn("text-[10px] shrink-0", tableEditMode ? "font-bold text-indigo-600" : "text-stone-400")} title="F2: 셀 즉석 편집 모드">{tableEditMode ? '편집 중 (F2)' : 'F2'}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
                  <input
                    type="range"
                    min={15}
                    max={64}
                    step={2}
                    value={rowHeight}
                    onChange={(e) => handleSetRowHeight(Number(e.target.value))}
                    className="w-20 h-1.5 accent-indigo-500 cursor-pointer"
                    title={`줄간격: ${rowHeight}px`}
                  />
                  <span className="text-[11px] font-bold text-slate-600 w-8 text-right tabular-nums">{rowHeight}</span>
                </div>
              </div>
            </>
          ) : (
            // split view: 표 영역 상단에 편집·줄간격만 배치 (간트 쪽은 자체 줌/줄간격 바 있음)
            <>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  const projectIdsInView = new Set(baseTasks.map((t) => t.projectId));
                  const projectsInView = projects.filter((p) => projectIdsInView.has(p.id));
                  setMdEditInitialMarkdown(buildMarkdownFromTasks(baseTasks, wbsMap, projectsInView));
                  setIsMdEditModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors shrink-0 bg-slate-100 text-slate-600 hover:bg-slate-200"
                title="표 내용을 마크다운으로 편집"
              >
                <Edit2 size={12} />
                편집
              </button>
              <span className={cn("text-[10px] shrink-0", tableEditMode ? "font-bold text-indigo-600" : "text-stone-400")} title="F2: 셀 즉석 편집 모드">{tableEditMode ? '편집 중 (F2)' : 'F2'}</span>
              <div className="w-px h-5 bg-stone-200 shrink-0" />
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
                <input
                  type="range"
                  min={15}
                  max={64}
                  step={2}
                  value={rowHeight}
                  onChange={(e) => handleSetRowHeight(Number(e.target.value))}
                  className="w-20 h-1.5 accent-indigo-500 cursor-pointer"
                  title={`줄간격: ${rowHeight}px`}
                />
                <span className="text-[11px] font-bold text-slate-600 w-8 text-right tabular-nums">{rowHeight}</span>
              </div>
            </>
          )}
        </div>
      <div className={cn("w-full pb-20", isSplitView && "flex-1 min-h-0 flex flex-col")} style={{ '--row-height': `${rowHeight}px`, '--cell-padding': `${Math.max(2, (rowHeight - 20) / 2)}px` } as React.CSSProperties}>
        {/* Split view: 헤더를 스크롤 밖에 두어 표·간트 행만 스크롤로 1:1 맞춤 */}
        {isSplitView && (
          <div className="data-header flex-shrink-0 border-b border-slate-200 bg-slate-50/80" style={headerStyle}>
            <div className="col-header justify-center relative" title="드래그 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('grip'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
              {resizeGrip('grip')}
            </div>
            <div className="col-header justify-center relative" title="전체 선택 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('checkbox'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
              <input
                type="checkbox"
                className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                onChange={handleSelectAll}
              />
              {resizeGrip('checkbox')}
            </div>
            <div className="col-header justify-center relative" title="순번 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('seq'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
              #
              {resizeGrip('seq')}
            </div>
            <div className="col-header justify-center relative" title="펼침 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('expand'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
              <span className="text-stone-300">▾</span>
              {resizeGrip('expand')}
            </div>
            {visibleColumnIds.map(renderHeaderCell)}
            <div className="col-header justify-end relative" title="작업 관리(편집·삭제 등) · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('actions'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
              관리
              {resizeGrip('actions')}
            </div>
          </div>
        )}
        <div
          ref={syncScrollRef}
          tabIndex={0}
          className={cn("overflow-auto relative bg-[var(--color-bg)] outline-none focus:ring-0", isSplitView ? "flex-1 min-h-0" : "flex-1", wrapTextInCells && "wrap-text-in-cells")}
          onScroll={(e) => {
            // No-op here: App.tsx handles syncing from the other side if needed
          }}
        >
          <div className="min-w-fit w-full bg-white relative">
            {/* Non-split: 헤더는 스크롤 안에 (기존 동작) */}
            {!isSplitView && (
              <div className="data-header" style={gridStyle}>
                <div className="col-header justify-center relative" title="드래그 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('grip'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
                  {resizeGrip('grip')}
                </div>
                <div className="col-header justify-center relative" title="전체 선택 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('checkbox'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
                  <input
                    type="checkbox"
                    className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                    checked={visibleTasks.length > 0 && selectedTaskIds.size === visibleTasks.length}
                    onChange={handleSelectAll}
                  />
                  {resizeGrip('checkbox')}
                </div>
                <div className="col-header justify-center relative" title="순번 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('seq'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
                  #
                  {resizeGrip('seq')}
                </div>
                <div className="col-header justify-center relative" title="펼침 · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('expand'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
                  <span className="text-stone-300">▾</span>
                  {resizeGrip('expand')}
                </div>
                {visibleColumnIds.map(renderHeaderCell)}
                <div className="col-header justify-end relative" title="작업 관리(편집·삭제 등) · 더블클릭: 너비 초기화" onDoubleClick={(e) => { e.stopPropagation(); handleColumnHeaderDoubleClick('actions'); }} onContextMenu={(e) => handleHeaderContextMenu(e)}>
                  관리
                  {resizeGrip('actions')}
                </div>
              </div>
            )}

            {/* Rows */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={visibleTasks.filter(Boolean).map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleTasks.filter(Boolean).map((task, rowIndex) => (
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
                      isFocused={lastSelectedId === task.id}
                      hasChildren={hasChildrenSet.has(task.id)}
                      isTreeView={isTreeView}
                      onSelect={handleSelect}
                      onFocusRow={setLastSelectedId}
                      onEdit={setEditingTask}
                      onDeleteClick={handleDeleteClick}
                      onContextMenu={handleContextMenu}
                      toggleExpand={toggleExpand}
                      gridStyle={gridStyle}
                      visibleColumnIds={visibleColumnIds}
                      isInlineEditingName={inlineEditingNameId === task.id}
                      setInlineEditingNameId={setInlineEditingNameId}
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      tableEditMode={tableEditMode}
                      allAssignees={allAssignees}
                      assigneeOptionsByProjectId={assigneeOptionsByProjectId}
                      updateTask={updateTask}
                      statusConfigs={wbsSettings?.statusConfigs ?? []}
                      projectAssignmentsByProjectId={projectAssignmentsByProjectId}
                      criticalPathSet={effectiveCriticalPathSet}
                      allocationDisplayText={allocationDisplayByTaskId.get(task.id) ?? '—'}
                    />
                    {inlineAddingTaskId === task.id && (
                      <div className="data-row bg-blue-50/60 border-dashed" style={gridStyle}>
                        <div className="data-cell justify-center text-blue-400 font-bold text-[10px]">*</div>
                        <div className="data-cell justify-center"></div>
                        <div className="data-cell justify-center"></div>
                        <div className="data-cell justify-center text-blue-400">
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
                                <form onSubmit={(e) => handleInlineQuickAdd(e, task.parentId)} className="flex w-full h-full relative group/form">
                                  <input
                                    autoFocus
                                    type="text"
                                    value={quickAddName}
                                    onChange={(e) => setQuickAddName(e.target.value)}
                                    onBlur={() => setInlineAddingTaskId(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setInlineAddingTaskId(null);
                                      e.stopPropagation();
                                    }}
                                    placeholder="작업명 입력 후 Enter..."
                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-blue-600 placeholder:text-blue-300 h-full py-2 px-2"
                                  />
                                  <button
                                    type="submit"
                                    disabled={!quickAddName.trim()}
                                    onMouseDown={(e) => e.preventDefault()}
                                    className="absolute right-0 top-0 bottom-0 text-[10px] font-bold text-white bg-blue-500 disabled:bg-blue-300 uppercase px-3 hover:bg-blue-600 transition-colors opacity-0 group-hover/form:opacity-100"
                                  >
                                    확인
                                  </button>
                                </form>
                              </div>
                            );
                          }
                          if (colId === 'wbsId') {
                            return <div key={colId} className="data-cell text-[10px] font-mono text-blue-400">신규</div>;
                          }
                          return <div key={colId} className="data-cell"></div>;
                        })}
                        <div className="data-cell"></div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </SortableContext>
            </DndContext>

            {/* Quick Add Row: split view에서는 스크롤 밖에 두어 표·간트 행 높이 일치(첫/끝 행 정렬) */}
            {!isSplitView && (
            <div className="data-row bg-slate-50 border-t border-slate-200/60 shadow-inner" style={gridStyle}>
              <div className="data-cell"></div>
              <div className="data-cell"></div>
              <div className="data-cell"></div>
              <div className="data-cell justify-center text-stone-400">
                <Plus size={14} />
              </div>
              {visibleColumnIds.map((colId) => {
                if (colId !== 'name') return <div key={colId} className="data-cell"></div>;
                return (
                  <div key={colId} className="data-cell p-0">
                    <form onSubmit={handleQuickAdd} className="flex w-full h-full">
                      <input
                        type="text"
                        value={quickAddName}
                        onChange={(e) => setQuickAddName(e.target.value)}
                        placeholder="새 작업 추가 (Enter 키 입력)..."
                        className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-medium placeholder:text-slate-400 h-full px-3"
                      />
                      <button
                        type="submit"
                        disabled={!quickAddName.trim()}
                        className="text-[10px] font-bold text-indigo-600 disabled:opacity-50 uppercase px-4 hover:bg-indigo-50 transition-colors"
                      >
                        추가
                      </button>
                    </form>
                  </div>
                );
              })}
              <div className="data-cell"></div>
            </div>
            )}

            {visibleTasks.length === 0 && tasks.length === 0 && (
              <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
                등록된 작업이 없습니다. 새 작업을 추가해 보세요.
              </div>
            )}
          </div>
        </div>
        {/* Split view: 새 작업 추가 행을 스크롤 밖 하단에 두어 표·간트 행 수를 동일하게 유지 */}
        {isSplitView && (
          <div className="data-row flex-shrink-0 bg-slate-50 border-t border-slate-200/60 shadow-inner" style={gridStyle}>
            <div className="data-cell"></div>
            <div className="data-cell"></div>
            <div className="data-cell"></div>
            <div className="data-cell justify-center text-stone-400">
              <Plus size={14} />
            </div>
            {visibleColumnIds.map((colId) => {
              if (colId !== 'name') return <div key={colId} className="data-cell"></div>;
              return (
                <div key={colId} className="data-cell p-0">
                  <form onSubmit={handleQuickAdd} className="flex w-full h-full">
                    <input
                      type="text"
                      value={quickAddName}
                      onChange={(e) => setQuickAddName(e.target.value)}
                      placeholder="새 작업 추가 (Enter 키 입력)..."
                      className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-medium placeholder:text-slate-400 h-full px-3"
                    />
                    <button
                      type="submit"
                      disabled={!quickAddName.trim()}
                      className="text-[10px] font-bold text-indigo-600 disabled:opacity-50 uppercase px-4 hover:bg-indigo-50 transition-colors"
                    >
                      추가
                    </button>
                  </form>
                </div>
              );
            })}
            <div className="data-cell"></div>
          </div>
        )}
      </div>

      {/* Bulk Action Bar - 다중선택(2개 이상)일 경우에만 표시 */}
      {selectedTaskIds.size > 1 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-glass-elevated shadow-2xl rounded-2xl z-50 animate-in slide-in-from-bottom-4 fade-in duration-300 overflow-hidden min-w-max border border-white/40 border-t-white">
          {/* Header */}
          <div className="bg-indigo-600/90 backdrop-blur-sm px-4 py-2 flex items-center justify-between gap-6">
            <span className="text-[11px] font-bold text-white tracking-widest uppercase">일괄 수정</span>
            <div className="flex items-center gap-2">
              <span className="bg-white/20 text-white text-[10px] font-black px-2 py-0.5 rounded-full tracking-wide">
                {selectedTaskIds.size}개 선택됨
              </span>
              <button
                onClick={() => { setSelection(new Set()); setBulkStatus(''); setBulkAssignee(''); setBulkWorkEffort(''); setBulkProgress(''); setBulkStartDate(''); setBulkEndDate(''); }}
                className="text-white/60 hover:text-white transition-colors hover:rotate-90 duration-300"
                title="선택 해제"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Fields + Actions */}
          <div className="px-4 py-3 flex items-end gap-3">
            {/* 상태 */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">상태</label>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className={cn(
                  "px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer",
                  bulkStatus ? "border-blue-400 text-blue-700 font-medium" : "border-stone-200 text-stone-500"
                )}
              >
                <option value="">변경 없음</option>
                {(wbsSettings?.statusConfigs ?? []).map(config => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">담당자</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="all-assignees"
                    value={bulkAssignee}
                    onChange={(e) => setBulkAssignee(e.target.value)}
                    placeholder="담당자 일괄 지정..."
                    className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') executeBulkAssignee();
                    }}
                  />
                  <datalist id="all-assignees">
                    {allAssignees.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
              </div>
            </div>

            {/* 공수(d) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">공수(d)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={bulkWorkEffort}
                onChange={(e) => setBulkWorkEffort(e.target.value)}
                placeholder="공수(d) 일괄 지정..."
                className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-36"
              />
            </div>

            {/* 시작일 */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">시작일</label>
              <input
                type="date"
                value={bulkStartDate}
                onChange={(e) => setBulkStartDate(e.target.value)}
                className={cn(
                  "px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-36",
                  bulkStartDate ? "border-blue-400 text-blue-700 font-medium" : "border-stone-200 text-stone-500"
                )}
              />
            </div>

            {/* 완료일(종료일) */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider px-0.5">완료일</label>
              <input
                type="date"
                value={bulkEndDate}
                onChange={(e) => setBulkEndDate(e.target.value)}
                className={cn(
                  "px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-36",
                  bulkEndDate ? "border-blue-400 text-blue-700 font-medium" : "border-stone-200 text-stone-500"
                )}
              />
            </div>

            {/* 적용 버튼 - 상태, 담당자, 공수, 시작일, 완료일 등 입력된 모든 항목 일괄 적용 */}
            <button
              onClick={executeBulkEdit}
              disabled={!bulkStatus && !bulkAssignee.trim() && (bulkWorkEffort === '' || isNaN(parseFloat(bulkWorkEffort))) && !bulkStartDate.trim() && !bulkEndDate.trim()}
              className="self-end text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-5 py-1.5 rounded-lg transition-colors"
              title="입력한 항목 모두 적용"
            >
              적용
            </button>

            <button
              onClick={executeBulkClearDependencies}
              className="flex items-center gap-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium self-end"
              title="선택한 작업들의 선행작업을 모두 제거"
            >
              <Unlink size={14} />
              선행작업 지우기
            </button>

            <div className="h-4 w-px bg-stone-200" />

            <button
              onClick={() => setDeleteConfirm({ isOpen: true, taskIds: Array.from(selectedTaskIds) })}
              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-full transition-colors text-sm font-medium"
              title="선택된 모든 작업 삭제"
            >
              <Trash2 size={14} />
              삭제
            </button>
            <button
              onClick={() => setSelection(new Set())}
              className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <TaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSave}
        initialData={editingTask || undefined}
        parentOptions={tasks}
        onOpenTask={(task) => setEditingTask(task)}
      />

      <MdEditModal
        isOpen={isMdEditModalOpen}
        onClose={() => { setIsMdEditModalOpen(false); setMdEditInitialMarkdown(''); }}
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
            pushToast('테이블 형식의 행을 찾을 수 없습니다. WBS 코드(**1**, **1.1** 등)가 있는 행만 반영됩니다.', { variant: 'warning' });
          } else {
            pushToast('매칭되는 작업이 없어 반영되지 않았습니다. WBS 코드를 변경하지 마세요.', { variant: 'warning' });
          }
        }}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={
            contextMenu.type === 'header'
              ? (() => {
                const colId = contextMenu.columnId;
                const sortableColumns: TableColumnId[] = ['name', 'startDate', 'endDate', 'workEffort', 'progress', 'assignee', 'status'];
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
                        const cols = (wbsSettings?.tableColumns ?? []).map(c =>
                          c.id === colId ? { ...c, visible: false } : c
                        );
                        updateWbsSettings({ tableColumns: cols });
                      },
                    });
                  }
                  if ((columnWidths as any)[colId] !== undefined) {
                    headerActions.push({
                      label: '컬럼 너비 초기화',
                      icon: <RotateCcw size={14} />,
                      onClick: () => {
                        const defaultW = (DEFAULT_COLUMN_WIDTHS as any)[colId];
                        if (defaultW != null) {
                          const next = { ...columnWidths, [colId]: defaultW };
                          setColumnWidths(next);
                          updateWbsSettings({ columnWidths: next });
                        }
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
                  label: '선행관계에 맞게 일정 정렬',
                  icon: <RefreshCw size={14} />,
                  onClick: refreshProjectSchedule,
                });
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
                    const task = tasks.find(t => t.id === contextMenu.taskId);
                    if (task) setEditingTask(task);
                  }
                },
                {
                  label: '하위 작업 추가',
                  icon: <CornerDownRight size={14} />,
                  onClick: () => {
                    const parent = tasks.find(t => t.id === contextMenu.taskId);
                    if (parent) {
                      const proj = projects.find(p => p.id === (parent.projectId || currentProjectId));
                      const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
                      setEditingTask({
                        id: '', // New task marker
                        parentId: parent.id,
                        name: '',
                        startDate: defaultDate,
                        endDate: defaultDate,
                        progress: 0,
                        assignee: '',
                        status: 'todo'
                      } as Task);
                    }
                  }
                },
                ...(contextMenu.taskId && !(sortConfig !== null || filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate || !!filters.milestoneOnly || !!filters.issueOnly)
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
                  }
                },
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
        message={deleteConfirm.taskIds.length > 1 ? '선택한 작업들을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.' : '이 작업을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다.'}
        confirmLabel="삭제"
        isDanger={true}
      />
    </>
  );
  return isSplitView ? <div className="h-full flex flex-col">{content}</div> : content;
}

/** taskId → 표에서의 순번(1부터) */
type TaskIdToSeqNum = Map<string, number>;
/** 표에서의 순번(1부터) → taskId */
type SeqNumToTaskId = Map<number, string>;

interface SortableTaskRowProps {
  key?: string | number;
  rowIndex: number;
  task: Task & { depth?: number };
  dropIndicator?: 'before' | 'inside' | 'after' | null;
  wbsId?: string;
  displayWbsId?: string;
  displayWbsMap: Map<string, string>;
  taskIdToSeqNum: TaskIdToSeqNum;
  seqNumToTaskId: SeqNumToTaskId;
  isSelected: boolean;
  /** 키보드 포커스 행 (상하 이동 시 체크와 무관하게 표시) */
  isFocused: boolean;
  hasChildren: boolean;
  isTreeView: boolean;
  onSelect: (taskId: string, multi: boolean, range: boolean) => void;
  /** 행 클릭 시 포커스만 이동 (선택/체크는 체크박스 클릭으로만) */
  onFocusRow?: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onDeleteClick: (taskId: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void;
  toggleExpand: (taskId: string) => void;
  gridStyle: React.CSSProperties;
  visibleColumnIds: TableColumnId[];
  isInlineEditingName: boolean;
  setInlineEditingNameId: (id: string | null) => void;
  editingCell: { taskId: string; columnId: TableColumnId } | null;
  setEditingCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
  /** 편집 버튼으로 켠 엑셀형 즉석 편집 모드: 셀 클릭만으로 해당 컬럼 편집 */
  tableEditMode: boolean;
  allAssignees: string[];
  /** projectId → 프로젝트 등록 인원 + 해당 프로젝트 작업 담당자 목록 */
  assigneeOptionsByProjectId: Map<string, string[]>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  statusConfigs: Array<{ id: string; name: string; progress?: number }>;
  /** projectId → assignments (for showing allocation when task has no assignments) */
  projectAssignmentsByProjectId: Map<string, Array<{ assignee: string; allocationPercent: number }>>;
  criticalPathSet?: Set<string>;
  /** 담당자별로 한 번만 표기한 투입율 텍스트 (행 순서 기준) */
  allocationDisplayText?: string;
}

function SortableTaskRowInner({
  rowIndex,
  task,
  dropIndicator,
  wbsId,
  displayWbsId,
  displayWbsMap,
  taskIdToSeqNum,
  seqNumToTaskId,
  isSelected,
  isFocused,
  hasChildren,
  isTreeView,
  onSelect,
  onFocusRow,
  onEdit,
  onDeleteClick,
  onContextMenu,
  toggleExpand,
  gridStyle,
  visibleColumnIds,
  isInlineEditingName,
  setInlineEditingNameId,
  editingCell,
  setEditingCell,
  tableEditMode,
  allAssignees,
  assigneeOptionsByProjectId,
  updateTask,
  statusConfigs,
  projectAssignmentsByProjectId,
  criticalPathSet,
  allocationDisplayText
}: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const depsDisplayValue = useMemo(() => {
    const depIds = task.dependencies ?? [];
    const nums = depIds
      .map(id => taskIdToSeqNum.get(id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    return nums.length > 0 ? nums.join(', ') : '';
  }, [task.dependencies, taskIdToSeqNum]);

  const [depsInputValue, setDepsInputValue] = useState(depsDisplayValue);
  const [depsFocused, setDepsFocused] = useState(false);
  React.useEffect(() => {
    if (!depsFocused) setDepsInputValue(depsDisplayValue);
  }, [depsDisplayValue, depsFocused]);

  const depth = task.depth || 0;
  const level = depth + 1;

  const zebraOverlay = rowIndex % 2 === 1 ? 'rgba(2, 6, 23, 0.03)' : 'transparent';

  const isDone = task.status === 'done' || (typeof task.progress === 'number' && task.progress >= 100);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDone ? '#e5e7eb' : (isSelected ? '#eff6ff' : levelRowBg(level)),
    backgroundImage: isSelected || isDone ? undefined : `linear-gradient(${zebraOverlay}, ${zebraOverlay})`,
    zIndex: isDragging ? 10 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      className={cn(
        "data-row group cursor-pointer outline-none transition-colors relative",
        isSelected && !isDone && "bg-blue-50 font-medium text-blue-900",
        isFocused && !isDone && "ring-1 ring-inset ring-blue-400/60",
        isDone && "text-stone-500"
      )}
      onClick={(e) => {
        onSelect(task.id, e.ctrlKey || e.metaKey, e.shiftKey);
        if (onFocusRow) onFocusRow(task.id);
      }}
      tabIndex={0}
      onDoubleClick={() => onEdit(task)}
      onContextMenu={(e) => onContextMenu(e, task.id, undefined)}
    >
      {dropIndicator === 'before' && (
        <div className="absolute left-0 right-0 top-0 h-0.5 bg-indigo-500 pointer-events-none" />
      )}
      {dropIndicator === 'after' && (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-indigo-500 pointer-events-none" />
      )}
      {dropIndicator === 'inside' && (
        <div className="absolute inset-0 ring-2 ring-indigo-400/60 bg-indigo-50/40 pointer-events-none" />
      )}
      <div
        className="data-cell justify-center cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </div>
      <div className="data-cell justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
          checked={isSelected}
          onChange={() => onSelect(task.id, true, false)}
        />
      </div>
      <div className="data-cell justify-center font-mono text-[10px] text-stone-500 tabular-nums">
        {rowIndex + 1}
      </div>
      <div className="data-cell justify-center">
        {isTreeView && hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(task.id);
            }}
            className="hover:bg-stone-200 rounded p-0.5 text-stone-500 transition-colors"
            title={task.expanded ? "접기" : "펼치기"}
          >
            {task.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {visibleColumnIds.map((colId) => {
        if (colId === 'wbsId') {
          return (
            <div key={colId} className="data-cell font-mono text-[10px] text-stone-400">
              {wbsId}
            </div>
          );
        }
        if (colId === 'name') {
          return (
            <div key={colId} className={cn("data-cell", tableEditMode && !isInlineEditingName && "ring-1 ring-dashed ring-slate-300 rounded")} style={{ paddingLeft: `${depth * 20 + 12}px` }}>
              {isInlineEditingName ? (
                <input
                  autoFocus
                  defaultValue={task.name}
                  className="w-full text-sm font-bold bg-white text-blue-600 outline-none ring-1 ring-blue-500 rounded px-1"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== task.name) {
                      updateTask(task.id, { name: e.target.value.trim() });
                    }
                    setInlineEditingNameId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setInlineEditingNameId(null);
                    }
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span
                  className={cn("font-medium text-[var(--color-ink)] flex items-center gap-1.5", tableEditMode ? "cursor-cell" : "cursor-text")}
                  onClick={(e) => { if (tableEditMode) { e.stopPropagation(); setInlineEditingNameId(task.id); } }}
                  onDoubleClick={() => setInlineEditingNameId(task.id)}
                  title={tableEditMode ? '클릭하여 작업명 수정' : getTaskDetailTooltip(task, statusConfigs, displayWbsMap, criticalPathSet?.has(task.id))}
                >
                  {task.isMilestone && <Flag size={14} className="text-amber-500 flex-shrink-0" title="마일스톤" />}
                  {task.isIssue && <Bug size={14} className="text-rose-600 flex-shrink-0" title="이슈" />}
                  {criticalPathSet?.has(task.id) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0" title="크리티컬 패스">크리티컬</span>
                  )}
                  {displayWbsId ? `${displayWbsId} ` : ''}{task.name}
                </span>
              )}
            </div>
          );
        }
        const lockedFields = new Set(task.userLockedFields ?? []);
        const LockBadge = ({ field }: { field: 'startDate' | 'endDate' | 'workEffort' | 'dependencies' }) =>
          lockedFields.has(field) ? <Lock size={10} className="text-amber-600 flex-shrink-0" title="사용자 고정 (AI 업데이트 시 유지)" /> : null;
        if (colId === 'startDate') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'startDate';
          return (
            <div key={colId} className={cn("data-cell font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded")} onClick={(e) => e.stopPropagation()}>
              <LockBadge field="startDate" />
              {isEditing ? (
                <input
                  type="date"
                  autoFocus
                  defaultValue={task.startDate ? task.startDate.slice(0, 10) : ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v && v !== (task.startDate?.slice(0, 10) ?? '')) {
                      updateTask(task.id, { startDate: v + (task.startDate?.slice(10) || '') });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-text hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) setEditingCell({ taskId: task.id, columnId: 'startDate' }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'startDate' }); }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'startDate' });
                  }}
                  title={tableEditMode ? '클릭하여 시작일 수정' : (task.startDate ? formatDate(task.startDate) : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {formatDate(task.startDate)}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'endDate') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'endDate';
          return (
            <div key={colId} className={cn("data-cell font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded")} onClick={(e) => e.stopPropagation()}>
              <LockBadge field="endDate" />
              {isEditing ? (
                <input
                  type="date"
                  autoFocus
                  defaultValue={task.endDate ? task.endDate.slice(0, 10) : ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v && v !== (task.endDate?.slice(0, 10) ?? '')) {
                      updateTask(task.id, { endDate: v + (task.endDate?.slice(10) || '') });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-text hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) setEditingCell({ taskId: task.id, columnId: 'endDate' }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'endDate' }); }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'endDate' });
                  }}
                  title={tableEditMode ? '클릭하여 종료일 수정' : (task.endDate ? formatDate(task.endDate) : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {formatDate(task.endDate)}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'workEffort') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'workEffort';
          return (
            <div key={colId} className={cn("data-cell font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded")} onClick={(e) => e.stopPropagation()}>
              <LockBadge field="workEffort" />
              {isEditing ? (
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  autoFocus
                  defaultValue={task.workEffort ?? ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0 && v !== (task.workEffort ?? NaN)) {
                      updateTask(task.id, { workEffort: v });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-text hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) setEditingCell({ taskId: task.id, columnId: 'workEffort' }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'workEffort' }); }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'workEffort' });
                  }}
                  title={tableEditMode ? '클릭하여 공수 수정' : (task.workEffort != null ? `${task.workEffort}일` : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {task.workEffort != null ? task.workEffort.toFixed(1) : '-'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'progress') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'progress';
          return (
            <div
              key={colId}
              className={cn("data-cell font-mono text-xs text-stone-600 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded")}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'progress');
              }}
              onClick={(e) => e.stopPropagation()}
              title={tableEditMode ? '클릭하여 진척률 수정 · 우클릭: 갱신 메뉴' : '더블클릭하여 수정 · 마우스 우클릭: 갱신 메뉴'}
            >
              {isEditing ? (
                <input
                  type="number"
                  min={0}
                  max={100}
                  autoFocus
                  defaultValue={typeof task.progress === 'number' ? task.progress : ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0 && v <= 100 && v !== (task.progress ?? NaN)) {
                      updateTask(task.id, { progress: v });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 inline-block w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-text hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) setEditingCell({ taskId: task.id, columnId: 'progress' }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'progress' }); }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'progress' });
                  }}
                >
                  {typeof task.progress === 'number' ? `${task.progress}%` : '-'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'assignee') {
          const hasAssignments = task.assignments && task.assignments.length > 0;
          const assigneeLabel = hasAssignments
            ? task.assignments!.map(a => `${a.assignee}(${a.allocationPercent}%)`).join(', ')
            : (task.assignee || '');
          const projectAssignees = (task.projectId ? assigneeOptionsByProjectId.get(task.projectId) : []) ?? [];
          // 프로젝트 투입인원 + 현재 담당자(목록에 없을 수 있음)를 선택 옵션으로
          const assigneeOptions = Array.from(new Set([...projectAssignees, task.assignee?.trim()].filter(Boolean))).sort();
          return (
            <div key={colId} className="data-cell text-xs text-stone-600 relative overflow-visible group/assignee" onClick={(e) => e.stopPropagation()} title={hasAssignments ? assigneeLabel : undefined}>
              {hasAssignments ? (
                <span className="block">{assigneeLabel}</span>
              ) : assigneeOptions.length > 0 ? (
                <select
                  value={task.assignee || ''}
                  onChange={(e) => updateTask(task.id, { assignee: e.target.value })}
                  className="w-full bg-transparent p-1 pr-6 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 transition-colors cursor-pointer appearance-none text-xs"
                  title="프로젝트 투입인원 중에서 선택"
                >
                  <option value="">배정 안됨</option>
                  {assigneeOptions.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    list={`assignee-datalist-${task.id}`}
                    value={task.assignee || ''}
                    onChange={(e) => updateTask(task.id, { assignee: e.target.value })}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (task.assignee || '').trim()) {
                        updateTask(task.id, { assignee: v });
                      }
                    }}
                    placeholder="배정 ..."
                    className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 transition-colors"
                  />
                  <datalist id={`assignee-datalist-${task.id}`}>
                    <option value="">배정 안됨</option>
                    {allAssignees.map(a => <option key={a} value={a} />)}
                  </datalist>
                </>
              )}
              {!hasAssignments && (
                <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center px-1 text-stone-400 group-hover/assignee:text-stone-600">
                  <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
              )}
            </div>
          );
        }
        if (colId === 'allocation') {
          // 담당자별로 한 번만 표기한 값 (상위에서 행 순서 기준으로 계산해 전달)
          const text = allocationDisplayText ?? '—';
          return (
            <div key={colId} className="data-cell text-xs text-stone-600 font-mono" title={text !== '—' ? text : undefined}>
              {text}
            </div>
          );
        }
        if (colId === 'status') {
          return (
            <div key={colId} className="data-cell" onClick={(e) => e.stopPropagation()}>
              <select
                value={task.status}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  if (newStatus !== task.status) {
                    const config = statusConfigs.find((c) => c.id === newStatus);
                    const updates: Partial<Task> = { status: newStatus };
                    if (config && config.progress !== undefined) {
                      updates.progress = config.progress;
                    }
                    updateTask(task.id, updates);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, task.id, 'status');
                }}
                className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 cursor-pointer transition-colors appearance-none text-xs"
              >
                {statusConfigs.map((config) => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </div>
          );
        }
        if (colId === 'deliverables') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'deliverables';
          return (
            <div key={colId} className={cn("data-cell text-xs text-stone-600 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded")} onClick={(e) => e.stopPropagation()}>
              {isEditing ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={task.deliverables ?? ''}
                  placeholder="산출물"
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (task.deliverables ?? '').trim()) {
                      updateTask(task.id, { deliverables: v || undefined });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 block truncate w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-text hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) setEditingCell({ taskId: task.id, columnId: 'deliverables' }); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'deliverables' }); }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'deliverables' });
                  }}
                  title={tableEditMode ? '클릭하여 산출물 수정' : ((task.deliverables || '').trim() || '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {task.deliverables || '-'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'dependencies') {
          const selfSeq = rowIndex + 1;
          const applyDependenciesInput = (raw: string | undefined) => {
            const parts = (typeof raw === 'string' ? raw : '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            const taskIds: string[] = [];
            const seen = new Set<number>();
            for (const p of parts) {
              const n = parseInt(p, 10);
              if (!Number.isFinite(n) || n < 1 || seen.has(n) || n === selfSeq) continue;
              seen.add(n);
              const id = seqNumToTaskId.get(n);
              if (id) taskIds.push(id);
            }
            const locked = new Set(task.userLockedFields ?? []);
            locked.add('dependencies');
            updateTask(task.id, { dependencies: taskIds, userLockedFields: Array.from(locked) });
          };
          return (
            <div key={colId} className="data-cell text-xs text-stone-600 font-mono flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()} title="행 번호 입력 (예: 1, 2, 5). F2로 이 셀 포커스. 자물쇠: 사용자 고정">
              <LockBadge field="dependencies" />
              <input
                data-deps-input="true"
                type="text"
                value={depsInputValue ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d\s,]/g, '');
                  setDepsInputValue(v);
                }}
                onFocus={() => setDepsFocused(true)}
                onBlur={() => {
                  setDepsFocused(false);
                  applyDependenciesInput((depsInputValue ?? '').trim());
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setDepsFocused(false);
                    applyDependenciesInput((depsInputValue ?? '').trim());
                    e.currentTarget.blur();
                  }
                }}
                placeholder=""
                className="w-full min-w-0 bg-transparent p-1 font-mono text-inherit border border-transparent hover:border-stone-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded focus:outline-none"
              />
            </div>
          );
        }
        return null;
      })}
      <div className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
          title="작업 수정"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(task.id);
          }}
          className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
          title="삭제"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function areRowPropsEqual(prev: SortableTaskRowProps, next: SortableTaskRowProps) {
  const editingCellSame =
    prev.editingCell === next.editingCell ||
    (!!prev.editingCell && !!next.editingCell && prev.editingCell.taskId === next.editingCell.taskId && prev.editingCell.columnId === next.editingCell.columnId);
  return (
    editingCellSame &&
    prev.tableEditMode === next.tableEditMode &&
    prev.rowIndex === next.rowIndex &&
    prev.wbsId === next.wbsId &&
    prev.displayWbsId === next.displayWbsId &&
    prev.isSelected === next.isSelected &&
    prev.isFocused === next.isFocused &&
    prev.hasChildren === next.hasChildren &&
    prev.isTreeView === next.isTreeView &&
    prev.isInlineEditingName === next.isInlineEditingName &&
    prev.gridStyle === next.gridStyle &&
    prev.visibleColumnIds === next.visibleColumnIds &&
    prev.allAssignees === next.allAssignees &&
    prev.assigneeOptionsByProjectId === next.assigneeOptionsByProjectId &&
    prev.statusConfigs === next.statusConfigs &&
    prev.projectAssignmentsByProjectId === next.projectAssignmentsByProjectId &&
    prev.criticalPathSet === next.criticalPathSet &&
    prev.allocationDisplayText === next.allocationDisplayText &&
    prev.task.id === next.task.id &&
    prev.task.parentId === next.task.parentId &&
    prev.task.name === next.task.name &&
    prev.task.startDate === next.task.startDate &&
    prev.task.endDate === next.task.endDate &&
    prev.task.progress === next.task.progress &&
    prev.task.assignee === next.task.assignee &&
    prev.task.assignments === next.task.assignments &&
    prev.task.projectId === next.task.projectId &&
    prev.task.status === next.task.status &&
    prev.task.expanded === next.task.expanded &&
    prev.task.workEffort === next.task.workEffort &&
    prev.task.deliverables === next.task.deliverables &&
    prev.taskIdToSeqNum === next.taskIdToSeqNum &&
    prev.seqNumToTaskId === next.seqNumToTaskId &&
    prev.task.dependencies === next.task.dependencies &&
    (prev.task.userLockedFields?.length ?? 0) === (next.task.userLockedFields?.length ?? 0) &&
    (prev.task.userLockedFields ?? []).every((f, i) => (next.task.userLockedFields ?? [])[i] === f) &&
    (prev.task.depth ?? 0) === (next.task.depth ?? 0)
  );
}

const SortableTaskRow = React.memo(SortableTaskRowInner, areRowPropsEqual);

function StatusBadge({ status }: { status: Task['status'] }) {
  const { wbsSettings } = useWBS();
  const badgeClass = {
    todo: 'badge-todo',
    'in-progress': 'badge-progress',
    done: 'badge-done',
    blocked: 'badge-blocked',
  }[status];

  return (
    <span className={cn('badge', badgeClass)}>
      {wbsSettings?.statusNames?.[status] ?? status}
    </span>
  );
}
