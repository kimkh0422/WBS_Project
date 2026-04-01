import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useWBS } from '../context/WBSContext';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatDate, round2, formatNum2 } from '../lib/utils';
import { ChevronRight, ChevronDown, ChevronUp, Plus, Pencil, ArrowUpDown, ArrowUp, ArrowDown, X, MoreHorizontal, CornerDownRight, CalendarDays, Clock, TrendingUp, ListChecks, Settings2, RefreshCw, EyeOff, RotateCcw, Unlink, Edit2, Trash2 } from 'lucide-react';
import { type TableColumnId, type WBSTableProps } from './wbsTableTypes';
import { SortableTaskRow, type TaskIdToSeqNum, type SeqNumToTaskId, type OtherCellFocus, type SortableTaskRowProps } from './SortableTaskRow';
import { ExcelGrid } from './ExcelGrid';
import { Task, TaskStatus, FilterState, SortConfig } from '../types';
import { TaskModal } from './TaskModal';
import { MdEditModal } from './MdEditModal';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { useVirtualizer, defaultRangeExtractor } from '@tanstack/react-virtual';
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
  DragStartEvent,
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
import { buildParentSet, buildVisibleTasks, type TaskWithDepth } from '../lib/taskView';
import { buildMarkdownFromTasks, parseMarkdownTable } from '../lib/export';
import { levelRowBg } from '../lib/levelColors';
import { useToast } from './Toast';
import { getCriticalPathTaskIds } from '../lib/schedule';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

/** 컬럼 헤더 마우스 오버 시 툴팁 */
const COLUMN_TOOLTIPS: Record<TableColumnId, string> = {
  wbsId: 'WBS 식별자',
  name: '작업명 (클릭하여 정렬)',
  startDate: '시작일 (클릭하여 정렬)',
  endDate: '종료일 (클릭하여 정렬)',
  workEffort: '공수(일 단위) (클릭하여 정렬)',
  weight: '진척 가중치 (클릭하여 정렬)',
  assignee: '담당자 (클릭하여 정렬)',
  allocation: '투입율 (%)',
  status: '상태 (클릭하여 정렬)',
  progress: '진척률 (%) (클릭하여 정렬)',
  deliverables: '산출물',
  dependencies: '선행작업(의존성)',
};

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

