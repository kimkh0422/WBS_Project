import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { flushSync } from 'react-dom';
import type { TaskWithDepth } from '../../lib/taskView';

interface UseWbsSelectionOptions {
  visibleTasks: TaskWithDepth[];
  sharedSelectedTaskIds: string[] | undefined;
  setSharedSelectedTaskIds: (ids: string[]) => void;
  tableScrollRef: MutableRefObject<HTMLDivElement | null>;
}

function selectionSig(ids: Iterable<string>): string {
  return [...ids].sort().join('|');
}

export function useWbsSelection({ visibleTasks, sharedSelectedTaskIds, setSharedSelectedTaskIds, tableScrollRef }: UseWbsSelectionOptions) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() =>
    sharedSelectedTaskIds && sharedSelectedTaskIds.length > 0 ? new Set(sharedSelectedTaskIds) : new Set(),
  );

  const [lastSelectedId, setLastSelectedId] = useState<string | null>(() =>
    sharedSelectedTaskIds && sharedSelectedTaskIds.length > 0 ? sharedSelectedTaskIds[0] : null,
  );
  const [anchorTaskId, setAnchorTaskId] = useState<string | null>(null);
  /** 연속 체크박스 클릭 시 handleSelect가 stale closure 없이 최신 선택을 읽도록 동기 ref 유지 */
  const selectedTaskIdsRef = useRef(selectedTaskIds);
  selectedTaskIdsRef.current = selectedTaskIds;
  /** Shift 구간 선택 시작 행 — setState보다 먼저 갱신(행 클릭 직후 Shift 시 state 미반영 버그 방지) */
  const rangeAnchorRef = useRef<string | null>(null);
  /** setSelection 직후 상위 Context 반영 전 effect가 옛 shared로 로컬을 덮어쓰지 않게 한다 */
  const pendingLocalSigRef = useRef<string | null>(null);
  const prevSharedIdsSigRef = useRef<string | null>(null);

  // 외부(검색/알림/간트 등)에서 sharedSelectedTaskIds가 바뀌면 로컬 Set 동기화.
  // 빈 배열([])도 반영 — 간트에서 선택 해제했을 때 표가 그대로 남는 버그 방지.
  // visibleTasks만 바뀔 때는 선택 Set을 건드리지 않는다.
  useEffect(() => {
    if (!sharedSelectedTaskIds) return;
    const sig = selectionSig(sharedSelectedTaskIds);

    const pending = pendingLocalSigRef.current;
    if (pending != null) {
      if (sig === pending) {
        pendingLocalSigRef.current = null;
        prevSharedIdsSigRef.current = sig;
      } else {
        // 로컬에서 방금 쓴 선택이 Context에 반영되기 전 — 옛 shared로 덮어쓰지 않음
        if (sharedSelectedTaskIds.length === 0) {
          setLastSelectedId((prev) => {
            if (prev == null) return null;
            return visibleTasks.some((t) => t.id === prev) ? prev : null;
          });
        }
        return;
      }
    }

    const selectionContentChanged = prevSharedIdsSigRef.current !== sig;

    if (selectionContentChanged) {
      prevSharedIdsSigRef.current = sig;
      const shared = new Set(sharedSelectedTaskIds);
      setSelectedTaskIds((prev) => {
        if (prev.size === shared.size && [...shared].every((id) => prev.has(id))) return prev;
        // Context 반영이 한 틱 늦을 때 로컬이 shared보다 앞서 있으면 덮어쓰지 않음.
        if (pendingLocalSigRef.current != null && shared.size < prev.size && [...shared].every((id) => prev.has(id))) {
          return prev;
        }
        selectedTaskIdsRef.current = shared;
        return shared;
      });
      if (sharedSelectedTaskIds.length === 1) {
        setLastSelectedId(sharedSelectedTaskIds[0]);
      }
    }

    if (sharedSelectedTaskIds.length === 0) {
      setLastSelectedId((prev) => {
        if (prev == null) return null;
        return visibleTasks.some((t) => t.id === prev) ? prev : null;
      });
    }
  }, [sharedSelectedTaskIds, visibleTasks]);

  const setSelection = useCallback(
    (next: Set<string>) => {
      const sig = selectionSig(next);
      pendingLocalSigRef.current = sig;
      selectedTaskIdsRef.current = next;
      // 체크박스·행 강조가 같은 프레임에 맞춰지도록 동기 커밋(비동기 배치로 체크만 보이는 현상 방지).
      flushSync(() => {
        setSelectedTaskIds(next);
        setSharedSelectedTaskIds(Array.from(next));
      });
    },
    [setSharedSelectedTaskIds],
  );

  const handleSelect = useCallback(
    (taskId: string, multi: boolean, range: boolean) => {
      const selectedTaskIds = selectedTaskIdsRef.current;
      let newSelected = new Set<string>(multi ? selectedTaskIds : ([] as string[]));

      const currentIndex = visibleTasks.findIndex((t) => t.id === taskId);

      if (range) {
        const anchorCandidates = [rangeAnchorRef.current, anchorTaskId, lastSelectedId].filter((id): id is string => Boolean(id));
        let anchorIndex = -1;
        for (const id of anchorCandidates) {
          const idx = visibleTasks.findIndex((t) => t.id === id);
          if (idx !== -1) {
            anchorIndex = idx;
            break;
          }
        }
        if (anchorIndex === -1 && currentIndex !== -1 && selectedTaskIds.size > 0) {
          let bestIdx = -1;
          let bestDist = Infinity;
          for (const sid of selectedTaskIds) {
            const idx = visibleTasks.findIndex((t) => t.id === sid);
            if (idx === -1) continue;
            const d = Math.abs(idx - currentIndex);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = idx;
            }
          }
          if (bestIdx !== -1) anchorIndex = bestIdx;
        }

        if (currentIndex !== -1 && anchorIndex !== -1) {
          const start = Math.min(currentIndex, anchorIndex);
          const end = Math.max(currentIndex, anchorIndex);

          for (let i = start; i <= end; i++) {
            newSelected.add(visibleTasks[i].id);
          }
          const visibleAnchorId = visibleTasks[anchorIndex]?.id;
          if (visibleAnchorId) {
            rangeAnchorRef.current = visibleAnchorId;
            setAnchorTaskId(visibleAnchorId);
          }
        } else {
          newSelected.add(taskId);
        }
      } else {
        const wasSelected = selectedTaskIds.has(taskId);

        if (multi) {
          if (wasSelected) newSelected.delete(taskId);
          else newSelected.add(taskId);
        } else {
          newSelected = wasSelected ? new Set<string>() : new Set<string>([taskId]);
        }

        rangeAnchorRef.current = taskId;
        setAnchorTaskId(taskId);
      }

      setSelection(newSelected);
      setLastSelectedId(taskId);
    },
    [visibleTasks, anchorTaskId, lastSelectedId, setSelection],
  );

  const handleSelectAll = useCallback(() => {
    const selectedTaskIds = selectedTaskIdsRef.current;
    if (selectedTaskIds.size === visibleTasks.length) {
      setSelection(new Set());
    } else {
      setSelection(new Set(visibleTasks.map((t) => t.id)));
    }
    requestAnimationFrame(() => tableScrollRef.current?.focus());
  }, [visibleTasks, setSelection, tableScrollRef]);

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
