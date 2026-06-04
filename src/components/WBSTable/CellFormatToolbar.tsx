import React, { useCallback, useMemo } from 'react';
import { Bold, Italic, Underline, Strikethrough, Eraser } from 'lucide-react';
import type { Task, CellTextStyle } from '../../types';
import type { TableColumnId } from '../wbsTableTypes';
import { cn } from '../../lib/utils';
import { mergeTaskCellTextStyles } from '../../lib/cellTextStyle';

const FONT_CHOICES = [
  { value: '', label: '글꼴(기본)' },
  { value: 'system-ui, sans-serif', label: '시스템 UI' },
  { value: 'Malgun Gothic, sans-serif', label: '맑은 고딕' },
  { value: 'Apple SD Gothic Neo, sans-serif', label: 'Apple SD Gothic' },
  { value: 'Pretendard, system-ui, sans-serif', label: 'Pretendard' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'ui-monospace, monospace', label: '고정폭' },
];

function builtinColumnLabel(id: TableColumnId): string {
  const m: Partial<Record<string, string>> = {
    wbsId: 'WBS',
    name: '작업명',
    startDate: '시작일',
    endDate: '종료일',
    workEffort: '공수',
    weight: '가중치',
    assignee: '담당',
    allocation: '투입율',
    status: '상태',
    progress: '진척률',
    plannedProgress: '계획율',
    progressVariance: '진척차이',
    deliverables: '산출물',
    dependencies: '선행작업',
  };
  return m[id] ?? id;
}

export interface CellFormatToolbarProps {
  focusedCell: { taskId: string; columnId: TableColumnId };
  /** 체크박스로 2개 이상 선택된 경우, 포커스 행이 선택에 포함되면 같은 열에 일괄 적용 */
  selectedTaskIds: Set<string>;
  tasks: Task[];
  canEdit: boolean;
  customColumnNameById: Map<string, string>;
  updateTask: (id: string, updates: Partial<Task>) => void;
}

