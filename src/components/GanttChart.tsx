import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useWBS } from '../context/WBSContext';
import { Task, FilterState, SortConfig } from '../types';
import { differenceInDays, eachDayOfInterval, format, isSameDay, parseISO, eachMonthOfInterval, eachWeekOfInterval } from 'date-fns';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { Edit2, Trash2, ZoomIn, ZoomOut, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { buildVisibleTasks, type TaskWithDepth } from '../lib/taskView';
import { isProjectTitleRootTask } from '../lib/ensureProjectTopLevelName';
import { useLevelColors } from '../context/LevelColorsContext';
import { useWbsTableAutoFormatting } from '../hooks/useWbsTableAutoFormatting';
import { getCriticalPathTaskIds } from '../lib/schedule';
import { useToast } from './Toast';
import { formatRange } from '../lib/ganttFormat';
import { getTaskScheduleOutsideProjectMessage } from '../lib/projectTaskSchedule';
import { isComposingKeyEvent } from '../lib/ime';
import { ZOOM_LEVELS, type ViewMode } from './Gantt/ZOOM_LEVELS';
import { useGanttViewport } from './hooks/useGanttViewport';
import { useGanttDrag } from './hooks/useGanttDrag';
import { useGanttRowDragSelect } from './hooks/useGanttRowDragSelect';
import { GanttTopHeader, GanttBottomHeader } from './Gantt/GanttHeader';
import { GanttGrid } from './Gantt/GanttGrid';
import { useOrganization } from '../context/OrganizationContext';
import { buildOrgMemberDisplayMetaMap, formatAssigneeDisplay } from '../lib/assigneeOptions';

const EMPTY_CRITICAL_PATH_SET = new Set<string>();

/** 무효 ISO·역전(종료<시작) 시에도 막대/SVG 좌표가 NaN이 되지 않도록 보정 */
function resolveGanttBarInterval(startIso: string, endIso: string, fallbackMin: Date): { start: Date; end: Date } {
  const rawStart = parseISO(startIso);
  const rawEnd = parseISO(endIso);
  const startOk = !Number.isNaN(rawStart.getTime());
  const endOk = !Number.isNaN(rawEnd.getTime());
  let safeStart: Date;
  let safeEnd: Date;
  if (!startOk && !endOk) {
    safeStart = fallbackMin;
    safeEnd = fallbackMin;
  } else if (!startOk && endOk) {
    safeStart = rawEnd;
    safeEnd = rawEnd;
  } else if (startOk && !endOk) {
    safeStart = rawStart;
    safeEnd = rawStart;
  } else {
    safeStart = rawStart;
    safeEnd = rawEnd < rawStart ? rawStart : rawEnd;
  }
  return { start: safeStart, end: safeEnd };
}

interface GanttChartProps {
  filters: FilterState;
  sortConfig: SortConfig;
  hideSidebar?: boolean;
  rowHeight?: number;
  /** 표에서 측정한 행별 높이 (줄바꿈 켜짐 시 표·간트 동기화) */
  rowHeights?: number[];
  onRowHeightChange?: (height: number) => void;
  syncScrollRef?: React.Ref<HTMLDivElement>;
  /** split 뷰: 표와 가로 스크롤 동기화 — 간트 날짜 헤더 스크롤 컨테이너 */
  splitGanttHeaderScrollRef?: React.Ref<HTMLDivElement | null>;
  /** split 뷰: 표와 가로 스크롤 동기화 — 간트 하단 가로 스크롤바 */
  splitGanttBottomScrollRef?: React.Ref<HTMLDivElement | null>;
  hotkeysEnabled?: boolean;
  /** split 뷰에서 표 본문 맨 아래 [+ 새 작업 추가] 행 높이만큼 간트 하단을 띄워 행 정렬 맞춤. 0이면 띄우지 않음. */
  bottomSpacerHeight?: number;
  /** split 뷰에서 표 하단에 도킹된 서식/일괄 바 높이만큼 간트 하단을 띄워 표·간트 행 끝(뷰포트 높이) 위치를 맞춤. 0이면 띄우지 않음. */
  bottomInsetHeight?: number;
  /** 표+간트 split: 막대 우클릭 시 표의 작업 컨텍스트 메뉴와 동일하게 연다 */
  onOpenTaskContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  /** 계획율 기준일(YYYY-MM-DD). 간트 수직선 위치·뷰포트 앵커. 미전달 시 당일(로컬)로 간주 */
  referenceDateIso?: string;
  /** 부모 제어 줌: `-1` = 전체 맞춤. `TableGanttSplit`에서 표 상단과 동기 */
  zoomIndex?: number;
  onZoomIndexChange?: (zoomIndex: number) => void;
}

export function GanttChart({
  filters,
  sortConfig,
  hideSidebar = false,
  rowHeight: propRowHeight,
  rowHeights: propRowHeights,
  onRowHeightChange,
  syncScrollRef,
  splitGanttHeaderScrollRef,
  splitGanttBottomScrollRef,
  hotkeysEnabled = true,
  bottomSpacerHeight = 0,
  bottomInsetHeight = 0,
  onOpenTaskContextMenu,
  referenceDateIso: referenceDateIsoProp,
  zoomIndex: zoomIndexProp,
  onZoomIndexChange,
}: GanttChartProps) {
  const {
    tasks,
    updateTask,
    flushProjectTaskRollups,
    deleteTask,
    wbsMap,
    displayWbsMap,
    selectedTaskIds,
    setSelectedTaskIds,
    activeTaskId,
    setActiveTaskId,
    wbsSettings,
    canEditCurrentProject,
    projects,
    toggleExpand,
  } = useWBS();
  /** 표가 먼저 반응하도록 간트 무거운 파생(가시 행·크리티컬 패스 등)은 낮은 우선순위로 따라잡는다. */
  const layoutTasks = useDeferredValue(tasks);
  const projectScheduleForTask = useCallback(
    (t: Task) => {
      const p = projects.find((pr) => pr.id === t.projectId);
      if (!p) return null;
      return getTaskScheduleOutsideProjectMessage(t, p);
    },
    [projects],
  );
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);

  const { orgMembers } = useOrganization();
  const assigneeDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);
  const { levelBarBg, levelGanttBarFill } = useLevelColors();
  const { showTableAutoFormatting } = useWbsTableAutoFormatting(wbsSettings);
  const GANTT_NEUTRAL_BAR_FILL = 'rgba(148, 163, 184, 0.38)';
  const GANTT_NEUTRAL_BAR_BORDER = '#94a3b8';
  /** 활성(클릭) 막대 = 루트, 그 아래 전체 하위 = 별도 톤으로 구분 */
  const GANTT_FOCUS_ROOT_BAR_FILL = 'rgba(245, 158, 11, 0.82)';
  const GANTT_FOCUS_ROOT_BAR_BORDER = '#b45309';
  const GANTT_FOCUS_SUBTREE_BAR_FILL = 'rgba(56, 189, 248, 0.58)';
  const GANTT_FOCUS_SUBTREE_BAR_BORDER = '#0284c7';
  const ganttBarFillAt = useCallback(
    (level: number) => (showTableAutoFormatting ? levelGanttBarFill(level) : GANTT_NEUTRAL_BAR_FILL),
    [showTableAutoFormatting, levelGanttBarFill],
  );
  const ganttBarBorderAt = useCallback(
    (level: number, isCritical: boolean) =>
      isCritical ? '#dc2626' : showTableAutoFormatting ? levelBarBg(level) : GANTT_NEUTRAL_BAR_BORDER,
    [showTableAutoFormatting, levelBarBg],
  );
  const ganttSidebarStripColor = useCallback(
    (level: number) => (showTableAutoFormatting ? levelBarBg(level) : 'transparent'),
    [showTableAutoFormatting, levelBarBg],
  );
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ taskId: string } | null>(null);
  const [tappedBar, setTappedBar] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const barPopoverRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set<string>(selectedTaskIds), [selectedTaskIds]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 240;
    const raw = window.localStorage.getItem('wbs:gantt:sidebarWidth');
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 240;
    return Math.min(520, Math.max(180, Math.round(n)));
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('wbs:gantt:sidebarWidth', String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleSidebarResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [sidebarWidth],
  );

  // 완료 처리 규칙:
  // - leaf(최하위) 작업: status === 'done' 이면 완료
  // - 상위 작업: 하위 leaf 작업들이 모두 완료면 완료로 간주(흑백 처리)
  const allLeafDoneById = useMemo(() => {
    const byId = new Map<string, Task>(layoutTasks.map((t) => [t.id, t]));
    const childrenByParent = new Map<string, string[]>();
    for (const t of layoutTasks) {
      if (!t.parentId) continue;
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t.id);
      childrenByParent.set(t.parentId, arr);
    }

    const memo = new Map<string, boolean>();
    const visiting = new Set<string>();

    const dfs = (id: string): boolean => {
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      if (visiting.has(id)) return false; // cycle guard
      visiting.add(id);

      const task = byId.get(id);
      if (!task) {
        visiting.delete(id);
        memo.set(id, false);
        return false;
      }

      const children = childrenByParent.get(id) ?? [];
      let result: boolean;
      if (children.length === 0) {
        result = task.status === 'done';
      } else {
        result = children.every((childId) => dfs(childId));
      }

      visiting.delete(id);
      memo.set(id, result);
      return result;
    };

    for (const t of layoutTasks) dfs(t.id);
    return memo;
  }, [layoutTasks]);

  // Zoom: -1 = 전체 맞춤(자동 dayWidth). 부모가 zoomIndex+onZoomIndexChange를 넘기면 제어 컴포넌트.
  const isZoomControlled = zoomIndexProp !== undefined && onZoomIndexChange != null;
  const [zoomIndexUncontrolled, setZoomIndexUncontrolled] = useState(-1);
  const zoomIndex = isZoomControlled ? zoomIndexProp! : zoomIndexUncontrolled;
  const setZoomIndex = useCallback(
    (nextOrUpdater: number | ((prev: number) => number)) => {
      if (isZoomControlled) {
        const prev = zoomIndexProp as number;
        const next = typeof nextOrUpdater === 'function' ? (nextOrUpdater as (p: number) => number)(prev) : nextOrUpdater;
        onZoomIndexChange!(next);
      } else {
        setZoomIndexUncontrolled(nextOrUpdater);
      }
    },
    [isZoomControlled, zoomIndexProp, onZoomIndexChange],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  /** split 뷰: 헤더·본문·하단 바를 감싸는 루트 — 본문 ref 전 너비 측정용 */
  const splitGanttRootRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  /** 본문(세로 스크롤) element — 표↔간트 동기화의 한쪽 끝. 외부 syncScrollRef와 함께 set한다(callback ref 호환). */
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const setMainScrollEl = useCallback(
    (el: HTMLDivElement | null) => {
      mainScrollRef.current = el;
      const outer = syncScrollRef;
      if (typeof outer === 'function') outer(el);
      else if (outer) (outer as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [syncScrollRef],
  );

  // visibleTasks 로직을 WBSTable과 동일하게 맞춰 표·간트 행 정렬이 일치하도록 함
  const visibleTasks = useMemo(
    () =>
      buildVisibleTasks(layoutTasks, filters, sortConfig, {
        preserveDepthOnFiltered: true,
        projectTitleSkip: (t) => isProjectTitleRootTask(t, projectsById.get(t.projectId)),
      }),
    [layoutTasks, filters, sortConfig, projectsById],
  );

  // 자식이 있는(=펼치기/접기 토글을 보여줄) 작업 id 집합
  const hasChildrenSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of layoutTasks) if (t.parentId) s.add(t.parentId);
    return s;
  }, [layoutTasks]);

  /** activeTaskId 기준 재귀적 하위 작업(직접 자식만이 아님). 체크 다중 선택 행은 기존 보라 강조와 충돌하지 않게 제외 */
  const activeSubtreeDescendantIds = useMemo(() => {
    if (!activeTaskId) return EMPTY_CRITICAL_PATH_SET;
    const childrenByParent = new Map<string, string[]>();
    for (const t of layoutTasks) {
      if (!t.parentId) continue;
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t.id);
      childrenByParent.set(t.parentId, arr);
    }
    const out = new Set<string>();
    const stack = [...(childrenByParent.get(activeTaskId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const c of childrenByParent.get(id) ?? []) stack.push(c);
    }
    return out;
  }, [layoutTasks, activeTaskId]);

  const { push: pushToast } = useToast();

  // visibleTaskById + visibleTaskIndexById를 단일 패스로 생성
  const { visibleTaskById, visibleTaskIndexById } = useMemo(() => {
    const byId = new Map<string, TaskWithDepth>();
    const indexById = new Map<string, number>();
    visibleTasks.forEach((task, index) => {
      byId.set(task.id, task);
      indexById.set(task.id, index);
    });
    return { visibleTaskById: byId, visibleTaskIndexById: indexById };
  }, [visibleTasks]);

  const showCriticalPath = wbsSettings?.showCriticalPath === true;

  // 크리티컬 패스 표시가 꺼져 있으면 계산 자체를 스킵 (O(V²+E) 연산)
  const criticalPathSet = useMemo(
    () => (showCriticalPath ? getCriticalPathTaskIds(layoutTasks) : EMPTY_CRITICAL_PATH_SET),
    [showCriticalPath, layoutTasks],
  );
  const effectiveCriticalPathSet = criticalPathSet;

  // Keyboard hotkeys - only when mounted
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hotkeysEnabled) return;
      if (isComposingKeyEvent(e)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable) return;
      const currentRowHeight = propRowHeight ?? 20;
      // Row height: Ctrl+Plus / Ctrl+Minus (표·간트 공통)
      if (onRowHeightChange && (e.ctrlKey || e.metaKey)) {
        const isInc = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
        const isDec = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
        if (isInc) {
          e.preventDefault();
          onRowHeightChange(Math.min(64, currentRowHeight + 2));
          return;
        }
        if (isDec) {
          e.preventDefault();
          onRowHeightChange(Math.max(15, currentRowHeight - 2));
          return;
        }
      }
      // Zoom: + / - (수정키 없을 때만; Ctrl+/-는 줄높이용)
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoomIndex((prev) => (prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1)));
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setZoomIndex((prev) => (prev === -1 ? 0 : Math.max(0, prev - 1)));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkeysEnabled, propRowHeight, onRowHeightChange, setZoomIndex]);

  const handleSave = (updates: Partial<Task>) => {
    if (editingTask) {
      if (editingTask.id !== '') updateTask(editingTask.id, updates);
      setEditingTask(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    if (onOpenTaskContextMenu) {
      onOpenTaskContextMenu(e, taskId);
      return;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  const handleBarClickForPopover = useCallback((_e: React.MouseEvent, _task: Task) => {
    // 막대 클릭 시 뜨던 정보 팝오버는 비활성. suppress ref만 reset해 드래그 직후 click 처리가 어긋나지 않게 유지.
    if (suppressBarPopoverClickRef.current) {
      suppressBarPopoverClickRef.current = false;
      return;
    }
  }, []);

  useEffect(() => {
    if (!tappedBar) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (barPopoverRef.current?.contains(ev.target as Node)) return;
      setTappedBar(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [tappedBar]);

  useEffect(() => {
    if (editingTask) setTappedBar(null);
  }, [editingTask]);

  const ROW_HEIGHT = propRowHeight ?? 20;
  const VIEW_PADDING_TOP = 0;

  // 표·간트 동기화: 표의 .data-row는 border-box이므로 height가 테두리 포함 총 높이. 간트도 동일한 줄간격으로 일직선 정렬.
  const effectiveRowHeights = useMemo(() => {
    if (propRowHeights && propRowHeights.length === visibleTasks.length) return propRowHeights;
    return visibleTasks.map(() => ROW_HEIGHT);
  }, [propRowHeights, visibleTasks.length, ROW_HEIGHT]);

  const totalHeight = useMemo(() => effectiveRowHeights.reduce((a, b) => a + b, 0), [effectiveRowHeights]);

  /** split: 표 하단 퀵 추가 행과 세로 스크롤 길이를 맞추기 위한 빈 여백(막대 위에 겹치지 않도록 행 아래에만 둠). */
  const splitBottomSpacerPx = canEditCurrentProject && bottomSpacerHeight > 0 ? bottomSpacerHeight : 0;
  const splitChartBodyHeight = totalHeight + splitBottomSpacerPx;

  /** 표+간트 split: TanStack Virtual은 스크롤 동기·ResizeObserver·가변 행높이와 겹치면 가시 행이 흔들려 깜빡일 수 있어 전부 그린다(일반 프로젝트 행 수에서 충분히 빠름). */
  const splitGanttRowLayout = useMemo(() => {
    let top = VIEW_PADDING_TOP;
    return visibleTasks.map((_, i) => {
      const size = effectiveRowHeights[i] ?? ROW_HEIGHT;
      const row = { index: i, start: top, size };
      top += size;
      return row;
    });
  }, [visibleTasks, effectiveRowHeights, ROW_HEIGHT, VIEW_PADDING_TOP]);

  const isSplitView = !!syncScrollRef;

  /** 간트 타임라인이 실제로 그려지는 스크롤 영역 너비(맞춤 줌·드래그 픽셀 환산에 사용). split 뷰는 containerRef가 없어 별도 측정. */
  const [chartViewportWidth, setChartViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const pickMeasureEl = () => {
      if (isSplitView) return mainScrollRef.current ?? splitGanttRootRef.current;
      return containerRef.current;
    };
    const measure = () => {
      const el = pickMeasureEl();
      let w = el?.clientWidth ?? 0;
      if (w <= 0 && el?.parentElement) w = el.parentElement.clientWidth;
      if (w > 0) setChartViewportWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const el = pickMeasureEl();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (isSplitView && splitGanttRootRef.current && splitGanttRootRef.current !== el) {
      ro.observe(splitGanttRootRef.current);
    }
    return () => ro.disconnect();
  }, [isSplitView, sidebarWidth, hideSidebar, visibleTasks.length, syncScrollRef]);

  const effectiveSidebarWidth = hideSidebar ? 0 : sidebarWidth;
  /** 측정 전 window.innerWidth 폴백은 간트 패널보다 넓어 맞춤 줌이 넘치므로 사용하지 않음 */
  const containerWidth = Math.max(120, chartViewportWidth);

  const resolvedReferenceIso = (referenceDateIsoProp?.trim() || format(new Date(), 'yyyy-MM-dd')) as string;
  const referenceAnchorDate = useMemo(() => {
    const d = parseISO(resolvedReferenceIso);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [resolvedReferenceIso]);

  const { dates, minDate, maxDate, totalDays, autoZoomLevel, currentZoomEntry, dayWidth } = useGanttViewport({
    visibleTasks,
    zoomIndex,
    containerWidth,
    effectiveSidebarWidth,
    referenceAnchorDate,
  });

  /** 전체 맞춤: 뷰포트·일정 범위가 바뀌면 가로 스크롤을 맨 앞으로 — 전체 타임라인이 보이도록 */
  useEffect(() => {
    if (zoomIndex !== -1) return;
    const reset = (el: HTMLDivElement | null) => {
      if (el && el.scrollLeft !== 0) el.scrollLeft = 0;
    };
    reset(isSplitView ? mainScrollRef.current : containerRef.current);
    reset(headerScrollRef.current);
    reset(bottomScrollRef.current);
  }, [zoomIndex, chartViewportWidth, totalDays, dayWidth, isSplitView]);

  /** 기본 세로 휠 → 행(세로) 스크롤, Shift+세로·가로 틸트(deltaX) → 타임라인 좌우, Ctrl+휠(핀치) → 확대/축소. split에서 헤더 위 휠은 본문(main) 세로로 연결. 하단 가로 바는 세로 휠을 좌우로만 사용.
   *  React `onWheel`은 passive로 등록되어 preventDefault 시 콘솔 경고가 나므로, 아래 useEffect에서 { passive: false } 네이티브 리스너로 붙인다. */
  const handleGanttWheel = useCallback(
    (e: WheelEvent) => {
      const el = e.currentTarget as HTMLDivElement;
      if (e.ctrlKey) {
        if (e.deltaY === 0) return;
        e.preventDefault();
        const step = e.deltaY > 0 ? -1 : 1;
        setZoomIndex((prev) => {
          const maxIdx = ZOOM_LEVELS.length - 1;
          if (prev === -1) {
            const autoIdx = Math.max(
              0,
              ZOOM_LEVELS.findIndex((z) => z.dayWidth === autoZoomLevel.dayWidth),
            );
            return Math.min(maxIdx, Math.max(0, autoIdx + step));
          }
          return Math.min(maxIdx, Math.max(0, prev + step));
        });
        return;
      }

      const verticalEl = isSplitView && mainScrollRef.current && el !== mainScrollRef.current ? mainScrollRef.current : el;

      const scrollH = (delta: number, target: HTMLElement = el) => {
        const maxLeft = Math.max(0, target.scrollWidth - target.clientWidth);
        if (maxLeft > 0) {
          target.scrollLeft = Math.min(maxLeft, Math.max(0, target.scrollLeft + delta));
          e.preventDefault();
        }
      };

      const scrollV = (delta: number) => {
        const maxTop = Math.max(0, verticalEl.scrollHeight - verticalEl.clientHeight);
        if (maxTop > 0) {
          verticalEl.scrollTop = Math.min(maxTop, Math.max(0, verticalEl.scrollTop + delta));
          e.preventDefault();
        }
      };

      if (e.deltaX !== 0) {
        scrollH(e.deltaX);
        return;
      }
      if (e.deltaY === 0) return;

      if (el.classList.contains('gantt-hscroll') && !e.shiftKey) {
        scrollH(e.deltaY);
        return;
      }

      if (e.shiftKey) {
        scrollH(e.deltaY);
        return;
      }

      scrollV(e.deltaY);
      const maxTopAfter = Math.max(0, verticalEl.scrollHeight - verticalEl.clientHeight);
      if (maxTopAfter <= 0) {
        scrollH(e.deltaY);
      }
    },
    [isSplitView, autoZoomLevel.dayWidth, setZoomIndex],
  );

  useEffect(() => {
    const opts: AddEventListenerOptions = { passive: false };
    const onWheel = (e: WheelEvent) => handleGanttWheel(e);
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const attached: Array<{ node: HTMLDivElement; fn: (e: WheelEvent) => void }> = [];

    const detach = () => {
      for (const { node, fn } of attached) {
        node.removeEventListener('wheel', fn, opts);
      }
      attached.length = 0;
    };

    const tryAttach = () => {
      detach();
      if (cancelled) return;

      if (isSplitView) {
        const header = headerScrollRef.current;
        const main = mainScrollRef.current;
        const bottom = bottomScrollRef.current;
        if (!header || !main || !bottom) {
          if (attempts < 120) {
            attempts += 1;
            raf = requestAnimationFrame(tryAttach);
          }
          return;
        }
        for (const node of [header, main, bottom]) {
          node.addEventListener('wheel', onWheel, opts);
          attached.push({ node, fn: onWheel });
        }
      } else {
        const node = containerRef.current;
        if (!node) {
          if (attempts < 120) {
            attempts += 1;
            raf = requestAnimationFrame(tryAttach);
          }
          return;
        }
        node.addEventListener('wheel', onWheel, opts);
        attached.push({ node, fn: onWheel });
      }
    };

    tryAttach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      detach();
    };
  }, [handleGanttWheel, isSplitView, syncScrollRef, visibleTasks.length, dates.length]);

  const { dragPreview, dragSession, suppressBarPopoverClickRef, anchorTaskIdRef, handleBarMouseDown, handleResizeMouseDown } = useGanttDrag(
    {
      selectedSet,
      visibleTaskById,
      visibleTasks,
      tasks,
      selectedTaskIds,
      setSelectedTaskIds,
      setActiveTaskId,
      updateTask,
      flushProjectTaskRollups,
      pushToast,
      dayWidth,
      minDate,
      sidebarResizeRef,
      setSidebarWidth,
    },
  );

  /** 단독 간트: 스크롤 영역 안에서 날짜 헤더(고정) 아래 첫 행까지의 오프셋 — 드래그 선택 Y→행 인덱스 환산용 */
  const STICKY_GANTT_TIMELINE_HEADER_PX = 60;
  const { handleRowBackgroundMouseDown } = useGanttRowDragSelect({
    visibleTasks,
    effectiveRowHeights,
    fallbackRowHeight: ROW_HEIGHT,
    getScrollEl: () => (isSplitView ? mainScrollRef.current : containerRef.current),
    rowAreaTopInset: isSplitView ? 0 : STICKY_GANTT_TIMELINE_HEADER_PX,
    setSelectedTaskIds,
    setActiveTaskId,
    anchorTaskIdRef,
  });

  // useCallback closure가 stale activeTaskId를 잡는 것을 막기 위해 ref로 최신값 접근.
  // (간트 클릭 → setActiveTaskId → 다음 render 전에 사용자가 ↓을 누르면 closure는 옛 값을 보고
  //  엉뚱한 다음 행으로 계산하던 회귀가 있었음)
  const activeTaskIdRef = useRef(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);
  const visibleTasksRef = useRef(visibleTasks);
  useEffect(() => {
    visibleTasksRef.current = visibleTasks;
  }, [visibleTasks]);

  // ↑/↓ 키로 활성 행 이동. 간트 스크롤 영역에 포커스가 있을 때만 동작하며,
  // activeTaskId는 간트 직접 조작 시에만 갱신된다(표 셀 이동은 lastSelectedId만 바꿈).
  const handleArrowKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!hotkeysEnabled) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tgt?.isContentEditable) return;
      const tasks = visibleTasksRef.current;
      if (tasks.length === 0) return;
      e.preventDefault();
      // 같은 keydown이 window 레벨의 표 키보드 핸들러(useWbsTableKeyboard)까지 bubble되어
      // lastSelectedId 기반으로 또 한 번 이동하던 회귀를 차단.
      e.nativeEvent.stopPropagation();
      const currentActive = activeTaskIdRef.current;
      const currentIdx = currentActive ? tasks.findIndex((t) => t.id === currentActive) : -1;
      const nextIdx =
        currentIdx < 0
          ? e.key === 'ArrowDown'
            ? 0
            : tasks.length - 1
          : e.key === 'ArrowDown'
            ? Math.min(tasks.length - 1, currentIdx + 1)
            : Math.max(0, currentIdx - 1);
      const next = tasks[nextIdx];
      if (!next) return;
      setActiveTaskId(next.id);
      // 표에 `task-row-${id}`가 있으면 그쪽으로 스크롤(간트만 뷰에서는 해당 요소가 없으면 no-op).
      document.getElementById(`task-row-${next.id}`)?.scrollIntoView({ block: 'nearest' });
    },
    [hotkeysEnabled, setActiveTaskId],
  );

  const dependencyPaths = useMemo(() => {
    if (visibleTasks.length === 0 || dates.length === 0) return [];
    const rowTops = effectiveRowHeights.reduce<number[]>((acc, _, i) => {
      acc.push(i === 0 ? VIEW_PADDING_TOP : acc[i - 1] + effectiveRowHeights[i - 1]);
      return acc;
    }, []);
    return visibleTasks.flatMap((task, index) => {
      if (!task.dependencies || task.dependencies.length === 0) return [];

      const { start: taskBarStart } = resolveGanttBarInterval(task.startDate, task.endDate, minDate);
      const taskOffsetDays = differenceInDays(taskBarStart, minDate);
      const taskLeft = taskOffsetDays * dayWidth;
      const taskTop = rowTops[index] + effectiveRowHeights[index] / 2;

      return task.dependencies.flatMap((depId) => {
        const depTask = visibleTaskById.get(depId);
        const depIndex = visibleTaskIndexById.get(depId);
        if (!depTask || depIndex === undefined) return [];

        const { end: depBarEnd } = resolveGanttBarInterval(depTask.startDate, depTask.endDate, minDate);
        const depOffsetDays = differenceInDays(depBarEnd, minDate) + 1;
        const depRight = depOffsetDays * dayWidth;
        const depTop = rowTops[depIndex] + effectiveRowHeights[depIndex] / 2;
        const path = `M ${depRight} ${depTop} L ${depRight + 10} ${depTop} L ${depRight + 10} ${taskTop} L ${taskLeft} ${taskTop}`;
        const isCritical = effectiveCriticalPathSet.has(depId) && effectiveCriticalPathSet.has(task.id);

        return [{ key: `${depId}-${task.id}`, path, isCritical }];
      });
    });
  }, [
    effectiveRowHeights,
    VIEW_PADDING_TOP,
    dayWidth,
    minDate,
    visibleTaskById,
    visibleTaskIndexById,
    visibleTasks,
    dates.length,
    effectiveCriticalPathSet,
  ]);

  // Split view: 날짜 헤더(상단 가로 스크롤) ↔ 본문 ↔ 하단 스크롤바 수평 동기화.
  // 본문(main)은 overflow-x-hidden이라 가로 스크롤이 헤더/하단에만 있고, 그 위치를 본문에 JS로 반영한다.
  // 빈/로딩 상태로 첫 렌더된 뒤 데이터가 도착해 스크롤 엘리먼트가 늦게 붙는 경우를 위해
  // RAF로 attach를 재시도하고, 작업·날짜 개수(0→N) 변화에도 리스너를 다시 붙인다.
  // (deps가 [isSplitView]뿐이면 새로고침 진입 시 본문에 리스너가 영영 안 붙어 바가 안 따라오던 회귀)
  // NOTE: Rules of Hooks - early return 이전에 위치해야 함
  useEffect(() => {
    if (!isSplitView) return;
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    let cleanup: (() => void) | undefined;

    const attach = () => {
      const main = mainScrollRef.current;
      const header = headerScrollRef.current;
      const bottom = bottomScrollRef.current;
      if (!main || !header || !bottom) {
        if (!cancelled && attempts < 120) {
          attempts += 1;
          raf = requestAnimationFrame(attach);
        }
        return;
      }

      let syncing = false;
      const applyLeft = (left: number) => {
        if (syncing) return;
        syncing = true;
        if (main.scrollLeft !== left) main.scrollLeft = left;
        if (header.scrollLeft !== left) header.scrollLeft = left;
        if (bottom.scrollLeft !== left) bottom.scrollLeft = left;
        syncing = false;
      };

      const onMain = () => applyLeft(main.scrollLeft);
      const onHeader = () => applyLeft(header.scrollLeft);
      const onBottom = () => applyLeft(bottom.scrollLeft);

      main.addEventListener('scroll', onMain, { passive: true });
      header.addEventListener('scroll', onHeader, { passive: true });
      bottom.addEventListener('scroll', onBottom, { passive: true });

      cleanup = () => {
        main.removeEventListener('scroll', onMain);
        header.removeEventListener('scroll', onHeader);
        bottom.removeEventListener('scroll', onBottom);
      };
    };

    attach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [isSplitView, syncScrollRef, visibleTasks.length, dates.length]);

  const tappedBarPopoverEl =
    tappedBar &&
    (() => {
      const t = visibleTaskById.get(tappedBar.taskId) ?? tasks.find((x) => x.id === tappedBar.taskId);
      if (!t) return null;
      const wbs = displayWbsMap.get(t.id);
      const displayName = wbs ? `${wbs} ${t.name}` : t.name;
      const schedulePopoverWarn = projectScheduleForTask(t);
      return (
        <div
          ref={barPopoverRef}
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm max-w-[280px]"
          style={{ left: tappedBar.x, top: tappedBar.y, transform: 'translate(-50%, 8px)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="font-semibold text-slate-800 break-words">{displayName}</div>
          <div className="text-slate-600 mt-1 tabular-nums">{formatRange(t.startDate, t.endDate)}</div>
          {schedulePopoverWarn ? (
            <div className="text-amber-900 mt-2 text-xs leading-snug border-t border-amber-100 pt-2">{schedulePopoverWarn}</div>
          ) : null}
          {t.assignee ? (
            <div className="text-slate-500 mt-1 break-words">{formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName)}</div>
          ) : null}
        </div>
      );
    })();

  if (visibleTasks.length === 0)
    return (
      <div className="p-12 text-center text-slate-400 italic font-serif bg-slate-50/30">
        {tasks.length === 0 ? '등록된 작업이 없습니다. 새 작업을 추가해 보세요.' : '필터와 일치하는 작업이 없습니다.'}
      </div>
    );

  if (dates.length === 0)
    return (
      <div className="p-12 text-center text-slate-400 italic font-serif bg-slate-50/30">
        유효하지 않은 날짜가 포함되어 있습니다. 데이터를 확인해 주세요.
      </div>
    );

  const viewMode: ViewMode = currentZoomEntry.mode;
  const totalWidth = totalDays * dayWidth;
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const months = eachMonthOfInterval({ start: minDate, end: maxDate });
  const weeks = eachWeekOfInterval({ start: minDate, end: maxDate });

  const calendarToday = new Date();
  const refLineIndex = days.findIndex((day) => isSameDay(day, referenceAnchorDate));
  const refLineLeft = refLineIndex !== -1 ? refLineIndex * dayWidth + dayWidth / 2 : 0;
  const refLineIsCalendarToday = isSameDay(referenceAnchorDate, calendarToday);
  const refLineLabel = refLineIsCalendarToday ? '오늘' : '기준일';

  const headerProps = { viewMode, dayWidth, minDate, maxDate, days, months, weeks, today: calendarToday };

  // Split view: 헤더는 스크롤 밖, 스크롤 영역은 행만 → 표와 scrollTop 1:1 맞춤
  if (isSplitView) {
    return (
      <>
        <div ref={splitGanttRootRef} className="w-full h-full flex flex-col bg-white">
          {/* 헤더 고정 (스크롤 밖) - 표의 split 헤더처럼 상단 수평 스크롤바 노출하여 본문·하단과 동기화.
              표는 헤더에 위쪽 스크롤바, 본문에 아래 스크롤바를 두는 구조 — 간트도 같은 패턴으로 정렬. */}
          <div
            ref={(el) => {
              headerScrollRef.current = el;
              const rh = splitGanttHeaderScrollRef;
              if (typeof rh === 'function') rh(el);
              else if (rh) (rh as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className="flex-shrink-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)] overflow-x-auto overflow-y-hidden"
          >
            <div className="relative flex-shrink-0" style={{ width: totalWidth, height: 60 }}>
              <div className="flex h-7 border-b border-slate-200" style={{ width: totalWidth }}>
                <GanttTopHeader {...headerProps} />
              </div>
              <div className="flex h-8" style={{ width: totalWidth }}>
                <GanttBottomHeader {...headerProps} />
              </div>
            </div>
          </div>
          {/* 스크롤 영역 = 행만 (표와 세로 스크롤 동기화). 수평 스크롤은 상단 헤더·하단 별도 바에서 처리(여기는 숨김). */}
          <div
            ref={setMainScrollEl}
            tabIndex={0}
            onKeyDown={handleArrowKey}
            // 간트 안 어디를 클릭해도 키보드 이동이 동작하도록 컨테이너 자체로 포커스를 가져온다.
            // bar mousedown 핸들러가 stopPropagation을 호출하므로 capture phase로 등록해야 막히지 않는다.
            onMouseDownCapture={(e) => (e.currentTarget as HTMLDivElement).focus({ preventScroll: true })}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-white pb-6 outline-none focus:ring-0"
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="relative" style={{ width: totalWidth, height: splitChartBodyHeight }}>
              <div className="absolute inset-0 z-0 flex pointer-events-none">
                <GanttGrid
                  viewMode={viewMode}
                  dayWidth={dayWidth}
                  minDate={minDate}
                  maxDate={maxDate}
                  days={days}
                  months={months}
                  weeks={weeks}
                />
              </div>
              {refLineIndex !== -1 && (
                <div
                  className={cn(
                    'absolute top-0 bottom-0 z-20 border-l-2 border-dashed pointer-events-none',
                    refLineIsCalendarToday ? 'border-red-500' : 'border-indigo-500',
                  )}
                  style={{ left: refLineLeft }}
                >
                  <span
                    className={cn(
                      'absolute top-0 left-0 -translate-x-1/2 rounded-b px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow whitespace-nowrap',
                      refLineIsCalendarToday ? 'bg-red-500' : 'bg-indigo-600',
                    )}
                  >
                    {refLineLabel}
                  </span>
                </div>
              )}
              <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                <defs>
                  <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                  </marker>
                </defs>
                {dependencyPaths.map(({ key, path, isCritical }) => (
                  <path
                    key={key}
                    d={path}
                    fill="none"
                    stroke={isCritical ? '#dc2626' : '#a8a29e'}
                    strokeWidth={isCritical ? 2.5 : 1.5}
                    markerEnd="url(#arrowhead)"
                    opacity={isCritical ? 0.9 : 0.6}
                  />
                ))}
              </svg>
              {splitGanttRowLayout.map((virtualRow) => {
                const index = virtualRow.index;
                const task = visibleTasks[index];
                if (!task) return null;
                // 보라색 강조: 체크박스 체크된 행만. 노란색(amber) 강조: 간트에서 직접 선택한 활성 행(activeTaskId).
                // 둘 다 해당하면 보라색 우선(체크박스가 더 명시적 의도).
                const isSelected = selectedSet.has(task.id);
                const isActive = !isSelected && activeTaskId === task.id;
                const isActiveSubtreeDesc = !isSelected && activeSubtreeDescendantIds.has(task.id);
                const preview = dragPreview?.get(task.id);
                const isBeingDragged = !!preview;
                const isPrimaryDragBar = isBeingDragged && dragSession && task.id === dragSession.primaryTaskId;
                const isRelatedDragBar = isBeingDragged && dragSession && task.id !== dragSession.primaryTaskId;
                const isFocusRootBar = !isSelected && !isBeingDragged && activeTaskId === task.id;
                const isFocusSubtreeBar = !isSelected && !isBeingDragged && activeSubtreeDescendantIds.has(task.id);
                const isDone = allLeafDoneById.get(task.id) === true;
                const effectiveStartDate = preview?.startDate ?? task.startDate;
                const effectiveEndDate = preview?.endDate ?? task.endDate;
                const { start, end } = resolveGanttBarInterval(effectiveStartDate, effectiveEndDate, minDate);
                const offsetDays = differenceInDays(start, minDate);
                const durationDays = Math.max(1, differenceInDays(end, start) + 1);
                const left = offsetDays * dayWidth;
                const width = Math.max(durationDays * dayWidth, dayWidth);
                const depth = task.depth ?? 0;
                const level = depth + 1;
                const isCritical = effectiveCriticalPathSet.has(task.id);
                const rowH = effectiveRowHeights[index];
                const scheduleWarn = projectScheduleForTask({ ...task, startDate: effectiveStartDate, endDate: effectiveEndDate });
                return (
                  <div
                    key={task.id}
                    className={cn(
                      'absolute left-0 right-0 group box-border border-b border-slate-100/80 transition-colors z-[1]',
                      isSelected &&
                        !dragPreview?.has(task.id) &&
                        'z-[2] bg-indigo-400 font-semibold text-violet-950 shadow-[inset_3px_0_0_#6b21a8,inset_0_0_0_2px_rgba(91,33,182,0.45),inset_0_1px_0_0_rgba(91,33,182,0.38),inset_0_-1px_0_0_rgba(91,33,182,0.38)]',
                      isActive &&
                        !dragPreview?.has(task.id) &&
                        'z-[2] bg-orange-100 font-semibold text-orange-950 shadow-[inset_3px_0_0_#ea580c,inset_0_0_0_2px_rgba(234,88,12,0.42),inset_0_1px_0_0_rgba(234,88,12,0.5),inset_0_-1px_0_0_rgba(234,88,12,0.5)]',
                      isActiveSubtreeDesc &&
                        !dragPreview?.has(task.id) &&
                        'z-[2] bg-sky-50/40 font-medium text-sky-900 shadow-[inset_3px_0_0_rgba(14,165,233,0.85),inset_0_0_0_1px_rgba(14,165,233,0.1)]',
                      !isSelected && !isActive && !isActiveSubtreeDesc && 'hover:bg-[var(--color-line-soft)]',
                      dragPreview?.has(task.id) &&
                        dragSession &&
                        (task.id === dragSession.primaryTaskId
                          ? 'z-[3] bg-orange-50/60 ring-1 ring-orange-400/70'
                          : 'z-[3] bg-sky-50/55 ring-1 ring-sky-400/45'),
                    )}
                    style={{ width: totalWidth, height: rowH, top: virtualRow.start }}
                    onContextMenu={(e) => handleContextMenu(e, task.id)}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      // 막대가 아닌 타임라인 빈 칸: 클릭은 활성만, 드래그는 행 구간 다중 선택
                      if ((e.target as HTMLElement).closest?.('[data-gantt-task-bar]')) return;
                      handleRowBackgroundMouseDown(e, index);
                    }}
                  >
                    <div
                      data-gantt-task-bar
                      onDoubleClick={() => setEditingTask(task)}
                      onClick={(e) => handleBarClickForPopover(e, task)}
                      onMouseDown={(e) => {
                        handleBarMouseDown(e, task);
                        e.stopPropagation();
                      }}
                      className={cn(
                        'absolute top-0 rounded shadow-sm overflow-hidden transition-all border',
                        isDone && showTableAutoFormatting && 'gantt-completed',
                        isCritical && 'ring-2 ring-red-500 border-red-600',
                        isFocusRootBar && !isCritical && 'ring-2 ring-orange-500 z-[3]',
                        isFocusSubtreeBar && !isCritical && 'ring-1 ring-sky-400/55 z-[3]',
                        isPrimaryDragBar && 'cursor-grabbing shadow-lg ring-2 ring-orange-900/25 z-[5]',
                        isRelatedDragBar && 'cursor-grabbing shadow-md ring-1 ring-amber-800/20 z-[4]',
                        isBeingDragged &&
                          !isPrimaryDragBar &&
                          !isRelatedDragBar &&
                          'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50',
                        !isBeingDragged && 'cursor-grab hover:brightness-110',
                      )}
                      style={{
                        left,
                        width: Math.max(width - 4, 4),
                        height: rowH,
                        backgroundColor: isPrimaryDragBar
                          ? '#ea580c'
                          : isRelatedDragBar
                            ? 'rgba(251, 191, 36, 0.88)'
                            : isCritical
                              ? ganttBarFillAt(level)
                              : isFocusRootBar
                                ? GANTT_FOCUS_ROOT_BAR_FILL
                                : isFocusSubtreeBar
                                  ? GANTT_FOCUS_SUBTREE_BAR_FILL
                                  : ganttBarFillAt(level),
                        borderColor: isPrimaryDragBar
                          ? '#9a3412'
                          : isRelatedDragBar
                            ? '#b45309'
                            : isCritical
                              ? ganttBarBorderAt(level, true)
                              : isFocusRootBar
                                ? GANTT_FOCUS_ROOT_BAR_BORDER
                                : isFocusSubtreeBar
                                  ? GANTT_FOCUS_SUBTREE_BAR_BORDER
                                  : ganttBarBorderAt(level, false),
                      }}
                      title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''} · ${effectiveStartDate} → ${effectiveEndDate}${task.assignee ? ` · ${formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName)}` : ''}${scheduleWarn ? ` · ⚠ ${scheduleWarn}` : ''}`}
                    >
                      <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                      {width >= 40 && (
                        <span
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium break-words pr-8 pointer-events-none line-clamp-2 text-slate-800"
                          style={{ width: 'calc(100% - 12px)' }}
                        >
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                          {task.name}
                        </span>
                      )}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                        onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')}
                      />
                    </div>
                    {width < 80 && !isBeingDragged && (
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs text-slate-500 break-words max-w-[200px] pointer-events-none"
                        style={{ left: left + width + 8 }}
                      >
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                        {task.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 하단 여백 — 표 퀵 추가 행 높이만큼 스크롤 영역을 늘리고, sticky로 겹치지 않게 행 아래 빈 구간만 둔다. */}
            {splitBottomSpacerPx > 0 && (
              <div
                className="absolute left-0 right-0 z-0 pointer-events-none box-border"
                style={{ top: totalHeight, height: splitBottomSpacerPx, width: totalWidth }}
                aria-hidden
              />
            )}
          </div>
          {/* 하단 수평 스크롤바 — 좌우 이동을 항상 표시(두께 14px, 슬레이트 톤 트랙). */}
          <div
            ref={(el) => {
              bottomScrollRef.current = el;
              const rb = splitGanttBottomScrollRef;
              if (typeof rb === 'function') rb(el);
              else if (rb) (rb as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            className="gantt-hscroll flex-shrink-0 overflow-x-scroll overflow-y-hidden border-t border-slate-200 bg-slate-100"
            style={{ height: 14 }}
            title="좌우로 드래그해 간트 화면을 이동"
          >
            <div style={{ width: totalWidth, height: 1 }} />
          </div>
          {/* 표 하단에 도킹된 서식/일괄 바 높이만큼 간트 하단도 띄워 표·간트 뷰포트(행 끝) 정렬을 맞춘다. */}
          {bottomInsetHeight > 0 && (
            <div
              className="flex-shrink-0 border-t border-[var(--color-line)] bg-slate-50"
              style={{ height: bottomInsetHeight }}
              aria-hidden
            />
          )}
        </div>

        {tappedBarPopoverEl}

        <TaskModal
          isOpen={!!editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleSave}
          initialData={editingTask || undefined}
          parentOptions={tasks}
          onOpenTask={(task) => setEditingTask(task)}
        />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            actions={[
              {
                label: '편집',
                onClick: () => {
                  setEditingTask(tasks.find((t) => t.id === contextMenu.taskId) || null);
                },
              },
              ...(canEditCurrentProject
                ? [
                    {
                      label: '삭제',
                      onClick: () => {
                        deleteTask(contextMenu.taskId);
                      },
                      danger: true,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="w-full h-full flex flex-col bg-white">
        {/* 컨트롤 바 - 스크롤 영역 밖 (split view와 동일한 구조) */}
        <div className="min-h-12 flex-shrink-0 flex items-center justify-end gap-3 px-4 py-1.5 border-b border-[var(--color-line)] bg-slate-50 overflow-x-auto overflow-y-visible whitespace-nowrap">
          {/* 확대/축소 (날짜 간격) */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 shrink-0">축소</span>
            <button
              onClick={() => setZoomIndex((prev) => (prev === -1 ? Math.max(0, ZOOM_LEVELS.length - 4) : Math.max(0, prev - 1)))}
              className="p-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors shrink-0"
              title="축소"
            >
              <ZoomOut size={12} />
            </button>
            <input
              type="range"
              min={0}
              max={ZOOM_LEVELS.length - 1}
              step={1}
              value={
                zoomIndex === -1
                  ? Math.max(
                      0,
                      ZOOM_LEVELS.findIndex((z) => z.dayWidth === autoZoomLevel.dayWidth),
                    )
                  : zoomIndex
              }
              onChange={(e) => setZoomIndex(Number(e.target.value))}
              className="w-24 h-1.5 accent-slate-800 cursor-pointer flex-1 min-w-0 max-w-[100px] shrink"
              title="간트 확대/축소 (Ctrl+휠)"
            />
            <button
              onClick={() => setZoomIndex((prev) => (prev === -1 ? ZOOM_LEVELS.length - 1 : Math.min(ZOOM_LEVELS.length - 1, prev + 1)))}
              className="p-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors shrink-0"
              title="확대"
            >
              <ZoomIn size={12} />
            </button>
            <span className="text-[10px] font-bold text-slate-500 shrink-0">확대</span>
            <button
              onClick={() => setZoomIndex(-1)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0',
                zoomIndex === -1 ? 'text-indigo-600 bg-indigo-50 font-medium' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
              )}
              title="전체 맞춤"
            >
              맞춤
            </button>
            {zoomIndex !== -1 ? (
              <span className="text-[10px] font-mono text-slate-500 w-8 shrink-0">{ZOOM_LEVELS[zoomIndex].label}</span>
            ) : null}
          </div>

          {/* 줄간격 조절 (split 뷰에서는 표 SummaryBar에 통합되어 있으므로 숨김) */}
          {!isSplitView && onRowHeightChange && (
            <>
              <div className="w-px h-5 bg-slate-200 flex-shrink-0" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">줄간격</span>
                <input
                  type="range"
                  min={15}
                  max={64}
                  step={2}
                  value={propRowHeight ?? 20}
                  onChange={(e) => onRowHeightChange(Number(e.target.value))}
                  className="w-24 h-1.5 accent-slate-800 cursor-pointer flex-1 min-w-0 max-w-[96px]"
                  title={`줄간격: ${propRowHeight ?? 20}px`}
                />
                <span className="text-[10px] font-bold text-slate-600 w-7 text-right shrink-0">{propRowHeight ?? 20}</span>
              </div>
            </>
          )}
        </div>

        {/* 스크롤 영역 */}
        <div
          ref={containerRef}
          tabIndex={0}
          onKeyDown={handleArrowKey}
          // bar/sidebar 어디를 클릭해도 키보드 이동이 동작하도록 컨테이너 자체로 포커스를 가져온다.
          // bar mousedown 핸들러가 stopPropagation을 호출하므로 capture phase로 등록.
          onMouseDownCapture={(e) => (e.currentTarget as HTMLDivElement).focus({ preventScroll: true })}
          className="flex-1 min-h-0 overflow-auto bg-white pb-40 outline-none focus:ring-0"
        >
          <div className="min-w-max flex flex-col">
            {/* Header Row */}
            <div className="flex sticky top-0 z-40 bg-white shadow-sm border-b border-[var(--color-line)]">
              {/* Sidebar Header */}
              {!hideSidebar && (
                <div
                  className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-slate-100/90 backdrop-blur p-3 font-bold text-xs uppercase flex items-end sticky left-0 z-50 text-slate-500"
                  style={{ width: sidebarWidth, height: 60 }}
                >
                  <div className="flex items-end w-full min-w-0">
                    <span>작업</span>
                  </div>
                  <div
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 border-l border-slate-200 hover:border-indigo-400 z-[60] shrink-0"
                    onMouseDown={handleSidebarResizeMouseDown}
                    title="왼쪽 너비 조절"
                  />
                </div>
              )}

              {/* Timeline Header */}
              <div className="relative" style={{ width: Math.max(totalWidth, containerWidth - effectiveSidebarWidth), height: 60 }}>
                {/* Top header (months or years) */}
                <div className="flex h-7 border-b border-slate-200" style={{ width: totalWidth }}>
                  <GanttTopHeader {...headerProps} />
                </div>

                {/* Bottom header (days, weeks, or months) */}
                <div className="flex h-8" style={{ width: totalWidth }}>
                  <GanttBottomHeader {...headerProps} />
                </div>
              </div>
            </div>

            {/* Body Row */}
            <div className="flex relative">
              {/* Left Column (Task Names) */}
              {!hideSidebar && (
                <div
                  className="relative flex-shrink-0 border-r border-[var(--color-line)] bg-white sticky left-0 z-30 lg:block md:hidden hidden"
                  style={{ width: sidebarWidth }}
                >
                  {visibleTasks.map((t, index) => {
                    const depth = t.depth ?? 0;
                    const level = depth + 1;
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'flex items-center gap-1 text-xs font-medium text-[var(--color-ink)] hover:bg-slate-50 cursor-pointer transition-colors border-b border-l-4 border-transparent hover:border-slate-100',
                          dragPreview?.has(t.id) &&
                            dragSession &&
                            (t.id === dragSession.primaryTaskId
                              ? 'bg-orange-50/70 ring-1 ring-inset ring-orange-400/50'
                              : 'bg-sky-50/60 ring-1 ring-inset ring-sky-400/40'),
                        )}
                        style={{
                          height: `${effectiveRowHeights[index] ?? ROW_HEIGHT}px`,
                          paddingLeft: `${depth * 16 + 8}px`,
                          paddingRight: 16,
                          borderLeftColor: ganttSidebarStripColor(level),
                        }}
                        title={[displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ${t.name}` : t.name, projectScheduleForTask(t)]
                          .filter(Boolean)
                          .join(' · ')}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          if ((e.target as HTMLElement).closest?.('button')) return;
                          handleRowBackgroundMouseDown(e, index);
                        }}
                        onDoubleClick={() => setEditingTask(t)}
                      >
                        {hasChildrenSet.has(t.id) ? (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(t.id);
                            }}
                            className="shrink-0 flex h-4 w-4 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                            title={t.expanded ? '하위 작업 접기' : '하위 작업 펼치기'}
                            aria-label={t.expanded ? '접기' : '펼치기'}
                          >
                            {t.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        ) : (
                          <span className="shrink-0 w-4" aria-hidden />
                        )}
                        <div className="break-words min-w-0">
                          {displayWbsMap.get(t.id) ? `${displayWbsMap.get(t.id)} ` : ''}
                          {t.name}
                        </div>
                      </div>
                    );
                  })}
                  <div
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/30 border-l border-slate-200 hover:border-indigo-400 z-[60] shrink-0"
                    onMouseDown={handleSidebarResizeMouseDown}
                    title="왼쪽 너비 조절"
                  />
                </div>
              )}

              {/* Chart Body */}
              <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
                {/* Grid Background */}
                <div className="absolute inset-0 z-0 flex pointer-events-none">
                  <GanttGrid
                    viewMode={viewMode}
                    dayWidth={dayWidth}
                    minDate={minDate}
                    maxDate={maxDate}
                    days={days}
                    months={months}
                    weeks={weeks}
                  />
                </div>

                {/* Today Line */}
                {refLineIndex !== -1 && (
                  <div
                    className={cn(
                      'absolute top-0 bottom-0 z-20 border-l-2 border-dashed pointer-events-none',
                      refLineIsCalendarToday ? 'border-red-500' : 'border-indigo-500',
                    )}
                    style={{ left: refLineLeft }}
                  >
                    <span
                      className={cn(
                        'absolute top-0 left-0 -translate-x-1/2 rounded-b px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow whitespace-nowrap',
                        refLineIsCalendarToday ? 'bg-red-500' : 'bg-indigo-600',
                      )}
                    >
                      {refLineLabel}
                    </span>
                  </div>
                )}

                {/* Dependency Lines SVG Layer */}
                <svg className="absolute inset-0 z-0 pointer-events-none w-full h-full">
                  <defs>
                    <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" fill="#a8a29e" />
                    </marker>
                  </defs>
                  {dependencyPaths.map(({ key, path, isCritical }) => (
                    <path
                      key={key}
                      d={path}
                      fill="none"
                      stroke={isCritical ? '#dc2626' : '#a8a29e'}
                      strokeWidth={isCritical ? 2.5 : 1.5}
                      markerEnd="url(#arrowhead)"
                      opacity={isCritical ? 0.9 : 0.6}
                    />
                  ))}
                </svg>

                {/* Task Bars */}
                {visibleTasks.map((task, index) => {
                  // 보라색=체크박스, 노란색=간트 직접 활성 (체크박스 우선)
                  const isSelected = selectedSet.has(task.id);
                  const isActive = !isSelected && activeTaskId === task.id;
                  const isActiveSubtreeDesc = !isSelected && activeSubtreeDescendantIds.has(task.id);
                  const preview = dragPreview?.get(task.id);
                  const isBeingDragged = !!preview;
                  const isPrimaryDragBar = isBeingDragged && dragSession && task.id === dragSession.primaryTaskId;
                  const isRelatedDragBar = isBeingDragged && dragSession && task.id !== dragSession.primaryTaskId;
                  const isFocusRootBar = !isSelected && !isBeingDragged && activeTaskId === task.id;
                  const isFocusSubtreeBar = !isSelected && !isBeingDragged && activeSubtreeDescendantIds.has(task.id);
                  const effectiveStartDate = preview?.startDate ?? task.startDate;
                  const effectiveEndDate = preview?.endDate ?? task.endDate;

                  const { start, end } = resolveGanttBarInterval(effectiveStartDate, effectiveEndDate, minDate);
                  const offsetDays = differenceInDays(start, minDate);
                  const durationDays = Math.max(1, differenceInDays(end, start) + 1);

                  const left = offsetDays * dayWidth;
                  const width = Math.max(durationDays * dayWidth, dayWidth);
                  const isMilestone = !!task.isMilestone;

                  const depth = task.depth ?? 0;
                  const level = depth + 1;
                  const isCritical = effectiveCriticalPathSet.has(task.id);
                  const isDone = allLeafDoneById.get(task.id) === true;
                  const rowH = effectiveRowHeights[index] ?? ROW_HEIGHT;
                  const scheduleWarn = projectScheduleForTask({ ...task, startDate: effectiveStartDate, endDate: effectiveEndDate });

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        'relative z-[1] group box-border border-b border-slate-100/80 transition-colors',
                        isSelected &&
                          !dragPreview?.has(task.id) &&
                          'z-[2] bg-indigo-400 font-semibold text-violet-950 shadow-[inset_3px_0_0_#6b21a8,inset_0_0_0_2px_rgba(91,33,182,0.45),inset_0_1px_0_0_rgba(91,33,182,0.38),inset_0_-1px_0_0_rgba(91,33,182,0.38)]',
                        isActive &&
                          !dragPreview?.has(task.id) &&
                          'z-[2] bg-orange-100 font-semibold text-orange-950 shadow-[inset_3px_0_0_#ea580c,inset_0_0_0_2px_rgba(234,88,12,0.42),inset_0_1px_0_0_rgba(234,88,12,0.5),inset_0_-1px_0_0_rgba(234,88,12,0.5)]',
                        isActiveSubtreeDesc &&
                          !dragPreview?.has(task.id) &&
                          'bg-sky-50/40 font-medium text-sky-900 shadow-[inset_3px_0_0_rgba(14,165,233,0.85),inset_0_0_0_1px_rgba(14,165,233,0.1)]',
                        !isSelected && !isActive && !isActiveSubtreeDesc && 'hover:bg-[var(--color-line-soft)]',
                        dragPreview?.has(task.id) &&
                          dragSession &&
                          (task.id === dragSession.primaryTaskId
                            ? 'bg-orange-50/60 ring-1 ring-orange-400/70'
                            : 'bg-sky-50/55 ring-1 ring-sky-400/45'),
                      )}
                      style={{ width: totalWidth, height: rowH }}
                      onContextMenu={(e) => handleContextMenu(e, task.id)}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        if ((e.target as HTMLElement).closest?.('[data-gantt-task-bar]')) return;
                        handleRowBackgroundMouseDown(e, index);
                      }}
                    >
                      {/* 마일스톤: 다이아몬드 / 일반 작업: 바 */}
                      <div
                        data-gantt-task-bar
                        onDoubleClick={() => setEditingTask(task)}
                        onClick={(e) => handleBarClickForPopover(e, task)}
                        onMouseDown={(e) => {
                          handleBarMouseDown(e, task);
                          e.stopPropagation();
                        }}
                        className={cn(
                          'absolute top-0 overflow-hidden transition-all',
                          isDone && showTableAutoFormatting && 'gantt-completed',
                          isMilestone
                            ? cn(
                                'rounded-sm border-2 rotate-45 cursor-grab hover:brightness-110 shadow-sm',
                                isFocusSubtreeBar && !isBeingDragged ? 'border-sky-600 bg-sky-400' : 'border-amber-600 bg-amber-500',
                                isFocusRootBar && !isBeingDragged && 'ring-2 ring-orange-500 z-[3]',
                                isFocusSubtreeBar && !isBeingDragged && 'ring-1 ring-sky-200 z-[3]',
                                isBeingDragged && 'cursor-grabbing ring-2 ring-orange-600 brightness-110 z-[5]',
                              )
                            : 'rounded shadow-sm border',
                          !isMilestone && isCritical && 'ring-2 ring-red-500 border-red-600',
                          !isMilestone && isFocusRootBar && !isCritical && 'ring-2 ring-orange-500 z-[3]',
                          !isMilestone && isFocusSubtreeBar && !isCritical && 'ring-1 ring-sky-400/55 z-[3]',
                          isPrimaryDragBar && !isMilestone && 'cursor-grabbing shadow-lg ring-2 ring-orange-900/25 z-[5]',
                          isRelatedDragBar && !isMilestone && 'cursor-grabbing shadow-md ring-1 ring-amber-800/20 z-[4]',
                          isBeingDragged &&
                            !isMilestone &&
                            !isPrimaryDragBar &&
                            !isRelatedDragBar &&
                            'cursor-grabbing opacity-90 shadow-lg ring-2 ring-white/50',
                          !isBeingDragged && !isMilestone && 'cursor-grab hover:brightness-110',
                        )}
                        style={
                          isMilestone
                            ? { left: left + dayWidth / 2 - 8, top: rowH / 2 - 8, width: 16, height: 16 }
                            : {
                                left,
                                width: Math.max(width - 4, 4),
                                height: rowH,
                                backgroundColor: isPrimaryDragBar
                                  ? '#ea580c'
                                  : isRelatedDragBar
                                    ? 'rgba(251, 191, 36, 0.88)'
                                    : isCritical
                                      ? ganttBarFillAt(level)
                                      : isFocusRootBar
                                        ? GANTT_FOCUS_ROOT_BAR_FILL
                                        : isFocusSubtreeBar
                                          ? GANTT_FOCUS_SUBTREE_BAR_FILL
                                          : ganttBarFillAt(level),
                                borderColor: isPrimaryDragBar
                                  ? '#9a3412'
                                  : isRelatedDragBar
                                    ? '#b45309'
                                    : isCritical
                                      ? ganttBarBorderAt(level, true)
                                      : isFocusRootBar
                                        ? GANTT_FOCUS_ROOT_BAR_BORDER
                                        : isFocusSubtreeBar
                                          ? GANTT_FOCUS_SUBTREE_BAR_BORDER
                                          : ganttBarBorderAt(level, false),
                              }
                        }
                        title={`${displayWbsMap.get(task.id) ? displayWbsMap.get(task.id) + ' ' : ''}${task.name}${isCritical ? ' · 크리티컬 패스' : ''}${isMilestone ? ` (마일스톤) · ${effectiveStartDate}` : ` · ${effectiveStartDate} → ${effectiveEndDate}`}${scheduleWarn ? ` · ⚠ ${scheduleWarn}` : ''}`}
                      >
                        {!isMilestone && (
                          <>
                            <div className="h-full bg-black/10" style={{ width: `${task.progress}%` }} />
                            {width >= 40 && (
                              <span
                                className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium truncate pr-8 pointer-events-none text-slate-800"
                                style={{ width: 'calc(100% - 12px)' }}
                              >
                                {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                                {task.name}
                              </span>
                            )}
                            <div
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                              onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-left')}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/20"
                              onMouseDown={(e) => handleResizeMouseDown(e, task, 'resize-right')}
                            />
                          </>
                        )}
                      </div>

                      {(width < 80 || isMilestone) && !isBeingDragged && (
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-xs text-slate-500 break-words max-w-[200px] pointer-events-none"
                          style={{ left: (isMilestone ? left + dayWidth / 2 - 8 + 16 : left + width) + 8 }}
                        >
                          {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}
                          {task.name}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {tappedBarPopoverEl}

      <TaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSave}
        initialData={editingTask || undefined}
        parentOptions={tasks}
        onOpenTask={(task) => setEditingTask(task)}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          actions={[
            {
              label: '수정',
              icon: <Edit2 size={14} />,
              onClick: () => {
                const task = tasks.find((t) => t.id === contextMenu.taskId);
                if (task) setEditingTask(task);
              },
            },
            ...(canEditCurrentProject
              ? [
                  {
                    label: '삭제',
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onClick: () => {
                      setDeleteConfirm({ taskId: contextMenu.taskId });
                    },
                  },
                ]
              : []),
          ]}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            deleteTask(deleteConfirm.taskId);
            setDeleteConfirm(null);
          }
        }}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        isDanger
      />
    </>
  );
}
