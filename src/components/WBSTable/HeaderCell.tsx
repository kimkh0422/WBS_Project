import React from 'react';
import type { Task } from '../../types';
import { PLANNED_PROGRESS_COLUMN_HELP_TEXT, PROGRESS_VARIANCE_COLUMN_HELP_TEXT } from '../../lib/plannedProgressTooltips';
import type { BuiltInTableColumnId, TableColumnId } from '../wbsTableTypes';

export { PLANNED_PROGRESS_COLUMN_HELP_TEXT, PROGRESS_VARIANCE_COLUMN_HELP_TEXT } from '../../lib/plannedProgressTooltips';

/** 정렬 문구 제외 — 표 셀·일괄 수정 바 등에 공통 사용 */
export const WEIGHT_COLUMN_HELP_TEXT = [
  '가중치 = 같은 부모 아래 형제 작업끼리의 상대적 비중입니다.',
  '바로 위 부모 행의 자동 진척률을 계산할 때, 각 자식의 (진척률×가중치)를 합한 뒤 가중치 합으로 나눕니다.',
  '형제 가중치 합이 100일 필요는 없습니다. 비율만 의미합니다.',
  '비어 두면 가중치 대신 공수(workEffort)가 진척 롤업 가중에 사용됩니다. 요약 행 공수는 직속 하위 공수 합으로 갱신됩니다.',
].join('\n');

/** 정렬 문구 제외 — 표 셀·일괄 수정 바 등에 공통 사용 */
export const PROGRESS_COLUMN_HELP_TEXT = [
  '진척률 0~100%. 리프(하위 없음) 행에는 직접 입력한 값이 저장됩니다.',
  '요약(하위 있음) 행에는 직접 자식들만 대상으로 가중 평균이 자동 반영됩니다(말단 전체가 아님).',
  '완료로 정의된 상태이면 하위와 관계없이 100%로 유지될 수 있습니다.',
  '환경설정에서 상태·진척 연동을 켠 경우, 단계 변경 시 해당 단계의 기본 진척%가 덮어쓸 수 있습니다.',
].join('\n');

/** 컬럼 헤더 마우스 오버 시 툴팁 */
export const COLUMN_TOOLTIPS: Record<BuiltInTableColumnId, string> = {
  wbsId: 'WBS 식별자',
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  duration: '기간 = 시작일~종료일(양 끝 포함) 일수. 값을 바꾸면 시작일 기준으로 종료일이 자동 계산됩니다.',
  workEffort: '프로젝트 공수 단위(분·시간·일·주)',
  weight: WEIGHT_COLUMN_HELP_TEXT,
  assignee: '담당자',
  allocation: '투입율 (%)',
  status: '상태',
  progress: PROGRESS_COLUMN_HELP_TEXT,
  plannedProgress: PLANNED_PROGRESS_COLUMN_HELP_TEXT,
  progressVariance: PROGRESS_VARIANCE_COLUMN_HELP_TEXT,
  deliverables: '산출물',
  dependencies: '선행작업(의존성)',
};

interface HeaderCellProps {
  id: TableColumnId;
  label?: string;
  /** workEffort 컬럼 표시 텍스트(단일 프로젝트 표시 시 단위 포함) */
  workEffortHeaderTitle?: string;
  /** false면 헤더 클릭으로 정렬하지 않음(우클릭 메뉴 등은 그대로). 표+간트 분할·표만 편집 모드에서 열 조작·행 동기화 시 오정렬 방지 */
  headerSortClickEnabled?: boolean;
  onSort: (key: keyof Task | 'wbs') => void;
  resizeGrip: React.ReactNode;
  onColContextMenu: (ev: React.MouseEvent) => void;
  onColDoubleClick: (ev: React.MouseEvent) => void;
}

export function HeaderCell({
  id,
  label,
  workEffortHeaderTitle,
  headerSortClickEnabled = true,
  onSort,
  resizeGrip,
  onColContextMenu,
  onColDoubleClick,
}: HeaderCellProps) {
  const sortableHeaderClass = headerSortClickEnabled
    ? 'col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative'
    : 'col-header relative';

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
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('wbs') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={
            headerSortClickEnabled ? 'WBS 순서 (클릭하여 정렬) · 더블클릭: 너비 자동' : 'WBS 순서 · 우클릭: 정렬·메뉴 · 더블클릭: 너비 자동'
          }
        >
          WBS
          {resizeGrip}
        </div>
      );
    case 'name':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('name') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.name : '작업명 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          작업명
          {resizeGrip}
        </div>
      );
    case 'startDate':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('startDate') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.startDate : '시작일 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          시작일
          {resizeGrip}
        </div>
      );
    case 'endDate':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('endDate') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.endDate : '종료일 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          종료일
          {resizeGrip}
        </div>
      );
    case 'duration':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.duration + ' · 더블클릭: 너비 자동'}
        >
          기간
          {resizeGrip}
        </div>
      );
    case 'workEffort':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('workEffort') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.workEffort : '공수 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          {workEffortHeaderTitle ?? '공수'}
          {resizeGrip}
        </div>
      );
    case 'weight':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('weight' as keyof Task) : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.weight : '가중치 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          가중치
          {resizeGrip}
        </div>
      );
    case 'progress':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('progress') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.progress : '진척률 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          진척(%)
          {resizeGrip}
        </div>
      );
    case 'plannedProgress':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.plannedProgress + ' · 더블클릭: 너비 자동'}
        >
          계획(%)
          <span
            className="ml-1 inline-block align-middle rounded bg-slate-200/80 px-1 text-[8px] font-bold uppercase leading-tight tracking-wide text-slate-500"
            title="자동 계산되는 항목 — 입력하지 않아도 됩니다."
          >
            자동
          </span>
          {resizeGrip}
        </div>
      );
    case 'progressVariance':
      return (
        <div
          className="col-header relative"
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={COLUMN_TOOLTIPS.progressVariance + ' · 더블클릭: 너비 자동'}
        >
          차이(%p)
          <span
            className="ml-1 inline-block align-middle rounded bg-slate-200/80 px-1 text-[8px] font-bold uppercase leading-tight tracking-wide text-slate-500"
            title="자동 계산되는 항목 — 입력하지 않아도 됩니다."
          >
            자동
          </span>
          {resizeGrip}
        </div>
      );
    case 'assignee':
      return (
        <div
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('assignee') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.assignee : '담당자 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          담당자
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
          className={sortableHeaderClass}
          onClick={headerSortClickEnabled ? () => onSort('status') : undefined}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={(headerSortClickEnabled ? COLUMN_TOOLTIPS.status : '상태 · 우클릭: 정렬·메뉴') + ' · 더블클릭: 너비 자동'}
        >
          상태
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
