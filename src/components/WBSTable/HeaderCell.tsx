import React from 'react';
import type { Task } from '../../types';
import { cn } from '../../lib/utils';
import { PLANNED_PROGRESS_COLUMN_HELP_TEXT, PROGRESS_VARIANCE_COLUMN_HELP_TEXT } from '../../lib/plannedProgressTooltips';
import type { BuiltInTableColumnId, TableColumnId } from '../wbsTableTypes';
import type { WbsColumnHeaderDragProps } from './columnHeaderDnd';

export { PLANNED_PROGRESS_COLUMN_HELP_TEXT, PROGRESS_VARIANCE_COLUMN_HELP_TEXT } from '../../lib/plannedProgressTooltips';

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (ref == null) continue;
      if (typeof ref === 'function') (ref as (v: T | null) => void)(value);
      else (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

/** 정렬 문구 제외 — 표 셀·일괄 수정 바 등에 공통 사용 */
export const WEIGHT_COLUMN_HELP_TEXT = [
  '가중치 = 같은 부모 아래 형제 작업끼리의 상대적 비중(선택 입력)입니다.',
  '상위 진척률·요약 바 집계는 **공수(workEffort) 비율**만 사용합니다(업무 구성비와 동일).',
  '형제 가중치 합이 100일 필요는 없습니다. 비율만 의미합니다.',
  '요약 행 공수는 직속 하위 공수 합으로 갱신됩니다.',
].join('\n');

/** 정렬 문구 제외 — 표 셀·일괄 수정 바 등에 공통 사용 */
export const PROGRESS_COLUMN_HELP_TEXT = [
  '진척률 0~100%. 리프(하위 없음) 행에는 직접 입력한 값이 저장됩니다.',
  '요약(하위 있음) 행에는 직접 자식들만 대상으로, **자식 공수 비율(업무 구성비)** 로 가중 평균이 자동 반영됩니다(Σ공수>0일 때; 요약 바「공수 가중」토글과 무관).',
  '완료(100%) 리프도 형제 대비 자신의 공수만큼만 상위 진척에 기여합니다.',
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
  workComposition:
    '같은 부모 아래 직속 형제 작업의 공수 합 대비, 이 행 공수가 차지하는 비율(%). 소수 첫째 자리까지 표시합니다. 최상위 행은 비웁니다. 상위 진척률 롤업과 동일한 공수 기준입니다.',
  weight: WEIGHT_COLUMN_HELP_TEXT,
  assignee: '담당자',
  allocation: '투입율 (%)',
  status: '작업 단계(미완료·완료). 단계 이름·색은 환경설정「표」탭의 상태 설정에서 바꿀 수 있습니다.',
  progress: PROGRESS_COLUMN_HELP_TEXT,
  plannedProgress: PLANNED_PROGRESS_COLUMN_HELP_TEXT,
  progressVariance: PROGRESS_VARIANCE_COLUMN_HELP_TEXT,
  deliverables: '산출물',
  dependencies: '선행작업(의존성)',
  actions: '작업 수정·삭제 등 관리 버튼',
};

/** 표 컬럼 표시·순서·너비를 바꾸는 방법 — 데이터 열 헤더 `title`에 공통 덧붙임 */
export const COLUMN_CONFIGURATION_HELP =
  '컬럼 표시·순서: 환경설정「표」탭의 표 필드(컬럼)에서 켜고 끄고 순서를 바꿉니다. 이 제목을 우클릭하면 이 열만 숨기기·숨긴 열 표시·좌우 이동·컬럼 추가를 할 수 있습니다. 제목 오른쪽 끝을 드래그하면 너비를 조절합니다. 작업명·상태 열은 항상 표시됩니다.';

function headerTitleWithSettingsHelp(coreTitle: string): string {
  return `${coreTitle} — ${COLUMN_CONFIGURATION_HELP}`;
}

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
  /** 정렬 클릭이 꺼져 있을 때: 열 전체(보이는 행) 셀 마퀴 선택 등 */
  onColClick?: (ev: React.MouseEvent) => void;
  /** 열 헤더 가로 드래그 재정렬(@dnd-kit) — 스프레드시트형 UX */
  columnDrag?: WbsColumnHeaderDragProps | null;
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
  onColClick,
  columnDrag,
}: HeaderCellProps) {
  const sortableHeaderClass = headerSortClickEnabled
    ? 'col-header cursor-pointer hover:text-[var(--color-ink)] transition-colors relative'
    : 'col-header relative';
  /** 정렬 비활성 + 열 클릭 선택: 시각적 피드백 */
  const inactivePointerClass =
    !headerSortClickEnabled && onColClick
      ? 'col-header relative cursor-pointer hover:text-[var(--color-ink)] transition-colors'
      : 'col-header relative';

  const H = (p: React.HTMLAttributes<HTMLDivElement>) => {
    if (!columnDrag) return <div {...p} />;
    const { ref: innerRef, className, style, title, ...r } = p;
    return (
      <div
        {...r}
        {...(columnDrag.listeners ?? {})}
        {...columnDrag.attributes}
        ref={mergeRefs(columnDrag.setNodeRef, innerRef)}
        style={{ ...(style && typeof style === 'object' ? style : {}), ...columnDrag.style }}
        className={cn(
          className,
          'cursor-grab active:cursor-grabbing',
          columnDrag.isDragging && 'relative z-[35] rounded-sm shadow-md ring-1 ring-[var(--color-accent)]/35',
        )}
        title={typeof title === 'string' ? `${title} · 드래그: 열 순서 이동` : title}
      />
    );
  };

  if (id.startsWith('custom:')) {
    return (
      <H
        className={inactivePointerClass}
        onClick={onColClick}
        onDoubleClick={onColDoubleClick}
        onContextMenu={onColContextMenu}
        title={headerTitleWithSettingsHelp(`${label ?? id} · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동`)}
      >
        {label ?? id}
        {resizeGrip}
      </H>
    );
  }
  switch (id) {
    case 'wbsId':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('wbs') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            headerSortClickEnabled
              ? 'WBS 순서 (클릭하여 정렬) · 더블클릭: 너비 자동'
              : 'WBS 순서 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴 · 더블클릭: 너비 자동',
          )}
        >
          WBS
          {resizeGrip}
        </H>
      );
    case 'name':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('name') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.name : '작업명 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          작업명
          {resizeGrip}
        </H>
      );
    case 'startDate':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('startDate') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.startDate : '시작일 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          시작일
          {resizeGrip}
        </H>
      );
    case 'endDate':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('endDate') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.endDate : '종료일 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          종료일
          {resizeGrip}
        </H>
      );
    case 'duration':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.duration + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          기간
          {resizeGrip}
        </H>
      );
    case 'workEffort':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('workEffort') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.workEffort : '공수 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          {workEffortHeaderTitle ?? '공수'}
          {resizeGrip}
        </H>
      );
    case 'workComposition':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.workComposition + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          업무구성(%)
          {resizeGrip}
        </H>
      );
    case 'weight':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('weight' as keyof Task) : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.weight : '가중치 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          가중치
          {resizeGrip}
        </H>
      );
    case 'progress':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('progress') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.progress : '진척률 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          진척(%)
          {resizeGrip}
        </H>
      );
    case 'plannedProgress':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.plannedProgress + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          계획(%)
          {resizeGrip}
        </H>
      );
    case 'progressVariance':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.progressVariance + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          차이(%p)
          {resizeGrip}
        </H>
      );
    case 'assignee':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('assignee') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.assignee : '담당자 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          담당자
          {resizeGrip}
        </H>
      );
    case 'allocation':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.allocation + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          투입율
          {resizeGrip}
        </H>
      );
    case 'status':
      return (
        <H
          className={headerSortClickEnabled ? sortableHeaderClass : inactivePointerClass}
          onClick={headerSortClickEnabled ? () => onSort('status') : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(
            (headerSortClickEnabled ? COLUMN_TOOLTIPS.status : '상태 · 클릭: 이 열 전체 선택 · 우클릭: 정렬·메뉴') +
              ' · 더블클릭: 너비 자동',
          )}
        >
          상태
          {resizeGrip}
        </H>
      );
    case 'deliverables':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.deliverables + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          산출물
          {resizeGrip}
        </H>
      );
    case 'dependencies':
      return (
        <H
          className={inactivePointerClass}
          onClick={headerSortClickEnabled ? undefined : onColClick}
          onDoubleClick={onColDoubleClick}
          onContextMenu={onColContextMenu}
          title={headerTitleWithSettingsHelp(COLUMN_TOOLTIPS.dependencies + ' · 클릭: 이 열 전체 선택 · 더블클릭: 너비 자동')}
        >
          선행작업
          {resizeGrip}
        </H>
      );
    default:
      return null;
  }
}
