import React from 'react';
import { Task, FilterState, SortConfig } from '../types';

export type BuiltInTableColumnId =
  | 'wbsId'
  | 'name'
  | 'startDate'
  | 'endDate'
  | 'duration'
  | 'workEffort'
  /** 직속 형제 대비 공수 비율(%), 소수 1자리 — 저장 필드 없음 */
  | 'workComposition'
  | 'weight'
  | 'assignee'
  | 'allocation'
  | 'status'
  | 'progress'
  | 'plannedProgress'
  | 'progressVariance'
  | 'deliverables'
  | 'dependencies'
  /** 표 우측 관리 열(수정·삭제) — 데이터 필드는 없으나 엑셀식 마퀴·포커스 격자에 포함 */
  | 'actions';
export type TableColumnId = BuiltInTableColumnId | `custom:${string}`;

/** 인라인 편집 중인 셀. `typeToEditSeed`는 controlled 편집기(allocation·진척률·선행작업)용 첫 글자 주입 후 즉시 제거된다. */
export type WbsEditingCellPayload = { taskId: string; columnId: TableColumnId; typeToEditSeed?: string };
/** @deprecated `actions`는 TableColumnId에 포함됨 */
export type TableDisplayColumnId = TableColumnId;

export interface WBSTableProps {
  filters: FilterState;
  sortConfig: SortConfig;
  onSort: (key: keyof Task | 'wbs') => void;
  syncScrollRef?: React.Ref<HTMLDivElement>;
  /** split 뷰: 표 상단 컬럼 헤더(가로 스크롤) 엘리먼트 — 간트 타임라인과 scrollLeft 동기화용 */
  splitHeaderScrollRef?: React.Ref<HTMLDivElement | null>;
  /** 표·간트 공통 줄간격(px). 전달 시 부모와 동기화(양쪽 슬라이더 모두 적용) */
  rowHeight?: number;
  onRowHeightChange?: (h: number) => void;
  /** 줄바꿈 켜짐 시 측정된 행 높이 배열을 전달 (표·간트 동기화용) */
  onRowHeightsChange?: (heights: number[]) => void;
  /** split 뷰: 간트와 동일한 행 높이(가상 스크롤·총 높이 정렬) */
  syncRowHeights?: number[];
  /** split 뷰: 표 하단(또는 하단 슬롯)에 도킹된 크롬 바 높이(px). 간트 하단을 같은 높이만큼 띄워 행 정렬을 맞춘다. */
  onBottomInsetChange?: (height: number) => void;
  /** split 뷰: 일괄 수정(다중 선택) 바를 이 컨테이너(표+간트 하단 전체 너비)로 포털한다. 없으면 topDockContainer 또는 표 패널 in-flow. */
  bottomDockContainer?: HTMLElement | null;
  /** 표+간트 split: 셀 서식 툴바를 상단에 포털한다. bottomDockContainer와 함께 쓰면 서식=상단, 일괄=하단으로 나뉜다. */
  topDockContainer?: HTMLElement | null;
  hotkeysEnabled?: boolean;
  onOpenColumnSettings?: () => void;
  /** true면 부모 높이를 채움(표만 뷰), false면 콘텐츠 높이만 사용(리스트 뷰, 하단 공백 감소) */
  fillHeight?: boolean;
  /** true면 마운트(및 프로젝트·프로젝트 필터 변경) 시 보이는 컬럼을 데이터에 맞게 일괄 자동 맞춤. 표만 탭 등에서 사용 */
  autoFitColumnsOnMount?: boolean;
  /** 설정 시 해당 작업으로 자동 스크롤 (검색/알림에서 이동 시 사용) */
  scrollToTaskId?: string | null;
  /**
   * 표+간트 split: 간트 막대 우클릭 시 표와 동일한 컨텍스트 메뉴를 열 때 사용.
   * WBSTable이 `handleContextMenu`를 이 ref에 주입한다.
   */
  taskContextMenuHandlerRef?: React.MutableRefObject<
    ((e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void) | null
  >;
  /** 표+간트 split: 부모가 보관하는 계획율 기준일(간트 기준선과 동기화). 없으면 WBSTable 내부 state 사용 */
  plannedRefDateIso?: string;
  onPlannedRefDateIsoChange?: (iso: string) => void;
  /**
   * 표+간트 split: 간트 타임라인 확대/축소 인덱스. `-1`이면 전체 일정이 보이도록 자동 맞춤.
   * `TableGanttSplit`에서 `GanttChart`와 동기화해 SummaryBar 슬라이더로 조절한다.
   */
  ganttZoomIndex?: number;
  onGanttZoomIndexChange?: (zoomIndex: number) => void;
}
