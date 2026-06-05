import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Bug, Edit2, Trash2, ListChecks } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, type Project, type WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatDate, formatMonthDay, formatNum1, formatPercent1, round1, round2 } from '../lib/utils';
import { useOrganization } from '../context/OrganizationContext';
import { useLevelColors } from '../context/LevelColorsContext';
import { filterTasksForDependencyPicker, getActiveDependencyToken, hasDependencyCycle } from '../lib/dependencyPicker';
import { formatStoredWorkEffortForDisplay, normalizeWorkEffortUnit, workEffortUnitSuffixKo } from '../lib/workEffortUnits';
import { getTaskProgressRollupTooltip } from '../lib/rollups';
import { hasPlannedSchedule, progressVariance } from '../lib/plannedProgress';
import { plannedProgressDataCellTitle, progressVarianceDataCellTitle } from '../lib/plannedProgressTooltips';
import { useToast } from './Toast';
import {
  buildOrgMemberLabelMap,
  buildOrgMemberDisplayMetaMap,
  formatAssigneeDisplay,
  resolveAssigneeIfUniqueMatch,
  type PersonDisplayMeta,
} from '../lib/assigneeOptions';
import { type TableColumnId } from './wbsTableTypes';
import { delegateInlineEditColumnId } from '../lib/wbsReadonlyGridColumns';
import { PROGRESS_COLUMN_HELP_TEXT, WEIGHT_COLUMN_HELP_TEXT } from './WBSTable/HeaderCell';
import { clampAllocationPercentInt } from '../lib/personAllocations';
import { cellTextStyleToCss, mergeDoneLineThrough } from '../lib/cellTextStyle';
import { isComposingKeyEvent } from '../lib/ime';
import { commitWbsInlineNameEditFromDom } from '../lib/wbsInlineNameCommit';

/** 인라인 날짜 키패드 입력 정규화: 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY.MM.DD' | '2050년 7월 16일'(끝의 일·공백 허용) 등 → 'YYYY-MM-DD' (유효하지 않으면 ''). */
function normalizeYmdInput(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  // ISO 등 "2026-06-15T12:00:00Z" → 앞 10자만 (전부 숫자로만 파싱하면 8자리 규칙에 걸려 실패하던 버그)
  const head10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head10)) {
    const mi = parseInt(head10.slice(5, 7), 10);
    const di = parseInt(head10.slice(8, 10), 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) return head10;
  }
  let y = '';
  let m = '';
  let d = '';
  // 표시용 toLocaleDateString('ko-KR') 복붙은 "…년 …월 …일"로 끝나므로, 일 뒤 비숫자 접미사를 허용한다.
  const sep = s.match(/^(\d{4})\s*[^\d]\s*(\d{1,2})\s*[^\d]\s*(\d{1,2})\s*[^\d]*$/);
  const digits = s.replace(/[^0-9]/g, '');
  if (sep) {
    [, y, m, d] = sep;
  } else if (digits.length === 8) {
    y = digits.slice(0, 4);
    m = digits.slice(4, 6);
    d = digits.slice(6, 8);
  } else {
    return '';
  }
  const mm = m.padStart(2, '0');
  const dd = d.padStart(2, '0');
  const mi = parseInt(mm, 10);
  const di = parseInt(dd, 10);
  if (!(mi >= 1 && mi <= 12 && di >= 1 && di <= 31)) return '';
  return `${y}-${mm}-${dd}`;
}

/** taskId → 표에서의 순번(1부터) */
export type TaskIdToSeqNum = Map<string, number>;
/** 표에서의 순번(1부터) → taskId */
export type SeqNumToTaskId = Map<number, string>;

/** 다른 사용자의 셀 포커스 정보 (실시간 커서 표시용) */
export type OtherCellFocus = {
  userId: string;
  displayName: string;
  color: string;
  taskId: string;
  columnId: TableColumnId;
  ts: number;
};

/** 작업명 마우스 오버 시 표시할 상세 툴팁 텍스트 */
function getTaskDetailTooltip(
  task: Task | null | undefined,
  statusConfigs: Array<{ id: string; name: string; progress?: number }> | null | undefined,
  displayWbsMap: Map<string, string> | null | undefined,
  isCritical?: boolean,
  projectEffortUnitByProjectId?: Map<string, WorkEffortUnit>,
  displayMetaByName?: Map<string, PersonDisplayMeta>,
): string {
  if (!task) return '';
  const lines: string[] = [];
  const effortUnit = normalizeWorkEffortUnit(projectEffortUnitByProjectId?.get(task.projectId));
  const statusName = Array.isArray(statusConfigs) ? (statusConfigs.find((c) => c.id === task.status)?.name ?? task.status) : task.status;
  const assigneeText = formatAssigneeDisplay(task.assignee, displayMetaByName) || '—';
  lines.push(`작업명: ${task.name ?? ''}`);
  if (task.isMilestone) lines.push('유형: 마일스톤');
  if (task.isIssue) lines.push('이슈: 예');
  if (task.isActionItem) lines.push('액션 항목: 예');
  if (isCritical) lines.push('크리티컬 패스: 예');
  lines.push(`기간: ${formatDate(task.startDate)} ~ ${formatDate(task.endDate)}`);
  lines.push(
    `공수: ${
      task.workEffort != null
        ? `${formatStoredWorkEffortForDisplay(task.workEffort, effortUnit)} ${workEffortUnitSuffixKo(effortUnit)}`.trim()
        : '—'
    }`,
  );
  if (task.weight != null) lines.push(`가중치: ${formatNum1(task.weight)}`);
  lines.push(`담당: ${assigneeText}`);
  lines.push(`상태: ${statusName}`);
  lines.push(`진척률: ${typeof task.progress === 'number' ? `${formatPercent1(task.progress)}%` : '—'}`);
  if (task.description?.trim()) lines.push(`설명: ${task.description.trim()}`);
  if (task.deliverables?.trim()) lines.push(`산출물: ${task.deliverables.trim()}`);
  const deps = task.dependencies;
  if (deps && Array.isArray(deps) && deps.length > 0 && displayWbsMap) {
    const depLabels = deps.map((id) => (displayWbsMap.get(id) ? `#${displayWbsMap.get(id)}` : id));
    lines.push(`선행작업: ${depLabels.join(', ')}`);
  }
  return lines.join('\n');
}

export interface SortableTaskRowProps {
  key?: string | number;
  rowIndex: number;
  task: Task & { depth?: number };
  dropIndicator?: 'before' | 'after' | null;
  wbsId?: string;
  displayWbsId?: string;
  displayWbsMap: Map<string, string>;
  taskIdToSeqNum: TaskIdToSeqNum;
  seqNumToTaskId: SeqNumToTaskId;
  /** 체크박스 체크 상태 = 보라색 강조. 명시적 다중 선택(스페이스/Ctrl/Shift)만 토글한다. */
  isSelected: boolean;
  /** 단일 활성 행 (클릭/화살표/표↔간트 동기화) = 노란색(amber) 강조. 체크박스와는 별개. */
  isFocused: boolean;
  hasChildren: boolean;
  isTreeView: boolean;
  onSelect: (taskId: string, multi: boolean, range: boolean) => void;
  /** 행 클릭(비-Shift) 시 구간 선택 앵커 — Shift+행클릭 시 시작 행 */
  onSetRowAnchor?: (taskId: string) => void;
  /** 행 클릭 시 포커스만 이동 (선택/체크는 체크박스 클릭으로만) */
  onFocusRow?: (taskId: string) => void;
  canEdit: boolean;
  onEdit: (task: Task) => void;
  onDeleteClick: (taskId: string) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string, columnId?: 'progress' | 'status') => void;
  toggleExpand: (taskId: string) => void;
  gridStyle: React.CSSProperties;
  visibleColumnIds: TableColumnId[];
  showActionsColumn?: boolean;
  isInlineEditingName: boolean;
  setInlineEditingNameId: (id: string | null) => void;
  editingCell: { taskId: string; columnId: TableColumnId } | null;
  setEditingCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  setFocusedCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
  /** 요약 바 등에서 켜는 엑셀형 편집 모드(표 컨테이너 wbs-view-mode·Esc 순서용). 셀 시각 격자와 무관 */
  tableEditMode: boolean;
  allAssignees: string[];
  /** projectId → 프로젝트 등록 인원 + 해당 프로젝트 작업 담당자 목록 */
  assigneeOptionsByProjectId: Map<string, string[]>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  statusConfigs: Array<{ id: string; name: string; progress?: number }>;
  /** projectId → assignments (for showing allocation when task has no assignments) */
  projectAssignmentsByProjectId: Map<string, Array<{ assignee: string; allocationPercent: number }>>;
  allProjectTasks: Task[];
  updateProject: (id: string, updates: Partial<Project>) => void;
  criticalPathSet?: Set<string>;
  /** 담당자별로 한 번만 표기한 투입율 텍스트 (행 순서 기준) */
  allocationDisplayText?: string;
  /** taskId::columnId -> 다른 사용자의 포커스(셀 커서) 목록 */
  otherFocusByCellKey: Map<
    string,
    Array<{ userId: string; displayName: string; color: string; taskId: string; columnId: TableColumnId; ts: number }>
  >;
  customColumnNameById: Map<string, string>;
  /** projectId → 작업 공수 숫자의 단위 */
  projectEffortUnitByProjectId: Map<string, WorkEffortUnit>;
  /** projectId → 프로젝트 일정(시작·종료). 작업 일정이 벗어나면 경고 표시에 사용 */
  projectScheduleByProjectId?: Map<string, Pick<Project, 'startDate' | 'endDate'>>;
  /** true면 작업명 컬럼에 표시용 WBS 접두(예: P1)를 붙여 표시 */
  prependDisplayWbsToTaskName?: boolean;
  /** 진척률 셀 툴팁(요약 바와 같은 범위의 작업 집합) */
  rollupTooltipBaseTasks: Task[];
  /** 이 작업의 계획율(0~100). 부모에서 계산해 전달. 계획·진척차이 컬럼 표시에 사용 */
  plannedProgress?: number;
  /** false면 레벨 배경·완료 시 자동 취소선 등 숨김(셀 서식 도구로 넣은 취소선은 유지) */
  showTableAutoFormatting?: boolean;
}

