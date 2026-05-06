import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Task, SortConfig } from '../../types';
import type { BuiltInTableColumnId, TableColumnId } from '../wbsTableTypes';

/** 컬럼 헤더 마우스 오버 시 툴팁 */
export const COLUMN_TOOLTIPS: Record<BuiltInTableColumnId, string> = {
  wbsId: 'WBS 식별자',
  name: '작업명 (클릭하여 정렬)',
  startDate: '시작일 (클릭하여 정렬)',
  endDate: '종료일 (클릭하여 정렬)',
  workEffort: '프로젝트 공수 단위(분·시간·일·주) (클릭하여 정렬)',
  weight: '진척 가중치 (클릭하여 정렬)',
  assignee: '담당자 (클릭하여 정렬)',
  allocation: '투입율 (%)',
  status: '상태 (클릭하여 정렬)',
  progress: '진척률 (%) (클릭하여 정렬)',
  deliverables: '산출물',
  dependencies: '선행작업(의존성)',
};

interface SortIconProps {
  column: keyof Task | 'wbsId';
  sortConfig: SortConfig;
}

export function SortIcon({ column, sortConfig }: SortIconProps) {
  const isActive = sortConfig?.key === column || (column === 'wbsId' && sortConfig?.key === 'wbs');
  if (!isActive) return <ArrowUpDown size={12} className="opacity-30" />;
  return sortConfig!.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

interface HeaderCellProps {
  id: TableColumnId;
  label?: string;
  /** workEffort 컬럼 표시 텍스트(단일 프로젝트 표시 시 단위 포함) */
  workEffortHeaderTitle?: string;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  resizeGrip: React.ReactNode;
  onColContextMenu: (ev: React.MouseEvent) => void;
  onColDoubleClick: (ev: React.MouseEvent) => void;
}

export function HeaderCell({
  id,
  label,
  workEffortHeaderTitle,
  sortConfig,
  onSort,
  resizeGrip,
  onColContextMenu,
  onColDoubleClick,
}: HeaderCellProps) {
  if (id.startsWith('custom:')) {
    return (
      <div
        className="col-header relative"
        onDoubleClick={onColDoubleClick}
        onContextMenu={onColContextMenu}
        title={`${label ?? id} · 더블클릭: 너비 자동`}
      >
        {label ?? id}
        {resizeGrip}
      </div>
    );
  }
  switch (id) {
    case 'wbsId':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('wbs')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title="WBS 순서 (클릭하여 정렬) · 더블클릭: 너비 자동"
        >
          WBS <SortIcon column="wbsId" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'name':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('name')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.name + ' · 더블클릭: 너비 자동'}
        >
          작업명 <SortIcon column="name" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'startDate':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('startDate')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.startDate + ' · 더블클릭: 너비 자동'}
        >
          시작일 <SortIcon column="startDate" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'endDate':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('endDate')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.endDate + ' · 더블클릭: 너비 자동'}
        >
          종료일 <SortIcon column="endDate" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'workEffort':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('workEffort')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.workEffort + ' · 더블클릭: 너비 자동'}
        >
          {workEffortHeaderTitle ?? '공수'} <SortIcon column="workEffort" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'weight':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('weight' as keyof Task)}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.weight + ' · 더블클릭: 너비 자동'}
        >
          가중치 <SortIcon column={'weight' as keyof Task} sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'progress':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('progress')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.progress + ' · 더블클릭: 너비 자동'}
        >
          진척(%) <SortIcon column="progress" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'assignee':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('assignee')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.assignee + ' · 더블클릭: 너비 자동'}
        >
          담당자 <SortIcon column="assignee" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'allocation':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.allocation + ' · 더블클릭: 너비 자동'}
        >
          투입율
          {resizeGrip}
        </div>
      );
    case 'status':
      return (
        <div
          className="col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative"
          onClick={() => onSort('status')}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.status + ' · 더블클릭: 너비 자동'}
        >
          상태 <SortIcon column="status" sortConfig={sortConfig} />
          {resizeGrip}
        </div>
      );
    case 'deliverables':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.deliverables + ' · 더블클릭: 너비 자동'}
        >
          산출물
          {resizeGrip}
        </div>
      );
    case 'dependencies':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.dependencies + ' · 더블클릭: 너비 자동'}
        >
          선행작업
          {resizeGrip}
        </div>
      );
    default:
      return null;
  }
}
