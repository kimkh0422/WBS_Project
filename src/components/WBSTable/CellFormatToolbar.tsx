import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Bold, ChevronDown, Eraser, GripVertical, Italic, Strikethrough, Trash2, Underline } from 'lucide-react';
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
          'flex h-8 min-w-[9.5rem] max-w-[14rem] items-center justify-between gap-2 rounded-md border px-2.5 text-left text-sm transition-colors',
          'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50',
          disabled && 'cursor-not-allowed opacity-50',
          open && 'border-indigo-400 ring-2 ring-indigo-100',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="글꼴 선택"
        title="글꼴"
      >
        <span className="truncate font-medium leading-snug" style={{ fontFamily: value || undefined }}>
          {currentLabel}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-slate-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="글꼴 목록"
          className="absolute bottom-full left-0 z-[200] mb-2 max-h-[min(50vh,280px)] min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 text-[15px] leading-snug shadow-2xl ring-1 ring-black/5"
        >
          {FONT_CHOICES.map((o) => (
            <li key={o.value || 'default'} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                style={{ fontFamily: o.value || undefined }}
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

/** B·I·U·S 등 세그먼트 토글 버튼 — 그룹 배경 위에서 활성 시 흰 배경+그림자로 도드라지게 */
function SegToggle({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={!!active}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition-all disabled:opacity-50',
        active ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200' : 'hover:bg-white/70',
      )}
    >
      {children}
    </button>
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
  /** 선택 행 일괄 삭제(확인 모달은 호출부가 띄움). 미전달 시 삭제 버튼 비표시. */
  onDeleteTargets?: (taskIds: string[]) => void;
}

export function CellFormatToolbar({
  focusedCell,
  selectedTaskIds,
  tasks,
  canEdit,
  customColumnNameById,
  updateTask,
  onDeleteTargets,
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

  /** 대상 행(선택 행, 없으면 포커스 행)의 모든 열 서식 제거. 전체 선택 후 누르면 표 전체가 초기화된다. */
  const clearAllForTargets = useCallback(() => {
    if (!canEdit) return;
    for (const id of targetTaskIds) {
      const t = tasks.find((x) => x.id === id);
      if (!t || !t.cellTextStyles || Object.keys(t.cellTextStyles).length === 0) continue;
      updateTask(id, { cellTextStyles: undefined });
    }
  }, [canEdit, targetTaskIds, tasks, updateTask]);

  // ── 드래그 이동 (다른 UI와 겹치지 않게 사용자가 위치 조정) ─────────────
  const DRAG_POS_KEY = 'wbs.cellFormatToolbar.pos';
  const [dragPos, setDragPos] = useState<{ dx: number; dy: number }>(() => {
    try {
      const saved = localStorage.getItem(DRAG_POS_KEY);
      if (saved) {
        const v = JSON.parse(saved);
        if (typeof v?.dx === 'number' && typeof v?.dy === 'number') return v;
      }
    } catch {
      /* ignore */
    }
    return { dx: 0, dy: 0 };
  });
  const dragStartRef = useRef<{ startX: number; startY: number; startDx: number; startDy: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // 우클릭/멀티터치는 무시
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragStartRef.current = { startX: e.clientX, startY: e.clientY, startDx: dragPos.dx, startDy: dragPos.dy };
      setIsDragging(true);
    },
    [dragPos.dx, dragPos.dy],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      setDragPos({ dx: s.startDx + (e.clientX - s.startX), dy: s.startDy + (e.clientY - s.startY) });
    };
    const onUp = () => {
      dragStartRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // 드래그 종료 시 위치 영속
  useEffect(() => {
    if (isDragging) return;
    try {
      localStorage.setItem(DRAG_POS_KEY, JSON.stringify(dragPos));
    } catch {
      /* ignore */
    }
  }, [isDragging, dragPos]);

  const handleDragReset = useCallback(() => {
    setDragPos({ dx: 0, dy: 0 });
  }, []);

  if (!anchorTask || focusedCell.columnId === 'wbsId') return null;

  const hasTextColor = !!(style?.color && style.color.startsWith('#') && style.color.length >= 4);
  const textColor = hasTextColor ? style!.color! : '#1e293b';
  const hasBg = !!(style?.backgroundColor && style.backgroundColor.startsWith('#') && style.backgroundColor.length >= 4);
  const bgColor = hasBg ? style!.backgroundColor! : '#ffffff';

  /** 그룹(세그먼트) 공통 배경 */
  const groupClass = 'flex items-center gap-1 rounded-xl bg-slate-100/70 p-1 ring-1 ring-inset ring-slate-200/60';

  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-[min(100vw-1.5rem,60rem)] flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 text-slate-900',
        'border border-[var(--color-line)]/70 bg-[var(--color-surface)]/92 shadow-[var(--shadow-lg),0_0_0_1px_rgba(255,255,255,0.55)_inset] backdrop-blur-xl',
        isDragging && 'select-none cursor-grabbing',
      )}
      style={{ transform: `translate(${dragPos.dx}px, ${dragPos.dy}px)` }}
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
      {/* 드래그 핸들 — 좌측 그립으로 toolbar를 이동. 더블클릭으로 원위치 복귀. */}
      <button
        type="button"
        onMouseDown={handleDragStart}
        onDoubleClick={handleDragReset}
        title="드래그하여 이동 · 더블클릭으로 원위치"
        aria-label="서식바 위치 이동"
        className={cn(
          'flex h-8 w-5 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700',
          isDragging ? 'cursor-grabbing text-indigo-600' : 'cursor-grab',
        )}
      >
        <GripVertical size={14} />
      </button>

      {/* 제목 + 대상 열/행 */}
      <span className="flex items-center gap-2 pr-0.5 text-sm font-bold tracking-tight text-slate-800">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"
          aria-hidden
        >
          <span className="text-[11px] font-black leading-none">Aa</span>
        </span>
        <span className="hidden whitespace-nowrap sm:inline">
          서식
          <span className="ml-1 font-semibold text-slate-500">· {columnTitle}</span>
        </span>
        {targetTaskIds.length > 1 ? (
          <span className="whitespace-nowrap rounded-md border border-indigo-200/80 bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">
            {targetTaskIds.length}행
          </span>
        ) : null}
      </span>

      {/* 글꼴 · 크기 */}
      <div className={groupClass}>
        <FontFamilyPicker
          value={style?.fontFamily ?? ''}
          disabled={!canEdit}
          onPick={(v) => {
            if (!v) applyPatch({ fontFamily: undefined });
            else applyPatch({ fontFamily: v });
          }}
        />
        <label
          title="글자 크기 (pt)"
          className={cn(
            'flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white pl-2 pr-1.5 shadow-sm',
            !canEdit && 'opacity-50',
          )}
        >
          <input
            type="number"
            min={8}
            max={48}
            disabled={!canEdit}
            className="h-7 w-9 border-0 bg-transparent p-0 text-center text-sm tabular-nums focus:outline-none focus:ring-0"
            value={style?.fontSize ?? ''}
            placeholder="–"
            aria-label="글자 크기"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') applyPatch({ fontSize: undefined });
              else {
                const n = parseInt(raw, 10);
                if (!Number.isNaN(n)) applyPatch({ fontSize: n });
              }
            }}
          />
          <span className="select-none text-[11px] font-semibold text-slate-400">pt</span>
        </label>
      </div>

      {/* 글자색 · 배경색 */}
      <div className={groupClass}>
        <label
          title="글자 색"
          className={cn(
            'relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white pl-2 pr-2.5 shadow-sm hover:bg-slate-50',
            !canEdit && 'pointer-events-none opacity-50',
          )}
        >
          <span className="select-none text-xs font-semibold text-slate-600">글자</span>
          <span className="flex flex-col items-center leading-none">
            <span className="text-[13px] font-extrabold leading-none text-slate-800">가</span>
            <span className="mt-[3px] h-[3px] w-4 rounded-full" style={{ backgroundColor: textColor }} aria-hidden />
          </span>
          <input
            type="color"
            disabled={!canEdit}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={textColor}
            onChange={(e) => applyPatch({ color: e.target.value })}
            aria-label="글자 색"
          />
        </label>
        <label
          title="배경 색"
          className={cn(
            'relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white pl-2 pr-2.5 shadow-sm hover:bg-slate-50',
            !canEdit && 'pointer-events-none opacity-50',
          )}
        >
          <span className="select-none text-xs font-semibold text-slate-600">배경</span>
          <span
            className="h-4 w-4 rounded border border-slate-300"
            style={
              hasBg
                ? { backgroundColor: bgColor }
                : // 배경 없음: 옅은 체크무늬로 "투명"임을 표시
                  {
                    backgroundImage:
                      'linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0,0 3px,3px -3px,-3px 0',
                  }
            }
            aria-hidden
          />
          <input
            type="color"
            disabled={!canEdit}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={bgColor}
            onChange={(e) => applyPatch({ backgroundColor: e.target.value })}
            aria-label="배경 색"
          />
        </label>
        <button
          type="button"
          disabled={!canEdit}
          title="배경 색 지우기"
          aria-label="배경 색 지우기"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-rose-700 disabled:opacity-50"
          onClick={() => applyPatch({ backgroundColor: undefined })}
        >
          <Ban size={16} />
        </button>
      </div>

      {/* 글자 스타일 토글 */}
      <div className={groupClass}>
        <SegToggle active={style?.bold} disabled={!canEdit} title="진하게" onClick={() => applyPatch({ bold: style?.bold ? false : true })}>
          <Bold size={16} strokeWidth={2.75} />
        </SegToggle>
        <SegToggle
          active={style?.italic}
          disabled={!canEdit}
          title="기울임"
          onClick={() => applyPatch({ italic: style?.italic ? false : true })}
        >
          <Italic size={16} />
        </SegToggle>
        <SegToggle
          active={style?.underline}
          disabled={!canEdit}
          title="밑줄"
          onClick={() => applyPatch({ underline: style?.underline ? false : true })}
        >
          <Underline size={16} />
        </SegToggle>
        <SegToggle
          active={style?.strikethrough}
          disabled={!canEdit}
          title="취소선"
          onClick={() => applyPatch({ strikethrough: style?.strikethrough ? false : true })}
        >
          <Strikethrough size={16} />
        </SegToggle>
      </div>

      <span className="h-7 w-px bg-slate-200" aria-hidden />

      {/* 서식 지우기 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!canEdit}
          title="이 셀(열) 서식 지우기"
          aria-label="이 셀 서식 지우기"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50"
          onClick={() => applyPatch(null)}
        >
          <Eraser size={16} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="선택한 행의 모든 열 서식을 지웁니다 (헤더 체크박스로 전체 선택 후 누르면 표 전체 초기화 · 실행취소 가능)"
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50"
          onClick={clearAllForTargets}
        >
          <Eraser size={14} />
          <span className="hidden sm:inline">모든 서식 지우기</span>
          <span className="sm:hidden">전체</span>
        </button>
      </div>

      {/* 행 삭제 — 선택 행(없으면 포커스 행) 일괄 삭제. 호출부가 확인 모달을 띄운다. */}
      {onDeleteTargets && (
        <>
          <span className="h-7 w-px bg-slate-200" aria-hidden />
          <button
            type="button"
            disabled={!canEdit || targetTaskIds.length === 0}
            title={
              targetTaskIds.length > 1
                ? `선택한 ${targetTaskIds.length}개 행을 삭제합니다 (하위 작업 포함, 실행취소 가능)`
                : '이 행을 삭제합니다 (하위 작업 포함, 실행취소 가능)'
            }
            className="flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 text-xs font-semibold text-red-700 shadow-sm transition-colors hover:border-red-400 hover:bg-red-100 hover:text-red-800 disabled:opacity-50"
            onClick={() => onDeleteTargets(targetTaskIds)}
          >
            <Trash2 size={14} />
            <span>삭제</span>
            {targetTaskIds.length > 1 ? (
              <span className="rounded-md bg-red-200/70 px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums text-red-800">
                {targetTaskIds.length}
              </span>
            ) : null}
          </button>
        </>
      )}
    </div>
  );
}