function SortableTaskRowInner({
  rowIndex,
  task,
  dropIndicator,
  wbsId,
  displayWbsId,
  displayWbsMap,
  taskIdToSeqNum,
  seqNumToTaskId,
  isSelected,
  isFocused,
  hasChildren,
  isTreeView,
  onSelect,
  onSetRowAnchor,
  onFocusRow,
  canEdit,
  onEdit,
  onDeleteClick,
  onContextMenu,
  toggleExpand,
  gridStyle,
  visibleColumnIds,
  showActionsColumn = true,
  isInlineEditingName,
  setInlineEditingNameId,
  editingCell,
  setEditingCell,
  focusedCell,
  setFocusedCell,
  tableEditMode,
  allAssignees,
  assigneeOptionsByProjectId,
  updateTask,
  statusConfigs,
  projectAssignmentsByProjectId,
  allProjectTasks,
  updateProject,
  criticalPathSet,
  allocationDisplayText,
  otherFocusByCellKey,
  customColumnNameById,
  projectEffortUnitByProjectId,
  projectScheduleByProjectId: _projectScheduleByProjectId,
  prependDisplayWbsToTaskName = false,
  rollupTooltipBaseTasks,
  plannedProgress,
  showTableAutoFormatting = true,
}: SortableTaskRowProps) {
  const effortUnitForTask = normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(task.projectId));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });

  /** 그립뿐 아니라 행(작업명·빈 영역 등)에서도 드래그 시작 — 입력·버튼·링크는 제외 */
  const rowDragListeners = useMemo(() => {
    if (!canEdit || !listeners) return undefined;
    const raw = listeners as Record<string, unknown>;
    const rawPd = raw.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined;
    if (!rawPd) return listeners;
    return {
      ...listeners,
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        const t = e.target as HTMLElement | null;
        if (!t) return;
        if (t.closest('input, textarea, select, button, a, option, [role="listbox"], [role="option"], [data-deps-input="true"]')) return;
        rawPd(e);
      },
    };
  }, [canEdit, listeners]);

  const { orgMembers } = useOrganization();
  const { levelRowBg: levelRowBgCtx } = useLevelColors();

  /**
   * 단일 클릭 진입점: 행/셀 포커스만 옮긴다. 편집 진입은 더블클릭(beginEditNow)이나 F2/Enter로만.
   * (Excel 패턴의 2단계 진입은 사용자가 의도치 않게 편집 모드로 들어가는 경우가 잦아 제거)
   */
  const beginEdit = (columnId: TableColumnId) => {
    setFocusedCell({ taskId: task.id, columnId });
    onFocusRow?.(task.id);
    onSetRowAnchor?.(task.id);
  };

  /** 더블클릭/F2용: 권한이 있으면 즉시 인라인 편집 진입. 권한 없으면 포커스만. */
  const beginEditNow = (columnId: TableColumnId) => {
    setFocusedCell({ taskId: task.id, columnId });
    onFocusRow?.(task.id);
    onSetRowAnchor?.(task.id);
    if (!canEdit) return;
    if (columnId === 'name') {
      setInlineEditingNameId(task.id);
      setEditingCell(null);
    } else {
      if (isInlineEditingName && canEdit) {
        commitWbsInlineNameEditFromDom(task.id, [task], updateTask, canEdit);
      }
      setEditingCell({ taskId: task.id, columnId });
      setInlineEditingNameId(null);
    }
  };
  /** 편집은 시작하지 않고 포커스만 옮길 때 (status select / dependencies input의 click 등) */
  const beginFocus = (columnId: TableColumnId) => {
    setFocusedCell({ taskId: task.id, columnId });
    onFocusRow?.(task.id);
    onSetRowAnchor?.(task.id);
  };

  const visibleEditableColumnIds = useMemo(() => visibleColumnIds.filter((id) => id !== 'wbsId') as TableColumnId[], [visibleColumnIds]);

  /** 계획율·진척차이(파생) 셀: 더블클릭 시 실제 편집 가능한 컬럼으로 진입 */
  const beginEditNowResolved = (columnId: TableColumnId) => {
    beginEditNow(delegateInlineEditColumnId(columnId, visibleEditableColumnIds));
  };

  /**
   * 표 행의 레벨 배경색.
   * - 다크모드: 컨텍스트가 transparent 반환 (왼쪽 테두리로 레벨 구분)
   * - 라이트모드 + 하위 작업이 있는 요약(상위) 행: 사용자 정의(없으면 기본) 레벨 색을 칠해 계층 구분 강조
   * - 라이트모드 + 리프(말단) 행: 투명 → 요약행이 자연스럽게 도드라지도록
   */
  const rowLevelBg = (lev: number, hasKids: boolean) => (showTableAutoFormatting && hasKids ? levelRowBgCtx(lev) : 'transparent');
  const orgMemberNames = useMemo(() => orgMembers.map((m) => m.name), [orgMembers]);
  const orgMemberLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);
  const orgMemberDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  const doneStatusIdsForProgressTip = useMemo(
    () => new Set((statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id)),
    [statusConfigs],
  );
  const effortSuffix = workEffortUnitSuffixKo(effortUnitForTask);
  const weightColumnTooltip = useMemo(
    () =>
      [
        WEIGHT_COLUMN_HELP_TEXT,
        '',
        `이 프로젝트 공수 단위: ${effortSuffix} — 가중이 비어 있을 때 롤업에 쓰입니다.`,
        '가중이 큰 형제는 진척이 조금만 올라도 상위 평균에 크게 반영되고, 가중이 작은 형제는 덜 반영됩니다.',
        '',
        '클릭: 포커스 · 더블클릭 또는 F2: 편집',
      ].join('\n'),
    [effortSuffix],
  );
  const progressColumnTooltip = useMemo(
    () =>
      [
        PROGRESS_COLUMN_HELP_TEXT,
        '',
        '더블클릭 또는 F2: 편집 · 우클릭: 상태별 진척 갱신 메뉴.',
        '가중치가 비어 있는 자식은 롤업 시 공수를 가중으로 씁니다. 형제 간 가중 비율에 따라 상위 진척이 달라질 수 있습니다.',
        '',
        '— 아래는 이 행 기준 산식 상세 —',
        '',
        getTaskProgressRollupTooltip(task, rollupTooltipBaseTasks, doneStatusIdsForProgressTip),
      ].join('\n'),
    [task, rollupTooltipBaseTasks, doneStatusIdsForProgressTip],
  );

  /** 프로젝트 assignments에서 담당자명(트림) 기준으로 비율 합침 — 동일 이름 중복 시 마지막 값, 표시·편집 기본값과 일치 */
  const projectAllocPctByTrimmedName = useMemo(() => {
    const m = new Map<string, number>();
    if (!task.projectId) return m;
    const raw = projectAssignmentsByProjectId.get(task.projectId) ?? [];
    for (const a of raw) {
      const name = (a.assignee || '').trim();
      if (!name) continue;
      m.set(name, Number(a.allocationPercent) || 0);
    }
    return m;
  }, [task.projectId, projectAssignmentsByProjectId]);

  /** 투입율 인라인: 숫자 input의 즉시 클램프/빈값 처리로 입력이 막히는 것을 방지 — 편집 세션당 문자열 유지 */
  const assigneeTrimForAlloc = (task.assignee || '').trim();
  const primaryPercentForAlloc = assigneeTrimForAlloc ? (projectAllocPctByTrimmedName.get(assigneeTrimForAlloc) ?? 100) : 100;
  const isAllocEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'allocation';
  const [allocationEditStr, setAllocationEditStr] = useState('');
  const allocEditSessionRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isAllocEditing) {
      allocEditSessionRef.current = null;
      return;
    }
    const sessionKey = `${task.id}:allocation`;
    if (allocEditSessionRef.current !== sessionKey) {
      allocEditSessionRef.current = sessionKey;
      setAllocationEditStr(String(primaryPercentForAlloc));
    }
  }, [isAllocEditing, task.id, primaryPercentForAlloc]);

  // 의존(선행) 작업을 화면에 보이는 행과 보이지 않는(접힘/필터) 작업으로 분류.
  // 보이지 않는 작업은 표 행 번호가 없으므로 별도 표기(WBS 코드)로 노출하며,
  // 편집 시에도 잃어버리지 않도록 ID를 보존한다.
  const { visibleDepNums, hiddenDepIds, hiddenDepLabels } = useMemo(() => {
    const depIds = task.dependencies ?? [];
    const visibleNums: number[] = [];
    const hiddenIds: string[] = [];
    const hiddenLabels: string[] = [];
    for (const id of depIds) {
      const seq = taskIdToSeqNum.get(id);
      if (seq != null) {
        visibleNums.push(seq);
      } else {
        hiddenIds.push(id);
        const wbs = displayWbsMap?.get(id);
        hiddenLabels.push(wbs ? `#${wbs}` : `#${id.slice(0, 6)}`);
      }
    }
    visibleNums.sort((a, b) => a - b);
    return { visibleDepNums: visibleNums, hiddenDepIds: hiddenIds, hiddenDepLabels: hiddenLabels };
  }, [task.dependencies, taskIdToSeqNum, displayWbsMap]);

  const depsDisplayValue = useMemo(() => (visibleDepNums.length > 0 ? visibleDepNums.join(', ') : ''), [visibleDepNums]);

  const [depsInputValue, setDepsInputValue] = useState(depsDisplayValue);
  const [depsFocused, setDepsFocused] = useState(false);
  const [depPickIdx, setDepPickIdx] = useState(0);
  const { push: pushToast } = useToast();
  const projectPickCandidates = useMemo(
    () => allProjectTasks.filter((t) => t.projectId === task.projectId && t.id !== task.id),
    [allProjectTasks, task.projectId, task.id],
  );
  const depTokenTable = getActiveDependencyToken(depsInputValue ?? '');
  const depSuggestionsList = useMemo(
    () => filterTasksForDependencyPicker(projectPickCandidates, depTokenTable, displayWbsMap, { tableRowById: taskIdToSeqNum }, 12),
    [projectPickCandidates, depTokenTable, displayWbsMap, taskIdToSeqNum],
  );
  useEffect(() => {
    setDepPickIdx(0);
  }, [depTokenTable, depSuggestionsList.length]);
  useEffect(() => {
    if (!depsFocused) setDepsInputValue(depsDisplayValue);
  }, [depsDisplayValue, depsFocused]);

  const depth = task.depth || 0;
  const level = depth + 1;

  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const zebraOverlay = rowIndex % 2 === 1 ? (dark ? 'rgba(255,255,255,0.02)' : 'rgba(2, 6, 23, 0.03)') : 'transparent';

  const isDone = doneStatusIdsForProgressTip.has(task.status ?? '') || (typeof task.progress === 'number' && task.progress >= 100);
  const applyDoneAutoStrike = showTableAutoFormatting && isDone;

  // 다크/라이트 모드별 행 상태 색상(완료 행은 배경·스트립으로 구분하지 않고 셀 텍스트 취소선으로만 표시)
  const selectedBg = dark ? '#3b2e6b' : '#a5b4fc';
  const focusedBg = dark ? '#4a3a1a' : '#fff7ed';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isSelected ? selectedBg : isFocused ? focusedBg : rowLevelBg(level, hasChildren),
    backgroundImage: isSelected || isFocused ? undefined : `linear-gradient(${zebraOverlay}, ${zebraOverlay})`,
    // 좌측 색상 strip은 box-shadow inset으로 그린다. border-left는 grid container의 컨텐츠 영역을 우측으로 밀어
    // 헤더와 본문 컬럼 정렬을 어긋나게 하므로 사용하지 않음.
    ...(isSelected
      ? {
          boxShadow: dark
            ? 'inset 3px 0 0 0 rgb(147 51 234), inset 0 0 0 2px rgba(168, 85, 247, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4)'
            : 'inset 3px 0 0 0 rgb(147 51 234), inset 0 0 0 2px rgba(168, 85, 247, 0.7), 0 2px 6px rgba(147, 51, 234, 0.35)',
        }
      : {}),
    ...(isFocused && !isSelected
      ? {
          boxShadow: dark
            ? 'inset 3px 0 0 0 rgb(217 119 6), inset 0 0 0 1px rgba(245, 158, 11, 0.28), 0 1px 2px rgba(0, 0, 0, 0.25)'
            : 'inset 3px 0 0 0 rgb(249 115 22), inset 0 0 0 1px rgba(251 146 60, 0.35), 0 1px 2px rgba(234, 88, 12, 0.12)',
        }
      : {}),
    zIndex: isDragging ? 10 : isSelected || isFocused ? 2 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      {...attributes}
      {...(rowDragListeners ?? {})}
      className={cn(
        'data-row group outline-none transition-colors relative',
        canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        // 행 외곽 안쪽에 두꺼운 ring(box-shadow inset)을 두면 layout에는 영향이 없어도 컨텐츠가 안쪽에서 시작하는 듯한
        // 시각 인상이 강해져 헤더와 정렬이 어긋나 보였음. 좌측 strip(box-shadow inset 3px) + 배경색 강조만 남기고 ring 클래스는 제거.
        isSelected && (dark ? 'font-semibold text-purple-300' : 'font-semibold text-purple-900'),
        isFocused && !isSelected && (dark ? 'font-medium text-orange-200' : 'font-medium text-orange-950'),
        // 요약(상위)행 타이포 강조: 선택/포커스 상태가 아닐 때만 추가 (해당 상태가 우선)
        hasChildren && !isSelected && !isFocused && 'font-semibold',
        // 셀에 사용자 지정 글꼴 크기가 있으면 그 행은 높이를 자동 확장(고정 행 높이에 큰 글자가 잘리는 문제 보완)
        !!task.cellTextStyles &&
          Object.values(task.cellTextStyles).some((s) => typeof s?.fontSize === 'number' && (s.fontSize ?? 0) > 0) &&
          'wbs-cell-styled',
      )}
      // Shift/Ctrl/Meta 구간·다중 선택: click은 일부 컨트롤(날짜 등)에서 합성되지 않을 수 있어 pointerdown 캡처에서 처리한다.
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) return;
        if (e.shiftKey) {
          onSelect(task.id, false, true);
          onFocusRow?.(task.id);
        } else {
          onSelect(task.id, true, false);
          onFocusRow?.(task.id);
        }
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) return;
        if (onFocusRow) onFocusRow(task.id);
        onSetRowAnchor?.(task.id);
      }}
      tabIndex={0}
      onDoubleClick={() => {
        // 대부분 셀이 더블클릭을 stopPropagation 하므로, 실질적으로는 WBS 등 일부 영역에서만 도달.
        // 작업명은 아래 name 셀에서 직접 onEdit 호출.
        onEdit(task);
      }}
      onContextMenu={(e) => onContextMenu(e, task.id, undefined)}
    >
      {dropIndicator === 'before' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500 pointer-events-none z-10" aria-hidden />
      )}
      {dropIndicator === 'after' && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 pointer-events-none z-10" aria-hidden />
      )}
      <div
        className="data-cell justify-center text-slate-300 hover:text-slate-500 select-none"
        title={canEdit ? '행을 잡고 드래그해 목록에서 위·아래 순서를 바꿉니다' : undefined}
        aria-hidden
      >
        <GripVertical size={14} />
      </div>
      <div className="data-cell justify-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
            onSelect(task.id, true, false);
            // 체크박스만 눌러도 셀 포커스가 남아 있지 않으면 하단 서식 바가 안 뜨는 문제 방지 + 다중 선택 시 같은 열 서식 일괄 적용 기준 행 정렬
            setFocusedCell((prev) => ({
              taskId: task.id,
              columnId: prev?.columnId && prev.columnId !== 'wbsId' ? prev.columnId : (visibleEditableColumnIds[0] ?? 'name'),
            }));
          }}
          onChange={() => {
            // onClick에서 제어하므로 onChange는 비워 둔다.
          }}
        />
      </div>
      <div
        className="data-cell justify-center font-mono text-[10px] text-slate-500 tabular-nums"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFocusRow?.(task.id);
          onSetRowAnchor?.(task.id);
          onEdit(task);
        }}
      >
        {rowIndex + 1}
      </div>
      <div className="data-cell justify-center" onDoubleClick={(e) => e.stopPropagation()}>
        {isTreeView && hasChildren && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(task.id);
            }}
            className="rounded p-0.5 text-xs font-mono tabular-nums transition-colors hover:bg-slate-200 text-slate-600"
            title={task.expanded ? '접기' : '펼치기'}
          >
            {task.expanded ? '▣' : '□'}
          </button>
        )}
      </div>
      {visibleColumnIds.map((colId) => {
        const otherFocusKey = `${task.id}::${colId}`;
        const othersHere = otherFocusByCellKey.get(otherFocusKey) ?? [];
        const otherPrimary = othersHere[0];
        const otherRingStyle = otherPrimary ? ({ boxShadow: `inset 0 0 0 2px ${otherPrimary.color}` } as React.CSSProperties) : undefined;
        if (colId === 'wbsId') {
          return (
            <div
              key={colId}
              className={cn('data-cell font-mono text-[10px] text-slate-400 cursor-pointer', applyDoneAutoStrike && 'line-through')}
              onClick={() => {
                // wbsId 칸 클릭도 행 포커스로 동작 — 편집 가능한 첫 컬럼을 기본 포커스 셀로 지정
                const firstEditable = visibleColumnIds.find((c) => c !== 'wbsId') ?? 'name';
                onFocusRow?.(task.id);
                onSetRowAnchor?.(task.id);
                setFocusedCell({ taskId: task.id, columnId: firstEditable });
              }}
            >
              {wbsId}
            </div>
          );
        }
        const txtStyle = cellTextStyleToCss(task.cellTextStyles?.[colId]);
        if (colId === 'name') {
          const isFocused = focusedCell?.taskId === task.id && focusedCell?.columnId === 'name' && !isInlineEditingName;
          const displayWbsPrefix = (displayWbsId && String(displayWbsId).trim()) || '';
          const rawName = (task.name ?? '').trim();
          const tableNameLabel =
            prependDisplayWbsToTaskName && displayWbsPrefix ? (rawName ? `${displayWbsPrefix} ${rawName}` : displayWbsPrefix) : rawName;
          return (
            <div
              key={colId}
              className={cn('data-cell relative', isFocused && 'ring-2 ring-indigo-500 ring-inset')}
              style={{ ...(otherRingStyle ?? {}), paddingLeft: `${depth * 20 + 12}px` }}
              onClick={(e) => {
                // 다른 행이면 1단계 포커스만; 같은 행 포커스 시 2단계에서 인라인 편집·편집 모드 진입.
                // 트리 접기/펼치기는 전용 ▣/□ 버튼으로만 수행.
                // 이미 작업명 input이 떠 있으면 중복 beginEdit 방지 (버블링된 클릭 등).
                e.stopPropagation();
                if (isInlineEditingName) return;
                beginEdit('name');
              }}
              onDoubleClick={(e) => {
                // 더블클릭: 상세(TaskModal). 작업명 인라인 편집은 F2(키보드)로 진입.
                if (isInlineEditingName) return;
                e.stopPropagation();
                onFocusRow?.(task.id);
                onSetRowAnchor?.(task.id);
                onEdit(task);
              }}
              title={getTaskDetailTooltip(
                task,
                statusConfigs,
                displayWbsMap,
                criticalPathSet?.has(task.id),
                projectEffortUnitByProjectId,
                orgMemberDisplayMetaByName,
              )}
            >
              {isInlineEditingName ? (
                <input
                  id={`wbs-edit-${task.id}-name`}
                  autoFocus
                  defaultValue={task.name}
                  className="w-full min-h-[28px] text-sm font-bold bg-white text-indigo-600 outline-none ring-1 ring-indigo-500 rounded px-1"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPaste={(e) => {
                    e.stopPropagation();
                    // 브라우저 기본 붙여넣기로 input 값이 갱신된 뒤 커밋·편집 종료 (포커스가 표로 나가 ↑/↓가 행 이동으로 가는 문제 방지)
                    setTimeout(() => {
                      commitWbsInlineNameEditFromDom(task.id, tasks, updateTask, canEdit);
                      setInlineEditingNameId(null);
                      setEditingCell(null);
                      setFocusedCell({ taskId: task.id, columnId: 'name' });
                      onFocusRow?.(task.id);
                      requestAnimationFrame(() => {
                        (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
                      });
                    }, 0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (isComposingKeyEvent(e.nativeEvent)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      commitWbsInlineNameEditFromDom(task.id, tasks, updateTask, canEdit);
                      setInlineEditingNameId(null);
                      setEditingCell(null);
                      setFocusedCell({ taskId: task.id, columnId: 'name' });
                      onFocusRow?.(task.id);
                      requestAnimationFrame(() => {
                        (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
                      });
                    } else if (e.key === 'Escape') {
                      setInlineEditingNameId(null);
                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    } else if (e.key === ' ') {
                      // 전역 표 단축키(Space=체크 토글)가 bubble되면 띄어쓰기가 막힐 수 있음
                      e.stopPropagation();
                    }
                  }}
                />
              ) : (
                <span
                  className="font-medium text-[var(--color-ink)] flex min-w-0 max-w-full items-center gap-1.5 cursor-cell overflow-hidden"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('name');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onFocusRow?.(task.id);
                    onSetRowAnchor?.(task.id);
                    onEdit(task);
                  }}
                  title={getTaskDetailTooltip(
                    task,
                    statusConfigs,
                    displayWbsMap,
                    criticalPathSet?.has(task.id),
                    projectEffortUnitByProjectId,
                    orgMemberDisplayMetaByName,
                  )}
                >
                  {task.isIssue && <Bug size={14} className="text-rose-600 flex-shrink-0" title="이슈" />}
                  {task.isActionItem && <ListChecks size={14} className="text-teal-600 flex-shrink-0" title="액션 항목" />}
                  {criticalPathSet?.has(task.id) && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0"
                      title="크리티컬 패스"
                    >
                      크리티컬
                    </span>
                  )}
                  <span className="min-w-0 truncate" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                    {tableNameLabel ? (
                      tableNameLabel
                    ) : (
                      <span className="italic text-slate-400 font-normal select-none">(더블클릭: 상세 · F2로 작업명 입력)</span>
                    )}
                  </span>
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-slate-200 shadow-sm pointer-events-none"
                  style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
                  title={othersHere.map((o) => o.displayName).join(', ')}
                >
                  {otherPrimary.displayName}
                  {othersHere.length > 1 ? ` +${othersHere.length - 1}` : ''}
                </div>
              )}
            </div>
          );
        }
        if (colId === 'startDate') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'startDate';
          const isFocused = focusedCell?.taskId === task.id && focusedCell?.columnId === 'startDate' && !isEditing;
          const commitStartDateIfChanged = (raw: string) => {
            const v = normalizeYmdInput(raw);
            if (!v || v === (task.startDate?.slice(0, 10) ?? '')) return;
            updateTask(task.id, { startDate: v + (task.startDate?.slice(10) || '') });
          };
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                isFocused && 'ring-2 ring-indigo-500 ring-inset',
              )}
              style={otherRingStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('startDate');
              }}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-startDate`}
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  defaultValue={task.startDate ? task.startDate.slice(0, 10) : ''}
                  placeholder="YYYY-MM-DD"
                  title="키패드로 입력: 2026-07-15 또는 20260715 (Enter 확정)"
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    commitStartDateIfChanged(e.target.value);
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // window 레벨 keydown 핸들러(useWbsTableKeyboard)와의 race로
                      // onBlur가 실행되기 전에 input이 unmount되는 경우가 있어 직접 커밋한다.
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                      commitStartDateIfChanged((e.target as HTMLInputElement).value);
                      setEditingCell(null);
                    } else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <span className="flex w-full min-w-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded px-1 -mx-1 min-w-0 flex-1 text-left cursor-cell hover:bg-indigo-50/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEdit('startDate');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNow('startDate');
                    }}
                    onFocus={(e) => {
                      e.stopPropagation();
                      beginEdit('startDate');
                    }}
                    title={`${formatDate(task.startDate) || '시작일 없음'} · 클릭: 포커스 · 더블클릭 또는 F2: 날짜 편집(연도 포함)`}
                  >
                    <span className="inline-flex items-center gap-0.5 min-w-0" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                      {formatMonthDay(task.startDate)}
                    </span>
                  </button>
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-slate-200 shadow-sm pointer-events-none"
                  style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
                  title={othersHere.map((o) => o.displayName).join(', ')}
                >
                  {otherPrimary.displayName}
                </div>
              )}
            </div>
          );
        }
        if (colId === 'endDate') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'endDate';
          const isFocusedEnd = focusedCell?.taskId === task.id && focusedCell?.columnId === 'endDate' && !isEditing;
          const commitEndDateIfChanged = (raw: string) => {
            const v = normalizeYmdInput(raw);
            if (!v || v === (task.endDate?.slice(0, 10) ?? '')) return;
            updateTask(task.id, { endDate: v + (task.endDate?.slice(10) || '') });
          };
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                isFocusedEnd && 'ring-2 ring-indigo-500 ring-inset',
              )}
              style={otherRingStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('endDate');
              }}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-endDate`}
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  defaultValue={task.endDate ? task.endDate.slice(0, 10) : ''}
                  placeholder="YYYY-MM-DD"
                  title="키패드로 입력: 2026-07-15 또는 20260715 (Enter 확정)"
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    commitEndDateIfChanged(e.target.value);
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                      commitEndDateIfChanged((e.target as HTMLInputElement).value);
                      setEditingCell(null);
                    } else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <span className="flex w-full min-w-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded px-1 -mx-1 min-w-0 flex-1 text-left cursor-cell hover:bg-indigo-50/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEdit('endDate');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNow('endDate');
                    }}
                    onFocus={(e) => {
                      e.stopPropagation();
                      beginEdit('endDate');
                    }}
                    title={`${formatDate(task.endDate) || '종료일 없음'} · 클릭: 포커스 · 더블클릭 또는 F2: 날짜 편집(연도 포함)`}
                  >
                    <span className="inline-flex items-center gap-0.5 min-w-0" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                      {formatMonthDay(task.endDate)}
                    </span>
                  </button>
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-slate-200 shadow-sm pointer-events-none"
                  style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
                  title={othersHere.map((o) => o.displayName).join(', ')}
                >
                  {otherPrimary.displayName}
                </div>
              )}
            </div>
          );
        }
        if (colId === 'workEffort') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'workEffort';
          const isFocusedWE = focusedCell?.taskId === task.id && focusedCell?.columnId === 'workEffort' && !isEditing;
          const effortStep = effortUnitForTask === 'minute' ? 1 : 0.5;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                isFocusedWE && 'ring-2 ring-indigo-500 ring-inset',
              )}
              style={otherRingStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('workEffort');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('workEffort');
              }}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-workEffort`}
                  type="number"
                  min={0}
                  step={effortStep}
                  autoFocus
                  defaultValue={task.workEffort ?? ''}
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0) {
                      const rounded = effortUnitForTask === 'minute' ? Math.round(v) : Math.round(v * 10) / 10;
                      if (rounded !== (task.workEffort ?? NaN)) updateTask(task.id, { workEffort: rounded });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <span className="flex w-full min-w-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded px-1 -mx-1 min-w-0 flex-1 text-left cursor-cell hover:bg-indigo-50/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEdit('workEffort');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNow('workEffort');
                    }}
                    onFocus={(e) => {
                      e.stopPropagation();
                      beginEdit('workEffort');
                    }}
                    title={`클릭하여 공수 수정 (${workEffortUnitSuffixKo(effortUnitForTask)})`}
                  >
                    <span className="inline-flex items-center gap-0.5 min-w-0" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                      {task.workEffort != null ? formatStoredWorkEffortForDisplay(task.workEffort, effortUnitForTask) : '-'}
                    </span>
                  </button>
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-slate-200 shadow-sm pointer-events-none"
                  style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
                >
                  {otherPrimary.displayName}
                </div>
              )}
            </div>
          );
        }
        if (colId === 'weight') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'weight';
          const isFocusedW = focusedCell?.taskId === task.id && focusedCell?.columnId === 'weight' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                isFocusedW && 'ring-2 ring-indigo-500 ring-inset',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('weight');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('weight');
              }}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-weight`}
                  type="number"
                  min={0}
                  step={0.1}
                  autoFocus
                  defaultValue={task.weight ?? ''}
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0) {
                      const rounded = round1(v);
                      if (rounded !== (task.weight ?? NaN)) updateTask(task.id, { weight: rounded });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rounded px-1 -mx-1 w-full text-left cursor-cell hover:bg-indigo-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('weight');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEditNow('weight');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('weight');
                  }}
                  title={weightColumnTooltip}
                >
                  <span style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                    {task.weight != null ? formatNum1(task.weight) : '-'}
                  </span>
                </button>
              )}
            </div>
          );
        }
        if (colId === 'progress') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'progress';
          const isFocusedProg = focusedCell?.taskId === task.id && focusedCell?.columnId === 'progress' && !isEditing;
          return (
            <div
              key={colId}
              className={cn('data-cell font-mono text-xs text-slate-600 min-w-0', isFocusedProg && 'ring-2 ring-indigo-500 ring-inset')}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'progress');
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('progress');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('progress');
              }}
              title={progressColumnTooltip}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-progress`}
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  autoFocus
                  defaultValue={typeof task.progress === 'number' ? task.progress : ''}
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0 && v <= 100) {
                      const rounded = round2(v);
                      if (rounded !== (task.progress ?? NaN)) updateTask(task.id, { progress: rounded });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <span
                  className="px-1 inline-block w-full min-w-0 text-left truncate tabular-nums"
                  style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}
                >
                  {typeof task.progress === 'number' && Number.isFinite(task.progress) ? `${formatPercent1(task.progress)}%` : '—'}
                </span>
              )}
            </div>
          );
        }
        if (colId === 'plannedProgress') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'plannedProgress';
          const isFocusedPlanned = focusedCell?.taskId === task.id && focusedCell?.columnId === 'plannedProgress' && !isEditing;
          const hasManualPlanned = typeof task.plannedProgressOverride === 'number' && Number.isFinite(task.plannedProgressOverride);
          const computable = hasChildren || hasPlannedSchedule(task) || hasManualPlanned;
          const planned = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress) ? plannedProgress : 0;
          const plannedFmt = formatPercent1(planned);
          return (
            <div
              key={colId}
              className={cn('data-cell font-mono text-xs text-slate-600 min-w-0', isFocusedPlanned && 'ring-2 ring-indigo-500 ring-inset')}
              style={otherRingStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('plannedProgress');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('plannedProgress');
              }}
              title={[
                computable
                  ? [plannedProgressDataCellTitle(plannedFmt), hasManualPlanned ? '(이 행은 계획율 수동 지정이 적용되어 있습니다.)' : '']
                      .filter(Boolean)
                      .join(' ')
                  : '계획 일정이 없어 계획율을 계산할 수 없습니다. 시작·종료(또는 베이스라인)를 넣으면 영업일 기준으로 산정됩니다.',
                '',
                '클릭: 셀 포커스 · 더블클릭 또는 F2: 계획율 수동 지정 편집',
              ].join('\n')}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-plannedProgress`}
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  autoFocus
                  defaultValue={typeof task.plannedProgressOverride === 'number' ? task.plannedProgressOverride : ''}
                  placeholder="수동 계획율 (%)"
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val === '') {
                      updateTask(task.id, { plannedProgressOverride: null });
                    } else {
                      const v = parseFloat(val);
                      if (!isNaN(v) && v >= 0 && v <= 100) {
                        const rounded = round2(v);
                        if (rounded !== (task.plannedProgressOverride ?? NaN)) {
                          updateTask(task.id, { plannedProgressOverride: rounded });
                        }
                      }
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent.stopPropagation();
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val === '') {
                        updateTask(task.id, { plannedProgressOverride: null });
                      } else {
                        const v = parseFloat(val);
                        if (!isNaN(v) && v >= 0 && v <= 100) {
                          const rounded = round2(v);
                          if (rounded !== (task.plannedProgressOverride ?? NaN)) {
                            updateTask(task.id, { plannedProgressOverride: rounded });
                          }
                        }
                      }
                      setEditingCell(null);
                    } else if (e.key === 'Escape') {
                      setEditingCell(null);
                    }
                  }}
                />
              ) : (
                <span className="px-1 inline-block w-full text-left truncate" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                  {computable ? `${plannedFmt}%` : '—'}
                </span>
              )}
            </div>
          );
        }
        if (colId === 'progressVariance') {
          const hasManualPlanned = typeof task.plannedProgressOverride === 'number' && Number.isFinite(task.plannedProgressOverride);
          const computable = hasChildren || hasPlannedSchedule(task) || hasManualPlanned;
          const planned = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress) ? plannedProgress : 0;
          const actual = typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : 0;
          const variance = progressVariance(actual, planned);
          const rounded = round1(variance);
          const color = !computable ? 'text-slate-400' : rounded < 0 ? 'text-red-600' : rounded > 0 ? 'text-emerald-600' : 'text-slate-500';
          const sign = rounded > 0 ? '+' : '';
          const label = rounded < 0 ? '계획 대비 지연' : rounded > 0 ? '계획보다 앞섬' : '계획대로';
          const actFmt = formatPercent1(actual);
          const plFmt = formatPercent1(planned);
          const varFmt = formatPercent1(variance);
          const isFocusedVar = focusedCell?.taskId === task.id && focusedCell?.columnId === 'progressVariance';
          return (
            <div
              key={colId}
              className={cn(
                'data-cell font-mono text-xs min-w-0 cursor-cell',
                !txtStyle.color && color,
                isFocusedVar && 'ring-2 ring-indigo-500 ring-inset',
              )}
              style={otherRingStyle}
              title={[
                computable
                  ? progressVarianceDataCellTitle(`${sign}${varFmt}`, `${actFmt}%`, `${plFmt}%`, label)
                  : '계획 일정이 없어 진척차이를 계산할 수 없습니다. 차이(%p)=실제 진척−계획율이며, 계획율은 일정에서만 산정됩니다.',
                '',
                '클릭: 셀 포커스 · 더블클릭 또는 F2: 실제 진척률 편집',
              ].join('\n')}
              onClick={(e) => {
                e.stopPropagation();
                beginEdit('progressVariance');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginEditNowResolved('progressVariance');
              }}
            >
              <span className="px-1 inline-block w-full text-left truncate" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                {computable ? `${sign}${varFmt}%p` : '—'}
              </span>
            </div>
          );
        }
        if (colId === 'assignee') {
          const projectAssignees = (task.projectId ? assigneeOptionsByProjectId.get(task.projectId) : []) ?? [];
          const assigneeOptions = Array.from(new Set([...projectAssignees, task.assignee?.trim(), ...orgMemberNames].filter(Boolean))).sort(
            (a, b) => a.localeCompare(b, 'ko'),
          );
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'assignee';
          const isFocusedAssignee = focusedCell?.taskId === task.id && focusedCell?.columnId === 'assignee' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell text-xs text-slate-600 relative overflow-visible group/assignee',
                isFocusedAssignee && 'ring-2 ring-indigo-500 ring-inset',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('assignee');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginEditNow('assignee');
              }}
            >
              {isEditing ? (
                <>
                  <input
                    id={`wbs-edit-${task.id}-assignee`}
                    type="text"
                    list={`assignee-datalist-${task.id}`}
                    autoFocus
                    defaultValue={task.assignee || ''}
                    placeholder="배정 ..."
                    className="w-full bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none pr-6"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (task.assignee || '').trim()) {
                        updateTask(task.id, { assignee: v });
                      }
                      setEditingCell(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const el = e.currentTarget;
                        const opts = assigneeOptions.length > 0 ? assigneeOptions : allAssignees;
                        const picked = resolveAssigneeIfUniqueMatch(el.value, opts);
                        if (picked) el.value = picked;
                        el.blur();
                        e.preventDefault();
                      }
                      if (e.key === 'Escape') {
                        setEditingCell(null);
                        e.preventDefault();
                      }
                      // 행(sortable)·표 전역 키보드로 버블되면 화살표가 정렬/행 이동으로 잡힐 수 있음
                      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
                        e.stopPropagation();
                      }
                    }}
                  />
                  <datalist id={`assignee-datalist-${task.id}`}>
                    <option value="">배정 안됨</option>
                    {(assigneeOptions.length > 0 ? assigneeOptions : allAssignees).map((a) => {
                      const info = orgMemberLabelByName.get(a);
                      return info ? <option key={a} value={a} label={info} /> : <option key={a} value={a} />;
                    })}
                  </datalist>
                </>
              ) : (
                <>
                  <div
                    className={cn('w-full px-1 py-0.5 truncate', !txtStyle.color && (task.assignee ? 'text-slate-600' : 'text-slate-400'))}
                    style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}
                    title={formatAssigneeDisplay(task.assignee, orgMemberDisplayMetaByName) || '배정 안됨'}
                  >
                    {(task.assignee || '').trim() || '배정 ...'}
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center px-1 text-slate-400 group-hover/assignee:text-slate-600">
                    <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                    </svg>
                  </div>
                </>
              )}
            </div>
          );
        }
        if (colId === 'allocation') {
          const isEditing = isAllocEditing;
          const isFocusedAlloc = focusedCell?.taskId === task.id && focusedCell?.columnId === 'allocation' && !isEditing;
          const persistAllocation = (rawStr: string) => {
            if (!task.projectId) return;
            if (!assigneeTrimForAlloc) {
              pushToast('투입율을 저장하려면 먼저 담당자를 지정해 주세요.', { variant: 'warning' });
              return;
            }
            const trimmed = rawStr.trim();
            const raw = trimmed === '' ? 100 : parseFloat(trimmed);
            if (!Number.isFinite(raw)) return;
            const pct = clampAllocationPercentInt(raw);
            const list = [...(projectAssignmentsByProjectId.get(task.projectId) ?? [])].filter(
              (a) => (a.assignee || '').trim() !== assigneeTrimForAlloc,
            );
            list.push({ assignee: assigneeTrimForAlloc, allocationPercent: pct });
            updateProject(task.projectId, { assignments: list });
          };
          return (
            <div
              key={colId}
              className={cn('data-cell font-mono text-xs text-slate-600 min-w-0', isFocusedAlloc && 'ring-2 ring-indigo-500 ring-inset')}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('allocation');
              }}
              title="클릭하여 투입율 수정"
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-allocation`}
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={allocationEditStr}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === '' || /^\d*$/.test(next)) setAllocationEditStr(next);
                  }}
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={() => {
                    persistAllocation(allocationEditStr);
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rounded px-1 -mx-1 inline-block w-full text-left cursor-cell hover:bg-indigo-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('allocation');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEditNow('allocation');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('allocation');
                  }}
                >
                  <span style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>{allocationDisplayText ?? '—'}</span>
                </button>
              )}
            </div>
          );
        }
        if (colId === 'status') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'status';
          const isFocusedStatus = focusedCell?.taskId === task.id && focusedCell?.columnId === 'status' && !isEditing;
          const currentStatusName = statusConfigs.find((c) => c.id === task.status)?.name ?? task.status ?? '—';
          return (
            <div
              key={colId}
              className={cn('data-cell', isFocusedStatus && 'ring-2 ring-indigo-500 ring-inset rounded')}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('status');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('status');
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'status');
              }}
            >
              {isEditing ? (
                <select
                  id={`wbs-edit-${task.id}-status`}
                  value={task.status}
                  autoFocus
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    if (newStatus !== task.status) {
                      const config = statusConfigs.find((c) => c.id === newStatus);
                      const updates: Partial<Task> = { status: newStatus };
                      if (config && config.progress !== undefined) {
                        updates.progress = config.progress;
                      }
                      updateTask(task.id, updates);
                    }
                    setEditingCell(null);
                  }}
                  onBlur={() => setEditingCell(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' || e.key === 'Enter') {
                      setEditingCell(null);
                      (e.target as HTMLSelectElement).blur();
                    }
                  }}
                  className="w-full bg-white p-1 ring-1 ring-indigo-500 rounded border border-transparent appearance-none text-xs"
                >
                  {statusConfigs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="w-full text-left rounded px-1 -mx-1 cursor-cell hover:bg-indigo-50/80 truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('status');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEditNow('status');
                  }}
                  title="더블클릭 또는 F2로 상태 수정"
                >
                  <span className="truncate block" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                    {currentStatusName}
                  </span>
                </button>
              )}
            </div>
          );
        }
        if (colId === 'deliverables') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'deliverables';
          const isFocusedDel = focusedCell?.taskId === task.id && focusedCell?.columnId === 'deliverables' && !isEditing;
          return (
            <div
              key={colId}
              className={cn('data-cell text-xs text-slate-600 min-w-0', isFocusedDel && 'ring-2 ring-indigo-500 ring-inset')}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('deliverables');
              }}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-deliverables`}
                  type="text"
                  autoFocus
                  defaultValue={task.deliverables ?? ''}
                  placeholder="산출물"
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (task.deliverables ?? '').trim()) {
                      updateTask(task.id, { deliverables: v || undefined });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rounded px-1 -mx-1 block truncate w-full text-left cursor-cell hover:bg-indigo-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('deliverables');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEditNow('deliverables');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('deliverables');
                  }}
                  title={(task.deliverables || '').trim() || '클릭하여 산출물 수정'}
                >
                  <span style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>{task.deliverables || '-'}</span>
                </button>
              )}
            </div>
          );
        }
        if (colId === 'dependencies') {
          const selfSeq = rowIndex + 1;
          const applyDependenciesInput = (raw: string | undefined) => {
            const parts = (typeof raw === 'string' ? raw : '')
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (
              parts.some((p) => {
                const n = parseInt(p, 10);
                return !Number.isFinite(n) || n < 1;
              })
            ) {
              setDepsInputValue(depsDisplayValue);
              return;
            }
            const taskIds: string[] = [];
            const seen = new Set<string>();
            const seenNums = new Set<number>();
            for (const p of parts) {
              const n = parseInt(p, 10);
              if (!Number.isFinite(n) || n < 1 || seenNums.has(n) || n === selfSeq) continue;
              seenNums.add(n);
              const id = seqNumToTaskId.get(n);
              if (id && !seen.has(id)) {
                seen.add(id);
                taskIds.push(id);
              }
            }
            // 접힘/필터로 화면에 보이지 않는 기존 선행작업도 유지(편집 시 손실 방지)
            for (const id of hiddenDepIds) {
              if (!seen.has(id)) {
                seen.add(id);
                taskIds.push(id);
              }
            }
            const prevDeps = task.dependencies ?? [];
            const sameLength = prevDeps.length === taskIds.length;
            const noChange = sameLength && prevDeps.every((id, i) => id === taskIds[i]);
            if (noChange) return;
            updateTask(task.id, { dependencies: taskIds });
          };
          const applyPickDependency = (pickedId: string) => {
            if (pickedId === task.id) return;
            const raw = depsInputValue ?? '';
            const lastComma = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('，'));
            const headPart = lastComma >= 0 ? raw.slice(0, lastComma) : '';
            const parts = headPart
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            const taskIds: string[] = [];
            const seen = new Set<string>();
            const seenNums = new Set<number>();
            for (const p of parts) {
              const n = parseInt(p, 10);
              if (!Number.isFinite(n) || n < 1 || seenNums.has(n) || n === selfSeq) continue;
              seenNums.add(n);
              const id = seqNumToTaskId.get(n);
              if (id && !seen.has(id)) {
                seen.add(id);
                taskIds.push(id);
              }
            }
            if (!seen.has(pickedId)) {
              seen.add(pickedId);
              taskIds.push(pickedId);
            }
            for (const id of hiddenDepIds) {
              if (!seen.has(id)) {
                seen.add(id);
                taskIds.push(id);
              }
            }
            const projectTasks = tasks.filter((t) => t.projectId === task.projectId);
            if (hasDependencyCycle(projectTasks, task.id, taskIds)) {
              pushToast('순환 의존관계가 발견되어 반영하지 않았습니다.', { variant: 'warning' });
              return;
            }
            const prevDeps = task.dependencies ?? [];
            const sameLength = prevDeps.length === taskIds.length;
            const noChange = sameLength && prevDeps.every((id, i) => id === taskIds[i]);
            if (noChange) return;
            updateTask(task.id, { dependencies: taskIds });
            const visibleNums = taskIds
              .map((tid) => taskIdToSeqNum.get(tid))
              .filter((n): n is number => n != null)
              .sort((a, b) => a - b);
            setDepsInputValue(visibleNums.join(', '));
          };
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'dependencies';
          const isFocusedDep = focusedCell?.taskId === task.id && focusedCell?.columnId === 'dependencies' && !isEditing;
          // 드롭다운은 편집 중이고 input이 실제 포커스됐을 때만 열림.
          const depsMenuOpen = isEditing && depsFocused && depSuggestionsList.length > 0;
          const visibleDepNums = (task.dependencies ?? [])
            .map((tid) => taskIdToSeqNum.get(tid))
            .filter((n): n is number => n != null)
            .sort((a, b) => a - b);
          const depsDisplayText = visibleDepNums.length > 0 ? visibleDepNums.join(', ') : '-';
          // 표 셀의 .data-cell(overflow:hidden) + 표 컨테이너(overflow:auto)에 갇혀 드롭다운이 잘리는 것을
          // 막기 위해 Portal로 body에 렌더링하고 input의 위치를 추적해 따라가게 한다.
          const renderDepsDropdown = depsMenuOpen
            ? createPortal(
                <DepsPortalDropdown
                  inputId={`wbs-edit-${task.id}-dependencies`}
                  items={depSuggestionsList}
                  pickIdx={depPickIdx}
                  setPickIdx={setDepPickIdx}
                  onPick={(id) => applyPickDependency(id)}
                  taskIdToSeqNum={taskIdToSeqNum}
                  displayWbsMap={displayWbsMap}
                />,
                document.body,
              )
            : null;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell text-xs text-slate-600 font-mono flex items-center gap-1 min-w-0 relative',
                depsMenuOpen && 'z-20 overflow-visible',
                isFocusedDep && 'ring-2 ring-indigo-500 ring-inset rounded',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('dependencies');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEditNow('dependencies');
              }}
              title={
                hiddenDepLabels.length > 0
                  ? `행 번호 또는 작업명 검색 후 선택. 접힘/필터로 보이지 않는 선행작업: ${hiddenDepLabels.join(', ')}`
                  : '더블클릭 또는 F2로 선행작업 수정'
              }
            >
              {isEditing ? (
                <div className="relative min-w-0 flex-1">
                  <input
                    id={`wbs-edit-${task.id}-dependencies`}
                    data-deps-input="true"
                    type="text"
                    autoFocus
                    value={depsInputValue ?? ''}
                    onChange={(e) => setDepsInputValue(e.target.value)}
                    tabIndex={0}
                    onFocus={() => {
                      beginFocus('dependencies');
                      setDepsFocused(true);
                    }}
                    onBlur={() => {
                      setDepsFocused(false);
                      applyDependenciesInput((depsInputValue ?? '').trim());
                      setEditingCell(null);
                    }}
                    onKeyDown={(e) => {
                      if (depSuggestionsList.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDepPickIdx((i) => {
                          const len = depSuggestionsList.length;
                          if (e.key === 'ArrowDown') return Math.min(len - 1, i + 1);
                          return Math.max(0, i - 1);
                        });
                        return;
                      }
                      if (depSuggestionsList.length > 0 && e.key === 'Enter' && depPickIdx >= 0 && depPickIdx < depSuggestionsList.length) {
                        e.preventDefault();
                        e.stopPropagation();
                        applyPickDependency(depSuggestionsList[depPickIdx]!.id);
                        // Enter로 픽한 후에는 편집 모드를 종료해 다른 셀처럼 화살표로 자유롭게 이동 가능.
                        // (드롭다운에서 마우스 클릭으로 픽한 경우는 그대로 유지 — 연속 선택 가능)
                        setDepsFocused(false);
                        setEditingCell(null);
                        e.currentTarget.blur();
                        return;
                      }
                      if (e.key === 'Enter') {
                        setDepsFocused(false);
                        applyDependenciesInput((depsInputValue ?? '').trim());
                        setEditingCell(null);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="번호 또는 이름…"
                    className="w-full min-w-0 bg-white p-1 font-mono text-inherit border border-indigo-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 rounded focus:outline-none"
                    autoComplete="off"
                  />
                  {renderDepsDropdown}
                </div>
              ) : (
                <span className="flex w-full min-w-0 items-center gap-0.5 font-mono">
                  <button
                    type="button"
                    className="rounded px-1 -mx-1 min-w-0 flex-1 truncate text-left cursor-cell hover:bg-indigo-50/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      beginEdit('dependencies');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNow('dependencies');
                    }}
                    title="더블클릭 또는 F2로 선행작업 수정"
                  >
                    <span className="block truncate" style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>
                      {depsDisplayText}
                    </span>
                  </button>
                </span>
              )}
            </div>
          );
        }
        if (colId.startsWith('custom:')) {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === colId;
          const isFocusedCustom = focusedCell?.taskId === task.id && focusedCell?.columnId === colId && !isEditing;
          const currentValue = task.customFields?.[colId] ?? '';
          const customLabel = customColumnNameById.get(colId) ?? colId.replace(/^custom:/, '');
          return (
            <div
              key={colId}
              className={cn('data-cell text-xs text-slate-600 min-w-0', isFocusedCustom && 'ring-2 ring-indigo-500 ring-inset')}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit(colId);
              }}
              title={customLabel}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-${colId}`}
                  type="text"
                  autoFocus
                  defaultValue={currentValue}
                  className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  onBlur={(e) => {
                    const nextValue = e.target.value ?? '';
                    if (nextValue !== currentValue) {
                      updateTask(task.id, {
                        customFields: { ...(task.customFields ?? {}), [colId]: nextValue },
                      });
                    }
                    setEditingCell(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    else if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="rounded px-1 -mx-1 block truncate w-full text-left cursor-cell hover:bg-indigo-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit(colId);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEditNow(colId);
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit(colId);
                  }}
                  title={currentValue || `${customLabel} 입력`}
                >
                  <span style={mergeDoneLineThrough(txtStyle, applyDoneAutoStrike)}>{currentValue || '-'}</span>
                </button>
              )}
            </div>
          );
        }
        return null;
      })}
      {showActionsColumn && (
        <div
          className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(task);
            }}
            className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded transition-colors"
            title="작업 수정"
          >
            <Edit2 size={13} />
          </button>
          {canEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClick(task.id);
              }}
              className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
              title="삭제"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function areRowPropsEqual(prev: SortableTaskRowProps, next: SortableTaskRowProps) {
  const editingCellSame =
    prev.editingCell === next.editingCell ||
    (!!prev.editingCell &&
      !!next.editingCell &&
      prev.editingCell.taskId === next.editingCell.taskId &&
      prev.editingCell.columnId === next.editingCell.columnId);
  const focusedCellSame =
    prev.focusedCell === next.focusedCell ||
    (!!prev.focusedCell &&
      !!next.focusedCell &&
      prev.focusedCell.taskId === next.focusedCell.taskId &&
      prev.focusedCell.columnId === next.focusedCell.columnId);
  return (
    editingCellSame &&
    focusedCellSame &&
    prev.tableEditMode === next.tableEditMode &&
    prev.rowIndex === next.rowIndex &&
    prev.wbsId === next.wbsId &&
    prev.displayWbsId === next.displayWbsId &&
    prev.isSelected === next.isSelected &&
    prev.isFocused === next.isFocused &&
    prev.hasChildren === next.hasChildren &&
    prev.isTreeView === next.isTreeView &&
    prev.isInlineEditingName === next.isInlineEditingName &&
    prev.gridStyle === next.gridStyle &&
    prev.visibleColumnIds === next.visibleColumnIds &&
    prev.showActionsColumn === next.showActionsColumn &&
    prev.allAssignees === next.allAssignees &&
    prev.assigneeOptionsByProjectId === next.assigneeOptionsByProjectId &&
    prev.statusConfigs === next.statusConfigs &&
    prev.projectAssignmentsByProjectId === next.projectAssignmentsByProjectId &&
    prev.allProjectTasks === next.allProjectTasks &&
    prev.updateProject === next.updateProject &&
    prev.projectEffortUnitByProjectId === next.projectEffortUnitByProjectId &&
    prev.projectScheduleByProjectId === next.projectScheduleByProjectId &&
    prev.criticalPathSet === next.criticalPathSet &&
    prev.allocationDisplayText === next.allocationDisplayText &&
    prev.displayWbsMap === next.displayWbsMap &&
    prev.task.id === next.task.id &&
    prev.task.parentId === next.task.parentId &&
    prev.task.name === next.task.name &&
    prev.task.startDate === next.task.startDate &&
    prev.task.endDate === next.task.endDate &&
    prev.task.progress === next.task.progress &&
    prev.task.assignee === next.task.assignee &&
    prev.task.projectId === next.task.projectId &&
    prev.task.status === next.task.status &&
    prev.task.expanded === next.task.expanded &&
    prev.task.workEffort === next.task.workEffort &&
    prev.task.deliverables === next.task.deliverables &&
    prev.task.customFields === next.task.customFields &&
    prev.taskIdToSeqNum === next.taskIdToSeqNum &&
    prev.seqNumToTaskId === next.seqNumToTaskId &&
    prev.task.dependencies === next.task.dependencies &&
    prev.task.isMilestone === next.task.isMilestone &&
    prev.task.isIssue === next.task.isIssue &&
    prev.task.isActionItem === next.task.isActionItem &&
    (prev.task.depth ?? 0) === (next.task.depth ?? 0) &&
    prev.task.plannedProgressOverride === next.task.plannedProgressOverride &&
    prev.canEdit === next.canEdit &&
    prev.dropIndicator === next.dropIndicator &&
    prev.customColumnNameById === next.customColumnNameById &&
    prev.prependDisplayWbsToTaskName === next.prependDisplayWbsToTaskName &&
    prev.rollupTooltipBaseTasks === next.rollupTooltipBaseTasks &&
    prev.plannedProgress === next.plannedProgress &&
    prev.showTableAutoFormatting === next.showTableAutoFormatting
  );
}

/**
 * 표 셀 안의 overflow:hidden / overflow:auto 컨테이너에 갇혀 잘리는 것을 막기 위해
 * Portal로 body에 렌더링되는 선행작업 드롭다운. 입력창 위치를 매 프레임 추적해 따라간다.
 */
function DepsPortalDropdown({
  inputId,
  items,
  pickIdx,
  setPickIdx,
  onPick,
  taskIdToSeqNum,
  displayWbsMap,
}: {
  inputId: string;
  items: Task[];
  pickIdx: number;
  setPickIdx: (i: number) => void;
  onPick: (id: string) => void;
  taskIdToSeqNum: Map<string, number>;
  displayWbsMap: Map<string, string>;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const el = document.getElementById(inputId);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom, width: Math.max(220, r.width) });
    };
    update();
    // 입력창 위치는 스크롤·리사이즈로 변할 수 있으므로 추적
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelled = true;
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [inputId]);

  if (!rect) return null;
  return (
    <ul
      role="listbox"
      style={{
        position: 'fixed',
        left: rect.left,
        top: rect.top + 2,
        width: rect.width,
        maxHeight: 220,
        overflowY: 'auto',
        zIndex: 9999,
      }}
      className="rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-lg py-0.5"
    >
      {items.map((t, i) => {
        const rowNum = taskIdToSeqNum.get(t.id);
        return (
          <li key={t.id} role="option" aria-selected={i === pickIdx}>
            <button
              type="button"
              className={cn(
                'w-full text-left px-2 py-1 text-[12px] leading-snug flex gap-1.5 items-baseline',
                i === pickIdx ? 'bg-indigo-50 dark:bg-indigo-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => setPickIdx(i)}
              onClick={() => onPick(t.id)}
            >
              {rowNum != null && <span className="text-slate-400 tabular-nums shrink-0">{rowNum}.</span>}
              <span className="min-w-0">
                {displayWbsMap.get(t.id) && <span className="text-slate-400 tabular-nums mr-0.5">{displayWbsMap.get(t.id)}</span>}
                <span className="break-words">{t.name || '이름 없음'}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export const SortableTaskRow = React.memo(SortableTaskRowInner, areRowPropsEqual);
