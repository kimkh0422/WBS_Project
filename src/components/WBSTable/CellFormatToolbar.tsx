import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Bold, ChevronDown, Eraser, Italic, Strikethrough, Trash2, Underline, X } from 'lucide-react';
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  // 메뉴는 body 포털 + position:fixed로 띄운다(툴바의 overflow-x-auto에 잘리지 않도록).
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; openUp: boolean } | null>(null);

  const computePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 툴바가 화면 하단에 도킹되므로 버튼 아래 공간이 부족하면 위로 펼친다(아래로 펼치면 화면 밖으로 잘림).
    const menuMaxH = Math.min(window.innerHeight * 0.6, 320);
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuMaxH + 12 && r.top > spaceBelow;
    setPos({
      left: Math.round(r.left),
      top: Math.round(openUp ? r.top - 6 : r.bottom + 6),
      minWidth: Math.round(r.width),
      openUp,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    computePos();
    const closeIfOutside = (ev: MouseEvent | TouchEvent) => {
      const t = ev.target as Node | null;
      if (t && (btnRef.current?.contains(t) || menuRef.current?.contains(t))) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    // 툴바 가로 스크롤·창 리사이즈 시 메뉴 위치 추적(capture로 스크롤 컨테이너 포함).
    const onReflow = () => computePos();
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('touchstart', closeIfOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('touchstart', closeIfOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, computePos]);

  // 현재 폰트 라벨: 목록에 있으면 그 라벨, 사용자 지정(목록 밖) 폰트면 앞쪽 패밀리명만 표기.
  const currentLabel = useMemo(() => {
    const matched = FONT_CHOICES.find((o) => o.value === value);
    if (matched) return matched.label;
    if (value) return value.split(',')[0].replace(/['"]/g, '').trim() || FONT_CHOICES[0].label;
    return FONT_CHOICES[0].label;
  }, [value]);

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
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
      {open &&
        pos &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label="글꼴 목록"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              minWidth: pos.minWidth,
              transform: pos.openUp ? 'translateY(-100%)' : undefined,
            }}
            className="z-[300] max-h-[min(60vh,320px)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 text-[15px] leading-snug shadow-2xl ring-1 ring-black/5"
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
          </ul>,
          document.body,
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
    duration: '기간',
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
  /** 단일 셀 포커스(없으면 null). 행만 체크 선택한 경우 null일 수 있다. */
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  /** 체크박스로 선택된 행. 1개 이상이면 "행 전체(엑셀식)" 모드로 동작한다. */
  selectedTaskIds: Set<string>;
  /** 행 전체 모드에서 서식을 적용할 표시 데이터 컬럼들(wbsId 제외). */
  rowApplyColumnIds: TableColumnId[];
  tasks: Task[];
  canEdit: boolean;
  customColumnNameById: Map<string, string>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  /** 선택 행 일괄 삭제(확인 모달은 호출부가 띄움). 미전달 시 삭제 버튼 비표시. */
  onDeleteTargets?: (taskIds: string[]) => void;
  /** 툴바 닫기(선택·포커스 해제). */
  onClose?: () => void;
}

/**
 * 표 하단 도킹 서식 툴바. 한글·엑셀의 Tool Bar처럼 동작하되, 선택 시 행이 밀리지 않도록 표 본문 아래에 붙는다.
 * 적용 범위(엑셀식 = 선택 단위가 곧 적용 단위):
 *  - 행을 체크 선택(selectedTaskIds ≥ 1)하면 → 선택한 모든 행 × 표시된 모든 데이터 열에 적용("행 전체").
 *  - 체크 없이 셀 하나만 포커스하면 → 그 셀(한 행, 한 열)에만 적용.
 */
export function CellFormatToolbar({
  focusedCell,
  selectedTaskIds,
  rowApplyColumnIds,
  tasks,
  canEdit,
  customColumnNameById,
  updateTask,
  onDeleteTargets,
  onClose,
}: CellFormatToolbarProps) {
  // 행을 체크 선택했으면 "행 전체" 모드(엑셀식). 아니면 포커스 셀 단일 모드.
  const rowMode = selectedTaskIds.size >= 1;

  // rowApplyColumnIds 누락(예: HMR 중간 상태)에도 안전하도록 빈 배열로 정규화.
  const rowCols = useMemo(() => rowApplyColumnIds ?? [], [rowApplyColumnIds]);

  const targetTaskIds = useMemo(() => {
    if (rowMode) return Array.from(selectedTaskIds);
    return focusedCell ? [focusedCell.taskId] : [];
  }, [rowMode, selectedTaskIds, focusedCell]);

  /** 적용 대상 열: 행 모드면 표시된 모든 데이터 열, 셀 모드면 포커스한 열 하나. */
  const targetColumnIds = useMemo<TableColumnId[]>(() => {
    if (rowMode) return rowCols;
    return focusedCell ? [focusedCell.columnId] : [];
  }, [rowMode, rowCols, focusedCell]);

  /** 컨트롤 표시(on/off·색)용 대표 셀: 행 모드면 첫 선택 행의 작업명(없으면 첫 열). */
  const previewColumnId = useMemo<TableColumnId | undefined>(() => {
    if (rowMode) return rowCols.includes('name' as TableColumnId) ? ('name' as TableColumnId) : rowCols[0];
    return focusedCell?.columnId;
  }, [rowMode, rowCols, focusedCell]);

  const previewTask = useMemo(() => {
    const id = rowMode ? targetTaskIds[0] : focusedCell?.taskId;
    return id ? tasks.find((t) => t.id === id) : undefined;
  }, [rowMode, targetTaskIds, focusedCell, tasks]);

  const style = previewColumnId ? previewTask?.cellTextStyles?.[previewColumnId] : undefined;

  const columnTitle = useMemo(() => {
    const id = focusedCell?.columnId;
    if (!id) return '';
    if (typeof id === 'string' && id.startsWith('custom:')) {
      return customColumnNameById.get(id) ?? id.replace(/^custom:/, '');
    }
    return builtinColumnLabel(id);
  }, [focusedCell, customColumnNameById]);

  /** 한 작업의 여러 열에 동일 patch를 누적 적용해 단일 cellTextStyles로 만든다. */
  const applyPatch = useCallback(
    (patch: Partial<CellTextStyle> | null) => {
      if (!canEdit) return;
      for (const id of targetTaskIds) {
        const t = tasks.find((x) => x.id === id);
        if (!t) continue;
        let acc = t.cellTextStyles;
        for (const col of targetColumnIds) {
          acc = mergeTaskCellTextStyles({ ...t, cellTextStyles: acc } as Task, col, patch).cellTextStyles;
        }
        updateTask(id, { cellTextStyles: acc });
      }
    },
    [canEdit, targetTaskIds, targetColumnIds, tasks, updateTask],
  );

  /** 대상 행의 모든 열 서식 제거. */
  const clearAllForTargets = useCallback(() => {
    if (!canEdit) return;
    for (const id of targetTaskIds) {
      const t = tasks.find((x) => x.id === id);
      if (!t || !t.cellTextStyles || Object.keys(t.cellTextStyles).length === 0) continue;
      updateTask(id, { cellTextStyles: undefined });
    }
  }, [canEdit, targetTaskIds, tasks, updateTask]);

  if (targetTaskIds.length === 0 || targetColumnIds.length === 0) return null;
  // 셀 모드에서 WBS 열은 서식 대상이 아니다.
  if (!rowMode && focusedCell?.columnId === 'wbsId') return null;

  const hasTextColor = !!(style?.color && style.color.startsWith('#') && style.color.length >= 4);
  const textColor = hasTextColor ? style!.color! : '#1e293b';
  const hasBg = !!(style?.backgroundColor && style.backgroundColor.startsWith('#') && style.backgroundColor.length >= 4);
  const bgColor = hasBg ? style!.backgroundColor! : '#ffffff';

  /** 그룹(세그먼트) 공통 배경 */
  const groupClass = 'flex items-center gap-1 rounded-xl bg-slate-100/70 p-1 ring-1 ring-inset ring-slate-200/60';

  return (
    <div
      className={cn(
        // h-14: 표 SummaryBar(h-14)와 같은 높이로 본문 하단에 도킹. border-t로 위 행과 구분(위쪽으로 향한 그림자).
        'flex h-14 w-full items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap px-3 py-0 text-slate-900',
        'border-t border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_-1px_3px_rgba(0,0,0,0.06)]',
      )}
      role="toolbar"
      aria-label="셀 서식"
      onMouseDown={(e) => {
        // 폼 컨트롤(입력·드롭다운)은 기본 동작 유지, 그 외 영역은 표 셀 포커스 유지를 위해 기본 동작 차단.
        const el = e.target as HTMLElement | null;
        if (el?.closest('input, select, textarea, label, button')) return;
        e.preventDefault();
      }}
    >
      {/* 제목 + 대상 표시 */}
      <span className="flex shrink-0 items-center gap-2 pr-0.5 text-sm font-bold tracking-tight text-slate-800">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"
          aria-hidden
        >
          <span className="text-[11px] font-black leading-none">Aa</span>
        </span>
        <span className="hidden whitespace-nowrap sm:inline">
          서식
          {rowMode ? (
            <span className="ml-1 font-semibold text-slate-500">· 행 전체</span>
          ) : columnTitle ? (
            <span className="ml-1 font-semibold text-slate-500">· {columnTitle}</span>
          ) : null}
        </span>
        {rowMode ? (
          <span className="whitespace-nowrap rounded-md border border-indigo-200/80 bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-800">
            {targetTaskIds.length}행
          </span>
        ) : null}
      </span>

      {/* 글꼴 · 크기 */}
      <div className={cn(groupClass, 'shrink-0')}>
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
      <div className={cn(groupClass, 'shrink-0')}>
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
                : {
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
      <div className={cn(groupClass, 'shrink-0')}>
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

      <span className="h-7 w-px shrink-0 bg-slate-200" aria-hidden />

      {/* 서식 지우기 */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={!canEdit}
          title={rowMode ? '선택한 행의 서식을 지웁니다' : '이 셀(열) 서식 지우기'}
          aria-label="서식 지우기"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-50"
          onClick={() => applyPatch(null)}
        >
          <Eraser size={16} />
        </button>
        <button
          type="button"
          disabled={!canEdit}
          title="선택한 행의 모든 열 서식을 지웁니다 (실행취소 가능)"
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
          <span className="h-7 w-px shrink-0 bg-slate-200" aria-hidden />
          <button
            type="button"
            disabled={!canEdit || targetTaskIds.length === 0}
            title={
              targetTaskIds.length > 1
                ? `선택한 ${targetTaskIds.length}개 행을 삭제합니다 (하위 작업 포함, 실행취소 가능)`
                : '이 행을 삭제합니다 (하위 작업 포함, 실행취소 가능)'
            }
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 text-xs font-semibold text-red-700 shadow-sm transition-colors hover:border-red-400 hover:bg-red-100 hover:text-red-800 disabled:opacity-50"
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

      {/* 닫기(선택 해제) — 우측 끝 */}
      {onClose && (
        <button
          type="button"
          title="서식 바 닫기 (선택 해제)"
          aria-label="서식 바 닫기"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
