import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Bug, Edit2, Trash2, ListChecks, ChevronRight, ChevronDown, GitBranch } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, type Project, type WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatDate, formatNum1, formatPercent1, round1, round2 } from '../lib/utils';
import { useOrganization } from '../context/OrganizationContext';
import { useLevelColors } from '../context/LevelColorsContext';
import { filterTasksForDependencyPicker, getActiveDependencyToken, hasDependencyCycle } from '../lib/dependencyPicker';
import { formatStoredWorkEffortForDisplay, normalizeWorkEffortUnit } from '../lib/workEffortUnits';
import { inclusiveCalendarDays, endYmdFromInclusiveDuration } from '../lib/durationDays';
import { progressVariance } from '../lib/plannedProgress';
import { PLANNED_NOT_EDITABLE_TOAST } from '../lib/plannedProgressTooltips';
import { isPointerShiftModifierActive } from '../lib/wbsTableShiftCellPointer';
import { useToast } from './Toast';
import {
  buildOrgMemberLabelMap,
  buildOrgMemberDisplayMetaMap,
  formatAssigneeDisplay,
  resolveAssigneeIfUniqueMatch,
  DEFAULT_PROJECT_ASSIGNMENT_PERCENT,
} from '../lib/assigneeOptions';
import { type TableColumnId, type WbsEditingCellPayload } from './wbsTableTypes';
import { delegateInlineEditColumnId } from '../lib/wbsReadonlyGridColumns';
import { clampAllocationPercentInt } from '../lib/personAllocations';
import { splitCellTextStyleForCellSurface } from '../lib/cellTextStyle';
import { isComposingKeyEvent } from '../lib/ime';
import { commitWbsInlineNameEditFromDom } from '../lib/wbsInlineNameCommit';
import { computeWorkCompositionPercent } from '../lib/workComposition';
import { normalizeYmdInput } from '../lib/ymdInput';

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

/** 행 border-b(1px) 때문에 인접 행 세로선이 끊겨 보이지 않도록 위쪽으로 겹친다. */
const TREE_GUIDE_ROW_JOIN_PX = 1;

/**
 * 작업명 셀 왼쪽 들여쓰기 영역에 트리 가이드 선(│ ├ └)을 그린다.
 * 셀 패딩 영역에 absolute로만 그려 본문(작업명) 레이아웃에는 영향을 주지 않는다.
 * 색은 인라인 rgba(반투명 slate)로 라이트·다크 모두에서 보이게 한다.
 */
function TreeGuides({ guide, depth, hasChildren, expanded }: { guide: string; depth: number; hasChildren: boolean; expanded?: boolean }) {
  const showChildStub = hasChildren && !!expanded;
  if (!guide && !showChildStub) return null;
  // 체브런을 차분하게 바꾼 뒤 레벨 구분은 이 연결선이 주로 담당하므로 약간 더 또렷하게.
  const lineColor = 'rgba(100, 116, 139, 0.82)';
  const vLine = (key: string, x: number, top: number | string, bottom?: number | string, height?: number | string) => (
    <span
      key={key}
      style={{
        position: 'absolute',
        top,
        ...(height != null ? { height } : { bottom: bottom ?? 0 }),
        width: 0,
        left: x,
        borderLeft: `1px solid ${lineColor}`,
      }}
    />
  );
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < guide.length; i++) {
    const c = guide[i];
    const x = i * 20 + 9;
    if (c === 'I' || c === 'T') {
      lines.push(vLine(`v${i}`, x, -TREE_GUIDE_ROW_JOIN_PX));
    } else if (c === 'L') {
      lines.push(vLine(`v${i}`, x, -TREE_GUIDE_ROW_JOIN_PX, undefined, `calc(50% + ${TREE_GUIDE_ROW_JOIN_PX}px)`));
    }
    if (c === 'T' || c === 'L') {
      lines.push(
        <span
          key={`h${i}`}
          style={{ position: 'absolute', top: '50%', height: 0, width: 11, left: x, borderTop: `1px solid ${lineColor}` }}
        />,
      );
    }
  }
  if (showChildStub) {
    lines.push(vLine('stub', depth * 20 + 9, '50%'));
  }
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {lines}
    </span>
  );
}

export interface SortableTaskRowProps {
  key?: string | number;
  rowIndex: number;
  task: Task & { depth?: number };
  dropIndicator?: 'before' | 'after' | null;
  wbsId?: string;
  displayWbsId?: string;
  /** # 칸에 순번 대신 표시할 순수 계층 WBS 번호(1 · 1.1 · 1.1.1, 접두어 없음) */
  wbsSeqLabel?: string;
  displayWbsMap: Map<string, string>;
  taskIdToSeqNum: TaskIdToSeqNum;
  seqNumToTaskId: SeqNumToTaskId;
  /** 체크박스 체크 상태 = 보라색 강조. 명시적 다중 선택(스페이스/Ctrl/Shift)만 토글한다. */
  isSelected: boolean;
  hasChildren: boolean;
  /** 전체 하위 작업 개수(직·간접 자손, 작업명 옆 표시 — 부모 없는 최상위 행에만 노출). */
  totalDescendantTaskCount?: number;
  isTreeView: boolean;
  /** 작업명 들여쓰기에 그릴 트리 가이드 선 문자열(depth 칸별 'I'│ 'T'├ 'L'└ ' '공백). 트리 뷰에서만 채워짐 */
  treeGuide?: string;
  onSelect: (taskId: string, multi: boolean, range: boolean) => void;
  /** 행 클릭(비-Shift) 시 구간 선택 앵커 — Ctrl+행클릭 등 행 단위 다중 선택용 */
  onSetRowAnchor?: (taskId: string) => void;
  /** 행 클릭 시 포커스 이동. 수정키 없는 일반 클릭은 체크박스 다중 선택을 자동 해제하고, Shift/Ctrl 클릭은 keepSelection으로 보존한다. */
  onFocusRow?: (taskId: string, opts?: { keepSelection?: boolean; columnId?: TableColumnId }) => void;
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
  editingCell: WbsEditingCellPayload | null;
  setEditingCell: (v: WbsEditingCellPayload | null) => void;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  setFocusedCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
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
  /** 이 작업의 계획율(0~100). 부모에서 계산해 전달. 계획·진척차이 컬럼 표시에 사용 */
  plannedProgress?: number;
  /** false면 레벨 배경 등 자동 서식 숨김(셀 서식 도구로 넣은 취소선은 유지) */
  showTableAutoFormatting?: boolean;
  /** 작업명 인라인 편집 중 Shift+Enter — 현재 행 위에 형제(동일 부모) 새 작업 추가 + 새 행 인라인 편집 진입 */
  onInsertRowAbove?: (baseTaskId: string) => void;
  /** 작업명 인라인 편집 중 Enter — 다음 표시 행의 이름 셀로 인라인 편집을 이어간다(엑셀 연속 입력). */
  onAdvanceInlineEditToNextRow?: (currentTaskId: string) => void;
  /** 이 task가 분기되어 자식 프로젝트가 있으면 그 자식 프로젝트(없으면 undefined) */
  forkedChildProject?: Project;
  /** 분기 배지 클릭 시 호출 — 보통 자식 프로젝트로 전환 */
  onOpenForkedChildProject?: (childProjectId: string) => void;
  /**
   * 체크박스로 2행 이상 선택된 채 해당 셀 편집기에 붙여넣기 할 때: 클립보드 텍스트의 첫 줄을 선택 행 전체에 반영.
   * 처리했으면 true(호출측에서 preventDefault) — 1행만 선택이면 false로 기본 붙여넣기 유지.
   */
  onPasteApplyToCheckboxSelection?: (columnId: TableColumnId, clipboardPlainText: string) => boolean;
  /** 마우스 드래그로 선택된 셀 범위( taskId::columnId ). 체크박스 행 선택과 별개 */
  cellMarqueeKeySet?: ReadonlySet<string> | null;
  /** 다중 셀 붙여넣기 직후 잠시 표시(복사 마퀴와 색 구분) */
  pastedCellKeySet?: ReadonlySet<string> | null;
  /** 셀 클릭·포커스 직후 한 칸 마퀴로 동기화(onFocusRow가 마퀴를 비운 뒤 같은 핸들러에서 호출) */
  commitCellMarquee?: (taskId: string, columnId: TableColumnId) => void;
  /** click에 shiftKey가 없어도 Shift를 누르고 있으면 true — 연속 Shift+클릭 시 beginEdit이 마퀴를 지우지 않게 */
  isShiftModifierActive?: () => boolean;
}

