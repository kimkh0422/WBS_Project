import type { TableColumnId } from '../components/wbsTableTypes';

/** 키보드·Tab으로 포커스는 받지만 값은 파생인 컬럼 — 인라인 편집은 다른 컬럼으로 위임 */
export function isDerivedScheduleColumnId(columnId: TableColumnId): boolean {
  return columnId === 'progressVariance' || columnId === 'workComposition';
}

/**
 * 계획율/진척차이 셀에서 F2·Tab 연속 편집 등으로 실제로 열 인라인 편집기가 있는 컬럼 id.
 * 표시 중인 컬럼만 고려한다(숨긴 날짜 열로는 넘기지 않음).
 */
export function delegateInlineEditColumnId(columnId: TableColumnId, visibleEditableColumnIds: readonly TableColumnId[]): TableColumnId {
  const has = (id: TableColumnId) => visibleEditableColumnIds.includes(id);
  if (columnId === 'progressVariance') {
    if (has('progress')) return 'progress';
    return columnId;
  }
  if (columnId === 'workComposition') {
    if (has('workEffort')) return 'workEffort';
    if (has('progress')) return 'progress';
    return columnId;
  }
  return columnId;
}
