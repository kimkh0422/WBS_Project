import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bold, ChevronDown, Eraser, Italic, Strikethrough, Underline } from 'lucide-react';
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
] as const;

function FontFamilyPicker({ value, disabled, onPick }: { value: string; disabled: boolean; onPick: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('touchstart', closeIfOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('touchstart', closeIfOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const currentLabel = useMemo(() => FONT_CHOICES.find((o) => o.value === value)?.label ?? FONT_CHOICES[0].label, [value]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          'flex h-9 min-w-[11rem] max-w-[15rem] items-center justify-between gap-2 rounded-lg border px-2.5 text-left text-sm tabular-nums shadow-sm transition-colors',
          'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50',
          disabled && 'cursor-not-allowed opacity-50',
          open && 'border-indigo-400 ring-2 ring-indigo-100',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="글꼴 선택"
      >
        <span className="truncate font-medium leading-snug">{currentLabel}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-slate-600 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="글꼴 목록"
          className="absolute bottom-full left-0 z-[200] mb-2 max-h-[min(50vh,280px)] min-w-full overflow-y-auto rounded-xl border border-slate-300 bg-white py-1.5 text-[15px] leading-snug shadow-2xl"
        >
          {FONT_CHOICES.map((o) => (
            <li key={o.value || 'default'} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                className={cn(
                  'flex w-full items-center px-3.5 py-2.5 text-left text-slate-900 hover:bg-indigo-50',
                  value === o.value && 'bg-indigo-50 font-semibold text-indigo-950',
                )}
                onClick={() => {
                  onPick(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  /** 체크박스로 2개 이상 선택된 경우, 포커스한 열(columnId) 기준으로 선택된 모든 행에 동일 서식 적용 */
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
  /** 키보드·셀 링 기준 행(삭제 등으로 없으면 툴바 숨김) */
  const anchorTask = useMemo(() => tasks.find((t) => t.id === focusedCell.taskId), [tasks, focusedCell.taskId]);

  const columnTitle = useMemo(() => {
    const id = focusedCell.columnId;
    if (typeof id === 'string' && id.startsWith('custom:')) {
      return customColumnNameById.get(id) ?? id.replace(/^custom:/, '');
    }
    return builtinColumnLabel(id);
  }, [focusedCell.columnId, customColumnNameById]);

  const targetTaskIds = useMemo(() => {
    if (selectedTaskIds.size > 1) return Array.from(selectedTaskIds);
    return [focusedCell.taskId];
  }, [selectedTaskIds, focusedCell.taskId]);

  /** 컨트롤에 보여 줄 서식: 체크만 하고 포커스 셀은 다른 행일 수 있어, 그때는 선택된 첫 행 기준 */
  const stylePreviewTaskId = useMemo(() => {
    if (selectedTaskIds.size > 1 && !selectedTaskIds.has(focusedCell.taskId)) {
      const [first] = Array.from(selectedTaskIds);
      return first ?? focusedCell.taskId;
    }
    return focusedCell.taskId;
  }, [selectedTaskIds, focusedCell.taskId]);

  const stylePreviewTask = useMemo(
    () => tasks.find((t) => t.id === stylePreviewTaskId) ?? anchorTask,
    [tasks, stylePreviewTaskId, anchorTask],
  );
  const style = stylePreviewTask?.cellTextStyles?.[focusedCell.columnId];

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

  if (!anchorTask || focusedCell.columnId === 'wbsId') return null;

  return (
    <div
      className="pointer-events-auto flex max-w-[min(100vw-1.5rem,56rem)] flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-xl"
      role="toolbar"
      aria-label="셀 서식"
      onMouseDown={(e) => {
        // 표 셀 포커스를 유지하려고 전체에 preventDefault를 쓰면, 숫자·글꼴 등 폼 컨트롤이
        // mousedown 기본 동작(포커스·드롭다운)을 받지 못해 크기 입력 등이 동작하지 않는다.
        const el = e.target as HTMLElement | null;
        if (el?.closest('input, select, textarea, label, button')) return;
        e.preventDefault();
      }}
    >
      <span className="text-sm font-bold tracking-tight text-slate-800">
        서식
        <span className="ml-1.5 font-semibold text-slate-500">· {columnTitle}</span>
        {targetTaskIds.length > 1 ? (
          <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
            {targetTaskIds.length}행
          </span>
        ) : null}
      </span>
      <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        <FontFamilyPicker
          value={style?.fontFamily ?? ''}
          disabled={!canEdit}
          onPick={(v) => {
            if (!v) applyPatch({ fontFamily: undefined });
            else applyPatch({ fontFamily: v });
          }}
        />
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          크기
          <input
            type="number"
            min={8}
            max={48}
            disabled={!canEdit}
            className="h-9 w-[3.25rem] rounded-lg border border-slate-300 bg-white px-2 text-center text-sm tabular-nums shadow-sm disabled:opacity-50"
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
      </div>
      <span className="h-6 w-px bg-slate-200" aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          글자
          <input
            type="color"
            disabled={!canEdit}
            className="h-9 w-10 cursor-pointer rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm disabled:opacity-50"
            value={style?.color?.startsWith('#') && style.color.length >= 4 ? style.color : '#1e293b'}
            onChange={(e) => applyPatch({ color: e.target.value })}
            title="글자 색"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          배경
          <input
            type="color"
            disabled={!canEdit}
            className="h-9 w-10 cursor-pointer rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm disabled:opacity-50"
            value={style?.backgroundColor?.startsWith('#') && style.backgroundColor.length >= 4 ? style.backgroundColor : '#ffffff'}
            onChange={(e) => applyPatch({ backgroundColor: e.target.value })}
            title="배경 색"
          />
        </label>
        <button
          type="button"
          disabled={!canEdit}
          title="배경 제거"
          className="h-9 shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={() => applyPatch({ backgroundColor: undefined })}
        >
          배경 없음
        </button>
      </div>
      <span className="h-6 w-px bg-slate-200" aria-hidden />
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={!canEdit}
          title="진하게"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white shadow-sm hover:bg-slate-50 disabled:opacity-50',
            style?.bold && 'border-indigo-400 bg-indigo-50 text-indigo-900',
          )}
          onClick={() => applyPatch({ bold: style?.bold ? false : true })}
        >
          <Bold size={17} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="기울임"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white shadow-sm hover:bg-slate-50 disabled:opacity-50',
            style?.italic && 'border-indigo-400 bg-indigo-50 text-indigo-900',
          )}
          onClick={() => applyPatch({ italic: style?.italic ? false : true })}
        >
          <Italic size={17} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="밑줄"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white shadow-sm hover:bg-slate-50 disabled:opacity-50',
            style?.underline && 'border-indigo-400 bg-indigo-50 text-indigo-900',
          )}
          onClick={() => applyPatch({ underline: style?.underline ? false : true })}
        >
          <Underline size={17} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="취소선"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white shadow-sm hover:bg-slate-50 disabled:opacity-50',
            style?.strikethrough && 'border-indigo-400 bg-indigo-50 text-indigo-900',
          )}
          onClick={() => applyPatch({ strikethrough: style?.strikethrough ? false : true })}
        >
          <Strikethrough size={17} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="이 셀(열) 서식 지우기"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50"
          onClick={() => applyPatch(null)}
        >
          <Eraser size={17} />
        </button>
      </div>
    </div>
  );
}
