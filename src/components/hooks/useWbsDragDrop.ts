import { useCallback, useState } from 'react';
import {
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import type { Coordinates } from '@dnd-kit/utilities';
import type { Task } from '../../types';

export type DropPosition = 'before' | 'after';

/** `task-row-{id}`가 있으면 화면상 실제 행 박스 기준(가상 스크롤·변환 오차 완화) */
function overRowMidY(overId: string, kitOverRect: Over['rect']): number {
  if (typeof document === 'undefined') return kitOverRect.top + kitOverRect.height / 2;
  const el = document.getElementById(`task-row-${overId}`);
  const dom = el?.getBoundingClientRect();
  if (dom && dom.height > 0) return dom.top + dom.height / 2;
  return kitOverRect.top + kitOverRect.height / 2;
}

/**
 * 포인터의 현재 clientY(시작 좌표 + dnd delta)와 대상 행 중앙을 비교한다.
 * 행 박스 중심만 쓰면 잡은 위치·오버레이와 어긋날 수 있어 마우스 기준으로 맞춘다.
 */
function dropPositionBeforeOrAfter(active: Active, over: Over, activatorEvent: Event, delta: Coordinates): DropPosition {
  const start = getEventCoordinates(activatorEvent);
  if (start) {
    const pointerY = start.y + delta.y;
    const midY = overRowMidY(String(over.id), over.rect);
    return pointerY < midY ? 'before' : 'after';
  }
  const translated = active.rect.current.translated ?? active.rect.current.initial;
  if (!translated) return 'before';
  const dragCenterY = translated.top + translated.height / 2;
  const midY = overRowMidY(String(over.id), over.rect);
  return dragCenterY < midY ? 'before' : 'after';
}

interface UseWbsDragDropOptions {
  tasks: Task[];
  /** 체크박스·Ctrl/Shift 다중 선택과 동기화된 id 집합(그립 드래그 시 일괄 이동에 사용) */
  selectedTaskIds?: ReadonlySet<string>;
  moveTaskRootsSibling: (orderedRootIds: string[], overId: string, position: 'before' | 'after') => void;
}

/** 다중 선택에서 트리 루트만(선택된 상위가 있으면 제외) — 표 `tasks` 순서 유지 */
function orderedSelectionRoots(tasks: Task[], projectId: string, selected: ReadonlySet<string>): string[] {
  const ordered = tasks.filter((t) => t.projectId === projectId && selected.has(t.id)).map((t) => t.id);
  return ordered.filter((id) => {
    const t = tasks.find((x) => x.id === id);
    const p = t?.parentId;
    return !p || !selected.has(p);
  });
}

export function useWbsDragDrop({ tasks, selectedTaskIds, moveTaskRootsSibling }: UseWbsDragDropOptions) {
  const [dndActiveId, setDndActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ overId: string; position: DropPosition } | null>(null);

  // KeyboardSensor 제외: Space 이후 ↑/↓가 정렬 이동으로 가로채져 담당자·셀 편집과 충돌함.
  // 행 순서 키보드 조정은 useWbsTableKeyboard 의 Alt+↑ / Alt+↓ (moveTask)만 사용.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDndActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropTarget(null);
      return;
    }
    const position = dropPositionBeforeOrAfter(active, over, event.activatorEvent, event.delta);
    setDropTarget({ overId: over.id as string, position });
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setDropTarget(null);
    setDndActiveId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDndActiveId(null);
      setDropTarget(null);
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;

      const sel = selectedTaskIds ?? new Set<string>();
      const bulkDrag = sel.size > 1 && sel.has(activeId);
      const dragSet: ReadonlySet<string> = bulkDrag ? sel : new Set([activeId]);

      const draggedTask = tasks.find((t) => t.id === activeId);
      const overTask = tasks.find((t) => t.id === overId);
      if (!draggedTask || !overTask || draggedTask.projectId !== overTask.projectId) {
        return;
      }

      const pid = draggedTask.projectId;
      const draggedRootIds = orderedSelectionRoots(tasks, pid, dragSet);
      if (draggedRootIds.length === 0) {
        return;
      }

      const collectSubtreeIds = (rootId: string, list: Task[]): Set<string> => {
        const acc = new Set<string>([rootId]);
        const stack = [rootId];
        while (stack.length) {
          const id = stack.pop()!;
          for (const t of list) {
            if (t.parentId === id && t.projectId === pid && !acc.has(t.id)) {
              acc.add(t.id);
              stack.push(t.id);
            }
          }
        }
        return acc;
      };

      const forbidden = new Set<string>();
      for (const rid of draggedRootIds) {
        for (const id of collectSubtreeIds(rid, tasks)) forbidden.add(id);
      }
      if (forbidden.has(overId)) {
        return;
      }

      const position = dropPositionBeforeOrAfter(active, over, event.activatorEvent, event.delta);
      moveTaskRootsSibling(draggedRootIds, overId, position);
    },
    [tasks, selectedTaskIds, moveTaskRootsSibling],
  );

  return {
    dndActiveId,
    dropTarget,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd,
  };
}