function SortableTaskRowInner({
  rowIndex,
  task,
  dropIndicator,
  wbsId,
  displayWbsId,
  wbsSeqLabel,
  displayWbsMap,
  taskIdToSeqNum,
  seqNumToTaskId,
  isSelected,
  hasChildren,
  totalDescendantTaskCount = 0,
  isTreeView,
  treeGuide = '',
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
  plannedProgress,
  showTableAutoFormatting = true,
  onInsertRowAbove,
  onAdvanceInlineEditToNextRow,
  forkedChildProject,
  onOpenForkedChildProject,
  onPasteApplyToCheckboxSelection,
  cellMarqueeKeySet = null,
  pastedCellKeySet = null,
  commitCellMarquee,
  isShiftModifierActive,
}: SortableTaskRowProps) {
  const effortUnitForTask = normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(task.projectId));
  // 순서 이동(정렬)은 첫 열 손잡이([data-row-grip])에서만 시작한다 — listeners/attributes는 그립 셀에만 부착.
  // 본문 드래그는 useWbsDragRangeSelect(엑셀식 범위 다중 선택)가 담당한다.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });

  const { orgMembers } = useOrganization();
  const { levelRowBg: levelRowBgCtx } = useLevelColors();

  // ── 엑셀식 즉시 타이핑(작업명 셀) ──
  // 작업명 셀이 '포커스만' 된 상태(armed)에서도 숨은 input을 미리 포커스해 둔다.
  // 같은 input이 그대로 편집기로 전환되므로 한글 IME 조합 첫 자모도 유실되지 않는다(포커스를 옮기지 않음).
  const nameEditRef = useRef<HTMLInputElement | null>(null);
  /** Shift+구간은 pointerdown에서 처리. click에는 shiftKey가 false로만 찍히는 경우가 있어(누르고 있어도) 토글로 잘못 가지 않게 한다. */
  const suppressNextCheckboxClickRef = useRef(false);
  const isNameArmed = canEdit && !isInlineEditingName && focusedCell?.taskId === task.id && focusedCell?.columnId === 'name';

  // armed가 되면 숨은 작업명 input을 포커스해 둔다(전체 선택은 onFocus에서).
  // 다른 입력(검색창 등)에 포커스가 있으면 가로채지 않는다 — 표 컨테이너/본문에 있을 때만.
  useEffect(() => {
    if (!(canEdit && !isInlineEditingName && focusedCell?.taskId === task.id && focusedCell?.columnId === 'name')) return;
    const el = nameEditRef.current;
    if (!el || document.activeElement === el) return;
    const active = document.activeElement as HTMLElement | null;
    const safeToFocus =
      !active ||
      active === document.body ||
      !!active.hasAttribute?.('data-wbs-table') ||
      (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'SELECT');
    if (safeToFocus) el.focus({ preventScroll: true });
  }, [focusedCell, isInlineEditingName, canEdit, task.id]);

  /** click 합성 시 shiftKey가 빠져도 ref·getModifierState로 Shift 조작 중임을 판별 */
  const shiftModifierActive = () => isShiftModifierActive?.() === true;
  const shiftModifierFromEvent = (e: { shiftKey?: boolean; getModifierState?: (key: string) => boolean }) =>
    isPointerShiftModifierActive(e, { current: shiftModifierActive() });

  /** armed(편집 전) 작업명 input에서 첫 입력/IME 조합 시작 시 실제 편집으로 승격 — 같은 element라 조합이 유지된다. */
  const promoteArmedNameToEditing = () => {
    onFocusRow?.(task.id, { keepSelection: true, columnId: 'name' });
    onSetRowAnchor?.(task.id);
    commitCellMarquee?.(task.id, 'name');
    setEditingCell(null);
    setInlineEditingNameId(task.id);
  };

  /** 행·마퀴 앵커만 맞추고 인라인 편집은 시작하지 않는다(단일 클릭용). */
  const beginFocus = (columnId: TableColumnId) => {
    if (shiftModifierActive()) return;
    onFocusRow?.(task.id, { keepSelection: true, columnId });
    onSetRowAnchor?.(task.id);
    commitCellMarquee?.(task.id, columnId);
  };

  /**
   * 단일 클릭 — 셀 선택만(엑셀과 같음). 값 바꾸기는 더블클릭·F2 또는 선택 후 바로 입력(type-to-edit).
   */
  const beginEdit = (columnId: TableColumnId) => {
    beginFocus(columnId);
  };

  /** 더블클릭/F2용: 권한이 있으면 즉시 인라인 편집 진입. 권한 없으면 포커스만. */
  const beginEditNow = (columnId: TableColumnId) => {
    if (shiftModifierActive()) return;
    onFocusRow?.(task.id, { keepSelection: true, columnId });
    onSetRowAnchor?.(task.id);
    if (!canEdit) {
      commitCellMarquee?.(task.id, columnId);
      return;
    }
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
    commitCellMarquee?.(task.id, columnId);
  };

  const handleCellBulkPaste = useCallback(
    (columnId: TableColumnId, e: React.ClipboardEvent) => {
      if (!onPasteApplyToCheckboxSelection) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!onPasteApplyToCheckboxSelection(columnId, text)) return;
      e.preventDefault();
      setEditingCell(null);
      requestAnimationFrame(() => {
        (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
      });
    },
    [onPasteApplyToCheckboxSelection, setEditingCell],
  );

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
  const orgMemberLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);
  const orgMemberDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  // 공수구성 컬럼이 보일 때만 O(N) 형제 합산 — 숨겨진 경우 매 렌더 비용 제거.
  const showsWorkComposition = visibleColumnIds.includes('workComposition');
  const workCompositionPct = useMemo(
    () => (showsWorkComposition ? computeWorkCompositionPercent(task, allProjectTasks) : null),
    [showsWorkComposition, task, allProjectTasks],
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
    if (allocEditSessionRef.current === sessionKey) return;
    allocEditSessionRef.current = sessionKey;
    const seed = editingCell?.taskId === task.id && editingCell?.columnId === 'allocation' ? editingCell.typeToEditSeed : undefined;
    if (typeof seed === 'string' && seed.length === 1 && /^\d$/.test(seed)) {
      setAllocationEditStr(seed);
    } else {
      setAllocationEditStr(String(primaryPercentForAlloc));
    }
    if (editingCell && editingCell.taskId === task.id && editingCell.columnId === 'allocation' && 'typeToEditSeed' in editingCell) {
      setEditingCell({ taskId: editingCell.taskId, columnId: 'allocation' });
    }
  }, [isAllocEditing, task.id, primaryPercentForAlloc, editingCell, setEditingCell]);

  /** 진척률: type-to-edit 시 첫 글자가 유실되지 않도록 allocation과 동일하게 문자열 controlled 편집 */
  const isProgEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'progress';
  const [progressEditStr, setProgressEditStr] = useState('');
  const progEditSessionRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!isProgEditing) {
      progEditSessionRef.current = null;
      return;
    }
    const sessionKey = `${task.id}:progress`;
    if (progEditSessionRef.current === sessionKey) return;
    progEditSessionRef.current = sessionKey;
    const seed = editingCell?.taskId === task.id && editingCell?.columnId === 'progress' ? editingCell.typeToEditSeed : undefined;
    if (typeof seed === 'string' && seed.length === 1 && /^[\d.]$/.test(seed)) {
      setProgressEditStr(seed);
    } else {
      const p = task.progress;
      setProgressEditStr(typeof p === 'number' && Number.isFinite(p) ? String(p) : '');
    }
    if (editingCell && editingCell.taskId === task.id && editingCell.columnId === 'progress' && 'typeToEditSeed' in editingCell) {
      setEditingCell({ taskId: editingCell.taskId, columnId: 'progress' });
    }
  }, [isProgEditing, task.id, task.progress, editingCell, setEditingCell]);

  // React `autoFocus`는 useEffect 이후에 실행된다. type-to-edit으로 연 직후 연속 키(예: 진척률 "50")가
  // 아직 표 스크롤 영역에 포커스일 때 두 번째 글자가 유실될 수 있어, 커밋 직후 동기로 편집기에 포커스한다.
  useLayoutEffect(() => {
    if (editingCell?.taskId === task.id) {
      const el = document.getElementById(`wbs-edit-${task.id}-${editingCell.columnId}`);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus({ preventScroll: true });
      }
      return;
    }
    if (isInlineEditingName) {
      const el = document.getElementById(`wbs-edit-${task.id}-name`);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus({ preventScroll: true });
      }
    }
  }, [editingCell, isInlineEditingName, task.id]);

  // 의존(선행) 작업을 화면에 보이는 행과 보이지 않는(접힘/필터) 작업으로 분류.
  // 보이지 않는 작업은 표 행 번호가 없으므로 별도 표기(WBS 코드)로 노출하며,
  // 편집 시에도 잃어버리지 않도록 ID를 보존한다.
  const { visibleDepNums, hiddenDepIds } = useMemo(() => {
    const depIds = task.dependencies ?? [];
    const visibleNums: number[] = [];
    const hiddenIds: string[] = [];
    for (const id of depIds) {
      const seq = taskIdToSeqNum.get(id);
      if (seq != null) {
        visibleNums.push(seq);
      } else {
        hiddenIds.push(id);
      }
    }
    visibleNums.sort((a, b) => a - b);
    return { visibleDepNums: visibleNums, hiddenDepIds: hiddenIds };
  }, [task.dependencies, taskIdToSeqNum]);

  const depsDisplayValue = useMemo(() => (visibleDepNums.length > 0 ? visibleDepNums.join(', ') : ''), [visibleDepNums]);

  const [depsInputValue, setDepsInputValue] = useState(depsDisplayValue);
  const [depsFocused, setDepsFocused] = useState(false);
  const [depPickIdx, setDepPickIdx] = useState(0);
  const isDepsEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'dependencies';
  const depsEditSessionRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!isDepsEditing) {
      depsEditSessionRef.current = null;
      return;
    }
    const sessionKey = `${task.id}:dependencies`;
    if (depsEditSessionRef.current === sessionKey) return;
    depsEditSessionRef.current = sessionKey;
    const seed = editingCell?.taskId === task.id && editingCell?.columnId === 'dependencies' ? editingCell.typeToEditSeed : undefined;
    if (typeof seed === 'string' && seed.length >= 1) {
      setDepsInputValue(seed);
    } else {
      setDepsInputValue(depsDisplayValue);
    }
    if (editingCell && editingCell.taskId === task.id && editingCell.columnId === 'dependencies' && 'typeToEditSeed' in editingCell) {
      setEditingCell({ taskId: editingCell.taskId, columnId: 'dependencies' });
    }
  }, [isDepsEditing, task.id, depsDisplayValue, editingCell, setEditingCell]);

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
    if (isDepsEditing) return;
    setDepsInputValue(depsDisplayValue);
  }, [depsDisplayValue, isDepsEditing]);

  const depth = task.depth || 0;
  const level = depth + 1;

  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const zebraOverlay = rowIndex % 2 === 1 ? (dark ? 'rgba(255,255,255,0.02)' : 'rgba(2, 6, 23, 0.03)') : 'transparent';

  // 다크/라이트 모드별 행 상태 색상
  // 선택 행: 표면/줄무늬 대비가 약해지지 않도록 배경을 한 단계 진하게(라이트 indigo-400, 다크 보라 톤 상향)
  const selectedBg = dark ? '#4c3a8a' : '#818cf8';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isSelected ? selectedBg : rowLevelBg(level, hasChildren),
    backgroundImage: isSelected ? undefined : `linear-gradient(${zebraOverlay}, ${zebraOverlay})`,
    // 좌측 색상 strip은 box-shadow inset으로 그린다. border-left는 grid container의 컨텐츠 영역을 우측으로 밀어
    // 헤더와 본문 컬럼 정렬을 어긋나게 하므로 사용하지 않음.
    ...(isSelected
      ? {
          boxShadow: dark
            ? 'inset 3px 0 0 0 rgb(192 132 252), inset 0 0 0 2px rgba(192 132 252, 0.55), inset 0 1px 0 0 rgba(216 180 254, 0.4), inset 0 -1px 0 0 rgba(216 180 254, 0.4), 0 2px 8px rgba(0 0 0, 0.45)'
            : 'inset 3px 0 0 0 rgb(126 34 206), inset 0 0 0 2px rgba(91 33 182, 0.55), inset 0 1px 0 0 rgba(91 33 182, 0.38), inset 0 -1px 0 0 rgba(91 33 182, 0.38), 0 2px 8px rgba(91, 33, 182, 0.28)',
        }
      : {}),
    zIndex: isDragging ? 10 : isSelected ? 2 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      className={cn(
        'data-row group outline-none transition-colors relative',
        // 본문은 끌어서 다중 선택(엑셀식) — 순서 이동은 첫 열 손잡이 전용이므로 행 전체엔 grab 커서를 주지 않는다.
        // 행 외곽 안쪽에 두꺼운 ring(box-shadow inset)을 두면 layout에는 영향이 없어도 컨텐츠가 안쪽에서 시작하는 듯한
        // 시각 인상이 강해져 헤더와 정렬이 어긋나 보였음. 좌측 strip(box-shadow inset 3px) + 배경색 강조만 남기고 ring 클래스는 제거.
        isSelected && (dark ? 'font-semibold text-purple-200' : 'font-semibold text-violet-950'),
        // 요약(상위)행 타이포 강조: 체크 선택 상태가 아닐 때만 추가
        hasChildren && !isSelected && 'font-semibold',
        // 셀에 사용자 지정 글꼴 크기가 있으면 그 행은 높이를 자동 확장(고정 행 높이에 큰 글자가 잘리는 문제 보완)
        !!task.cellTextStyles &&
          Object.values(task.cellTextStyles).some((s) => typeof s?.fontSize === 'number' && (s.fontSize ?? 0) > 0) &&
          'wbs-cell-styled',
      )}
      // Ctrl/Meta 다중 선택: click은 일부 컨트롤에서 합성되지 않을 수 있어 pointerdown 캡처에서 처리한다.
      // Shift+셀 범위는 표 본문(data-wbs-table) 캡처에서 통일 처리(표 단독·분할·sticky 동일).
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        if (shiftModifierFromEvent(e)) return;
        if (!e.ctrlKey && !e.metaKey) return;
        onSelect(task.id, true, false);
        onFocusRow?.(task.id, { keepSelection: true });
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (shiftModifierFromEvent(e) || e.ctrlKey || e.metaKey) return;
        if (onFocusRow) onFocusRow(task.id);
        onSetRowAnchor?.(task.id);
      }}
      tabIndex={0}
      onContextMenu={(e) => onContextMenu(e, task.id, undefined)}
    >
      {dropIndicator === 'before' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500 pointer-events-none z-10" aria-hidden />
      )}
      {dropIndicator === 'after' && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 pointer-events-none z-10" aria-hidden />
      )}
      <div
        ref={canEdit ? setActivatorNodeRef : undefined}
        className={cn(
          'data-cell justify-center select-none touch-none',
          canEdit ? 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-indigo-500' : 'text-slate-200',
        )}
        aria-label={canEdit ? '드래그하여 순서 변경' : undefined}
        data-row-grip
        {...(canEdit ? attributes : {})}
        {...(canEdit ? listeners : {})}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </div>
      <div
        className="data-cell justify-center"
        data-wbs-row-gutter
        onPointerDownCapture={(e) => {
          if (e.pointerType === 'touch' || e.button !== 0) return;
          if (!shiftModifierFromEvent(e) || e.ctrlKey || e.metaKey || e.altKey) return;
          suppressNextCheckboxClickRef.current = true;
          onSelect(task.id, false, true);
          setFocusedCell({
            taskId: task.id,
            columnId:
              focusedCell?.columnId && focusedCell.columnId !== 'wbsId' ? focusedCell.columnId : (visibleEditableColumnIds[0] ?? 'name'),
          });
          e.preventDefault();
          e.stopPropagation();
          window.setTimeout(() => {
            suppressNextCheckboxClickRef.current = false;
          }, 0);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            if (suppressNextCheckboxClickRef.current) {
              suppressNextCheckboxClickRef.current = false;
              e.preventDefault();
              return;
            }
            if (shiftModifierFromEvent(e)) {
              onSelect(task.id, false, true);
              setFocusedCell({
                taskId: task.id,
                columnId:
                  focusedCell?.columnId && focusedCell.columnId !== 'wbsId'
                    ? focusedCell.columnId
                    : (visibleEditableColumnIds[0] ?? 'name'),
              });
              e.preventDefault();
              return;
            }
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            onSelect(task.id, true, false);
            // 체크박스만 눌러도 셀 포커스가 남아 있지 않으면 하단 서식 바가 안 뜨는 문제 방지 + 다중 선택 시 같은 열 서식 일괄 적용 기준 행 정렬
            setFocusedCell({
              taskId: task.id,
              columnId:
                focusedCell?.columnId && focusedCell.columnId !== 'wbsId' ? focusedCell.columnId : (visibleEditableColumnIds[0] ?? 'name'),
            });
          }}
          onChange={() => {
            // onClick에서 제어하므로 onChange는 비워 둔다.
          }}
        />
      </div>
      <div
        className="data-cell justify-center font-mono text-[10px] text-slate-500 tabular-nums"
        data-wbs-row-gutter
        onPointerDownCapture={(e) => {
          if (e.pointerType === 'touch' || e.button !== 0) return;
          if (!shiftModifierFromEvent(e) || e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
          onSelect(task.id, false, true);
          const firstEditable = visibleColumnIds.find((c) => c !== 'wbsId') ?? 'name';
          setFocusedCell({
            taskId: task.id,
            columnId:
              focusedCell?.columnId && focusedCell.columnId !== 'wbsId'
                ? focusedCell.columnId
                : (visibleEditableColumnIds[0] ?? firstEditable),
          });
        }}
        onClick={(e) => {
          if (!shiftModifierFromEvent(e)) return;
          e.stopPropagation();
          onSelect(task.id, false, true);
          const firstEditable = visibleColumnIds.find((c) => c !== 'wbsId') ?? 'name';
          setFocusedCell({
            taskId: task.id,
            columnId:
              focusedCell?.columnId && focusedCell.columnId !== 'wbsId'
                ? focusedCell.columnId
                : (visibleEditableColumnIds[0] ?? firstEditable),
          });
        }}
      >
        {wbsSeqLabel || rowIndex + 1}
      </div>
      {visibleColumnIds.map((colId) => {
        const otherFocusKey = `${task.id}::${colId}`;
        const othersHere = otherFocusByCellKey.get(otherFocusKey) ?? [];
        const otherPrimary = othersHere[0];
        const otherRingStyle = otherPrimary ? ({ boxShadow: `inset 0 0 0 2px ${otherPrimary.color}` } as React.CSSProperties) : undefined;
        const inMarquee = cellMarqueeKeySet?.has(`${task.id}::${colId}`) ?? false;
        const inPasteFlash = pastedCellKeySet?.has(`${task.id}::${colId}`) ?? false;
        // 다중 셀 선택(드래그·Shift+화살표): 포커스 링(indigo)과 겹치지 않게 하늘색 톤으로, 배경·테두리 대비를 충분히 둔다.
        // 붙여넣기 직후 플래시는 에메랄드 톤으로 복사 범위와 구분.
        const skyMarqueeClass = inMarquee ? 'bg-sky-200/95 dark:bg-sky-800/65 ring-1 ring-inset ring-sky-500/55 dark:ring-sky-400/45' : '';
        const pasteFlashClass = inPasteFlash
          ? 'bg-emerald-100/95 dark:bg-emerald-900/45 ring-1 ring-inset ring-emerald-500/55 dark:ring-emerald-400/45'
          : '';
        const rangeHighlightClass = inPasteFlash ? pasteFlashClass : skyMarqueeClass;
        const rangeCellProps = {
          'data-wbs-range-cell': true as const,
          'data-range-task': task.id,
          'data-range-col': colId,
        };
        const __renderCell = (): React.ReactNode => {
          if (colId === 'wbsId') {
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className="data-cell font-mono text-[10px] text-slate-400 cursor-pointer"
                onClick={() => {
                  // wbsId 칸 클릭도 행 포커스로 동작 — 편집 가능한 첫 컬럼을 기본 포커스 셀로 지정
                  const firstEditable = visibleColumnIds.find((c) => c !== 'wbsId') ?? 'name';
                  onFocusRow?.(task.id, { keepSelection: true, columnId: firstEditable });
                  onSetRowAnchor?.(task.id);
                  commitCellMarquee?.(task.id, firstEditable);
                }}
              >
                {wbsId}
              </div>
            );
          }
          const { textStyle: txtStyle, cellSurfaceStyle } = splitCellTextStyleForCellSurface(
            task.cellTextStyles?.[colId],
            inMarquee || inPasteFlash,
          );
          const mergeCellOuter = (base?: React.CSSProperties | null) => ({ ...(base ?? {}), ...cellSurfaceStyle });
          if (colId === 'name') {
            const isFocused = focusedCell?.taskId === task.id && focusedCell?.columnId === 'name' && !isInlineEditingName;
            const displayWbsPrefix = (displayWbsId && String(displayWbsId).trim()) || '';
            const rawName = (task.name ?? '').trim();
            const tableNameLabel =
              prependDisplayWbsToTaskName && displayWbsPrefix ? (rawName ? `${displayWbsPrefix} ${rawName}` : displayWbsPrefix) : rawName;
            // 작업명은 좌측 고정(sticky)열이라 자체 box-shadow(고정열 그림자)가 Tailwind ring(box-shadow)을 덮어
            // 포커스 링이 보이지 않는다 → box-shadow와 독립적인 outline으로 포커스를 표시한다.
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn('data-cell relative', rangeHighlightClass)}
                style={{
                  ...mergeCellOuter(otherRingStyle),
                  paddingLeft: `${depth * 20 + 22}px`,
                  ...(isTreeView ? { overflow: 'visible' as const } : null),
                  ...(isFocused ? { outline: '2px solid rgb(99, 102, 241)', outlineOffset: '-2px' } : null),
                }}
                onClick={(e) => {
                  // 한 번 클릭으로 작업명 셀만 선택 — Ctrl/Shift/Meta는 다중·구간 선택용.
                  // Ctrl/Shift/Meta 클릭은 다중·구간 선택용이므로 편집 진입하지 않음 (행 pointerdown 캡처가 선택 처리).
                  // 트리 접기/펼치기는 전용 ▣/□ 버튼으로만 수행.
                  // 이미 작업명 input이 떠 있으면 중복 진입 방지 (버블링된 클릭 등).
                  e.stopPropagation();
                  if (e.ctrlKey || e.metaKey || shiftModifierFromEvent(e)) return;
                  if (isInlineEditingName) return;
                  beginEdit('name');
                }}
                onDoubleClick={(e) => {
                  // 더블클릭은 상세 모달을 열지 않음 — 모드와 무관하게 항상 인라인 편집 진입. 상세는 행 우측 '수정' 버튼으로만 진입.
                  if (isInlineEditingName) return;
                  e.stopPropagation();
                  beginEditNow('name');
                }}
              >
                {isTreeView && <TreeGuides guide={treeGuide} depth={depth} hasChildren={hasChildren} expanded={task.expanded} />}
                {isTreeView && hasChildren && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(task.id);
                    }}
                    className={cn(
                      // 레벨 구분이 흐려지지 않도록 차분한 무채색으로 통일.
                      // 펼침/접힘은 색이 아니라 방향(▾/▸)으로만 구분한다(같은 레벨 형제가 상태에 따라 다른 색으로 보이지 않게).
                      'absolute z-[1] flex h-5 w-5 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-800',
                    )}
                    style={{ left: `${depth * 20}px`, top: '50%', transform: 'translateY(-50%)' }}
                    aria-label={task.expanded ? '접기' : '펼치기'}
                    aria-expanded={task.expanded}
                  >
                    {task.expanded ? <ChevronDown size={13} strokeWidth={2.5} /> : <ChevronRight size={13} strokeWidth={2.5} />}
                  </button>
                )}
                {(isInlineEditingName || isNameArmed) && (
                  <input
                    ref={nameEditRef}
                    id={`wbs-edit-${task.id}-name`}
                    autoFocus
                    defaultValue={task.name}
                    data-wbs-armed={!isInlineEditingName ? 'true' : undefined}
                    tabIndex={isInlineEditingName ? undefined : -1}
                    className={
                      isInlineEditingName
                        ? 'w-full min-h-[28px] text-sm font-bold bg-white text-indigo-600 outline-none ring-1 ring-indigo-500 rounded px-1'
                        : // armed: 화면엔 안 보이지만 포커스를 잡아 한글 IME 첫 자모까지 받는 캐처. 클릭은 통과(pointer-events:none).
                          'absolute inset-0 h-full w-full opacity-0 pointer-events-none'
                    }
                    onFocus={(e) => {
                      // armed(편집 전)면 전체 선택 → 첫 타이핑이 기존 값을 덮어씀(엑셀식). 편집 중엔 커서 보존.
                      if (isInlineEditingName) return;
                      try {
                        e.currentTarget.select();
                      } catch {
                        /* ignore */
                      }
                    }}
                    onCompositionStart={() => {
                      // 한글 등 IME 조합 시작 = 편집 시작(같은 input이라 조합 유지). 전체 선택 상태라 기존 값을 덮어씀.
                      if (!isInlineEditingName) promoteArmedNameToEditing();
                    }}
                    onInput={(e) => {
                      // armed에서 첫 입력(영문·숫자·기호) = 편집 시작. 조합 중(IME)은 onCompositionStart가 처리.
                      if (isInlineEditingName) return;
                      if ((e.nativeEvent as InputEvent).isComposing) return;
                      promoteArmedNameToEditing();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onPaste={(e) => {
                      e.stopPropagation();
                      // 브라우저 기본 붙여넣기로 input 값이 갱신된 뒤 커밋·편집 종료 (포커스가 표로 나가 ↑/↓가 행 이동으로 가는 문제 방지)
                      setTimeout(() => {
                        commitWbsInlineNameEditFromDom(task.id, allProjectTasks, updateTask, canEdit);
                        setInlineEditingNameId(null);
                        setEditingCell(null);
                        setFocusedCell({ taskId: task.id, columnId: 'name' });
                        onFocusRow?.(task.id, { keepSelection: true });
                        commitCellMarquee?.(task.id, 'name');
                        requestAnimationFrame(() => {
                          (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
                        });
                      }, 0);
                    }}
                    onKeyUp={(e) => {
                      // Del/Backspace로 내용이 비면 엑셀처럼 빈 값 확정 + 편집 종료(빈 input에 포커스가 남지 않음)
                      if (!isInlineEditingName) return;
                      const ne = e.nativeEvent as KeyboardEvent;
                      if (ne.isComposing) return;
                      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                      if (e.currentTarget.value.trim() !== '') return;
                      commitWbsInlineNameEditFromDom(task.id, allProjectTasks, updateTask, canEdit);
                      setInlineEditingNameId(null);
                      setEditingCell(null);
                      setFocusedCell({ taskId: task.id, columnId: 'name' });
                      onFocusRow?.(task.id, { keepSelection: true });
                      commitCellMarquee?.(task.id, 'name');
                      requestAnimationFrame(() => {
                        (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
                      });
                    }}
                    onKeyDown={(e) => {
                      // armed(편집 전)면 키 입력을 전역 핸들러(셀 이동·단축키)로 위임 — 화살표/Enter/Delete 등이 정상 동작.
                      if (!isInlineEditingName) return;
                      if (e.key === 'Enter') {
                        if (isComposingKeyEvent(e.nativeEvent)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        commitWbsInlineNameEditFromDom(task.id, allProjectTasks, updateTask, canEdit);
                        if (e.shiftKey && onInsertRowAbove) {
                          // Shift+Enter — 현재 행 위에 형제 새 작업 추가 + 새 행 인라인 편집.
                          setInlineEditingNameId(null);
                          setEditingCell(null);
                          onInsertRowAbove(task.id);
                          return;
                        }
                        // Enter — 엑셀처럼 아래(형제)에 빈 행을 추가하고 그 작업명 편집으로 이어감.
                        if (onAdvanceInlineEditToNextRow && canEdit) {
                          onAdvanceInlineEditToNextRow(task.id);
                          return;
                        }
                        setInlineEditingNameId(null);
                        setEditingCell(null);
                        setFocusedCell({ taskId: task.id, columnId: 'name' });
                        onFocusRow?.(task.id, { keepSelection: true });
                        commitCellMarquee?.(task.id, 'name');
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
                )}
                {!isInlineEditingName && (
                  <span
                    className="font-medium text-[var(--color-ink)] flex min-w-0 max-w-full items-center gap-1.5 cursor-cell overflow-hidden"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.ctrlKey || e.metaKey || shiftModifierFromEvent(e)) return;
                      beginEdit('name');
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNow('name');
                    }}
                  >
                    {task.isIssue && <Bug size={14} className="text-rose-600 flex-shrink-0" />}
                    {task.isActionItem && <ListChecks size={14} className="text-teal-600 flex-shrink-0" />}
                    {task.mirroredFromTaskId && task.mirroredFromProjectId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 flex-shrink-0">
                        <GitBranch size={11} aria-hidden />
                        자식
                      </span>
                    )}
                    {forkedChildProject && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenForkedChildProject?.(forkedChildProject.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors flex-shrink-0"
                      >
                        <GitBranch size={11} aria-hidden />
                        분기
                      </button>
                    )}
                    {criticalPathSet?.has(task.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0">
                        크리티컬
                      </span>
                    )}
                    <span className="min-w-0 truncate" style={txtStyle}>
                      {tableNameLabel ? (
                        tableNameLabel
                      ) : (
                        <span className="italic text-slate-400 font-normal select-none">(입력 또는 F2로 작업명 편집)</span>
                      )}
                    </span>
                    {totalDescendantTaskCount > 0 && !task.parentId && (
                      <span className="text-slate-400 text-xs font-normal tabular-nums flex-shrink-0">({totalDescendantTaskCount})</span>
                    )}
                  </span>
                )}
                {otherPrimary && (
                  <div
                    className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-slate-200 shadow-sm pointer-events-none"
                    style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
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
              const prev = task.startDate?.slice(0, 10) ?? '';
              if (v === '' && prev === '') return;
              if (v === '' && prev !== '') {
                updateTask(task.id, { startDate: '' });
                return;
              }
              if (!v || v === prev) return;
              updateTask(task.id, { startDate: v + (task.startDate?.slice(10) || '') });
            };
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                  isFocused && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
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
                    className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                    onPaste={(e) => handleCellBulkPaste('startDate', e)}
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
                    >
                      <span className="inline-flex items-center gap-0.5 min-w-0" style={txtStyle}>
                        {formatDate(task.startDate) || '—'}
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
          if (colId === 'endDate') {
            const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'endDate';
            const isFocusedEnd = focusedCell?.taskId === task.id && focusedCell?.columnId === 'endDate' && !isEditing;
            const commitEndDateIfChanged = (raw: string) => {
              const v = normalizeYmdInput(raw);
              const prev = task.endDate?.slice(0, 10) ?? '';
              if (v === '' && prev === '') return;
              if (v === '' && prev !== '') {
                updateTask(task.id, { endDate: '' });
                return;
              }
              if (!v || v === prev) return;
              updateTask(task.id, { endDate: v + (task.endDate?.slice(10) || '') });
            };
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                  isFocusedEnd && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
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
                    className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                    onPaste={(e) => handleCellBulkPaste('endDate', e)}
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
                    >
                      <span className="inline-flex items-center gap-0.5 min-w-0" style={txtStyle}>
                        {formatDate(task.endDate) || '—'}
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
          if (colId === 'duration') {
            const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'duration';
            const isFocusedDur = focusedCell?.taskId === task.id && focusedCell?.columnId === 'duration' && !isEditing;
            const durationDays = inclusiveCalendarDays(task.startDate, task.endDate);
            const commitDurationIfChanged = (raw: string) => {
              const trimmed = (raw ?? '').trim();
              if (!trimmed) {
                const prevEnd = (task.endDate ?? '').trim();
                if (prevEnd) updateTask(task.id, { endDate: '' });
                return;
              }
              const n = parseInt(trimmed, 10);
              if (!Number.isFinite(n) || n < 1) return;
              if (!task.startDate) return; // 시작일이 없으면 종료일을 역산할 수 없음
              const newYmd = endYmdFromInclusiveDuration(task.startDate, n);
              if (!newYmd) return;
              const newEnd = newYmd + (task.endDate?.slice(10) || '');
              if (newEnd === (task.endDate ?? '')) return;
              updateTask(task.id, { endDate: newEnd });
            };
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                  isFocusedDur && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEdit('duration');
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEditNow('duration');
                }}
              >
                {isEditing ? (
                  <input
                    id={`wbs-edit-${task.id}-duration`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    defaultValue={durationDays ?? ''}
                    className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onFocus={(e) => e.currentTarget.select()}
                    onPaste={(e) => handleCellBulkPaste('duration', e)}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      const cleaned = el.value.replace(/\D/g, '');
                      if (cleaned !== el.value) el.value = cleaned;
                    }}
                    onBlur={(e) => {
                      commitDurationIfChanged(e.target.value);
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
                        beginEdit('duration');
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        beginEditNow('duration');
                      }}
                      onFocus={(e) => {
                        e.stopPropagation();
                        beginEdit('duration');
                      }}
                    >
                      <span className="inline-flex items-center gap-0.5 min-w-0" style={txtStyle}>
                        {durationDays != null ? durationDays : '-'}
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
          if (colId === 'workEffort') {
            const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'workEffort';
            const isFocusedWE = focusedCell?.taskId === task.id && focusedCell?.columnId === 'workEffort' && !isEditing;
            const effortStep = effortUnitForTask === 'minute' ? 1 : 0.5;
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell relative font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                  isFocusedWE && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
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
                    onPaste={(e) => handleCellBulkPaste('workEffort', e)}
                    onBlur={(e) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      if (raw === '') {
                        if (task.workEffort !== undefined) updateTask(task.id, { workEffort: undefined });
                      } else {
                        const v = parseFloat(raw);
                        if (!isNaN(v) && v >= 0) {
                          const rounded = effortUnitForTask === 'minute' ? Math.round(v) : Math.round(v * 10) / 10;
                          if (rounded !== (task.workEffort ?? NaN)) updateTask(task.id, { workEffort: rounded });
                        }
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
                    >
                      <span className="inline-flex items-center gap-0.5 min-w-0" style={txtStyle}>
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
          if (colId === 'workComposition') {
            const isFocusedComp = focusedCell?.taskId === task.id && focusedCell?.columnId === 'workComposition';
            const text = workCompositionPct == null ? '—' : `${formatPercent1(workCompositionPct)}%`;
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs text-slate-600 min-w-0 cursor-help tabular-nums',
                  isFocusedComp && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusRow?.(task.id, { keepSelection: true, columnId: 'workComposition' });
                  commitCellMarquee?.(task.id, 'workComposition');
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  beginEditNowResolved('workComposition');
                }}
              >
                <span className="px-1 inline-block w-full text-right truncate" style={txtStyle}>
                  {text}
                </span>
              </div>
            );
          }
          if (colId === 'weight') {
            const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'weight';
            const isFocusedW = focusedCell?.taskId === task.id && focusedCell?.columnId === 'weight' && !isEditing;
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs text-slate-600 flex items-center gap-1 min-w-0',
                  isFocusedW && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
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
                    onPaste={(e) => handleCellBulkPaste('weight', e)}
                    onBlur={(e) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      if (raw === '') {
                        if (task.weight != null) updateTask(task.id, { weight: null });
                      } else {
                        const v = parseFloat(raw);
                        if (!isNaN(v) && v >= 0) {
                          const rounded = round1(v);
                          if (rounded !== (task.weight ?? NaN)) updateTask(task.id, { weight: rounded });
                        }
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
                  >
                    <span style={txtStyle}>{task.weight != null ? formatNum1(task.weight) : '-'}</span>
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
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs text-slate-600 min-w-0',
                  isFocusedProg && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
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
              >
                {isEditing ? (
                  <input
                    id={`wbs-edit-${task.id}-progress`}
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={progressEditStr}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === '' || /^\d*([.]\d*)?$/.test(next)) setProgressEditStr(next);
                    }}
                    className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onPaste={(e) => handleCellBulkPaste('progress', e)}
                    onBlur={() => {
                      const raw = progressEditStr.trim();
                      if (raw === '') {
                        if ((task.progress ?? 0) !== 0) updateTask(task.id, { progress: 0 });
                      } else {
                        const v = parseFloat(raw);
                        if (!isNaN(v) && v >= 0 && v <= 100) {
                          const rounded = round2(v);
                          if (rounded !== (task.progress ?? NaN)) updateTask(task.id, { progress: rounded });
                        }
                      }
                      setEditingCell(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      else if (e.key === 'Escape') setEditingCell(null);
                    }}
                  />
                ) : (
                  <span className="px-1 inline-block w-full min-w-0 text-left truncate tabular-nums" style={txtStyle}>
                    {typeof task.progress === 'number' && Number.isFinite(task.progress) ? `${formatPercent1(task.progress)}%` : '—'}
                  </span>
                )}
              </div>
            );
          }
          if (colId === 'plannedProgress') {
            const isFocusedPlanned = focusedCell?.taskId === task.id && focusedCell?.columnId === 'plannedProgress';
            // 계획율은 시작일·종료일·기준일 기반 자동 계산값만 사용(편집 불가, 표시 전용).
            const computable = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress);
            const planned = computable ? (plannedProgress as number) : 0;
            const plannedFmt = formatPercent1(planned);
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs text-slate-600 min-w-0 cursor-help',
                  isFocusedPlanned && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusRow?.(task.id, { keepSelection: true, columnId: 'plannedProgress' });
                  commitCellMarquee?.(task.id, 'plannedProgress');
                }}
                onDoubleClick={(e) => {
                  // 계획율 셀은 직접 편집 불가 — 편집 시도(더블클릭) 시 날짜 수정 안내
                  e.stopPropagation();
                  pushToast(PLANNED_NOT_EDITABLE_TOAST, { variant: 'info' });
                }}
              >
                <span className="px-1 inline-block w-full text-left truncate" style={txtStyle}>
                  {computable ? `${plannedFmt}%` : '—'}
                </span>
              </div>
            );
          }
          if (colId === 'progressVariance') {
            // 계획율이 자동 계산 가능(시작·종료 있음 또는 부모 롤업) → 차이 계산
            const computable = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress);
            const planned = typeof plannedProgress === 'number' && Number.isFinite(plannedProgress) ? plannedProgress : 0;
            const actual = typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : 0;
            const variance = progressVariance(actual, planned);
            const rounded = round1(variance);
            const color = !computable
              ? 'text-slate-400'
              : rounded < 0
                ? 'text-red-600'
                : rounded > 0
                  ? 'text-emerald-600'
                  : 'text-slate-500';
            const sign = rounded > 0 ? '+' : '';
            const label = rounded < 0 ? '계획 대비 지연' : rounded > 0 ? '계획보다 앞섬' : '계획대로';
            const actFmt = formatPercent1(actual);
            const plFmt = formatPercent1(planned);
            const varFmt = formatPercent1(variance);
            const isFocusedVar = focusedCell?.taskId === task.id && focusedCell?.columnId === 'progressVariance';
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs min-w-0 cursor-cell',
                  !txtStyle.color && color,
                  isFocusedVar && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(otherRingStyle)}
                onClick={(e) => {
                  e.stopPropagation();
                  beginEdit('progressVariance');
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  beginEditNowResolved('progressVariance');
                }}
              >
                <span className="px-1 inline-block w-full text-left truncate" style={txtStyle}>
                  {computable ? `${sign}${varFmt}%p` : '—'}
                </span>
              </div>
            );
          }
          if (colId === 'assignee') {
            const projectAssignees = (task.projectId ? assigneeOptionsByProjectId.get(task.projectId) : []) ?? [];
            const assigneeOptions = Array.from(new Set([...projectAssignees, (task.assignee || '').trim()].filter(Boolean))).sort((a, b) =>
              a.localeCompare(b, 'ko'),
            );
            const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'assignee';
            const isFocusedAssignee = focusedCell?.taskId === task.id && focusedCell?.columnId === 'assignee' && !isEditing;
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn(
                  'data-cell text-xs text-slate-600 relative overflow-visible group/assignee',
                  isFocusedAssignee && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
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
                        if (v && task.projectId) {
                          const existing = projectAssignmentsByProjectId.get(task.projectId) ?? [];
                          if (!existing.some((a) => (a.assignee || '').trim() === v)) {
                            updateProject(task.projectId, {
                              assignments: [...existing, { assignee: v, allocationPercent: DEFAULT_PROJECT_ASSIGNMENT_PERCENT }],
                            });
                          }
                        }
                        setEditingCell(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const el = e.currentTarget;
                          const opts = assigneeOptions;
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
                      {(assigneeOptions.length > 0 ? assigneeOptions : ([task.assignee].filter(Boolean) as string[])).map((a) => {
                        const info = orgMemberLabelByName.get(a);
                        return info ? <option key={a} value={a} label={info} /> : <option key={a} value={a} />;
                      })}
                    </datalist>
                  </>
                ) : (
                  <>
                    <div
                      className={cn(
                        'w-full px-1 py-0.5 truncate',
                        !txtStyle.color && (task.assignee ? 'text-slate-600' : 'text-slate-400'),
                      )}
                      style={txtStyle}
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
                {...rangeCellProps}
                className={cn(
                  'data-cell font-mono text-xs text-slate-600 min-w-0',
                  isFocusedAlloc && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEdit('allocation');
                }}
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
                    <span style={txtStyle}>{allocationDisplayText ?? '—'}</span>
                  </button>
                )}
              </div>
            );
          }
          if (colId === 'status') {
            const isFocusedStatus = focusedCell?.taskId === task.id && focusedCell?.columnId === 'status';
            const currentStatusName = statusConfigs.find((c) => c.id === task.status)?.name ?? task.status ?? '—';
            const currentStatusCfg = statusConfigs.find((c) => c.id === task.status);
            return (
              <div
                key={colId}
                {...rangeCellProps}
                className={cn('data-cell', isFocusedStatus && 'ring-2 ring-indigo-500 ring-inset rounded', rangeHighlightClass)}
                style={mergeCellOuter(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  beginFocus('status');
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, task.id, 'status');
                }}
              >
                {canEdit ? (
                  <select
                    id={`wbs-edit-${task.id}-status`}
                    value={task.status}
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      if (newStatus !== task.status) {
                        updateTask(task.id, { status: newStatus });
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => {
                      e.stopPropagation();
                      beginFocus('status');
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey) {
                        e.stopPropagation();
                      }
                      if (e.key === 'Escape') {
                        (e.target as HTMLSelectElement).blur();
                        requestAnimationFrame(() => {
                          (document.querySelector('[data-wbs-table]') as HTMLElement | null)?.focus?.();
                        });
                      }
                    }}
                    className={cn(
                      'w-full bg-white px-1 py-0.5 rounded border border-transparent text-xs cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-400',
                      currentStatusCfg?.id === 'done' && 'text-emerald-700 font-medium',
                      currentStatusCfg?.id === 'todo' && 'text-slate-600',
                    )}
                  >
                    {statusConfigs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="truncate block px-1" style={txtStyle}>
                    {currentStatusName}
                  </span>
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
                {...rangeCellProps}
                className={cn(
                  'data-cell text-xs text-slate-600 min-w-0',
                  isFocusedDel && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
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
                    onPaste={(e) => handleCellBulkPaste('deliverables', e)}
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
                  >
                    <span style={txtStyle}>{task.deliverables || '-'}</span>
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
              const projectTasks = allProjectTasks.filter((t) => t.projectId === task.projectId);
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
                {...rangeCellProps}
                className={cn(
                  'data-cell text-xs text-slate-600 font-mono flex items-center gap-1 min-w-0 relative',
                  depsMenuOpen && 'z-20 overflow-visible',
                  isFocusedDep && 'ring-2 ring-indigo-500 ring-inset rounded',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEdit('dependencies');
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEditNow('dependencies');
                }}
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
                        if (
                          depSuggestionsList.length > 0 &&
                          e.key === 'Enter' &&
                          depPickIdx >= 0 &&
                          depPickIdx < depSuggestionsList.length
                        ) {
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
                    >
                      <span className="block truncate" style={txtStyle}>
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
                {...rangeCellProps}
                className={cn(
                  'data-cell text-xs text-slate-600 min-w-0',
                  isFocusedCustom && 'ring-2 ring-indigo-500 ring-inset',
                  rangeHighlightClass,
                )}
                style={mergeCellOuter(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing) beginEdit(colId);
                }}
              >
                {isEditing ? (
                  <input
                    id={`wbs-edit-${task.id}-${colId}`}
                    type="text"
                    autoFocus
                    defaultValue={currentValue}
                    className="w-full min-w-0 bg-white border border-indigo-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    onPaste={(e) => handleCellBulkPaste(colId, e)}
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
                  >
                    <span style={txtStyle}>{currentValue || '-'}</span>
                  </button>
                )}
              </div>
            );
          }
          return null;
        };
        return __renderCell();
      })}
      {showActionsColumn && (
        <div
          {...{
            'data-wbs-range-cell': true as const,
            'data-range-task': task.id,
            'data-range-col': 'actions' as TableColumnId,
          }}
          className={cn(
            'data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
            pastedCellKeySet?.has(`${task.id}::actions`)
              ? 'bg-emerald-100/95 dark:bg-emerald-900/45 ring-1 ring-inset ring-emerald-500/55 dark:ring-emerald-400/45'
              : cellMarqueeKeySet?.has(`${task.id}::actions`) &&
                  'bg-sky-200/95 dark:bg-sky-800/65 ring-1 ring-inset ring-sky-500/55 dark:ring-sky-400/45',
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(task);
            }}
            className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded transition-colors"
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
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 이 행에 실제로 그려지는 셀(자기 task.id의 보이는 컬럼들 + actions)만 마퀴 멤버십을 비교한다.
 * 전체 키셋(드래그 범위가 크면 수천 개)을 행마다 순회하던 O(행수×범위셀수)를 O(행수×보이는컬럼수)로 낮춰
 * 마퀴 드래그 중 지연을 제거. 호출 시점엔 visibleColumnIds·showActionsColumn·task.id가 이미 참조동일로 확인됨.
 */
function rowMarqueeEqual(prev: SortableTaskRowProps, next: SortableTaskRowProps): boolean {
  const a = prev.cellMarqueeKeySet;
  const b = next.cellMarqueeKeySet;
  if (a === b) return true;
  if (!a && !b) return true;
  const taskId = next.task.id;
  const cols = next.visibleColumnIds;
  for (let i = 0; i < cols.length; i++) {
    const key = `${taskId}::${cols[i]}`;
    if ((a?.has(key) ?? false) !== (b?.has(key) ?? false)) return false;
  }
  if (next.showActionsColumn) {
    const ak = `${taskId}::actions`;
    if ((a?.has(ak) ?? false) !== (b?.has(ak) ?? false)) return false;
  }
  return true;
}

function rowPastedFlashEqual(prev: SortableTaskRowProps, next: SortableTaskRowProps): boolean {
  const a = prev.pastedCellKeySet;
  const b = next.pastedCellKeySet;
  if (a === b) return true;
  if (!a && !b) return true;
  const taskId = next.task.id;
  const cols = next.visibleColumnIds;
  for (let i = 0; i < cols.length; i++) {
    const key = `${taskId}::${cols[i]}`;
    if ((a?.has(key) ?? false) !== (b?.has(key) ?? false)) return false;
  }
  if (next.showActionsColumn) {
    const ak = `${taskId}::actions`;
    if ((a?.has(ak) ?? false) !== (b?.has(ak) ?? false)) return false;
  }
  return true;
}

/** 이 행에 그려지는 셀 포커스 링만 비교 — 전역 focusedCell 객체가 바뀌어도 포커스 없는 행은 리렌더 생략 */
function rowFocusedCellVisualEqual(
  prevFocused: SortableTaskRowProps['focusedCell'],
  nextFocused: SortableTaskRowProps['focusedCell'],
  prevTaskId: string,
  nextTaskId: string,
): boolean {
  if (prevTaskId !== nextTaskId) return false;
  const prevCol = prevFocused?.taskId === prevTaskId ? prevFocused.columnId : null;
  const nextCol = nextFocused?.taskId === nextTaskId ? nextFocused.columnId : null;
  return prevCol === nextCol;
}

function areRowPropsEqual(prev: SortableTaskRowProps, next: SortableTaskRowProps) {
  const prevSeed = prev.editingCell?.typeToEditSeed ?? undefined;
  const nextSeed = next.editingCell?.typeToEditSeed ?? undefined;
  const editingCellSame =
    prev.editingCell === next.editingCell ||
    (!!prev.editingCell &&
      !!next.editingCell &&
      prev.editingCell.taskId === next.editingCell.taskId &&
      prev.editingCell.columnId === next.editingCell.columnId &&
      prevSeed === nextSeed);
  const focusedCellRelevantSame = rowFocusedCellVisualEqual(prev.focusedCell, next.focusedCell, prev.task.id, next.task.id);
  // 대량 참조(allProjectTasks·displayWbsMap·taskIdToSeqNum·seqNumToTaskId
  // ·criticalPathSet·projectAssignmentsByProjectId)는 어떤 작업이든 변경되면 새 참조가 되어
  // 전 행 memo를 무효화한다. 이 행의 실제 표시값(displayWbsId·wbsSeqLabel·allocationDisplayText
  // ·criticalPathSet.has(task.id))만 비교해 불필요한 재렌더를 방지한다.
  const criticalSame =
    prev.criticalPathSet === next.criticalPathSet || prev.criticalPathSet.has(prev.task.id) === next.criticalPathSet.has(next.task.id);
  return (
    editingCellSame &&
    focusedCellRelevantSame &&
    criticalSame &&
    prev.rowIndex === next.rowIndex &&
    prev.wbsId === next.wbsId &&
    prev.displayWbsId === next.displayWbsId &&
    prev.isSelected === next.isSelected &&
    prev.hasChildren === next.hasChildren &&
    prev.totalDescendantTaskCount === next.totalDescendantTaskCount &&
    prev.isTreeView === next.isTreeView &&
    prev.treeGuide === next.treeGuide &&
    prev.isInlineEditingName === next.isInlineEditingName &&
    prev.gridStyle === next.gridStyle &&
    prev.visibleColumnIds === next.visibleColumnIds &&
    prev.showActionsColumn === next.showActionsColumn &&
    prev.allAssignees === next.allAssignees &&
    prev.assigneeOptionsByProjectId === next.assigneeOptionsByProjectId &&
    prev.statusConfigs === next.statusConfigs &&
    prev.updateProject === next.updateProject &&
    prev.projectEffortUnitByProjectId === next.projectEffortUnitByProjectId &&
    prev.projectScheduleByProjectId === next.projectScheduleByProjectId &&
    prev.allocationDisplayText === next.allocationDisplayText &&
    prev.task.id === next.task.id &&
    rowMarqueeEqual(prev, next) &&
    rowPastedFlashEqual(prev, next) &&
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
    prev.wbsSeqLabel === next.wbsSeqLabel &&
    prev.task.dependencies === next.task.dependencies &&
    prev.task.isMilestone === next.task.isMilestone &&
    prev.task.isIssue === next.task.isIssue &&
    prev.task.isActionItem === next.task.isActionItem &&
    (prev.task.depth ?? 0) === (next.task.depth ?? 0) &&
    prev.task.plannedProgressOverride === next.task.plannedProgressOverride &&
    // 셀 서식(글꼴·색·취소선)·자식(포크) 배지도 렌더에 쓰이므로 비교에 포함 — 변경 시 즉시 다시 그리도록.
    prev.task.cellTextStyles === next.task.cellTextStyles &&
    prev.task.mirroredFromTaskId === next.task.mirroredFromTaskId &&
    prev.task.mirroredFromProjectId === next.task.mirroredFromProjectId &&
    prev.canEdit === next.canEdit &&
    prev.dropIndicator === next.dropIndicator &&
    prev.customColumnNameById === next.customColumnNameById &&
    prev.prependDisplayWbsToTaskName === next.prependDisplayWbsToTaskName &&
    prev.plannedProgress === next.plannedProgress &&
    prev.showTableAutoFormatting === next.showTableAutoFormatting &&
    prev.forkedChildProject === next.forkedChildProject
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
