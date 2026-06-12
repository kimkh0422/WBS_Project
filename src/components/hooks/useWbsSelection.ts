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
  /** 체크 선택 배열의 내용이 바뀐 경우에만 true — `visibleTasks`만 바뀐 effect 재실행에 lastSelectedId가 덮어써지지 않게 함 */
  const prevSharedIdsSigRef = useRef<string | null>(null);

  // 외부(검색/알림/간트 등)에서 sharedSelectedTaskIds가 바뀌면 로컬 Set 동기화.
  // 빈 배열([])도 반영 — 간트에서 선택 해제했을 때 표가 그대로 남는 버그 방지.
  useEffect(() => {
    if (!sharedSelectedTaskIds) return;
    const sig = [...sharedSelectedTaskIds].sort().join('|');
    const selectionContentChanged = prevSharedIdsSigRef.current !== sig;
    prevSharedIdsSigRef.current = sig;

    const shared = new Set(sharedSelectedTaskIds);
    setSelectedTaskIds((prev) => {
      if (prev.size === shared.size && [...shared].every((id) => prev.has(id))) return prev;
      return shared;
    });
    // 단일 체크일 때 매 effect마다 lastSelectedId를 그 행으로 고정하면,
    // 스페이스로 체크한 뒤 ↑/↓로 옮긴 키보드 포커스가 다음 렌더에서 다시 체크된 행으로 되돌아간다.
    if (sharedSelectedTaskIds.length === 1) {
      if (selectionContentChanged) {
        setLastSelectedId(sharedSelectedTaskIds[0]);
      }
    } else if (sharedSelectedTaskIds.length === 0) {
      // 체크 선택만 해제(Esc·간트 동기 등)할 때 `lastSelectedId`를 무조건 null로 두면
      // `focusedCell`도 Esc로 지워진 뒤 화살표 기준 셀이 사라져 키보드 이동이 멈춘다.
      // 현재 표에 없는 이전 행(프로젝트 전환 등)일 때만 포커스를 비운다.
      setLastSelectedId((prev) => {
        if (prev == null) return null;
        return visibleTasks.some((t) => t.id === prev) ? prev : null;
      });
    }
  }, [sharedSelectedTaskIds, visibleTasks]);

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

      // 체크박스·클릭은 클릭한 행만 개별 토글한다(하위 작업을 자동으로 함께 선택하지 않음).
      // 하위 동반 처리가 필요한 동작(삭제 등)은 각 동작에서 별도로 하위를 수집한다.
      const currentIndex = visibleTasks.findIndex((t) => t.id === taskId);

      if (range) {
        // 앵커 후보: ref → state → 포커스 행 순. 표에 없는 ID(필터·접기·간트만 조작 후 옛 ref)는 건너뛰어
        // anchorIndex === -1일 때 한 줄만 선택되는 간헐적 Shift 범위 실패를 막는다.
        const anchorCandidates = [rangeAnchorRef.current, anchorTaskId, lastSelectedId].filter((id): id is string => Boolean(id));
        let anchorIndex = -1;
        for (const id of anchorCandidates) {
          const idx = visibleTasks.findIndex((t) => t.id === id);
          if (idx !== -1) {
            anchorIndex = idx;
            break;
          }
        }

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
        const wasSelected = selectedTaskIds.has(taskId);

        if (multi) {
          // 체크박스·Ctrl 클릭: 클릭한 행만 토글
          if (wasSelected) newSelected.delete(taskId);
          else newSelected.add(taskId);
        } else {
          // 단일 클릭: 그 행만 선택 (이미 선택돼 있었으면 해제)
          newSelected = wasSelected ? new Set<string>() : new Set<string>([taskId]);
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
