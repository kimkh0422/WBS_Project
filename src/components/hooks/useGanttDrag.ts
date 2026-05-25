import type React from 'react';
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import type { Task } from '../../types';
import type { TaskWithDepth } from '../../lib/taskView';
import type { DragState, TaskDragInfo } from '../Gantt/ZOOM_LEVELS';

interface UseGanttDragOptions {
  selectedSet: Set<string>;
  visibleTaskById: Map<string, TaskWithDepth>;
  visibleTasks: TaskWithDepth[];
  tasks: Task[];
  selectedTaskIds: string[];
  setSelectedTaskIds: (ids: string[]) => void;
  /** 단순 click 시 체크박스(selectedTaskIds)는 건드리지 않고 단일 활성 행만 갱신한다. Ctrl/Shift 클릭은 기존대로 체크 토글. */
  setActiveTaskId: (id: string | null) => void;
  updateTask: (
    id: string,
    updates: Partial<Task>,
    options?: {
      skipCascade?: boolean;
      skipEffortScheduleLink?: boolean;
      deferScheduleSync?: boolean;
    },
  ) => void;
  /** 간트 일정 패치 후 호출(단일·다중 행): 선행(FS) 정합 후 상위 롤업 */
  flushProjectTaskRollups?: (projectId: string) => void;
  pushToast: (msg: string, options?: { variant?: 'info' | 'success' | 'warning' | 'error'; durationMs?: number }) => void;
  dayWidth: number;
  minDate: Date;
  sidebarResizeRef: MutableRefObject<{ startX: number; startWidth: number } | null>;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
}

interface UseGanttDragResult {
  dragPreview: Map<string, { startDate: string; endDate: string }> | null;
  suppressBarPopoverClickRef: MutableRefObject<boolean>;
  anchorTaskIdRef: MutableRefObject<string | null>;
  handleBarMouseDown: (e: React.MouseEvent, task: Task) => void;
  handleResizeMouseDown: (e: React.MouseEvent, task: Task, type: 'resize-left' | 'resize-right') => void;
}

