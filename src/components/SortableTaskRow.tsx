import React, { useState, useMemo } from 'react';
import { GripVertical, Flag, Bug, Lock, Edit2, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { cn, formatDate, formatNum2, round2 } from '../lib/utils';
import { levelRowBg as levelRowBgBase } from '../lib/levelColors';

/** 다크모드: 행 배경 투명 (레벨 구분은 왼쪽 테두리로) */
const levelRowBg = (level: number) =>
  document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'transparent'
    : levelRowBgBase(level);
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
  isCritical?: boolean
): string {
  if (!task) return '';
  const lines: string[] = [];
  const statusName = Array.isArray(statusConfigs) ? statusConfigs.find((c) => c.id === task.status)?.name ?? task.status : task.status;
  const assigneeText = task.assignee || '—';
  lines.push(`작업명: ${task.name ?? ''}`);
  if (task.isMilestone) lines.push('유형: 마일스톤');
  if (task.isIssue) lines.push('이슈: 예');
  if (isCritical) lines.push('크리티컬 패스: 예');
  lines.push(`기간: ${formatDate(task.startDate)} ~ ${formatDate(task.endDate)}`);
  lines.push(`공수: ${task.workEffort != null ? `${task.workEffort}일` : '—'}`);
  if (task.weight != null) lines.push(`가중치: ${task.weight}`);
  lines.push(`담당: ${assigneeText}`);
  lines.push(`상태: ${statusName}`);
  lines.push(`진척률: ${typeof task.progress === 'number' ? `${formatNum2(task.progress)}%` : '—'}`);
  if (task.description?.trim()) lines.push(`설명: ${task.description.trim()}`);
  if (task.deliverables?.trim()) lines.push(`산출물: ${task.deliverables.trim()}`);
  const deps = task.dependencies;
  if (deps && Array.isArray(deps) && deps.length > 0 && displayWbsMap) {
    const depLabels = deps.map((id) => displayWbsMap.get(id) ? `#${displayWbsMap.get(id)}` : id);
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
  otherFocusByCellKey: Map<string, Array<{ userId: string; displayName: string; color: string; taskId: string; columnId: TableColumnId; ts: number }>>;
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
  allAssignees,
  assigneeOptionsByProjectId,
  updateTask,
  statusConfigs,
  projectAssignmentsByProjectId,
  criticalPathSet,
  allocationDisplayText,
  otherFocusByCellKey
}: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const depsDisplayValue = useMemo(() => {
    const depIds = task.dependencies ?? [];
    const nums = depIds
      .map(id => taskIdToSeqNum.get(id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    return nums.length > 0 ? nums.join(', ') : '';
  }, [task.dependencies, taskIdToSeqNum]);

  const [depsInputValue, setDepsInputValue] = useState(depsDisplayValue);
  const [depsFocused, setDepsFocused] = useState(false);
  React.useEffect(() => {
    if (!depsFocused) setDepsInputValue(depsDisplayValue);
  }, [depsDisplayValue, depsFocused]);

  const depth = task.depth || 0;
  const level = depth + 1;

  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const zebraOverlay = rowIndex % 2 === 1 ? (dark ? 'rgba(255,255,255,0.02)' : 'rgba(2, 6, 23, 0.03)') : 'transparent';

  const isDone = task.status === 'done' || (typeof task.progress === 'number' && task.progress >= 100);

  // 다크/라이트 모드별 행 상태 색상
  const doneNormalBg   = dark ? '#1a2332'  : '#e5e7eb';
  const doneSelectedBg = dark ? '#2e2456'  : '#c7d2fe';
  const doneFocusedBg  = dark ? '#3b2f1a'  : '#fef9c3';
  const selectedBg     = dark ? '#3b2e6b'  : '#a5b4fc';
  const focusedBg      = dark ? '#4a3a1a'  : '#fef3c7';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDone
      ? (isSelected ? doneSelectedBg : isFocused ? doneFocusedBg : doneNormalBg)
      : isSelected
        ? selectedBg
        : isFocused
          ? focusedBg
          : levelRowBg(level),
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
          boxShadow: dark
            ? 'inset 0 0 0 3px rgba(168, 85, 247, 0.5)'
            : 'inset 0 0 0 3px rgba(168, 85, 247, 0.8)',
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
          boxShadow: dark
            ? 'inset 0 0 0 2px rgba(245, 158, 11, 0.3)'
            : 'inset 0 0 0 2px rgba(245, 158, 11, 0.5)',
        }
      : {}),
    ...(isDone && !isSelected && !isFocused
      ? { borderLeft: '3px solid rgb(34 197 94)' }
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
      className={cn(
        "data-row group cursor-pointer outline-none transition-colors relative",
        isSelected && !isDone && (dark ? "font-semibold text-purple-300" : "font-semibold text-purple-900 ring-4 ring-inset ring-purple-500/80"),
        isSelected && isDone && (dark ? "font-semibold text-purple-300" : "font-semibold text-purple-900 ring-4 ring-inset ring-purple-500/80"),
        isFocused && !isSelected && !isDone && (dark ? "font-medium text-amber-300" : "font-medium text-amber-900 ring-2 ring-inset ring-amber-500/70"),
        isFocused && !isSelected && isDone && (dark ? "font-medium text-amber-300" : "font-medium text-amber-800 ring-2 ring-inset ring-amber-500/60"),
        isDone && !isSelected && !isFocused && (dark ? "text-slate-500" : "text-stone-500")
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
      {dropIndicator && (
        <div className="absolute inset-0 ring-2 ring-indigo-400 bg-indigo-50/40 pointer-events-none z-10" />
      )}
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
      <div className="data-cell justify-center font-mono text-[10px] text-stone-500 tabular-nums" onDoubleClick={(e) => e.stopPropagation()}>
        {rowIndex + 1}
      </div>
      <div className="data-cell justify-center" onDoubleClick={(e) => e.stopPropagation()}>
        {isTreeView && hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (tableEditMode) return; // 편집 모드에서는 펼치기/접기 비활성화
              toggleExpand(task.id);
            }}
            className={cn(
              "rounded p-0.5 text-xs font-mono tabular-nums transition-colors",
              tableEditMode ? "text-stone-300 cursor-default" : "hover:bg-stone-200 text-stone-600"
            )}
            title={tableEditMode ? "편집 모드에서는 펼치기/접기 불가 (Esc로 편집 모드 해제)" : (task.expanded ? "접기" : "펼치기")}
          >
            {task.expanded ? "▣" : "□"}
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
            <div key={colId} className="data-cell font-mono text-[10px] text-stone-400">
              {wbsId}
            </div>
          );
        }
        if (colId === 'name') {
          const isFocused = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'name' && !isInlineEditingName;
          return (
            <div
              key={colId}
              className={cn("data-cell relative", (tableEditMode && !isInlineEditingName && "ring-1 ring-dashed ring-slate-300 rounded"), isFocused && "ring-2 ring-blue-500 ring-inset")}
              style={{ ...(otherRingStyle ?? {}), paddingLeft: `${depth * 20 + 12}px` }}
              onClick={(e) => {
                // 이름 셀 클릭 시에는 레벨 접기/펼치기를 트리거하지 않고, 행 포커스/선택만 유지
                // (트리 접기/펼치기는 전용 ▣/□ 버튼으로만 수행)
                if (tableEditMode) {
                  e.stopPropagation();
                  setFocusedCell({ taskId: task.id, columnId: 'name' });
                  setInlineEditingNameId(task.id);
                }
              }}
              title={tableEditMode ? '클릭하여 작업명 수정' : getTaskDetailTooltip(task, statusConfigs, displayWbsMap, criticalPathSet?.has(task.id))}
            >
              {isInlineEditingName ? (
                <input
                  id={`wbs-edit-${task.id}-name`}
                  autoFocus
                  defaultValue={task.name}
                  className="w-full text-sm font-bold bg-white text-blue-600 outline-none ring-1 ring-blue-500 rounded px-1"
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
                  className={cn("font-medium text-[var(--color-ink)] flex items-center gap-1.5", tableEditMode ? "cursor-cell" : "cursor-default")}
                  onClick={(e) => { if (tableEditMode) { e.stopPropagation(); setFocusedCell({ taskId: task.id, columnId: 'name' }); setInlineEditingNameId(task.id); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setInlineEditingNameId(task.id); }}
                  title={tableEditMode ? '클릭하여 작업명 수정' : getTaskDetailTooltip(task, statusConfigs, displayWbsMap, criticalPathSet?.has(task.id))}
                >
                  {task.isMilestone && <Flag size={14} className="text-amber-500 flex-shrink-0" title="마일스톤" />}
                  {task.isIssue && <Bug size={14} className="text-rose-600 flex-shrink-0" title="이슈" />}
                  {criticalPathSet?.has(task.id) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold flex-shrink-0" title="크리티컬 패스">크리티컬</span>
                  )}
                  {displayWbsId ? `${displayWbsId} ` : ''}{task.name}
                </span>
              )}
              {otherPrimary && (
                <div
                  className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none"
                  style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}
                  title={othersHere.map(o => o.displayName).join(', ')}
                >
                  {otherPrimary.displayName}
                  {othersHere.length > 1 ? ` +${othersHere.length - 1}` : ''}
                </div>
              )}
            </div>
          );
        }
        const lockedFields = new Set(task.userLockedFields ?? []);
        const LockBadge = ({ field }: { field: 'startDate' | 'endDate' | 'workEffort' | 'dependencies' }) =>
          lockedFields.has(field) ? <Lock size={10} className="text-amber-600 flex-shrink-0" title="사용자 고정 (AI 업데이트 시 유지)" /> : null;
        if (colId === 'startDate') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'startDate';
          const isFocused = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'startDate' && !isEditing;
          return (
            <div
              key={colId}
              className={cn("data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocused && "ring-2 ring-blue-500 ring-inset")}
              style={otherRingStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <LockBadge field="startDate" />
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
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'startDate' }); setEditingCell({ taskId: task.id, columnId: 'startDate' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'startDate' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'startDate' });
                  }}
                  title={tableEditMode ? '클릭하여 시작일 수정' : (task.startDate ? formatDate(task.startDate) : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {formatDate(task.startDate)}
                </button>
              )}
              {otherPrimary && (
                <div className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none" style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}>
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
              className={cn("data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedEnd && "ring-2 ring-blue-500 ring-inset")}
              style={otherRingStyle}
              onClick={(e) => e.stopPropagation()}
            >
              <LockBadge field="endDate" />
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
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'endDate' }); setEditingCell({ taskId: task.id, columnId: 'endDate' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'endDate' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'endDate' });
                  }}
                  title={tableEditMode ? '클릭하여 종료일 수정' : (task.endDate ? formatDate(task.endDate) : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {formatDate(task.endDate)}
                </button>
              )}
              {otherPrimary && (
                <div className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none" style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}>
                  {otherPrimary.displayName}
                </div>
              )}
            </div>
          );
        }
        if (colId === 'workEffort') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'workEffort';
          const isFocusedWE = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'workEffort' && !isEditing;
          return (
            <div
              key={colId}
              className={cn("data-cell relative font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedWE && "ring-2 ring-blue-500 ring-inset")}
              style={otherRingStyle}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <LockBadge field="workEffort" />
              {isEditing ? (
                <input
                  id={`wbs-edit-${task.id}-workEffort`}
                  type="number"
                  min={0}
                  step={0.5}
                  autoFocus
                  defaultValue={task.workEffort ?? ''}
                  className="w-full min-w-0 bg-white border border-blue-400 rounded px-1 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0) {
                      const rounded = Math.round(v * 10) / 10;
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
                  className={cn("rounded px-1 -mx-1 w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'workEffort' }); setEditingCell({ taskId: task.id, columnId: 'workEffort' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'workEffort' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'workEffort' });
                  }}
                  title={tableEditMode ? '클릭하여 공수 수정' : (task.workEffort != null ? `${(Math.round(task.workEffort * 10) / 10)}일` : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {task.workEffort != null ? (Math.round(task.workEffort * 10) / 10).toFixed(1) : '-'}
                </button>
              )}
              {otherPrimary && (
                <div className="absolute -top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-white/90 border border-stone-200 shadow-sm pointer-events-none" style={{ borderColor: otherPrimary.color, color: otherPrimary.color }}>
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
                "data-cell font-mono text-xs text-stone-600 flex items-center gap-1 min-w-0",
                tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded",
                isFocusedW && "ring-2 ring-blue-500 ring-inset"
              )}
              onClick={(e) => e.stopPropagation()}
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
                      const rounded = round2(v);
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
                  className={cn(
                    "rounded px-1 -mx-1 w-full text-left",
                    tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'weight' }); setEditingCell({ taskId: task.id, columnId: 'weight' }); }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'weight' });
                  }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'weight' });
                  }}
                  title={tableEditMode ? '클릭하여 가중치 수정' : (task.weight != null ? `가중치 ${formatNum2(task.weight)}` : '더블클릭 또는 탭으로 포커스 후 수정')}
                >
                  {task.weight != null ? formatNum2(task.weight) : '-'}
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
              className={cn("data-cell font-mono text-xs text-stone-600 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedProg && "ring-2 ring-blue-500 ring-inset")}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, task.id, 'progress');
              }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              title={tableEditMode ? '클릭하여 진척률 수정 · 우클릭: 갱신 메뉴' : '더블클릭하여 수정 · 마우스 우클릭: 갱신 메뉴'}
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
                  className={cn("rounded px-1 -mx-1 inline-block w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'progress' }); setEditingCell({ taskId: task.id, columnId: 'progress' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'progress' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'progress' });
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
          const assigneeOptions = Array.from(new Set([...projectAssignees, task.assignee?.trim()].filter(Boolean))).sort();
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'assignee';
          const isFocusedAssignee = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'assignee' && !isEditing;
          return (
            <div
              key={colId}
              className={cn("data-cell text-xs text-stone-600 relative overflow-visible group/assignee", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedAssignee && "ring-2 ring-blue-500 ring-inset")}
              onClick={(e) => { e.stopPropagation(); if (tableEditMode && !isEditing) { setFocusedCell({ taskId: task.id, columnId: 'assignee' }); setEditingCell({ taskId: task.id, columnId: 'assignee' }); } }}
              onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'assignee' }); }}
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
                      if (e.key === 'Escape') { setEditingCell(null); e.preventDefault(); }
                    }}
                  />
                  <datalist id={`assignee-datalist-${task.id}`}>
                    <option value="">배정 안됨</option>
                    {assigneeOptions.length > 0
                      ? assigneeOptions.map(a => <option key={a} value={a} />)
                      : allAssignees.map(a => <option key={a} value={a} />)}
                  </datalist>
                </>
              ) : (
                <>
                  <div className={cn("w-full px-1 py-0.5 truncate", task.assignee ? "text-stone-600" : "text-stone-400")}>
                    {task.assignee || '배정 ...'}
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center px-1 text-stone-400 group-hover/assignee:text-stone-600">
                    <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                  </div>
                </>
              )}
            </div>
          );
        }
        if (colId === 'allocation') {
          const assignee = (task.assignee || '').trim();
          const projectList = task.projectId ? (projectAssignmentsByProjectId.get(task.projectId) ?? []) : [];
          const fromProject = projectList.find(a => (a.assignee || '').trim() === assignee);
          const primaryPercent = fromProject?.allocationPercent ?? 100;
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'allocation';
          const isFocusedAlloc = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'allocation' && !isEditing;
          return (
            <div
              key={colId}
              className={cn("data-cell font-mono text-xs text-stone-600 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedAlloc && "ring-2 ring-blue-500 ring-inset")}
              onClick={(e) => e.stopPropagation()}
              title={tableEditMode ? '클릭하여 투입율 수정' : '더블클릭하여 투입율 수정'}
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
                  className={cn("rounded px-1 -mx-1 inline-block w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'allocation' }); setEditingCell({ taskId: task.id, columnId: 'allocation' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'allocation' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'allocation' });
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
            <div key={colId} className={cn("data-cell", isFocusedStatus && "ring-2 ring-blue-500 ring-inset rounded")} onClick={(e) => { e.stopPropagation(); if (tableEditMode) setFocusedCell({ taskId: task.id, columnId: 'status' }); }}>
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e, task.id, 'status');
                }}
                className="w-full bg-transparent p-1 focus:bg-white focus:ring-1 focus:ring-blue-500 rounded border border-transparent hover:border-stone-200 cursor-pointer transition-colors appearance-none text-xs"
              >
                {statusConfigs.map((config) => (
                  <option key={config.id} value={config.id}>{config.name}</option>
                ))}
              </select>
            </div>
          );
        }
        if (colId === 'deliverables') {
          const isEditing = editingCell?.taskId === task.id && editingCell?.columnId === 'deliverables';
          const isFocusedDel = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'deliverables' && !isEditing;
          return (
            <div key={colId} className={cn("data-cell text-xs text-stone-600 min-w-0", tableEditMode && !isEditing && "ring-1 ring-dashed ring-slate-300 rounded", isFocusedDel && "ring-2 ring-blue-500 ring-inset")} onClick={(e) => e.stopPropagation()}>
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
                    e.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cn("rounded px-1 -mx-1 block truncate w-full text-left", tableEditMode ? "cursor-cell hover:bg-blue-50/80" : "cursor-default hover:bg-blue-50/80")}
                  onClick={(e) => { e.stopPropagation(); if (tableEditMode) { setFocusedCell({ taskId: task.id, columnId: 'deliverables' }); setEditingCell({ taskId: task.id, columnId: 'deliverables' }); } }}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingCell({ taskId: task.id, columnId: 'deliverables' }); }}
                  onFocus={(e) => {
                    if (!tableEditMode) return;
                    e.stopPropagation();
                    setEditingCell({ taskId: task.id, columnId: 'deliverables' });
                  }}
                  title={tableEditMode ? '클릭하여 산출물 수정' : ((task.deliverables || '').trim() || '더블클릭 또는 탭으로 포커스 후 수정')}
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
            const parts = (typeof raw === 'string' ? raw : '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            const taskIds: string[] = [];
            const seen = new Set<number>();
            for (const p of parts) {
              const n = parseInt(p, 10);
              if (!Number.isFinite(n) || n < 1 || seen.has(n) || n === selfSeq) continue;
              seen.add(n);
              const id = seqNumToTaskId.get(n);
              if (id) taskIds.push(id);
            }
            const locked = new Set(task.userLockedFields ?? []);
            locked.add('dependencies');
            updateTask(task.id, { dependencies: taskIds, userLockedFields: Array.from(locked) });
          };
          const isFocusedDep = tableEditMode && focusedCell?.taskId === task.id && focusedCell?.columnId === 'dependencies';
          return (
            <div key={colId} className={cn("data-cell text-xs text-stone-600 font-mono flex items-center gap-1 min-w-0", isFocusedDep && "ring-2 ring-blue-500 ring-inset rounded")} onClick={(e) => { e.stopPropagation(); if (tableEditMode) setFocusedCell({ taskId: task.id, columnId: 'dependencies' }); }} title="행 번호 입력 (예: 1, 2, 5). F2로 이 셀 포커스. 자물쇠: 사용자 고정">
              <LockBadge field="dependencies" />
              <input
                id={`wbs-edit-${task.id}-dependencies`}
                data-deps-input="true"
                type="text"
                value={depsInputValue ?? ''}
                onChange={(e) => {
                  if (!tableEditMode) return;
                  const v = e.target.value.replace(/[^\d\s,]/g, '');
                  setDepsInputValue(v);
                }}
                readOnly={!tableEditMode}
                tabIndex={tableEditMode ? 0 : -1}
                onMouseDown={(e) => {
                  if (!tableEditMode) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onFocus={(e) => {
                  if (!tableEditMode) {
                    e.currentTarget.blur();
                    return;
                  }
                  setDepsFocused(true);
                }}
                onBlur={() => {
                  if (!tableEditMode) return;
                  setDepsFocused(false);
                  applyDependenciesInput((depsInputValue ?? '').trim());
                }}
                onKeyDown={(e) => {
                  if (!tableEditMode) return;
                  if (e.key === 'Enter') {
                    setDepsFocused(false);
                    applyDependenciesInput((depsInputValue ?? '').trim());
                    e.currentTarget.blur();
                  }
                }}
                placeholder=""
                className={cn(
                  "w-full min-w-0 bg-transparent p-1 font-mono text-inherit border border-transparent hover:border-stone-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 rounded focus:outline-none",
                  !tableEditMode && "cursor-default"
                )}
              />
            </div>
          );
        }
        return null;
      })}
      <div className="data-cell justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onDoubleClick={(e) => e.stopPropagation()}>
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
    (!!prev.editingCell && !!next.editingCell && prev.editingCell.taskId === next.editingCell.taskId && prev.editingCell.columnId === next.editingCell.columnId);
  const focusedCellSame =
    prev.focusedCell === next.focusedCell ||
    (!!prev.focusedCell && !!next.focusedCell && prev.focusedCell.taskId === next.focusedCell.taskId && prev.focusedCell.columnId === next.focusedCell.columnId);
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
    prev.taskIdToSeqNum === next.taskIdToSeqNum &&
    prev.seqNumToTaskId === next.seqNumToTaskId &&
    prev.task.dependencies === next.task.dependencies &&
    (prev.task.userLockedFields?.length ?? 0) === (next.task.userLockedFields?.length ?? 0) &&
    (prev.task.userLockedFields ?? []).every((f, i) => (next.task.userLockedFields ?? [])[i] === f) &&
    (prev.task.depth ?? 0) === (next.task.depth ?? 0) &&
    prev.canEdit === next.canEdit &&
    prev.dropIndicator === next.dropIndicator
  );
}

export const SortableTaskRow = React.memo(SortableTaskRowInner, areRowPropsEqual);

