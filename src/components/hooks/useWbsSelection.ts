import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { TaskWithDepth } from '../../lib/taskView';

interface UseWbsSelectionOptions {
  visibleTasks: TaskWithDepth[];
  sharedSelectedTaskIds: string[] | undefined;
  setSharedSelectedTaskIds: (ids: string[]) => void;
  tableScrollRef: MutableRefObject<HTMLDivElement | null>;
}

export function useWbsSelection({ visibleTasks, sharedSelectedTaskIds, setSharedSelectedTaskIds, tableScrollRef }: UseWbsSelectionOptions) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() =>
    sharedSelectedTaskIds && sharedSelectedTaskIds.length > 0 ? new Set(sharedSelectedTaskIds) : new Set(),
  );

  const [lastSelectedId, setLastSelectedId] = useState<string | null>(() =>
    sharedSelectedTaskIds && sharedSelectedTaskIds.length > 0 ? sharedSelectedTaskIds[0] : null,
  );
  const [anchorTaskId, setAnchorTaskId] = useState<string | null>(null);
  /** Shift 구간 선택 시작 행 — setState보다 먼저 갱신(행 클릭 직후 Shift 시 state 미반영 버그 방지) */
  const rangeAnchorRef = useRef<string | null>(null);

  // 외부(검색/알림/간트 등)에서 sharedSelectedTaskIds가 바뀌면 로컬 Set 동기화.
  // 빈 배열([])도 반영 — 간트에서 선택 해제했을 때 표가 그대로 남는 버그 방지.
  useEffect(() => {
    if (!sharedSelectedTaskIds) return;
    const shared = new Set(sharedSelectedTaskIds);
    setSelectedTaskIds((prev) => {
      if (prev.size === shared.size && [...shared].every((id) => prev.has(id))) return prev;
      return shared;
    });
    if (sharedSelectedTaskIds.length === 1) setLastSelectedId(sharedSelectedTaskIds[0]);
    else if (sharedSelectedTaskIds.length === 0) setLastSelectedId(null);
  }, [sharedSelectedTaskIds]);

  const setSelection = useCallback(
    (next: Set<string>) => {
      setSelectedTaskIds(next);
      setSharedSelectedTaskIds(Array.from(next));
    },
    [setSharedSelectedTaskIds],
  );

  const handleSelect = useCallback(
    (taskId: string, multi: boolean, range: boolean) => {
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
    },
    [selectedTaskIds, visibleTasks, anchorTaskId, lastSelectedId, setSelection],
  );

  const handleSelectAll = useCallback(() => {
    if (selectedTaskIds.size === visibleTasks.length) {
      setSelection(new Set());
    } else {
      setSelection(new Set(visibleTasks.map((t) => t.id)));
    }
    // 체크박스에서 테이블로 포커스 이동 (Delete 등 키보드 단축키 즉시 동작)
    requestAnimationFrame(() => tableScrollRef.current?.focus());
  }, [selectedTaskIds, visibleTasks, setSelection, tableScrollRef]);

  return {
    selectedTaskIds,
    lastSelectedId,
    setLastSelectedId,
    anchorTaskId,
    setAnchorTaskId,
    rangeAnchorRef,
    setSelection,
    handleSelect,
    handleSelectAll,
  };
}