export function useGanttDrag({
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
}: UseGanttDragOptions): UseGanttDragResult {
  const [dragPreview, setDragPreview] = useState<Map<string, { startDate: string; endDate: string }> | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const anchorTaskIdRef = useRef<string | null>(null);
  /** true after significant pointer move during bar drag/resize, or mousedown on resize handle — suppress tap-to-preview */
  const suppressBarPopoverClickRef = useRef(false);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const flushRollupsRef = useRef(flushProjectTaskRollups);
  flushRollupsRef.current = flushProjectTaskRollups;

  // Drag-to-move and resize use refs to avoid re-binding listeners
  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;
  const minDateRef = useRef<Date>(minDate);
  minDateRef.current = minDate;

  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

  const selectionRef = useRef({ selectedTaskIds, visibleTasks, setSelectedTaskIds, setActiveTaskId, updateTask });
  selectionRef.current = { selectedTaskIds, visibleTasks, setSelectedTaskIds, setActiveTaskId, updateTask };

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent, task: Task) => {
      e.preventDefault();
      e.stopPropagation();
      suppressBarPopoverClickRef.current = false;
      // 다중 선택된 작업 중 하나를 드래그하면 전체 선택 항목 이동
      const baseIds =
        selectedSet.has(task.id) && selectedSet.size > 1 ? [...selectedSet].filter((id) => visibleTaskById.has(id)) : [task.id];
      // 부모 작업 드래그 시 모든 자손도 함께 이동 (자손 포함 안 하면 DB 동기화 시 롤업으로 날짜 복원됨)
      const expandWithDescendants = (rootIds: string[]): string[] => {
        const result = new Set<string>(rootIds);
        const stack = [...rootIds];
        while (stack.length > 0) {
          const pid = stack.pop()!;
          for (const t of tasks) {
            if (t.parentId === pid && !result.has(t.id)) {
              result.add(t.id);
              stack.push(t.id);
            }
          }
        }
        return [...result];
      };
      const idsToMove = expandWithDescendants(baseIds);
      const taskInfos: TaskDragInfo[] = idsToMove
        .map((id) => {
          const t = visibleTaskById.get(id) ?? tasks.find((x) => x.id === id);
          if (!t) return null;
          return {
            taskId: t.id,
            originalStartDate: t.startDate,
            originalEndDate: t.endDate,
            previewStartDate: t.startDate,
            previewEndDate: t.endDate,
          };
        })
        .filter((x): x is TaskDragInfo => x !== null);
      if (taskInfos.length === 0) return;
      const lockedDayWidth = Math.max(dayWidthRef.current, 1e-6);
      dragStateRef.current = {
        taskId: task.id,
        type: 'move',
        startX: e.clientX,
        startY: e.clientY,
        lockedDayWidth,
        clickTaskId: task.id,
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
        tasks: taskInfos,
      };
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    },
    [selectedSet, visibleTaskById, tasks],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, task: Task, type: 'resize-left' | 'resize-right') => {
      e.preventDefault();
      e.stopPropagation();
      suppressBarPopoverClickRef.current = true;
      // 부모 리사이즈 시 자손도 함께 클램프하기 위해 자손 포함
      const getDescendants = (parentId: string): Task[] => {
        const result: Task[] = [];
        const stack = [parentId];
        while (stack.length > 0) {
          const pid = stack.pop()!;
          for (const t of tasks) {
            if (t.parentId === pid) {
              result.push(t);
              stack.push(t.id);
            }
          }
        }
        return result;
      };
      const descendants = getDescendants(task.id);
      const lockedDayWidth = Math.max(dayWidthRef.current, 1e-6);
      dragStateRef.current = {
        taskId: task.id,
        type,
        startX: e.clientX,
        startY: e.clientY,
        lockedDayWidth,
        clickTaskId: task.id,
        ctrlKey: false,
        shiftKey: false,
        tasks: [
          {
            taskId: task.id,
            originalStartDate: task.startDate,
            originalEndDate: task.endDate,
            previewStartDate: task.startDate,
            previewEndDate: task.endDate,
          },
          ...descendants.map((d) => ({
            taskId: d.id,
            originalStartDate: d.startDate,
            originalEndDate: d.endDate,
            previewStartDate: d.startDate,
            previewEndDate: d.endDate,
          })),
        ],
      };
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [tasks],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const resize = sidebarResizeRef.current;
      if (resize) {
        const next = resize.startWidth + (e.clientX - resize.startX);
        setSidebarWidth(Math.min(520, Math.max(180, Math.round(next))));
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) return;

      if (Math.abs(e.clientX - drag.startX) > 10 || Math.abs(e.clientY - drag.startY) > 10) {
        suppressBarPopoverClickRef.current = true;
      }

      const dw = drag.lockedDayWidth > 0 ? drag.lockedDayWidth : Math.max(dayWidthRef.current, 1e-6);
      const deltaX = e.clientX - drag.startX;
      const deltaDays = Math.round(deltaX / dw);

      const nextPreview = new Map<string, { startDate: string; endDate: string }>();

      if (drag.type === 'move') {
        for (const t of drag.tasks) {
          const origStart = parseISO(t.originalStartDate);
          const origEnd = parseISO(t.originalEndDate);
          // 달력 기준 포함 기간(일) 유지: 시작만 이동량으로 밀고 종료는 기간으로 결정
          const spanInclusive = Math.max(1, differenceInDays(origEnd, origStart) + 1);
          const shiftedStart = addDays(origStart, deltaDays);
          const shiftedEnd = addDays(shiftedStart, spanInclusive - 1);
          const newStart = format(shiftedStart, 'yyyy-MM-dd');
          const newEnd = format(shiftedEnd, 'yyyy-MM-dd');
          t.previewStartDate = newStart;
          t.previewEndDate = newEnd;
          nextPreview.set(t.taskId, { startDate: newStart, endDate: newEnd });
        }
      } else {
        // resize-left / resize-right: 첫 번째 항목이 리사이즈 대상(부모), 나머지는 자손
        const primary = drag.tasks[0];
        if (primary) {
          const origStart = parseISO(primary.originalStartDate);
          const origEnd = parseISO(primary.originalEndDate);
          let newStart = primary.originalStartDate;
          let newEnd = primary.originalEndDate;

          if (drag.type === 'resize-left') {
            const candidate = addDays(origStart, deltaDays);
            if (candidate < origEnd) newStart = format(candidate, 'yyyy-MM-dd');
          } else {
            const candidate = addDays(origEnd, deltaDays);
            if (candidate > origStart) newEnd = format(candidate, 'yyyy-MM-dd');
          }

          primary.previewStartDate = newStart;
          primary.previewEndDate = newEnd;
          nextPreview.set(primary.taskId, { startDate: newStart, endDate: newEnd });

          // 자손: 부모의 새 날짜 범위 밖으로 벗어난 부분만 클램프
          for (let i = 1; i < drag.tasks.length; i++) {
            const t = drag.tasks[i]!;
            let dStart = t.originalStartDate;
            let dEnd = t.originalEndDate;
            if (drag.type === 'resize-right') {
              if (dEnd > newEnd) dEnd = newEnd;
              if (dStart > newEnd) dStart = newEnd;
            } else {
              if (dStart < newStart) dStart = newStart;
              if (dEnd < newStart) dEnd = newStart;
            }
            t.previewStartDate = dStart;
            t.previewEndDate = dEnd;
            nextPreview.set(t.taskId, { startDate: dStart, endDate: dEnd });
          }
        }
      }

      setDragPreview(nextPreview);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (sidebarResizeRef.current) {
        sidebarResizeRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      const drag = dragStateRef.current;
      if (drag) {
        const moved = Math.abs(e.clientX - drag.startX) > 10 || Math.abs(e.clientY - drag.startY) > 10;
        if (moved) {
          const { updateTask: upd } = selectionRef.current;
          let anyDateChange = false;
          const taskById = new Map<string, Task>();
          for (const x of tasksRef.current) taskById.set(x.id, x);
          const treeDepth = (taskId: string): number => {
            let depth = 0;
            let id: string | undefined = taskId;
            for (;;) {
              const row = taskById.get(id!);
              if (!row?.parentId) return depth;
              depth += 1;
              id = row.parentId;
            }
          };
          const ordered = drag.tasks.length > 1 ? [...drag.tasks].sort((a, b) => treeDepth(b.taskId) - treeDepth(a.taskId)) : drag.tasks;
          const batchDefer = drag.tasks.length > 1;
          const projectIdsToFlush = new Set<string>();
          for (const t of ordered) {
            const row = taskById.get(t.taskId);
            if (row?.projectId) projectIdsToFlush.add(row.projectId);
          }
          for (const t of ordered) {
            const startChanged = t.previewStartDate !== t.originalStartDate || t.previewEndDate !== t.originalEndDate;
            if (!startChanged) continue;
            anyDateChange = true;
            const commonOpts = { skipCascade: true as const, deferScheduleSync: batchDefer };
            if (drag.type === 'move') {
              const origS = parseISO(t.originalStartDate);
              const origE = parseISO(t.originalEndDate);
              const prevS = parseISO(t.previewStartDate);
              if (!isValid(origS) || !isValid(origE) || !isValid(prevS)) continue;
              const shiftDays = differenceInDays(prevS, origS);
              const startIso = format(addDays(origS, shiftDays), 'yyyy-MM-dd');
              const endIso = format(addDays(origE, shiftDays), 'yyyy-MM-dd');
              upd(t.taskId, { startDate: startIso, endDate: endIso }, { ...commonOpts, skipEffortScheduleLink: true });
            } else {
              upd(t.taskId, { startDate: t.previewStartDate, endDate: t.previewEndDate }, { ...commonOpts, skipEffortScheduleLink: false });
            }
          }
          if (anyDateChange) {
            const flush = flushRollupsRef.current;
            if (flush) {
              for (const pid of projectIdsToFlush) flush(pid);
            }
          }
          if (anyDateChange) {
            const changed = (x: TaskDragInfo) => x.previewStartDate !== x.originalStartDate || x.previewEndDate !== x.originalEndDate;
            const p = drag.tasks.find((x) => x.taskId === drag.taskId && changed(x)) ?? drag.tasks.find(changed);
            if (p && drag.type === 'move') {
              const origS = parseISO(p.originalStartDate);
              const origE = parseISO(p.originalEndDate);
              const prevS = parseISO(p.previewStartDate);
              if (isValid(origS) && isValid(origE) && isValid(prevS)) {
                const sh = differenceInDays(prevS, origS);
                const newStart = format(addDays(origS, sh), 'MM/dd');
                const newEnd = format(addDays(origE, sh), 'MM/dd');
                const oldStart = format(origS, 'MM/dd');
                const oldEnd = format(origE, 'MM/dd');
                pushToastRef.current(`일정 변경: ${oldStart} ~ ${oldEnd} → ${newStart} ~ ${newEnd}`, { variant: 'info', durationMs: 3000 });
              }
            } else if (p) {
              const oldStart = format(parseISO(p.originalStartDate), 'MM/dd');
              const oldEnd = format(parseISO(p.originalEndDate), 'MM/dd');
              const newStart = format(parseISO(p.previewStartDate), 'MM/dd');
              const newEnd = format(parseISO(p.previewEndDate), 'MM/dd');
              pushToastRef.current(`일정 변경: ${oldStart} ~ ${oldEnd} → ${newStart} ~ ${newEnd}`, { variant: 'info', durationMs: 3000 });
            }
          }
        } else if (drag.type === 'move') {
          // 클릭(드래그 없음): 선택 처리
          const { selectedTaskIds: sel, visibleTasks: vis, setSelectedTaskIds: setSel, setActiveTaskId: setActive } = selectionRef.current;
          const taskId = drag.clickTaskId;
          const multi = drag.ctrlKey;
          const range = drag.shiftKey;
          const current = new Set<string>(sel);
          // 표에서만 선택한 뒤 간트에서 Shift 구간 선택 시 앵커 ref가 비어 있을 수 있음 → 현재 선택의 마지막 항목으로 보강
          const anchorId = anchorTaskIdRef.current ?? (sel.length > 0 ? sel[sel.length - 1]! : null);
          if (range && anchorId) {
            // Shift+클릭: 체크박스 범위 추가 (체크박스 동작은 명시적 modifier에서만)
            const idx = vis.findIndex((t) => t.id === taskId);
            const anchorIdx = vis.findIndex((t) => t.id === anchorId);
            let next: string[];
            if (idx !== -1 && anchorIdx !== -1) {
              const start = Math.min(idx, anchorIdx);
              const end = Math.max(idx, anchorIdx);
              next = vis.slice(start, end + 1).map((t) => t.id);
            } else {
              next = [...current, taskId];
            }
            setSel(next);
            setActive(taskId);
          } else if (multi) {
            // Ctrl/Cmd+클릭: 체크박스 토글 (체크박스 동작은 명시적 modifier에서만)
            const nextSet = new Set<string>(current);
            if (nextSet.has(taskId)) nextSet.delete(taskId);
            else nextSet.add(taskId);
            setSel([...nextSet]);
            setActive(taskId);
          } else {
            // 단순 클릭: 체크박스(selectedTaskIds)는 건드리지 않고 단일 활성 행만 갱신
            // → 표↔간트 보라색 강조는 동기화되지만 체크박스는 그대로 (스페이스/Ctrl/Shift로만 토글)
            anchorTaskIdRef.current = taskId;
            setActive(taskId);
          }
        }
        dragStateRef.current = null;
        setDragPreview(null);
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarResizeRef, setSidebarWidth]);

  return {
    dragPreview,
    suppressBarPopoverClickRef,
    anchorTaskIdRef,
    handleBarMouseDown,
    handleResizeMouseDown,
  };
}
