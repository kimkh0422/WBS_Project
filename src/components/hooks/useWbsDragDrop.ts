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
  updateTask: (id: string, updates: Partial<Task>) => void;
  reorderTask: (draggedId: string, targetId: string) => void;
}

export function useWbsDragDrop({ tasks, updateTask, reorderTask }: UseWbsDragDropOptions) {
  const [dndActiveId, setDndActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ overId: string; position: DropPosition } | null>(null);
  // 드래그 후 배치 옵션 팝업
  const [dropMenu, setDropMenu] = useState<{ draggedId: string; overId: string; x: number; y: number } | null>(null);

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

  /** 드래그 종료 → 배치 옵션 팝업 표시 */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDndActiveId(null);
      setDropTarget(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const draggedId = active.id as string;
      const overId = over.id as string;

      const draggedTask = tasks.find((t) => t.id === draggedId);
      const overTask = tasks.find((t) => t.id === overId);
      if (!draggedTask || !overTask || draggedTask.projectId !== overTask.projectId) return;

      // 순환 방지: over가 드래그한 작업의 자손이면 차단
      const isDescendant = (ancestorId: string, checkId: string): boolean => {
        let cur = tasks.find((t) => t.id === checkId);
        while (cur?.parentId) {
          if (cur.parentId === ancestorId) return true;
          cur = tasks.find((t) => t.id === cur!.parentId);
        }
        return false;
      };
      if (isDescendant(draggedId, overId)) return;

      const el = document.getElementById(`task-row-${overId}`);
      const rect = el?.getBoundingClientRect();
      // 시작일 칸 정도 위치 (행 왼쪽 + 약 350px)
      const x = rect ? rect.left + Math.min(450, rect.width * 0.38) : 450;
      const y = rect ? rect.bottom + 4 : window.innerHeight / 2;
      setDropMenu({ draggedId, overId, x, y });
    },
    [tasks],
  );

  /** 배치 옵션 선택 시 실행 */
  const executeDropAction = useCallback(
    (action: DropPosition) => {
      if (!dropMenu) return;
      const { draggedId, overId } = dropMenu;
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) {
        setDropMenu(null);
        return;
      }

      if (action === 'inside') {
        updateTask(draggedId, { parentId: overId });
        if (!overTask.expanded) updateTask(overId, { expanded: true });
      } else {
        const targetParentId = overTask.parentId ?? null;
        updateTask(draggedId, { parentId: targetParentId });
        reorderTask(draggedId, overId);
      }
      setDropMenu(null);
    },
    [dropMenu, tasks, updateTask, reorderTask],
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
