import React from 'react';
import { Task, FilterState, SortConfig } from '../types';

export type BuiltInTableColumnId =
  | 'wbsId'
  | 'name'
  | 'startDate'
  | 'endDate'
  | 'workEffort'
  | 'weight'
  | 'assignee'
  | 'allocation'
  | 'status'
  | 'progress'
  | 'deliverables'
  | 'dependencies';
export type TableColumnId = BuiltInTableColumnId | `custom:${string}`;

export interface WBSTableProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  syncScrollRef?: React.Ref<HTMLDivElement>;
  /** 표·간트 공통 줄간격(px). 전달 시 부모와 동기화(양쪽 슬라이더 모두 적용) */
  rowHeight?: number;
  onRowHeightChange?: (h: number) => void;
  /** 줄바꿈 켜짐 시 측정된 행 높이 배열을 전달 (표·간트 동기화용) */
  onRowHeightsChange?: (heights: number[]) => void;
  hotkeysEnabled?: boolean;
  onOpenColumnSettings?: () => void;
  /** true면 부모 높이를 채움(표만 뷰), false면 콘텐츠 높이만 사용(리스트 뷰, 하단 공백 감소) */
  fillHeight?: boolean;
  /** 필터로 인해 표시 행이 없을 때 "필터 초기화" 등에 사용 */
  onResetFilters?: () => void;
  /** 설정 시 해당 작업으로 자동 스크롤 (검색/알림에서 이동 시 사용) */
  scrollToTaskId?: string | null;
}