export function CellFormatToolbar({
  focusedCell,
  selectedTaskIds,
  tasks,
  canEdit,
  customColumnNameById,
  updateTask,
}: CellFormatToolbarProps) {
  const task = useMemo(() => tasks.find((t) => t.id === focusedCell.taskId), [tasks, focusedCell.taskId]);
  const style = task?.cellTextStyles?.[focusedCell.columnId];

  const columnTitle = useMemo(() => {
    const id = focusedCell.columnId;
    if (typeof id === 'string' && id.startsWith('custom:')) {
      return customColumnNameById.get(id) ?? id.replace(/^custom:/, '');
    }
    return builtinColumnLabel(id);
  }, [focusedCell.columnId, customColumnNameById]);

  const targetTaskIds = useMemo(() => {
    if (selectedTaskIds.size > 1 && selectedTaskIds.has(focusedCell.taskId)) {
      return Array.from(selectedTaskIds);
    }
    return [focusedCell.taskId];
  }, [selectedTaskIds, focusedCell.taskId]);

  const applyPatch = useCallback(
    (patch: Partial<CellTextStyle> | null) => {
      if (!canEdit) return;
      for (const id of targetTaskIds) {
        const t = tasks.find((x) => x.id === id);
        if (!t) continue;
        updateTask(id, mergeTaskCellTextStyles(t, focusedCell.columnId, patch));
      }
    },
    [canEdit, targetTaskIds, tasks, updateTask, focusedCell.columnId],
  );

  if (!task || focusedCell.columnId === 'wbsId') return null;

  return (
    <div
      className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm"
      role="toolbar"
      aria-label="셀 서식"
      onMouseDown={(e) => {
        // 표 셀 포커스를 유지하려고 전체에 preventDefault를 쓰면, 숫자·글꼴 등 폼 컨트롤이
        // mousedown 기본 동작(포커스·드롭다운)을 받지 못해 크기 입력 등이 동작하지 않는다.
        const el = e.target as HTMLElement | null;
        if (el?.closest('input, select, textarea, label')) return;
        e.preventDefault();
      }}
    >
      <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
        서식 · {columnTitle}
        {targetTaskIds.length > 1 ? ` (${targetTaskIds.length}행)` : ''}
      </span>
      <span className="w-px h-5 bg-slate-200" aria-hidden />
      <select
        disabled={!canEdit}
        className="max-w-[9rem] text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white disabled:opacity-50"
        value={style?.fontFamily ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) applyPatch({ fontFamily: undefined });
          else applyPatch({ fontFamily: v });
        }}
      >
        {FONT_CHOICES.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-slate-600">
        크기
        <input
          type="number"
          min={8}
          max={48}
          disabled={!canEdit}
          className="w-12 text-xs border border-slate-200 rounded-md px-1 py-0.5 disabled:opacity-50"
          value={style?.fontSize ?? ''}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') applyPatch({ fontSize: undefined });
            else {
              const n = parseInt(raw, 10);
              if (!Number.isNaN(n)) applyPatch({ fontSize: n });
            }
          }}
        />
      </label>
      <label className="flex items-center gap-1 text-[11px] text-slate-600">
        글자
        <input
          type="color"
          disabled={!canEdit}
          className="h-7 w-8 cursor-pointer rounded border border-slate-200 bg-white p-0 disabled:opacity-50"
          value={style?.color?.startsWith('#') && style.color.length >= 4 ? style.color : '#1e293b'}
          onChange={(e) => applyPatch({ color: e.target.value })}
          title="글자 색"
        />
      </label>
      <label className="flex items-center gap-1 text-[11px] text-slate-600">
        배경
        <input
          type="color"
          disabled={!canEdit}
          className="h-7 w-8 cursor-pointer rounded border border-slate-200 bg-white p-0 disabled:opacity-50"
          value={style?.backgroundColor?.startsWith('#') && style.backgroundColor.length >= 4 ? style.backgroundColor : '#ffffff'}
          onChange={(e) => applyPatch({ backgroundColor: e.target.value })}
          title="배경 색"
        />
      </label>
      <button
        type="button"
        disabled={!canEdit}
        title="배경 제거"
        className="text-[10px] px-1.5 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        onClick={() => applyPatch({ backgroundColor: undefined })}
      >
        배경 없음
      </button>
      <span className="w-px h-5 bg-slate-200" aria-hidden />
      <button
        type="button"
        disabled={!canEdit}
        title="진하게"
        className={cn(
          'p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50',
          style?.bold && 'bg-indigo-100 border-indigo-300 text-indigo-800',
        )}
        onClick={() => applyPatch({ bold: style?.bold ? false : true })}
      >
        <Bold size={16} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        disabled={!canEdit}
        title="기울임"
        className={cn(
          'p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50',
          style?.italic && 'bg-indigo-100 border-indigo-300 text-indigo-800',
        )}
        onClick={() => applyPatch({ italic: style?.italic ? false : true })}
      >
        <Italic size={16} />
      </button>
      <button
        type="button"
        disabled={!canEdit}
        title="밑줄"
        className={cn(
          'p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50',
          style?.underline && 'bg-indigo-100 border-indigo-300 text-indigo-800',
        )}
        onClick={() => applyPatch({ underline: style?.underline ? false : true })}
      >
        <Underline size={16} />
      </button>
      <button
        type="button"
        disabled={!canEdit}
        title="취소선"
        className={cn(
          'p-1.5 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50',
          style?.strikethrough && 'bg-indigo-100 border-indigo-300 text-indigo-800',
        )}
        onClick={() => applyPatch({ strikethrough: style?.strikethrough ? false : true })}
      >
        <Strikethrough size={16} />
      </button>
      <button
        type="button"
        disabled={!canEdit}
        title="이 셀(열) 서식 지우기"
        className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-rose-50 hover:border-rose-200 disabled:opacity-50"
        onClick={() => applyPatch(null)}
      >
        <Eraser size={16} />
      </button>
    </div>
  );
}
