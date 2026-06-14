import type { TableColumnId } from '../components/wbsTableTypes';

/**
 * Shift+셀 마퀴 확장에 개입하면 안 되는 타깃(툴바·그립·편집 입력 등).
 * `[data-wbs-range-cell]` 안의 일반 버튼(날짜·담당자 등 셀 클릭 영역)은 제외하지 않는다 —
 * 여기까지 막아 두면 Shift+클릭이 셀의 onClick(beginEdit)→handleFocusRow로 새어 들어가 마퀴가 지워진다.
 */
export function isShiftCellMarqueeExcludedTarget(el: HTMLElement | null): boolean {
  if (!el) return true;
  if (el.closest('[data-row-grip]')) return true;
  if (el.closest('textarea, select, option, [role="listbox"], [role="option"], [data-deps-input="true"]')) return true;
  if (el.closest('input:not([type="checkbox"])')) return true;
  const link = el.closest('a');
  if (link && !link.closest('[data-wbs-range-cell]')) return true;
  const btn = el.closest('button');
  if (btn) {
    if (!btn.closest('[data-wbs-range-cell]')) return true;
    if (btn.hasAttribute('aria-expanded')) return true;
  }
  return false;
}

/**
 * Shift+클릭으로 마퀴 끝점이 될 셀 좌표를 DOM에서 복원한다.
 * - `[data-wbs-range-cell]` 안이면 dataset 기준
 * - 그 외 `.data-row` 안(체크박스·순번 등)이면 행 id + 포커스 열(또는 첫 편집 열)
 */
export function resolveWbsShiftClickMarqueeEnd(
  target: EventTarget | null,
  visibleColumnIds: readonly TableColumnId[],
  editableColumnIds: readonly TableColumnId[],
  focusedCell: { taskId: string; columnId: TableColumnId } | null,
): { taskId: string; columnId: TableColumnId } | null {
  const el = target as HTMLElement | null;
  if (!el) return null;

  const cellEl = el.closest('[data-wbs-range-cell]') as HTMLElement | null;
  if (cellEl) {
    const taskId = cellEl.dataset.rangeTask;
    const columnId = cellEl.dataset.rangeCol as TableColumnId | undefined;
    if (taskId && columnId && visibleColumnIds.includes(columnId)) return { taskId, columnId };
  }

  const rowEl = el.closest('.data-row') as HTMLElement | null;
  if (!rowEl?.id?.startsWith('task-row-')) return null;
  const taskId = rowEl.id.slice('task-row-'.length);
  if (!taskId) return null;
  const col =
    focusedCell?.taskId === taskId && focusedCell.columnId && visibleColumnIds.includes(focusedCell.columnId)
      ? focusedCell.columnId
      : (editableColumnIds[0] ?? 'name');
  return { taskId, columnId: col };
}