const DEFAULT_TABLE_COLUMNS: { id: 'wbsId' | 'name' | 'startDate' | 'endDate' | 'workEffort' | 'weight' | 'assignee' | 'allocation' | 'status' | 'progress' | 'deliverables' | 'dependencies'; visible: boolean }[] = [
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

export function WBSTable({ filters, sortConfig, onSort, syncScrollRef, rowHeight: propRowHeight, onRowHeightChange, onRowHeightsChange, hotkeysEnabled = true, onOpenColumnSettings, fillHeight = false, onResetFilters }: WBSTableProps) {
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
    canEditCurrentProject,
    reorderTask,
  } = useWBS();

  const { push: pushToast, tipOnce } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const currentUserDisplayName =
    String(user?.user_metadata?.full_name ?? user?.email ?? '').trim() || '(이름 없음)';

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
  /** Shift 구간 선택 시작 행 — setState보다 먼저 갱신(행 클릭 직후 Shift 시 state 미반영 버그 방지) */
  const rangeAnchorRef = useRef<string | null>(null);

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

  const quickAddNameInlineRef = useRef<HTMLInputElement>(null);
  const quickAddNameBottomRef = useRef<HTMLInputElement>(null);
  const [insertTargetId, setInsertTargetId] = useState<string | null>(null);
  const [inlineAddingTaskId, setInlineAddingTaskId] = useState<string | null>(null);

  // F2 Inline Name Edit state
  const [inlineEditingNameId, setInlineEditingNameId] = useState<string | null>(null);

  /** 셀 단위 인라인 편집: { taskId, columnId } */
  const [editingCell, setEditingCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);
  /** 편집 버튼으로 켜는 엑셀형 즉석 편집 모드: 셀 클릭만으로 해당 컬럼 편집 (F2로 토글) */
  const [tableEditMode, setTableEditMode] = useState(false);
  /** 전체를 스프레드시트(AG Grid) 뷰로 보는 모드 */
  const [excelView, setExcelView] = useState(false);

  // 엑셀 시트(AG Grid) 뷰로 전환/종료할 때는 표 인라인 편집 모드도 함께 종료
  useEffect(() => {
    if (!excelView && tableEditMode) {
      setTableEditMode(false);
      setEditingCell(null);
      setInlineEditingNameId(null);
      setFocusedCell(null);
    }
  }, [excelView, tableEditMode]);
  /** 편집 모드에서 키보드로 이동할 때의 현재 셀 (편집 중이 아닐 때) */
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; columnId: TableColumnId } | null>(null);

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
  // ─── Realtime: 표 셀 포커스 공유(상대 커서 느낌) ────────────────────────────
  const focusChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const [otherCellFocus, setOtherCellFocus] = useState<OtherCellFocus[]>([]);
  const otherFocusByCellKey = useMemo(() => {
    const m = new Map<string, OtherCellFocus[]>();
    for (const f of otherCellFocus) {
      const k = `${f.taskId}::${f.columnId}`;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    }
    return m;
  }, [otherCellFocus]);

  const colorForUser = useCallback((uid: string) => {
    // deterministic palette
    const palette = ['#2563eb', '#16a34a', '#f97316', '#db2777', '#7c3aed', '#0ea5e9', '#ca8a04', '#dc2626'];
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return palette[h % palette.length]!;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!currentProjectId || currentProjectId === 'all') return;
    if (!currentUserId) return;

    const channel = supabase.channel(`wbs-focus-${currentProjectId}`, {
      config: {
        broadcast: { self: false },
      },
    });
    focusChannelRef.current = channel;

    const prune = (list: OtherCellFocus[]) => {
      const now = Date.now();
      return list.filter(x => now - x.ts < 15000); // 15s stale prune
    };

    channel.on('broadcast', { event: 'cell_focus' }, (payload) => {
      const raw = payload?.payload ?? payload;
      queueMicrotask(() => {
        const p = raw;
        const uid = String(p?.userId ?? '').trim();
        if (!uid || uid === currentUserId) return;
        const taskId = String(p?.taskId ?? '').trim();
        const columnId = String(p?.columnId ?? '').trim() as TableColumnId;
        if (!taskId || !columnId) return;
        const displayName = String(p?.displayName ?? '').trim() || '(이름 없음)';
        const color = String(p?.color ?? '').trim() || colorForUser(uid);
        setOtherCellFocus(prev => {
          const next = prune(prev);
          const without = next.filter(x => x.userId !== uid);
          return [...without, { userId: uid, displayName, color, taskId, columnId, ts: Date.now() }];
        });
      });
    });

    channel.on('broadcast', { event: 'cell_blur' }, (payload) => {
      const raw = payload?.payload ?? payload;
      queueMicrotask(() => {
        const p = raw;
        const uid = String(p?.userId ?? '').trim();
        if (!uid || uid === currentUserId) return;
        setOtherCellFocus(prev => prev.filter(x => x.userId !== uid));
      });
    });

    channel.subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        /* ignore */
      }
      focusChannelRef.current = null;
      setOtherCellFocus([]);
    };
  }, [currentProjectId, currentUserId, colorForUser]);

  // 내 포커스 전송 (focusedCell 우선, editingCell도 포함)
  useEffect(() => {
    const channel = focusChannelRef.current;
    if (!channel) return;
    if (!tableEditMode) return;
    if (!currentUserId) return;
    const cell = editingCell ?? focusedCell;
    const send = (event: 'cell_focus' | 'cell_blur', payload: Record<string, string>) => {
      try {
        channel.send({ type: 'broadcast', event, payload });
      } catch {
        /* ignore */
      }
    };
    if (!cell) {
      send('cell_blur', { userId: currentUserId });
      return;
    }
    const t = window.setTimeout(() => {
      send('cell_focus', {
        userId: currentUserId,
        displayName: currentUserDisplayName,
        color: colorForUser(currentUserId),
        taskId: cell.taskId,
        columnId: cell.columnId,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [tableEditMode, editingCell, focusedCell, currentUserId, currentUserDisplayName, colorForUser]);
  /** 편집 버튼 클릭 시 열리는 표-as-MD 편집 모달 */
  const [isMdEditModalOpen, setIsMdEditModalOpen] = useState(false);
  const [mdEditInitialMarkdown, setMdEditInitialMarkdown] = useState('');

  // Global list of assignees for datalist autocomplete (bulk edit 등): 프로젝트 투입인원 + 작업 담당자
  const allAssignees = useMemo(() => {
    const fromProjects = projects.flatMap(p => (p.assignments ?? []).map(a => a.assignee).filter(Boolean));
    const fromAssignee = tasks.map(t => t.assignee).filter(Boolean);
    return Array.from(new Set([...fromProjects, ...fromAssignee])).sort();
  }, [projects, tasks]);

  // 프로젝트별 담당자 옵션: 프로젝트 등록 인원 + 해당 프로젝트 작업에 이미 배정된 인원
  const assigneeOptionsByProjectId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of projects) {
      const fromProject = (p.assignments ?? []).map(a => a.assignee).filter(Boolean);
      const fromTasks = tasks
        .filter(t => t.projectId === p.id)
        .map(t => t.assignee).filter(Boolean);
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
    weight: 56,
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
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  /** 스플릿 뷰에서 헤더 가로 스크롤 동기화용 */
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScrollRef = useRef(false);

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
    const cols = wbsSettings?.tableColumns;
    const incoming = Array.isArray(cols) && (cols.length > 0) ? cols : DEFAULT_TABLE_COLUMNS;

    const allow = new Set(DEFAULT_TABLE_COLUMNS.map(c => c.id));
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

    return cleaned.map(c => c.id === 'name' ? { ...c, visible: true } : c);
  }, [wbsSettings]);

  const visibleColumnIds = useMemo(() => tableColumns.filter(c => c.visible).map(c => c.id), [tableColumns]);
  /** 편집 모드에서 좌우 이동 시 사용할 편집 가능 컬럼 순서 (wbsId 제외) */
  const editableColumnIds = useMemo(() => visibleColumnIds.filter(id => id !== 'wbsId') as TableColumnId[], [visibleColumnIds]);

  const gridStyle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${columnWidths.grip}px`);
    parts.push(`${columnWidths.checkbox}px`);
    parts.push(`${columnWidths.seq}px`);
    parts.push(`${columnWidths.expand}px`);
    for (const id of visibleColumnIds) {
      if (id === 'name') parts.push(`${columnWidths.name}px`);
      else parts.push(`${(columnWidths as Record<string, number>)[id]}px`);
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

  // 가상 스크롤링: wrapTextInCells=false(고정 행 높이)이고 50행 초과 시 활성화
  const [dndActiveId, setDndActiveId] = useState<string | null>(null);
  const shouldVirtualize = !wrapTextInCells && visibleTasks.length > 50 && inlineAddingTaskId === null;

  // 드래그 중인 항목의 인덱스를 미리 계산 (virtualRangeExtractor 내 O(n) findIndex 제거)
  const dndActiveIndex = useMemo(
    () => (dndActiveId ? visibleTasks.findIndex(t => t.id === dndActiveId) : -1),
    [dndActiveId, visibleTasks]
  );

  const virtualRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const base = defaultRangeExtractor(range);
      if (dndActiveIndex !== -1 && !base.includes(dndActiveIndex)) {
        return [...base, dndActiveIndex].sort((a, b) => a - b);
      }
      return base;
    },
    [dndActiveIndex]
  );

  const rowVirtualizer = useVirtualizer({
    count: visibleTasks.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
    rangeExtractor: virtualRangeExtractor,
  });

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
      const heights = [...rows].map(el => el.offsetHeight);
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

  /** 담당자별로 투입율을 한 번만 표기: 행 순서대로 이미 표시한 담당자 집합을 유지하고, 해당 행에 표시할 텍스트만 반환 */
  const allocationDisplayByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    const shown = new Set<string>();
    for (const task of visibleTasks) {
      const assignments = task.projectId ? projectAssignmentsByProjectId.get(task.projectId) ?? [] : [];
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
    weight: '가중치',
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
      else if (colId === 'workEffort') cellText = task.workEffort != null ? (Math.round(task.workEffort * 10) / 10).toFixed(1) : '-';
      else if (colId === 'weight') cellText = task.weight != null ? formatNum2(task.weight) : '-';
      else if (colId === 'assignee') {
        cellText = task.assignee || '—';
      } else if (colId === 'allocation') cellText = allocationDisplayByTaskId.get(task.id) ?? '—';
      else if (colId === 'status') {
        const name = (wbsSettings?.statusConfigs ?? []).find((c: { id: string }) => c.id === task.status);
        cellText = (name as { name?: string } | undefined)?.name ?? task.status ?? '—';
      } else if (colId === 'progress') cellText = typeof task.progress === 'number' ? `${formatNum2(task.progress)}%` : '—';
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
  const setSelection = useCallback((next: Set<string>) => {
    setSelectedTaskIds(next);
    setSharedSelectedTaskIds(Array.from(next));
  }, [setSharedSelectedTaskIds]);

  const handleSelect = useCallback((taskId: string, multi: boolean, range: boolean) => {
    let newSelected = new Set<string>(multi ? selectedTaskIds : ([] as string[]));

    // 계층 구조: 상위 작업 선택 시 하위 작업 전체를 함께 선택/해제
    const currentIndex = visibleTasks.findIndex((t) => t.id === taskId);
    const currentTask = currentIndex !== -1 ? visibleTasks[currentIndex] : null;
    const currentDepth = currentTask?.depth ?? 0;

    const descendantIds: string[] = [];
    if (currentTask) {
      for (let i = currentIndex + 1; i < visibleTasks.length; i++) {
        const t = visibleTasks[i];
        const depth = t.depth ?? 0;
        if (depth <= currentDepth) break;
        descendantIds.push(t.id);
      }
    }

    if (range) {
      const anchorId = rangeAnchorRef.current ?? anchorTaskId ?? lastSelectedId;
      if (anchorId) {
        const anchorIndex = visibleTasks.findIndex((t) => t.id === anchorId);

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
        newSelected.add(taskId);
      }
    } else {
      const wasSelected = selectedTaskIds.has(taskId);
      const idsToToggle = [taskId, ...descendantIds];

      if (multi) {
        if (wasSelected) {
          idsToToggle.forEach((id) => newSelected.delete(id));
        } else {
          idsToToggle.forEach((id) => newSelected.add(id));
        }
      } else {
        const next = new Set<string>();
        if (!wasSelected) {
          idsToToggle.forEach((id) => next.add(id));
        }
        newSelected = next;
      }

      rangeAnchorRef.current = taskId;
      setAnchorTaskId(taskId);
    }

    setSelection(newSelected);
    setLastSelectedId(taskId);
  }, [selectedTaskIds, visibleTasks, anchorTaskId, lastSelectedId, setSelection]);

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
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDndActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
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
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setDropTarget(null);
    setDndActiveId(null);
  }, []);

  /** 드래그한 작업을 놓은 위치에 따라 상하 이동 또는 하위(자식) 이동 */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDndActiveId(null);
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
    const childrenByParent = new Map<string, string[]>();
    for (const t of tasks) {
      if (t.parentId) {
        const arr = childrenByParent.get(t.parentId) ?? [];
        arr.push(t.id);
        childrenByParent.set(t.parentId, arr);
      }
    }
    const descendantIds = new Set<string>();
    const collectDescendants = (parentId: string) => {
      for (const childId of childrenByParent.get(parentId) ?? []) {
        descendantIds.add(childId);
        collectDescendants(childId);
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
    } else {
      // before/after: overTask와 같은 부모 레벨(형제)로 이동 + 표시 순서도 같이 이동
      const targetParentId = overTask.parentId ?? null;
      updateTask(draggedId, { parentId: targetParentId });
      reorderTask(draggedId, overId);
    }
    setDropTarget(null);
  }, [tasks, dropTarget, updateTask, reorderTask]);

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      const target = e.target as HTMLElement;
      if (editingTask || deleteConfirm.isOpen) return;
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // 엑셀 뷰(ag-grid)에서는 기본 키보드 동작(Tab/Enter/Insert 등)을 그대로 사용하도록
      // 전역 단축키를 비활성화한다.
      if (excelView) {
        const inAgGrid = (target as HTMLElement).closest?.('.ag-root');
        if (inAgGrid) return;
      }

      const inWbsTable = (target as HTMLElement).closest?.('[data-wbs-table]');
      const inQuickAdd = (target as HTMLElement).closest?.('[data-quick-add]');

      // 새 작업 입력칸(하단/인라인)에서는 Enter가 폼 submit 되도록 전역 단축키 미동작
      if (inQuickAdd) return;
      // 표 밖의 일반 입력/셀렉트 포커스 중에는 단축키 미동작
      if (!inWbsTable && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

      // 셀/작업명 편집 중 Enter: 값 커밋(blur) 후
      // - 현재 행 바로 아래에 같은 레벨(형제) 새 작업을 추가하고 그 작업으로 계속 편집.
      // - (의존성 입력칸 등 자체 Enter 처리가 있는 input은 여기로 오기 전에 stopPropagation 되거나,
      //    아래의 target.closest 체크에서 제외되도록 설계되어 있음)
      if (e.key === 'Enter' && (editingCell || inlineEditingNameId) && inWbsTable) {
        e.preventDefault();
        const currentTaskId = editingCell?.taskId ?? inlineEditingNameId!;
        const columnId: TableColumnId = editingCell?.columnId ?? 'name';
        const currentIndex = visibleTasks.findIndex((t) => t.id === currentTaskId);

        // 1) 먼저 blur로 현재 입력을 커밋 (onBlur에서 updateTask 수행)
        (document.activeElement as HTMLElement | null)?.blur?.();

        // 2) 새 작업으로 이동
        const moveToTaskId = (nextId: string) => {
          setLastSelectedId(nextId);
          setTableEditMode(true);
          setFocusedCell({ taskId: nextId, columnId });
          if (columnId === 'name') {
            setInlineEditingNameId(nextId);
            setEditingCell(null);
          } else {
            setEditingCell({ taskId: nextId, columnId });
            setInlineEditingNameId(null);
          }
          document.getElementById(`task-row-${nextId}`)?.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            document.getElementById(`wbs-edit-${nextId}-${columnId}`)?.focus();
          });
        };

        window.setTimeout(() => {
          // 현재 행 아래에 같은 레벨(형제) 새 작업 추가
          const base = tasks.find((t) => t.id === currentTaskId);
          const pid = base?.projectId || currentProjectId;
          const proj = projects.find((p) => p.id === pid);
          const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
          const newId = addTask(
            {
              name: '새 작업',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: base?.parentId ?? null,
              expanded: true,
            },
            currentTaskId
          );
          setSelection(new Set([newId]));
          moveToTaskId(newId);
        }, 0);
        return;
      }

      // 셀/작업명 편집 중 화살표: 인접 셀(행/열)로 이동 후 계속 편집
      // number 타입 input에서는 화살표 키를 값 증감에만 사용하고 셀 이동하지 않는다
      // (빠르게 누를 경우 blur → row 포커스 → 행 더블클릭 오작동 방지)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (editingCell || inlineEditingNameId) && target.closest('[data-wbs-table]')) {
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') return;
        const currentTaskId = editingCell?.taskId ?? inlineEditingNameId!;
        const columnId: TableColumnId = editingCell?.columnId ?? 'name';
        const currentIndex = visibleTasks.findIndex((t) => t.id === currentTaskId);
        const colIdx = editableColumnIds.indexOf(columnId);
        if (currentIndex >= 0 && colIdx >= 0) {
          let nextRowIdx = currentIndex;
          let nextColIdx = colIdx;
          if (e.key === 'ArrowDown') nextRowIdx = Math.min(visibleTasks.length - 1, currentIndex + 1);
          else if (e.key === 'ArrowUp') nextRowIdx = Math.max(0, currentIndex - 1);
          else if (e.key === 'ArrowLeft') nextColIdx = Math.max(0, colIdx - 1);
          else if (e.key === 'ArrowRight') nextColIdx = Math.min(editableColumnIds.length - 1, colIdx + 1);

          const nextTask = visibleTasks[nextRowIdx];
          const nextCol = editableColumnIds[nextColIdx];
          if (nextTask && nextCol) {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur?.();
            setTimeout(() => {
              setLastSelectedId(nextTask.id);
              if (nextCol === 'name') {
                setInlineEditingNameId(nextTask.id);
                setEditingCell(null);
              } else {
                setEditingCell({ taskId: nextTask.id, columnId: nextCol });
                setInlineEditingNameId(null);
              }
              document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
              requestAnimationFrame(() => {
                document.getElementById(`wbs-edit-${nextTask.id}-${nextCol}`)?.focus();
              });
            }, 0);
          }
        }
        return;
      }

      // 편집 모드에서 셀 간 화살표 이동 (편집 중이 아닐 때)
      if (tableEditMode && !editingCell && !inlineEditingNameId && target.closest('[data-wbs-table]') && focusedCell && editableColumnIds.length > 0) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const rowIdx = visibleTasks.findIndex((t) => t.id === focusedCell.taskId);
          const colIdx = editableColumnIds.indexOf(focusedCell.columnId);
          if (rowIdx >= 0 && colIdx >= 0) {
            let nextRowIdx = rowIdx;
            let nextColIdx = colIdx;
            if (e.key === 'ArrowUp') nextRowIdx = Math.max(0, rowIdx - 1);
            else if (e.key === 'ArrowDown') nextRowIdx = Math.min(visibleTasks.length - 1, rowIdx + 1);
            else if (e.key === 'ArrowLeft') nextColIdx = Math.max(0, colIdx - 1);
            else if (e.key === 'ArrowRight') nextColIdx = Math.min(editableColumnIds.length - 1, colIdx + 1);
            const nextTask = visibleTasks[nextRowIdx];
            const nextCol = editableColumnIds[nextColIdx];
            if (nextTask && nextCol) {
              e.preventDefault();
              setFocusedCell({ taskId: nextTask.id, columnId: nextCol });
              setLastSelectedId(nextTask.id);
              document.getElementById(`task-row-${nextTask.id}`)?.scrollIntoView({ block: 'nearest' });
            }
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const { taskId, columnId } = focusedCell;
          if (columnId === 'name') {
            setInlineEditingNameId(taskId);
            setEditingCell(null);
          } else {
            setEditingCell(focusedCell);
            setInlineEditingNameId(null);
          }
          document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            document.getElementById(`wbs-edit-${taskId}-${columnId}`)?.focus();
          });
          return;
        }
      }

      // Esc: 편집/선택 해제는 포커스 위치와 무관하게 우선 처리
      // (입력 중/셀 편집 중에도 Esc로 빠져나오고, 최종적으로 선택도 해제 가능)
      if (e.key === 'Escape') {
        // 편집 중지 (셀 편집 → 작업명 편집 → 테이블 편집 모드 순으로 해제)
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
          setFocusedCell(null);
          (document.activeElement as HTMLElement)?.blur();
          tableScrollRef.current?.focus();
          e.preventDefault();
          return;
        }
        // 선택 모두 취소
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

      // Ignore other non-shortcut keys when editing a cell or typing in an input
      if (editingCell || inlineEditingNameId) return;
      const inWbsTableFallback = (target as HTMLElement).closest?.('[data-wbs-table]');
      if (!inWbsTableFallback) {
        // 표 밖의 일반 입력/셀렉트는 기본 동작 유지 (검색창 등)
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      }

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
        if (clipboard.length === 0) {
          pushToast('복사된 작업이 없습니다.', { variant: 'info' });
          return;
        }

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
          const { id: _id, projectId: _pid, depth: _depth, dependencies: _deps, ...rest } = t as Task & { depth?: number };
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

      const copySelectionToClipboard = () => {
        if (selectedTaskIds.size === 0) return;
        const selected = visibleTasks
          .filter(t => selectedTaskIds.has(t.id))
          .map((t) => {
            const { depth: _depth, ...rest } = t as TaskWithDepth;
            return rest as Task;
          });
        setCopiedTasks(selected);
        try {
          const payload: ClipboardPayloadV1 = { version: 1, copiedAt: new Date().toISOString(), tasks: selected };
          localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
        } catch {
          // ignore storage errors (private mode, quota, etc.)
        }
      };

      // Cut: copy + delete (with confirmation)
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        copySelectionToClipboard();
        if (effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      // Copy (works as long as there's a selection)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectionToClipboard();
        return;
      }

      // Delete만 삭제 메뉴 오픈 (Backspace는 브라우저 뒤로가기·입력 필드와 충돌 방지)
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (canEditCurrentProject && effectiveSelectedIds.length > 0) {
          setDeleteConfirm({ isOpen: true, taskIds: effectiveSelectedIds });
        }
        return;
      }

      // F2: 선택 셀(편집 모드 포커스) 또는 현재 행·작업명을 즉시 인라인 편집 (엑셀과 동일)
      if (e.key === 'F2') {
        e.preventDefault();
        const taskId =
          tableEditMode && focusedCell
            ? focusedCell.taskId
            : lastSelectedId || visibleTasks[0]?.id;
        if (!taskId || editableColumnIds.length === 0) return;
        const columnId =
          tableEditMode &&
          focusedCell &&
          focusedCell.taskId === taskId &&
          editableColumnIds.includes(focusedCell.columnId)
            ? focusedCell.columnId
            : editableColumnIds.includes('name')
              ? 'name'
              : editableColumnIds[0]!;
        setTableEditMode(true);
        setFocusedCell({ taskId, columnId });
        setLastSelectedId(taskId);
        // 체크박스 선택은 유지 (편집만으로 행이 자동 체크되지 않음)
        if (columnId === 'name') {
          setInlineEditingNameId(taskId);
          setEditingCell(null);
        } else {
          setEditingCell({ taskId, columnId });
          setInlineEditingNameId(null);
        }
        document.getElementById(`task-row-${taskId}`)?.scrollIntoView({ block: 'nearest' });
        requestAnimationFrame(() => {
          document.getElementById(`wbs-edit-${taskId}-${columnId}`)?.focus();
        });
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
          // Alt+↑: 한 칸 위로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered &&
            (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
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
          // Alt+↓: 한 칸 아래로 이동 (체크 선택 1개 또는 포커스만 있는 1개)
          const canMove =
            !isSortedOrFiltered &&
            (selectedTaskIds.size === 0 || (selectedTaskIds.size === 1 && selectedTaskIds.has(lastSelectedId)));
          if (canMove) {
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
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 편집 모드에서는 화살표는 셀 이동으로만 사용 (펼치기/접기 비활성화)
        if (tableEditMode) return;
        // 트리 뷰에서만: ← 접기, → 펼치기 (자식이 있는 행에서만 동작)
        const isTreeView = !(
          filters.status !== 'all' || filters.assignee || filters.startDate || filters.endDate ||
          !!filters.milestoneOnly || !!filters.issueOnly
        );
        // NOTE: 체크박스 선택이 없어도, 포커스(lastSelectedId)가 있으면 접기/펼치기 가능해야 함.
        if (isTreeView && lastSelectedId) {
          const task = tasks.find(t => t.id === lastSelectedId);
          const hasChildren = task ? tasks.some(t => t.parentId === task.id) : false;
          if (hasChildren) {
            if (e.key === 'ArrowLeft' && task?.expanded) {
              e.preventDefault();
              toggleExpand(lastSelectedId);
            } else if (e.key === 'ArrowRight' && !task?.expanded) {
              e.preventDefault();
              toggleExpand(lastSelectedId);
            }
          }
        }
      } else if (e.key === 'Tab') {
        if (tableEditMode) return; // 편집 모드에서는 들여쓰기/내어쓰기 비활성화
        e.preventDefault();
        if (selectedTaskIds.size > 0) {
          // Tab: 레벨 한 단계 내리기(들여쓰기), Shift+Tab: 레벨 한 단계 올리기(내어쓰기)
          const orderedIds = visibleTasks.filter(t => selectedTaskIds.has(t.id)).map(t => t.id);
          if (e.shiftKey) {
            outdentTasks(orderedIds);
          } else {
            indentTasks(orderedIds);
          }
        }
      } else if (e.key === 'Enter') {
        // Enter: 동일 레벨(형제) 작업을 현재 행 "아래"에 추가
        if (tableEditMode) return; // 편집 모드에서는 Enter는 셀 편집 시작으로만 사용
        e.preventDefault();

        // 기본 기준 행: lastSelectedId(포커스된 행) 우선, 없으면 마지막 표시 행
        // ※ selectedTaskIds.size === 1 체크 제거: 화살표 키 이동 시 selectedTaskIds는
        //    갱신되지 않아 size가 0 또는 다수가 될 수 있지만, lastSelectedId는 항상 올바른
        //    현재 행을 가리키므로 이를 기준으로 사용한다.
        const baseTask =
          (lastSelectedId
            ? tasks.find((t) => t.id === lastSelectedId)
            : visibleTasks.length > 0
            ? tasks.find((t) => t.id === visibleTasks[visibleTasks.length - 1].id)
            : undefined) || null;

        const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

        const parentIdForNew =
          baseTask?.parentId ??
          null; // 기준 행이 없으면 루트 작업으로 추가

        const insertAfterId = baseTask?.id;

        const newId = addTask(
          {
            name: '새 작업',
            startDate: filters.startDate || defaultDate,
            endDate: filters.endDate || defaultDate,
            progress: 0,
            workEffort: 0.5,
            assignee: filters.assignee || '',
            status: 'todo',
            parentId: parentIdForNew,
          },
          insertAfterId
        );
        setSelection(new Set([newId]));
        setLastSelectedId(newId);
        setInlineEditingNameId(newId);
      } else if (e.key === 'Insert') {
        if (tableEditMode) return; // 편집 모드에서는 새 작업 추가 비활성화
        e.preventDefault();

        // 기준 행: lastSelectedId(포커스된 행) 우선, 없으면 마지막 표시 행
        const baseTask =
          (lastSelectedId
            ? tasks.find((t) => t.id === lastSelectedId)
            : visibleTasks.length > 0
            ? tasks.find((t) => t.id === visibleTasks[visibleTasks.length - 1].id)
            : undefined) || null;
        const proj = projects.find((p) => p.id === (baseTask?.projectId || currentProjectId));
        const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

        if (e.shiftKey) {
          // Shift+Insert: 같은 레벨에서 기준 행 "위에" 새 작업 추가
          if (!baseTask) return;
          const currentIndex = visibleTasks.findIndex((t) => t.id === baseTask.id);
          const previousSibling = currentIndex > 0 ? visibleTasks[currentIndex - 1] : undefined;
          const insertAfterId = previousSibling?.id;
          const newId = addTask(
            {
              name: '새 작업',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: baseTask.parentId ?? null,
            },
            insertAfterId
          );
          setSelection(new Set([newId]));
          setLastSelectedId(newId);
          setInlineEditingNameId(newId);
        } else {
          // Insert: 기준 행의 하위 작업 추가 (기준 행이 없으면 루트 하위로 추가)
          const parentForChildId = baseTask?.id ?? null;
          const newId = addTask(
            {
              name: baseTask ? '새 하위 작업' : '새 작업',
              startDate: filters.startDate || defaultDate,
              endDate: filters.endDate || defaultDate,
              progress: 0,
              workEffort: 0.5,
              assignee: filters.assignee || '',
              status: 'todo',
              parentId: parentForChildId,
            },
            baseTask?.id
          );

          // Expand the parent so the new task is visible
          if (baseTask && !baseTask.expanded) {
            updateTask(baseTask.id, { expanded: true });
          }

          setSelection(new Set([newId]));
          setLastSelectedId(newId);
          setInlineEditingNameId(newId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, excelView, selectedTaskIds, sharedSelectedTaskIds, lastSelectedId, visibleTasks, editingTask, editingCell, inlineEditingNameId, tableEditMode, focusedCell, editableColumnIds, deleteConfirm, moveTask, indentTask, outdentTask, indentTasks, outdentTasks, tasks, sortConfig, filters, copiedTasks, addTask, rowHeight, handleSetRowHeight, handleSelectAll, toggleExpand, pushToast]);

  // 편집 모드가 아닐 때 테이블 내 입력 포커스 제거(커서 깜빡임 방지). 인라인 새 작업 추가 중이면 유지.
  useEffect(() => {
    if (tableEditMode || inlineAddingTaskId) return;
    const el = document.activeElement;
    if (!el || !tableScrollRef.current?.contains(el)) return;
    if ((el as HTMLElement).closest?.('[data-quick-add]')) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.blur();
      tableScrollRef.current?.focus();
    }
  }, [tableEditMode, inlineAddingTaskId]);

  const handleQuickAddCancel = () => {
    setInlineAddingTaskId(null);
    setInsertTargetId(null);
  };

  const handleInlineQuickAdd = (e: React.FormEvent, parentId: string | null) => {
    e.preventDefault();
    const name = quickAddNameInlineRef.current?.value ?? '';
    if (!name.trim()) return;

    const proj = projects.find(p => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    const newId = addTask({
      name: name.trim(),
      parentId,
      startDate: filters.startDate || defaultDate,
      endDate: filters.endDate || defaultDate,
      progress: 0,
      workEffort: 0.5,
      assignee: filters.assignee || '',
      status: 'todo'
    }, insertTargetId || undefined);

    if (quickAddNameInlineRef.current) quickAddNameInlineRef.current.value = '';
    setInlineAddingTaskId(null);
    setInsertTargetId(null);

    // Select the newly added task so pressing Enter again adds below it
    setSelection(new Set([newId]));
    setLastSelectedId(newId);
  };

  const handleSave = (updates: Partial<Task>) => {
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
    const name = quickAddNameBottomRef.current?.value ?? '';
    if (!name.trim()) return;

    const proj = projects.find(p => p.id === currentProjectId);
    const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];
    addTask({
      name: name.trim(),
      startDate: filters.startDate || defaultDate,
      endDate: filters.endDate || defaultDate,
      progress: 0,
      workEffort: 0.5,
      assignee: filters.assignee || '',
      status: 'todo',
      parentId: null,
    });
    if (quickAddNameBottomRef.current) quickAddNameBottomRef.current.value = '';
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => {
    e.preventDefault();
    if (!selectedTaskIds.has(taskId)) {
      handleSelect(taskId, false, false);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', taskId, columnId });
  }, [selectedTaskIds, handleSelect]);

  const handleSyncProgressFromStatus = () => {
    const idsToSync = selectedTaskIds.size > 0 ? Array.from(selectedTaskIds) : (contextMenu?.taskId ? [contextMenu.taskId] : []);
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
      rangeAnchorRef.current = nextSelectId;
      setAnchorTaskId(nextSelectId);
    } else {
      setSelection(new Set());
      setLastSelectedId(null);
      rangeAnchorRef.current = null;
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
      if (!isNaN(val) && val >= 0) updates.workEffort = Math.round(val * 10) / 10;
    }
    if (bulkProgress !== '') {
      const val = parseFloat(bulkProgress);
      if (!isNaN(val) && val >= 0 && val <= 100) updates.progress = round2(val);
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
    const taskById = new Map<string, Task>(tasks.map(t => [t.id, t]));
    for (const id of selectedTaskIds) {
      const prev = taskById.get(id);
      const locked = new Set<string>(prev?.userLockedFields ?? []);
      locked.add('workEffort');
      updateTask(id, { workEffort: value, userLockedFields: [...locked] });
    }
    setBulkWorkEffort('');
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const executeBulkStatus = () => {
    if (!bulkStatus) return;
    const updates: Partial<Task> = { status: bulkStatus };
    // 상태-진척도 연동이 켜져 있을 때만 상태 기준으로 진척률을 자동 설정
    if (wbsSettings.linkStatusAndProgress !== false) {
      const cfg = (wbsSettings.statusConfigs ?? []).find(c => c.id === bulkStatus);
      if (cfg && typeof cfg.progress === 'number' && Number.isFinite(cfg.progress)) {
        updates.progress = cfg.progress;
      }
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
    const taskById = new Map<string, Task>(tasks.map(t => [t.id, t]));
    for (const id of selectedTaskIds) {
      const prev = taskById.get(id);
      const locked = new Set<string>(prev?.userLockedFields ?? []);
      locked.add('dependencies');
      updateTask(id, { dependencies: [], userLockedFields: [...locked] });
    }
    setSelection(new Set());
    setLastSelectedId(null);
  };

  const SortIcon = ({ column }: { column: keyof Task | 'wbsId' }) => {
    const isActive = sortConfig?.key === column || (column === 'wbsId' && sortConfig?.key === 'wbs');
    if (!isActive) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortConfig!.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  // Aggregate stats: 항상 현재 프로젝트 기준 전체 현황 (선택/필터/레벨/접힘과 무관)
  // 전체 진척율: 1레벨 WBS의 (progress×weight) 가중평균을 우선 사용. (weight 없으면 공수로 대체)
  // 1레벨이 없으면 폴백으로 단말(리프) 단순 평균(상·하위 이중 집계 방지).
  const summaryStats = useMemo(() => {
    const source = baseTasks;
    if (source.length === 0) return null;

    const leafTasks = source.filter(t => !source.some(other => other.parentId === t.id));
    const forAggregate = leafTasks.length > 0 ? leafTasks : source;

    const totalEffort = forAggregate.reduce((sum, t) => sum + (t.workEffort || 0), 0);
    const taskById = new Map<string, Task>(source.map(t => [t.id, t]));
    const depthMemo = new Map<string, number>();
    const getDepth = (id: string): number => {
      const cached = depthMemo.get(id);
      if (cached !== undefined) return cached;
      const t = taskById.get(id);
      if (!t || !t.parentId || !taskById.has(t.parentId)) { depthMemo.set(id, 0); return 0; }
      const d = getDepth(t.parentId) + 1;
      depthMemo.set(id, d);
      return d;
    };
    const level1 = source.filter(t => getDepth(t.id) === 1);
    const computeWeighted = (items: Task[]) => {
      let totalWeight = 0;
      let acc = 0;
      for (const t of items) {
        const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
        const w =
          typeof t.weight === 'number' && Number.isFinite(t.weight)
            ? t.weight
            : (typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0 ? t.workEffort : 0);
        totalWeight += w;
        acc += p * w;
      }
      if (totalWeight > 0) return Math.round(acc / totalWeight);
      if (items.length > 0) return Math.round(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length);
      return 0;
    };
    const avgProgress = level1.length > 0
      ? computeWeighted(level1)
      : (forAggregate.length > 0
        ? Math.round(forAggregate.reduce((sum, t) => sum + (t.progress || 0), 0) / forAggregate.length)
        : 0);
    const startDate = source.reduce((min, t) => t.startDate < min ? t.startDate : min, source[0].startDate);
    const endDate = source.reduce((max, t) => t.endDate > max ? t.endDate : max, source[0].endDate);

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
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onContextMenu={(e) => { e.stopPropagation(); }}
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
      case 'weight':
        return (
          <div
            key={id}
            className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
            onClick={() => onSort('weight' as keyof Task)}
            onDoubleClick={onColDoubleClick}
            onContextMenu={onColContextMenu}
            title={COLUMN_TOOLTIPS.weight + ' · 더블클릭: 너비 자동'}
          >
            가중치 <SortIcon column={'weight' as keyof Task} />
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
              <StatChip icon={<Clock size={12} />} label="총 공수" value={`${Number(summaryStats.totalEffort ?? 0).toLocaleString()}일`} />
              <Divider />
              <StatChip icon={<TrendingUp size={12} />} label="전체 진척율" value={`${summaryStats.avgProgress}%`} />
              <Divider />
              <StatChip icon={<CalendarDays size={12} />} label="기간" value={`${formatSummaryDate(summaryStats.startDate)} ~ ${formatSummaryDate(summaryStats.endDate)}`} />

              <div className="ml-auto flex items-center gap-3">
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">레벨 펼치기</span>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.max(1, maxTreeLevel) }, (_, i) => i + 1).map(lv => (
                    <button
                      key={lv}
                      type="button"
                      title={`${lv}레벨까지 펼치기`}
                      onClick={() => {
                        setTreeExpandLevel(lv);
                        expandToLevel(lv);
                      }}
                      className={cn(
                        "h-7 min-w-[2.25rem] rounded-md border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                        treeExpandLevel === lv
                          ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm"
                          : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                      )}
                    >
                      {lv}
                    </button>
                  ))}
                </div>
                <Divider />
                <button
                  type="button"
                  onClick={toggleTableEditMode}
                  aria-pressed={tableEditMode}
                  className={cn(
                    "flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                    tableEditMode
                      ? "border-blue-400 bg-blue-100 text-blue-700"
                      : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                  )}
                  title="스프레드시트 편집 모드 (F2)"
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden />
                </button>
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
                  MD편집
                </button>
                <button
                  type="button"
                  onClick={() => setExcelView((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors shrink-0",
                    excelView
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                  title={excelView ? "엑셀 시트 보기 해제" : "엑셀 시트 형태로 보기 (셀 이동/편집은 엑셀처럼 동작)"}
                >
                  <span>엑셀편집</span>
                </button>
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
                onClick={toggleTableEditMode}
                aria-pressed={tableEditMode}
                className={cn(
                  "flex items-center justify-center h-7 w-7 rounded-md border text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
                  tableEditMode
                    ? "border-blue-400 bg-blue-100 text-blue-700"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                )}
                title="스프레드시트 편집 모드 (F2)"
              >
                <Pencil size={14} strokeWidth={2} aria-hidden />
              </button>
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
                MD편집
              </button>
              <button
                type="button"
                onClick={() => setExcelView((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-colors shrink-0",
                  excelView
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
                title={excelView ? "엑셀 시트 보기 해제" : "엑셀 시트 형태로 보기 (셀 이동/편집은 엑셀처럼 동작)"}
              >
                <span>엑셀편집</span>
              </button>
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
      <div className={cn("w-full pb-20 flex flex-col min-h-0", fillHeight && "flex-1")} style={{ '--row-height': `${rowHeight}px`, '--cell-padding': `${Math.max(2, (rowHeight - 20) / 2)}px` } as React.CSSProperties}>
        {/* Split view: 헤더를 스크롤 밖에 두되, 가로 스크롤은 본문과 동기화 */}
        {!excelView && isSplitView && (
          <div
            ref={headerScrollRef}
            className="flex-shrink-0 border-b border-slate-200 bg-slate-50/80 overflow-x-auto overflow-y-hidden"
            onScroll={(e) => {
              if (isSyncingScrollRef.current) return;
              const body = tableScrollRef.current;
              if (body) {
                isSyncingScrollRef.current = true;
                body.scrollLeft = e.currentTarget.scrollLeft;
                requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
              }
            }}
          >
            <div className="data-header flex-shrink-0" style={headerStyle}>
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
          </div>
        )}
        {!excelView && (
        <div
          ref={(el) => {
            if (typeof syncScrollRef === 'function') syncScrollRef(el);
            else if (syncScrollRef) (syncScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            tableScrollRef.current = el;
          }}
          tabIndex={0}
          data-wbs-table
          className={cn(
            "overflow-auto relative bg-[var(--color-bg)] outline-none focus:ring-0",
            !tableEditMode && "wbs-view-mode",
            fillHeight ? "flex-1 min-h-0" : "min-h-[280px] max-h-[calc(100vh-14rem)]",
            wrapTextInCells && "wrap-text-in-cells"
          )}
          onScroll={(e) => {
            const target = e.currentTarget;
            const header = headerScrollRef.current;
            if (isSplitView && header && !isSyncingScrollRef.current) {
              isSyncingScrollRef.current = true;
              header.scrollLeft = target.scrollLeft;
              requestAnimationFrame(() => { isSyncingScrollRef.current = false; });
            }
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
                const bottomPad = virtualItems
                  ? rowVirtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
                  : 0;
                const itemsToRender = virtualItems
                  ? virtualItems.map(v => ({ task: tasksForRender[v.index], rowIndex: v.index }))
                  : tasksForRender.map((task, rowIndex) => ({ task, rowIndex }));
                return (
              <SortableContext
                items={tasksForRender.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
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
                      isFocused={lastSelectedId === task.id}
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
                      setInlineEditingNameId={setInlineEditingNameId}
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
                                    ref={quickAddNameInlineRef}
                                    type="text"
                                    defaultValue=""
                                    onBlur={() => setInlineAddingTaskId(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setInlineAddingTaskId(null);
                                      e.stopPropagation();
                                    }}
                                    onPaste={(e) => {
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

                                      const proj = projects.find(p => p.id === (task.projectId || currentProjectId));
                                      const defaultDate = proj?.startDate || new Date().toISOString().split('T')[0];

                                      lines.forEach((line) => {
                                        addTask({
                                          name: line,
                                          parentId: task.id,
                                          startDate: filters.startDate || defaultDate,
                                          endDate: filters.endDate || defaultDate,
                                          progress: 0,
                                          workEffort: 0.5,
                                          assignee: filters.assignee || '',
                                          status: 'todo',
                                        });
                                      });

                                      if (quickAddNameInlineRef.current) quickAddNameInlineRef.current.value = '';
                                      setInlineAddingTaskId(null);
                                      setInsertTargetId(null);
                                    }}
                                    placeholder="작업명 입력 후 Enter..."
                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-bold text-blue-600 placeholder:text-blue-300 h-full py-2 px-2"
                                  />
                                  <button
                                    type="submit"
                                    onMouseDown={(e) => e.preventDefault()}
                                    className="absolute right-0 top-0 bottom-0 text-[10px] font-bold text-white bg-blue-500 uppercase px-3 hover:bg-blue-600 transition-colors opacity-0 group-hover/form:opacity-100"
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
                {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
              </SortableContext>
                );
              })()}
            </DndContext>

            {/* Quick Add Row: split view에서는 스크롤 밖에 두어 표·간트 행 높이 일치(첫/끝 행 정렬) */}
            {!isSplitView ? (
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
                          data-quick-add
                          ref={quickAddNameBottomRef}
                          type="text"
                          defaultValue=""
                          placeholder="새 작업 추가 (Enter 키 입력)..."
                          className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-medium placeholder:text-slate-400 h-full px-3"
                        />
                        <button
                          type="submit"
                          className="text-[10px] font-bold text-indigo-600 uppercase px-4 hover:bg-indigo-50 transition-colors"
                        >
                          추가
                        </button>
                      </form>
                    </div>
                  );
                })}
                <div className="data-cell"></div>
              </div>
            ) : null}

            {visibleTasks.length === 0 && tasks.length === 0 && (
              <div className="p-12 text-center text-stone-400 italic font-serif bg-stone-50/30">
                등록된 작업이 없습니다. 새 작업을 추가해 보세요.
              </div>
            )}
            {visibleTasks.length === 0 && tasks.length > 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-stone-400 gap-3">
                <p className="text-sm">필터 조건에 맞는 작업이 없습니다.</p>
                <button
                  type="button"
                  onClick={() => onResetFilters?.()}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  필터 초기화
                </button>
              </div>
            )}
          </div>
        </div>
        )}
        {excelView && (
          <div className="flex-1 min-h-[320px] border border-slate-200 rounded-xl overflow-hidden bg-white">
            <ExcelGrid tasks={visibleTasks} displayWbsMap={displayWbsMap} onTaskChange={updateTask} />
          </div>
        )}
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
                      data-quick-add
                      ref={quickAddNameBottomRef}
                      type="text"
                      defaultValue=""
                      placeholder="새 작업 추가 (Enter 키 입력)..."
                      className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-medium placeholder:text-slate-400 h-full px-3"
                    />
                    <button
                      type="submit"
                      className="text-[10px] font-bold text-indigo-600 uppercase px-4 hover:bg-indigo-50 transition-colors"
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
    const sortableColumns: TableColumnId[] = ['name', 'startDate', 'endDate', 'workEffort', 'weight', 'progress', 'assignee', 'status'];
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
                  if ((columnWidths as Record<string, number>)[colId] !== undefined) {
                    headerActions.push({
                      label: '컬럼 너비 초기화',
                      icon: <RotateCcw size={14} />,
                      onClick: () => {
                        const defaultW = (DEFAULT_COLUMN_WIDTHS as Record<string, number>)[colId];
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
                ...(canEditCurrentProject ? [{
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
                }] : []),
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
  return <div className={cn("flex flex-col min-h-0", fillHeight && "h-full")}>{content}</div>;
}

