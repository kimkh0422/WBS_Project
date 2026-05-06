import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Flag, Bug, Edit2, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, type WorkEffortUnit } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatDate, formatNum1, formatNum2, round1, round2 } from '../lib/utils';
import { useOrganization } from '../context/OrganizationContext';
import { useLevelColors } from '../context/LevelColorsContext';
import { useWBS } from '../context/WBSContext';
import { filterTasksForDependencyPicker, getActiveDependencyToken, hasDependencyCycle } from '../lib/dependencyPicker';
import { formatStoredWorkEffortForDisplay, normalizeWorkEffortUnit, workEffortUnitSuffixKo } from '../lib/workEffortUnits';
import { useToast } from './Toast';
import { type TableColumnId } from './wbsTableTypes';

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
): string {
  if (!task) return '';
  const lines: string[] = [];
  const effortUnit = normalizeWorkEffortUnit(projectEffortUnitByProjectId?.get(task.projectId));
  const statusName = Array.isArray(statusConfigs) ? (statusConfigs.find((c) => c.id === task.status)?.name ?? task.status) : task.status;
  const assigneeText = task.assignee || '—';
  lines.push(`작업명: ${task.name ?? ''}`);
  if (task.isMilestone) lines.push('유형: 마일스톤');
  if (task.isIssue) lines.push('이슈: 예');
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
  lines.push(`진척률: ${typeof task.progress === 'number' ? `${formatNum2(task.progress)}%` : '—'}`);
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
  dropIndicator?: 'before' | 'inside' | 'after' | null;
  wbsId?: string;
  displayWbsId?: string;
  displayWbsMap: Map<string, string>;
  taskIdToSeqNum: TaskIdToSeqNum;
  seqNumToTaskId: SeqNumToTaskId;
  isSelected: boolean;
  /** 키보드 포커스 행 (상하 이동 시 체크와 무관하게 표시) */
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
  isInlineEditingName: boolean;
  setInlineEditingNameId: (id: string | null) => void;
  editingCell: { taskId: string; columnId: TableColumnId } | null;
  setEditingCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  setFocusedCell: (v: { taskId: string; columnId: TableColumnId } | null) => void;
  /** 편집 버튼으로 켠 엑셀형 즉석 편집 모드: 셀 클릭만으로 해당 컬럼 편집 */
  tableEditMode: boolean;
  /** 셀 클릭으로 편집을 시작할 때 편집모드를 자동으로 켜기 위한 setter */
  setTableEditMode: (v: boolean) => void;
  allAssignees: string[];
  /** projectId → 프로젝트 등록 인원 + 해당 프로젝트 작업 담당자 목록 */
  assigneeOptionsByProjectId: Map<string, string[]>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  statusConfigs: Array<{ id: string; name: string; progress?: number }>;
  /** projectId → assignments (for showing allocation when task has no assignments) */
  projectAssignmentsByProjectId: Map<string, Array<{ assignee: string; allocationPercent: number }>>;
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
  isInlineEditingName,
  setInlineEditingNameId,
  editingCell,
  setEditingCell,
  focusedCell,
  setFocusedCell,
  tableEditMode,
  setTableEditMode,
  allAssignees,
  assigneeOptionsByProjectId,
  updateTask,
  statusConfigs,
  projectAssignmentsByProjectId,
  criticalPathSet,
  allocationDisplayText,
  otherFocusByCellKey,
  customColumnNameById,
  projectEffortUnitByProjectId,
}: SortableTaskRowProps) {
  const effortUnitForTask = normalizeWorkEffortUnit(projectEffortUnitByProjectId.get(task.projectId));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const { orgMembers } = useOrganization();
  const { levelRowBg: levelRowBgCtx } = useLevelColors();

  /**
   * 셀 클릭 시 호출: 2단계 동작 (Excel 패턴).
   * - 1단계: 아직 포커스되지 않은 행의 셀을 클릭 → 행/셀 포커스만 잡고 편집은 시작하지 않음.
   * - 2단계: 이미 포커스된 행의 셀(같거나 다른 셀)을 클릭 → 편집 모드 진입.
   * - F2를 누르면 항상 현재 포커스된 셀(없으면 name)을 편집할 수 있음 (모든 컬럼 동일).
   */
  const beginEdit = (columnId: TableColumnId) => {
    // 1단계: 다른 행에서 처음 클릭 → 포커스만
    if (!isFocused) {
      setTableEditMode(true);
      setFocusedCell({ taskId: task.id, columnId });
      onFocusRow?.(task.id);
      onSetRowAnchor?.(task.id);
      return;
    }
    // 2단계: 이미 선택된 행의 셀 클릭 → 편집 시작
    setTableEditMode(true);
    setFocusedCell({ taskId: task.id, columnId });
    onFocusRow?.(task.id);
    onSetRowAnchor?.(task.id);
    if (columnId === 'name') {
      setInlineEditingNameId(task.id);
      setEditingCell(null);
    } else {
      setEditingCell({ taskId: task.id, columnId });
      setInlineEditingNameId(null);
    }
  };
  /** 편집은 시작하지 않고 포커스만 옮길 때 (status select / dependencies input의 click 등) */
  const beginFocus = (columnId: TableColumnId) => {
    setTableEditMode(true);
    setFocusedCell({ taskId: task.id, columnId });
    onFocusRow?.(task.id);
    onSetRowAnchor?.(task.id);
  };
  /**
   * 표 행의 레벨 배경색.
   * - 다크모드: 컨텍스트가 transparent 반환 (왼쪽 테두리로 레벨 구분)
   * - 라이트모드 + 하위 작업이 있는 요약(상위) 행: 사용자 정의(없으면 기본) 레벨 색을 칠해 계층 구분 강조
   * - 라이트모드 + 리프(말단) 행: 투명 → 요약행이 자연스럽게 도드라지도록
   */
  const rowLevelBg = (lev: number, hasKids: boolean) => (hasKids ? levelRowBgCtx(lev) : 'transparent');
  const orgMemberNames = useMemo(() => orgMembers.map((m) => m.name), [orgMembers]);
  const orgMemberLabelByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const member of orgMembers) {
      if (!m.has(member.name)) m.set(member.name, `${member.department} · ${member.position}`);
    }
    return m;
  }, [orgMembers]);

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
  const { tasks } = useWBS();
  const { push: pushToast } = useToast();
  const projectPickCandidates = useMemo(
    () => tasks.filter((t) => t.projectId === task.projectId && t.id !== task.id),
    [tasks, task.projectId, task.id],
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

  const isDone = task.status === 'done' || (typeof task.progress === 'number' && task.progress >= 100);

  // 다크/라이트 모드별 행 상태 색상
  const doneNormalBg = dark ? '#1a2332' : '#e5e7eb';
  const doneSelectedBg = dark ? '#2e2456' : '#c7d2fe';
  const doneFocusedBg = dark ? '#3b2f1a' : '#fef9c3';
  const selectedBg = dark ? '#3b2e6b' : '#a5b4fc';
  const focusedBg = dark ? '#4a3a1a' : '#fef3c7';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDone
      ? isSelected
        ? doneSelectedBg
        : isFocused
          ? doneFocusedBg
          : doneNormalBg
      : isSelected
        ? selectedBg
        : isFocused
          ? focusedBg
          : rowLevelBg(level, hasChildren),
    backgroundImage: isSelected || isDone || isFocused ? undefined : `linear-gradient(${zebraOverlay}, ${zebraOverlay})`,
    ...(isSelected && !isDone
      ? {
          borderLeft: '5px solid rgb(147 51 234)',
          boxShadow: dark
            ? 'inset 0 0 0 2px rgba(168, 85, 247, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4)'
            : 'inset 0 0 0 2px rgba(168, 85, 247, 0.7), 0 2px 6px rgba(147, 51, 234, 0.35)',
        }
      : {}),
    ...(isSelected && isDone
      ? {
          borderLeft: '5px solid rgb(147 51 234)',
          boxShadow: dark ? 'inset 0 0 0 3px rgba(168, 85, 247, 0.5)' : 'inset 0 0 0 3px rgba(168, 85, 247, 0.8)',
        }
      : {}),
    ...(isFocused && !isSelected && !isDone
      ? {
          borderLeft: '4px solid rgb(217 119 6)',
          boxShadow: dark
            ? 'inset 0 0 0 2px rgba(245, 158, 11, 0.3), 0 1px 3px rgba(0, 0, 0, 0.3)'
            : 'inset 0 0 0 2px rgba(245, 158, 11, 0.45), 0 1px 3px rgba(217, 119, 6, 0.25)',
        }
      : {}),
    ...(isFocused && !isSelected && isDone
      ? {
          borderLeft: '4px solid rgb(217 119 6)',
          boxShadow: dark ? 'inset 0 0 0 2px rgba(245, 158, 11, 0.3)' : 'inset 0 0 0 2px rgba(245, 158, 11, 0.5)',
        }
      : {}),
    ...(isDone && !isSelected && !isFocused ? { borderLeft: '3px solid rgb(34 197 94)' } : {}),
    zIndex: isDragging ? 10 : isSelected || isFocused ? 2 : 1,
    position: isDragging ? 'relative' : undefined,
    ...gridStyle,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      id={`task-row-${task.id}`}
      className={cn(
        'data-row group cursor-pointer outline-none transition-colors relative',
        isSelected &&
          !isDone &&
          (dark ? 'font-semibold text-purple-300' : 'font-semibold text-purple-900 ring-4 ring-inset ring-purple-500/80'),
        isSelected &&
          isDone &&
          (dark ? 'font-semibold text-purple-300' : 'font-semibold text-purple-900 ring-4 ring-inset ring-purple-500/80'),
        isFocused &&
          !isSelected &&
          !isDone &&
          (dark ? 'font-medium text-amber-300' : 'font-medium text-amber-900 ring-2 ring-inset ring-amber-500/70'),
        isFocused &&
          !isSelected &&
          isDone &&
          (dark ? 'font-medium text-amber-300' : 'font-medium text-amber-800 ring-2 ring-inset ring-amber-500/60'),
        isDone && !isSelected && !isFocused && (dark ? 'text-slate-500' : 'text-stone-500'),
        // 요약(상위)행 타이포 강조: 선택/포커스 상태가 아닐 때만 추가 (해당 상태가 우선)
        hasChildren && !isSelected && !isFocused && 'font-semibold',
      )}
      onClick={(e) => {
        if (e.shiftKey) {
          onSelect(task.id, false, true);
          if (onFocusRow) onFocusRow(task.id);
          return;
        }
        if (e.ctrlKey || e.metaKey) {
          onSelect(task.id, true, false);
          if (onFocusRow) onFocusRow(task.id);
          return;
        }
        if (onFocusRow) onFocusRow(task.id);
        onSetRowAnchor?.(task.id);
      }}
      tabIndex={0}
      onDoubleClick={() => onEdit(task)}
      onContextMenu={(e) => onContextMenu(e, task.id, undefined)}
    >
      {dropIndicator && <div className="absolute inset-0 ring-2 ring-indigo-400 bg-indigo-50/40 pointer-events-none z-10" />}
      <div
        className="data-cell justify-center cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500"
        onDoubleClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </div>
      <div className="data-cell justify-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
          checked={isSelected}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey) {
              onSelect(task.id, false, true);
            } else if (e.ctrlKey || e.metaKey) {
              onSelect(task.id, true, false);
            } else {
              onSelect(task.id, true, false);
            }
          }}
          onChange={() => {
            // onClick에서 제어하므로 onChange는 비워 둔다.
          }}
        />
      </div>
      <div
        className="data-cell justify-center font-mono text-[10px] text-stone-500 tabular-nums"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {rowIndex + 1}
      </div>
      <div className="data-cell justify-center" onDoubleClick={(e) => e.stopPropagation()}>
        {isTreeView && hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(task.id);
            }}
            className="rounded p-0.5 text-xs font-mono tabular-nums transition-colors hover:bg-stone-200 text-stone-600"
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
              className="data-cell font-mono text-[10px] text-stone-400 cursor-pointer"
              onClick={() => {
                // wbsId 칸 클릭도 행 포커스로 동작 — 편집 가능한 첫 컬럼을 기본 포커스 셀로 지정
                const firstEditable = visibleColumnIds.find((c) => c !== 'wbsId') ?? 'name';
                onFocusRow?.(task.id);
                onSetRowAnchor?.(task.id);
                setFocusedCell({ taskId: task.id, columnId: firstEditable });
                setTableEditMode(true);
              }}
            >
              {wbsId}
            </div>
          );
        }
        if (colId === 'name') {
          const isFocused = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'name' && !isInlineEditingName;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative',
                tableEditMode && !isInlineEditingName && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocused && 'ring-2 ring-blue-500 ring-inset',
              )}
              style={{ ...(otherRingStyle ?? {}), paddingLeft: `${depth * 20 + 12}px` }}
              onClick={(e) => {
                // 셀 클릭만으로 즉시 인라인 편집 시작 (편집모드 자동 진입).
                // 트리 접기/펼치기는 전용 ▣/□ 버튼으로만 수행.
                // 이미 작업명 input이 떠 있으면 중복 beginEdit 방지 (버블링된 클릭 등).
                e.stopPropagation();
                if (isInlineEditingName) return;
                beginEdit('name');
              }}
              onDoubleClick={(e) => {
                // 작업명이 비어 있어 안쪽 span의 클릭 영역이 없어도, 셀 전체 더블클릭으로 인라인 편집 시작.
                // (행의 onDoubleClick=상세 모달 열기로 버블되지 않도록 stopPropagation)
                if (isInlineEditingName) return;
                e.stopPropagation();
                beginEdit('name');
              }}
              title={getTaskDetailTooltip(task, statusConfigs, displayWbsMap, criticalPathSet?.has(task.id), projectEffortUnitByProjectId)}
            >
              {isInlineEditingName ? (
                <input
                  id={`wbs-edit-${task.id}-name`}
                  autoFocus
                  defaultValue={task.name}
                  className="w-full min-h-[28px] text-sm font-bold bg-white text-blue-600 outline-none ring-1 ring-blue-500 rounded px-1"
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== task.name) {
                      updateTask(task.id, { name: e.target.value.trim() });
                    }
                    setInlineEditingNameId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setInlineEditingNameId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="font-medium text-[var(--color-ink)] flex items-center gap-1.5 cursor-cell"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('name');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('name');
                  }}
                  title={getTaskDetailTooltip(
                    task,
                    statusConfigs,
                    displayWbsMap,
                    criticalPathSet?.has(task.id),
                    projectEffortUnitByProjectId,
                  )}
                >
                  {task.isMilestone && <Flag size={14} className="text-amber-500 flex-shrink-0" title="마일스톤" />}
                  {task.isIssue && <Bug size={14} className="text-rose-600 flex-shrink-0" title="이슈" />}
                  {criticalPathSet?.has(task.id) && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0"
                      title="크리티컬 패스"
                    >
                      크리티컬
                    </span>
                  )}
                  {task.name ? (
                    task.name
                  ) : (
                    <span className="italic text-stone-400 font-normal select-none">(클릭 또는 F2로 작업명 입력)</span>
                  )}
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none"
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
          const isFocused = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'startDate' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocused && 'ring-2 ring-blue-500 ring-inset',
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
                  type="date"
                  autoFocus
                  defaultValue={task.startDate ? task.startDate.slice(0, 10) : ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v && v !== (task.startDate?.slice(0, 10) ?? '')) {
                      updateTask(task.id, { startDate: v + (task.startDate?.slice(10) || '') });
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
                  className="rounded px-1 -mx-1 w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('startDate');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('startDate');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('startDate');
                  }}
                  title="클릭하여 시작일 수정"
                >
                  {formatDate(task.startDate)}
                </button>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none"
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
          const isFocusedEnd = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'endDate' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedEnd && 'ring-2 ring-blue-500 ring-inset',
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
                  type="date"
                  autoFocus
                  defaultValue={task.endDate ? task.endDate.slice(0, 10) : ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v && v !== (task.endDate?.slice(0, 10) ?? '')) {
                      updateTask(task.id, { endDate: v + (task.endDate?.slice(10) || '') });
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
                  className="rounded px-1 -mx-1 w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('endDate');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('endDate');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('endDate');
                  }}
                  title="클릭하여 종료일 수정"
                >
                  {formatDate(task.endDate)}
                </button>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none"
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
          const isFocusedWE = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'workEffort' && !isEditing;
          const effortStep = effortUnitForTask === 'minute' ? 1 : 0.5;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedWE && 'ring-2 ring-blue-500 ring-inset',
              )}
              style={otherRingStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('workEffort');
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-workEffort`}
                  type="number"
                  min={0}
                  step={effortStep}
                  autoFocus
                  defaultValue={task.workEffort ?? ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                <button
                  type="button"
                  className="rounded px-1 -mx-1 w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('workEffort');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('workEffort');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('workEffort');
                  }}
                  title={`클릭하여 공수 수정 (${workEffortUnitSuffixKo(effortUnitForTask)})`}
                >
                  {task.workEffort != null ? formatStoredWorkEffortForDisplay(task.workEffort, effortUnitForTask) : '-'}
                </button>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none"
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
          const isFocusedW = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'weight' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedW && 'ring-2 ring-blue-500 ring-inset',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('weight');
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-weight`}
                  type="number"
                  min={0}
                  step={0.1}
                  autoFocus
                  defaultValue={task.weight ?? ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                  className="rounded px-1 -mx-1 w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('weight');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('weight');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('weight');
                  }}
                  title="클릭하여 가중치 수정"
                >
                  {task.weight != null ? formatNum1(task.weight) : '-'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'progress') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'progress';
          const isFocusedProg = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'progress' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell font-mono text-xs text-stone-600 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedProg && 'ring-2 ring-blue-500 ring-inset',
              )}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'progress');
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('progress');
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title="클릭하여 진척률 수정 · 우클릭: 갱신 메뉴"
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
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                <button
                  type="button"
                  className="rounded px-1 -mx-1 inline-block w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('progress');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('progress');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('progress');
                  }}
                >
                  {typeof task.progress === 'number' ? `${formatNum2(task.progress)}%` : '-'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'assignee') {
          const projectAssignees = (task.projectId ? assigneeOptionsByProjectId.get(task.projectId) : []) ?? [];
          const assigneeOptions = Array.from(new Set([...projectAssignees, task.assignee?.trim(), ...orgMemberNames].filter(Boolean))).sort(
            (a, b) => a.localeCompare(b, 'ko'),
          );
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'assignee';
          const isFocusedAssignee = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'assignee' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell text-xs text-stone-600 relative overflow-visible group/assignee',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedAssignee && 'ring-2 ring-blue-500 ring-inset',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('assignee');
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                beginEdit('assignee');
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
                    className="w-full bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none pr-6"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (task.assignee || '').trim()) {
                        updateTask(task.id, { assignee: v });
                      }
                      setEditingCell(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        setEditingCell(null);
                        e.preventDefault();
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
                  <div className={cn('w-full px-1 py-0.5 truncate', task.assignee ? 'text-stone-600' : 'text-stone-400')}>
                    {task.assignee || '배정 ...'}
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center px-1 text-stone-400 group-hover/assignee:text-stone-600">
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
          const assignee = (task.assignee || '').trim();
          const projectList = task.projectId ? (projectAssignmentsByProjectId.get(task.projectId) ?? []) : [];
          const fromProject = projectList.find((a) => (a.assignee || '').trim() === assignee);
          const primaryPercent = fromProject?.allocationPercent ?? 100;
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'allocation';
          const isFocusedAlloc = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'allocation' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell font-mono text-xs text-stone-600 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedAlloc && 'ring-2 ring-blue-500 ring-inset',
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing) beginEdit('allocation');
              }}
              title="클릭하여 투입율 수정"
            >
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-allocation`}
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  autoFocus
                  defaultValue={primaryPercent}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={() => {
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
                  className="rounded px-1 -mx-1 inline-block w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('allocation');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('allocation');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('allocation');
                  }}
                >
                  {allocationDisplayText ?? '—'}
                </button>
              )}
            </div>
          );
        }
        if (colId === 'status') {
          const isFocusedStatus = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'status';
          return (
            <div
              key={colId}
              className={cn('data-cell', isFocusedStatus && 'ring-2 ring-blue-500 ring-inset rounded')}
              onClick={(e) => {
                e.stopPropagation();
                beginFocus('status');
              }}
            >
              <select
                id={`wbs-edit-${task.id}-status`}
                value={task.status}
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
                }}
                onFocus={() => beginFocus('status')}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, task.id, 'status');
                }}
                className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 cursor-pointer transition-colors appearance-none text-xs"
              >
                {statusConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        if (colId === 'deliverables') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'deliverables';
          const isFocusedDel = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'deliverables' && !isEditing;
          return (
            <div
              key={colId}
              className={cn(
                'data-cell text-xs text-stone-600 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedDel && 'ring-2 ring-blue-500 ring-inset',
              )}
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
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                  className="rounded px-1 -mx-1 block truncate w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit('deliverables');
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit('deliverables');
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit('deliverables');
                  }}
                  title={(task.deliverables || '').trim() || '클릭하여 산출물 수정'}
                >
                  {task.deliverables || '-'}
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
            const locked = new Set(task.userLockedFields ?? []);
            locked.add('dependencies');
            updateTask(task.id, { dependencies: taskIds, userLockedFields: Array.from(locked) });
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
            const locked = new Set(task.userLockedFields ?? []);
            locked.add('dependencies');
            updateTask(task.id, { dependencies: taskIds, userLockedFields: Array.from(locked) });
            const visibleNums = taskIds
              .map((tid) => taskIdToSeqNum.get(tid))
              .filter((n): n is number => n != null)
              .sort((a, b) => a - b);
            setDepsInputValue(visibleNums.join(', '));
          };
          const isFocusedDep = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'dependencies';
          // 드롭다운은 input이 실제 포커스됐을 때만 열림. Enter로 편집 종료 시 setDepsFocused(false)로 자동 닫힘.
          const depsMenuOpen = depsFocused && depSuggestionsList.length > 0;
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
                'data-cell text-xs text-stone-600 font-mono flex items-center gap-1 min-w-0 relative',
                depsMenuOpen && 'z-20 overflow-visible',
                isFocusedDep && 'ring-2 ring-blue-500 ring-inset rounded',
              )}
              onClick={(e) => {
                e.stopPropagation();
                beginFocus('dependencies');
                // 셀의 빈 영역을 클릭해도 input이 직접 포커스되어 드롭다운이 자동으로 펼쳐지도록 보정
                document.getElementById(`wbs-edit-${task.id}-dependencies`)?.focus();
              }}
              title={
                hiddenDepLabels.length > 0
                  ? `행 번호 또는 작업명 검색 후 선택. 접힘/필터로 보이지 않는 선행작업: ${hiddenDepLabels.join(', ')}`
                  : '행 번호(예: 1, 2) 또는 작업명·WBS 일부 입력 후 목록에서 선택. F2로 이 셀 포커스'
              }
            >
              {hiddenDepLabels.length > 0 && (
                <span
                  className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded flex-shrink-0"
                  title={`접힘/필터로 보이지 않는 선행작업 ${hiddenDepLabels.length}건: ${hiddenDepLabels.join(', ')}`}
                  aria-label={`보이지 않는 선행작업 ${hiddenDepLabels.length}건`}
                >
                  +{hiddenDepLabels.length}
                </span>
              )}
              <div className="relative min-w-0 flex-1">
                <input
                  id={`wbs-edit-${task.id}-dependencies`}
                  data-deps-input="true"
                  type="text"
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
                  className="w-full min-w-0 bg-transparent p-1 font-mono text-inherit border border-transparent hover:border-stone-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded focus:outline-none"
                  autoComplete="off"
                />
                {renderDepsDropdown}
              </div>
            </div>
          );
        }
        if (colId.startsWith('custom:')) {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === colId;
          const isFocusedCustom = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === colId && !isEditing;
          const currentValue = task.customFields?.[colId] ?? '';
          const customLabel = customColumnNameById.get(colId) ?? colId.replace(/^custom:/, '');
          return (
            <div
              key={colId}
              className={cn(
                'data-cell text-xs text-stone-600 min-w-0',
                tableEditMode && !isEditing && 'ring-1 ring-dashed ring-slate-300 rounded',
                isFocusedCustom && 'ring-2 ring-blue-500 ring-inset',
              )}
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
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
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
                  className="rounded px-1 -mx-1 block truncate w-full text-left cursor-cell hover:bg-blue-50/80"
                  onClick={(e) => {
                    e.stopPropagation();
                    beginEdit(colId);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    beginEdit(colId);
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                    beginEdit(colId);
                  }}
                  title={currentValue || `${customLabel} 입력`}
                >
                  {currentValue || '-'}
                </button>
              )}
            </div>
          );
        }
        return null;
      })}
      <div
        className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
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
    prev.allAssignees === next.allAssignees &&
    prev.assigneeOptionsByProjectId === next.assigneeOptionsByProjectId &&
    prev.statusConfigs === next.statusConfigs &&
    prev.projectAssignmentsByProjectId === next.projectAssignmentsByProjectId &&
    prev.projectEffortUnitByProjectId === next.projectEffortUnitByProjectId &&
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
    (prev.task.userLockedFields?.length ?? 0) === (next.task.userLockedFields?.length ?? 0) &&
    (prev.task.userLockedFields ?? []).every((f, i) => (next.task.userLockedFields ?? [])[i] === f) &&
    (prev.task.depth ?? 0) === (next.task.depth ?? 0) &&
    prev.canEdit === next.canEdit &&
    prev.dropIndicator === next.dropIndicator &&
    prev.customColumnNameById === next.customColumnNameById
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
      className="rounded-md border border-stone-200 dark:border-stone-600 bg-white dark:bg-slate-900 shadow-lg py-0.5"
    >
      {items.map((t, i) => {
        const rowNum = taskIdToSeqNum.get(t.id);
        return (
          <li key={t.id} role="option" aria-selected={i === pickIdx}>
            <button
              type="button"
              className={cn(
                'w-full text-left px-2 py-1 text-[12px] leading-snug flex gap-1.5 items-baseline',
                i === pickIdx ? 'bg-blue-50 dark:bg-blue-950/50' : 'hover:bg-stone-50 dark:hover:bg-slate-800',
              )}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => setPickIdx(i)}
              onClick={() => onPick(t.id)}
            >
              {rowNum != null && <span className="text-stone-400 tabular-nums shrink-0">{rowNum}.</span>}
              <span className="min-w-0">
                {displayWbsMap.get(t.id) && <span className="text-stone-400 tabular-nums mr-0.5">{displayWbsMap.get(t.id)}</span>}
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
