import React, { useCallback, useMemo } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** 행 Dnd(task id)과 충돌하지 않도록 접두어 사용 */
export const WBS_COLUMN_DND_PREFIX = 'wbs-col:';

export type WbsColumnHeaderDragProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  style: React.CSSProperties;
  isDragging: boolean;
};

function SortableColumnShell({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (drag: WbsColumnHeaderDragProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    transition,
  };
  const drag: WbsColumnHeaderDragProps = {
    setNodeRef,
    attributes: attributes as Record<string, unknown>,
    listeners: listeners as Record<string, unknown> | undefined,
    style,
    isDragging,
  };
  return <>{children(drag)}</>;
}

/**
 * 표 데이터 헤더 셀(고정 3열 이후)만 가로 재정렬. 비활성 시 자식에 drag=null.
 */
export function WbsColumnHeaderDndGroup({
  columnIds,
  disabled,
  onReorder,
  children,
}: {
  columnIds: readonly string[];
  disabled: boolean;
  onReorder: (nextIds: string[]) => void;
  children: (colId: string, drag: WbsColumnHeaderDragProps | null) => React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const sortableIds = useMemo(() => columnIds.map((c) => `${WBS_COLUMN_DND_PREFIX}${c}`), [columnIds]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sortableIds.indexOf(String(active.id));
      const newIndex = sortableIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onReorder(arrayMove([...columnIds], oldIndex, newIndex));
    },
    [columnIds, disabled, onReorder, sortableIds],
  );

  if (disabled) {
    return <>{columnIds.map((id) => children(id, null))}</>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
        {columnIds.map((colId) => (
          <SortableColumnShell key={colId} id={`${WBS_COLUMN_DND_PREFIX}${colId}`} disabled={false}>
            {(drag) => children(colId, drag)}
          </SortableColumnShell>
        ))}
      </SortableContext>
    </DndContext>
  );
}
