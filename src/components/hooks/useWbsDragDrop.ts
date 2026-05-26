import { useCallback, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Task } from '../../types';

export type DropPosition = 'before' | 'inside' | 'after';

interface UseWbsDragDropOptions {
  tasks: Task[];
  /** 체크박스·Ctrl/Shift 다중 선택과 동기화된 id 집합(그립 드래그 시 일괄 이동에 사용) */
  selectedTaskIds?: ReadonlySet<string>;
  reparentTaskRootsUnder: (newParentId: string, orderedRootIds: string[]) => void;
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

export function useWbsDragDrop({ tasks, selectedTaskIds, reparentTaskRootsUnder, moveTaskRootsSibling }: UseWbsDragDropOptions) {
  const [dndActiveId, setDndActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ overId: string; position: DropPosition } | null>(null);
  const [dropMenu, setDropMenu] = useState<{
    draggedRootIds: string[];
    overId: string;
    x: number;
    y: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
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
    setDropTarget({ overId: over.id as string, position: 'inside' });
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
      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const sel = selectedTaskIds ?? new Set<string>();
      const bulkDrag = sel.size > 1 && sel.has(activeId);
      const dragSet: ReadonlySet<string> = bulkDrag ? sel : new Set([activeId]);

      const draggedTask = tasks.find((t) => t.id === activeId);
      const overTask = tasks.find((t) => t.id === overId);
      if (!draggedTask || !overTask || draggedTask.projectId !== overTask.projectId) return;

      const pid = draggedTask.projectId;
      const draggedRootIds = orderedSelectionRoots(tasks, pid, dragSet);
      if (draggedRootIds.length === 0) return;

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
      if (forbidden.has(overId)) return;

      const el = document.getElementById(`task-row-${overId}`);
      const rect = el?.getBoundingClientRect();
      const x = rect ? rect.left + Math.min(450, rect.width * 0.38) : 450;
      const y = rect ? rect.bottom + 4 : window.innerHeight / 2;
      setDropMenu({ draggedRootIds, overId, x, y });
    },
    [tasks, selectedTaskIds],
  );

  const executeDropAction = useCallback(
    (action: DropPosition) => {
      if (!dropMenu) return;
      const { draggedRootIds, overId } = dropMenu;
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask || draggedRootIds.length === 0) {
        setDropMenu(null);
        return;
      }

      if (action === 'inside') {
        reparentTaskRootsUnder(overId, draggedRootIds);
      } else {
        moveTaskRootsSibling(draggedRootIds, overId, action);
      }
      setDropMenu(null);
    },
    [dropMenu, tasks, reparentTaskRootsUnder, moveTaskRootsSibling],
  );

  return {
    dndActiveId,
    dropTarget,
    dropMenu,
    setDropMenu,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd,
    executeDropAction,
  };
}
