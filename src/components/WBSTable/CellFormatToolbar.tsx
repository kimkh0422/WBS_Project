import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, ChevronDown, Highlighter, Minus, Plus, RemoveFormatting, Sparkles, Strikethrough, Trash2, Undo2 } from 'lucide-react';
import type { Task, CellTextStyle } from '../../types';
import type { TableColumnId } from '../wbsTableTypes';
import { cn } from '../../lib/utils';
import { mergeTaskCellTextStyles } from '../../lib/cellTextStyle';

/** Google 문서 툴바에 가깝게 맞춘 배경색 */
const DOCS_TOOLBAR_BG = '#f0f4f8';

const FONT_CHOICES = [
  { value: '', label: '글꼴(기본)' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
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
  // 툴바가 상단/하단 어디에 있든 화면 여백에 따라 위·아래로 펼친다.
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
          'flex h-7 min-w-[7.5rem] max-w-[12rem] items-center justify-between gap-1.5 rounded border border-[#dadce0] bg-white px-2 text-left text-[13px] text-[#444746] transition-colors hover:bg-[#f8fafc]',
          disabled && 'cursor-not-allowed opacity-50',
          open && 'border-[#1a73e8] ring-1 ring-[#1a73e8]/25',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="글꼴 선택"
        title="글꼴"
      >
        <span className="truncate font-medium leading-snug" style={{ fontFamily: value || undefined }}>
          {currentLabel}
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-[#444746]/70 transition-transform', open && 'rotate-180')} aria-hidden />
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

/** B·I·U 등 — Google 문서처럼 글자 형태 토글 */
function DocsCharToggle({
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
        'flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded px-1 text-[13px] font-semibold text-[#444746] transition-colors disabled:opacity-50',
        active ? 'bg-[#e8f0fe] text-[#174ea6]' : 'hover:bg-black/[0.06]',
      )}
    >
      {children}
    </button>
  );
}

function ToolbarSep() {
  return <span className="mx-0.5 h-6 w-px shrink-0 self-center bg-[#dadce0]" aria-hidden />;
}

function DocsIconBtn({
  disabled,
  title,
  onClick,
  children,
}: {
  disabled?: boolean;
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const isDisabled = !!disabled;
  return (
    <button
      type="button"
      disabled={isDisabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded text-[#444746] transition-colors',
        isDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-black/[0.06]',
      )}
    >
      {children}
    </button>
  );
}

export interface CellFormatToolbarProps {
  /** 툴바 맨 앞(글꼴 선택 왼쪽)에 끼워 넣는 슬롯 — 표 텍스트/JSON 편집 버튼 등 */
  toolbarStartSlot?: React.ReactNode;
  /** 단일 셀 포커스(없으면 null). 행만 체크 선택한 경우 null일 수 있다. */
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
  /** 체크박스로 선택된 행. 1개 이상이면 "행 전체(엑셀식)" 모드로 동작한다. */
  selectedTaskIds: Set<string>;
  /** 체크 없이 마퀴 드래그로 선택된 셀들(taskId::columnId). 2셀 이상이면 직사각형 범위에 서식 적용 */
  cellMarqueeKeySet?: ReadonlySet<string> | null;
  /** 행 전체 모드에서 서식을 적용할 표시 데이터 컬럼들(wbsId 제외). */
  rowApplyColumnIds: TableColumnId[];
  tasks: Task[];
  canEdit: boolean;
  customColumnNameById: Map<string, string>;
  updateTask: (id: string, updates: Partial<Task>) => void;
  /** 선택 행 일괄 삭제(확인 모달은 호출부가 띄움). 미전달 시 삭제 버튼 비표시. */
  onDeleteTargets?: (taskIds: string[]) => void;
  /** 'top': 표+간트 상단 고정 도킹(아래로 구분선). 기본은 하단 도킹. */
  dock?: 'top' | 'bottom';
  /** true면 상·하단 구분선을 그리지 않음(요약 막대와 한 줄로 합칠 때 부모가 구분선을 담당). */
  mergeChromeBorder?: boolean;
  /** 작업표·간트: 레벨 배경·완료 강조 등 자동 서식(이 기기에서만 끄기 가능) */
  tableAutoFormatting?: {
    effectiveOn: boolean;
    globalEnabled: boolean;
    onToggle: () => void;
  };
}

/**
 * 표에 도킹되는 셀 서식 툴바. 한글·엑셀의 Tool Bar처럼 동작한다.
 * `dock="top"`이면 표+간트 상단 슬롯에 붙이고, 기본(`bottom`)이면 표 본문 아래에 붙여 선택 시 위쪽 행이 덜 밀리게 할 수 있다.
 * 적용 범위(엑셀식 = 선택 단위가 곧 적용 단위):
 *  - 행을 체크 선택(selectedTaskIds ≥ 1)하면 → 선택한 모든 행 × 표시된 모든 데이터 열에 적용("행 전체").
 *  - 마퀴로 셀 범위를 잡으면 → 해당 직사각형의 행×열에만 적용.
 *  - 체크·마퀴 없이 셀 하나만 포커스하면 → 그 셀(한 행, 한 열)에만 적용.
 */
export function CellFormatToolbar({
  toolbarStartSlot,
  focusedCell,
  selectedTaskIds,
  cellMarqueeKeySet = null,
  rowApplyColumnIds,
  tasks,
  canEdit,
  customColumnNameById: _customColumnNameById,
  updateTask,
  onDeleteTargets,
  dock = 'bottom',
  mergeChromeBorder = false,
  tableAutoFormatting,
}: CellFormatToolbarProps) {
  // 행을 체크 선택했으면 "행 전체" 모드(엑셀식). 아니면 마퀴 셀 범위 → 고유 행×열의 곱(직사각형). 그다음 포커스 셀 단일.
  const rowMode = selectedTaskIds.size >= 1;

  const marqueeTargets = useMemo(() => {
    if (!cellMarqueeKeySet || cellMarqueeKeySet.size < 1) return null;
    const taskIds = new Set<string>();
    const columnIds = new Set<TableColumnId>();
    for (const key of cellMarqueeKeySet) {
      const sep = key.indexOf('::');
      if (sep < 1) continue;
      taskIds.add(key.slice(0, sep));
      columnIds.add(key.slice(sep + 2) as TableColumnId);
    }
    if (taskIds.size === 0 || columnIds.size === 0) return null;
    return { taskIds: [...taskIds], columnIds: [...columnIds] };
  }, [cellMarqueeKeySet]);

  const rectMode = !rowMode && marqueeTargets != null;

  // rowApplyColumnIds 누락(예: HMR 중간 상태)에도 안전하도록 빈 배열로 정규화.
  const rowCols = useMemo(() => rowApplyColumnIds ?? [], [rowApplyColumnIds]);

  const targetTaskIds = useMemo(() => {
    if (rowMode) return Array.from(selectedTaskIds);
    if (rectMode && marqueeTargets) return marqueeTargets.taskIds;
    return focusedCell ? [focusedCell.taskId] : [];
  }, [rowMode, selectedTaskIds, rectMode, marqueeTargets, focusedCell]);

  /** 적용 대상 열: 행 모드면 표시된 모든 데이터 열, 마퀴 모드면 범위 열 집합, 셀 모드면 포커스한 열 하나. */
  const targetColumnIds = useMemo<TableColumnId[]>(() => {
    if (rowMode) return rowCols;
    if (rectMode && marqueeTargets) return marqueeTargets.columnIds;
    return focusedCell ? [focusedCell.columnId] : [];
  }, [rowMode, rowCols, rectMode, marqueeTargets, focusedCell]);

  /** 서식 적용 가능: 대상 행·열이 있고, WBS 열만 포커스한 경우는 제외 */
  const hasFormattingTargets = useMemo(() => {
    if (targetTaskIds.length === 0 || targetColumnIds.length === 0) return false;
    if (!rowMode && focusedCell?.columnId === 'wbsId') return false;
    return true;
  }, [targetTaskIds, targetColumnIds, rowMode, focusedCell]);

  /** 컨트롤 비활성: 읽기 전용이거나 적용 대상이 없을 때 */
  const formatDisabled = !canEdit || !hasFormattingTargets;

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

  /** 한 작업의 여러 열에 동일 patch를 누적 적용해 단일 cellTextStyles로 만든다. */
  const applyPatch = useCallback(
    (patch: Partial<CellTextStyle> | null) => {
      if (!canEdit || !hasFormattingTargets) return;
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
    [canEdit, hasFormattingTargets, targetTaskIds, targetColumnIds, tasks, updateTask],
  );

  const hasTextColor = !!(style?.color && style.color.startsWith('#') && style.color.length >= 4);
  const textColor = hasTextColor ? style!.color! : '#1e293b';
  const hasBg = !!(style?.backgroundColor && style.backgroundColor.startsWith('#') && style.backgroundColor.length >= 4);
  const bgColor = hasBg ? style!.backgroundColor! : '#ffffff';

  const bumpFontSize = (delta: number) => {
    if (formatDisabled) return;
    const base = typeof style?.fontSize === 'number' && Number.isFinite(style.fontSize) ? style.fontSize : 11;
    const n = Math.min(48, Math.max(8, Math.round(base + delta)));
    applyPatch({ fontSize: n });
  };

  return (
    <div
      className={cn(
        'flex h-11 w-full min-h-11 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap px-2 py-1 text-[#444746]',
        !mergeChromeBorder && (dock === 'top' ? 'border-b border-[#dadce0]' : 'border-t border-[#dadce0]'),
      )}
      style={{ backgroundColor: DOCS_TOOLBAR_BG }}
      role="toolbar"
      aria-label="셀 서식"
      onMouseDown={(e) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest('input, select, textarea, label, button')) return;
        e.preventDefault();
      }}
    >
      {toolbarStartSlot ? (
        <>
          {toolbarStartSlot}
          <ToolbarSep />
        </>
      ) : null}
      <FontFamilyPicker
        value={style?.fontFamily ?? ''}
        disabled={formatDisabled}
        onPick={(v) => {
          if (!v) applyPatch({ fontFamily: undefined });
          else applyPatch({ fontFamily: v });
        }}
      />

      <ToolbarSep />

      <div className="flex shrink-0 items-center gap-0.5">
        <DocsIconBtn title="글자 크기 줄이기" disabled={formatDisabled} onClick={() => bumpFontSize(-1)}>
          <Minus size={18} strokeWidth={2} />
        </DocsIconBtn>
        <label
          title="글자 크기(px)"
          className={cn(
            'flex h-7 min-w-[2.25rem] items-center justify-center rounded border border-[#dadce0] bg-white px-1.5 shadow-sm',
            formatDisabled && 'opacity-50',
          )}
        >
          <input
            type="number"
            min={8}
            max={48}
            disabled={formatDisabled}
            className="h-6 w-full min-w-[1.75rem] max-w-[2.5rem] border-0 bg-transparent p-0 text-center text-[13px] tabular-nums text-[#444746] focus:outline-none focus:ring-0"
            value={style?.fontSize ?? ''}
            placeholder="11"
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
        </label>
        <DocsIconBtn title="글자 크기 늘리기" disabled={formatDisabled} onClick={() => bumpFontSize(1)}>
          <Plus size={18} strokeWidth={2} />
        </DocsIconBtn>
      </div>

      <ToolbarSep />

      <DocsCharToggle
        active={style?.bold}
        disabled={formatDisabled}
        title="진하게"
        onClick={() => applyPatch({ bold: style?.bold ? false : true })}
      >
        <span className="font-bold leading-none">B</span>
      </DocsCharToggle>
      <DocsCharToggle
        active={style?.italic}
        disabled={formatDisabled}
        title="기울임"
        onClick={() => applyPatch({ italic: style?.italic ? false : true })}
      >
        <span className="font-serif italic leading-none">I</span>
      </DocsCharToggle>
      <DocsCharToggle
        active={style?.underline}
        disabled={formatDisabled}
        title="밑줄"
        onClick={() => applyPatch({ underline: style?.underline ? false : true })}
      >
        <span className="leading-none underline">U</span>
      </DocsCharToggle>
      <DocsCharToggle
        active={style?.strikethrough}
        disabled={formatDisabled}
        title="취소선"
        onClick={() => applyPatch({ strikethrough: style?.strikethrough ? false : true })}
      >
        <Strikethrough size={16} strokeWidth={2.25} className="opacity-90" />
      </DocsCharToggle>

      <label
        title="글자 색(클릭하여 선택)"
        className={cn(
          'relative ml-0.5 flex h-7 cursor-pointer items-center gap-0.5 rounded px-1.5 hover:bg-black/[0.06]',
          formatDisabled && 'pointer-events-none opacity-50',
        )}
      >
        <span className="flex flex-col items-center leading-none">
          <span className="text-[15px] font-semibold leading-none text-[#444746]">A</span>
          <span className="mt-0.5 h-[3px] w-[1.1rem] rounded-sm" style={{ backgroundColor: textColor }} aria-hidden />
        </span>
        <input
          type="color"
          disabled={formatDisabled}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={textColor}
          onChange={(e) => applyPatch({ color: e.target.value })}
          aria-label="글자 색"
        />
      </label>
      <DocsIconBtn title="글자색 지우기(기본)" disabled={formatDisabled} onClick={() => applyPatch({ color: undefined })}>
        <Undo2 size={16} strokeWidth={2} className="opacity-90" />
      </DocsIconBtn>

      <label
        title="셀 배경색(클릭하여 선택)"
        className={cn(
          'relative flex h-7 cursor-pointer items-center justify-center rounded px-1 hover:bg-black/[0.06]',
          formatDisabled && 'pointer-events-none opacity-50',
        )}
      >
        <Highlighter size={18} strokeWidth={2} className="text-[#444746]" />
        <input
          type="color"
          disabled={formatDisabled}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={bgColor}
          onChange={(e) => applyPatch({ backgroundColor: e.target.value })}
          aria-label="셀 배경색"
        />
      </label>
      <DocsIconBtn title="셀 배경색 지우기" disabled={formatDisabled} onClick={() => applyPatch({ backgroundColor: undefined })}>
        <Ban size={17} strokeWidth={2} />
      </DocsIconBtn>

      <ToolbarSep />

      <button
        type="button"
        title={rowMode ? '선택한 행·열의 서식 지우기' : '이 셀 서식 지우기'}
        disabled={formatDisabled}
        aria-label="서식 제거"
        onClick={() => applyPatch(null)}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1 rounded border border-[#dadce0] bg-white px-2 text-[12px] font-medium text-[#444746] transition-colors hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <RemoveFormatting size={16} strokeWidth={2} aria-hidden />
        <span>서식 제거</span>
      </button>

      {tableAutoFormatting ? (
        <>
          <ToolbarSep />
          <button
            type="button"
            onClick={tableAutoFormatting.onToggle}
            disabled={!tableAutoFormatting.globalEnabled}
            aria-pressed={tableAutoFormatting.effectiveOn}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/25',
              !tableAutoFormatting.globalEnabled
                ? 'cursor-not-allowed border-[#dadce0] bg-[#f1f3f4] text-[#80868b]'
                : tableAutoFormatting.effectiveOn
                  ? 'border-[#c7d2fe] bg-[#e8eaff] text-[#3730a3] hover:bg-[#ddd6fe]/60'
                  : 'border-[#dadce0] bg-white text-[#444746] hover:bg-black/[0.06]',
            )}
            title={
              !tableAutoFormatting.globalEnabled
                ? '관리자가 전체 자동 서식(레벨 색·완료 강조)을 껐습니다.'
                : tableAutoFormatting.effectiveOn
                  ? '레벨 배경·간트 완료 강조 등 자동 서식이 켜져 있습니다. 클릭하면 이 브라우저에서만 끕니다.'
                  : '이 브라우저에서 자동 서식이 꺼져 있습니다. 클릭하면 다시 켭니다.'
            }
          >
            <Sparkles size={14} strokeWidth={2} aria-hidden />
            자동 서식
          </button>
        </>
      ) : null}

      <div className="min-w-2 flex-1" aria-hidden />

      {onDeleteTargets ? (
        <button
          type="button"
          disabled={formatDisabled || targetTaskIds.length === 0}
          title={targetTaskIds.length > 1 ? `선택한 ${targetTaskIds.length}개 행 삭제 (하위 작업 포함)` : '이 행 삭제 (하위 작업 포함)'}
          className="flex h-7 shrink-0 items-center gap-1 rounded border border-[#dadce0] bg-white px-2 text-[12px] font-medium text-[#c5221f] transition-colors hover:bg-[#fce8e6] disabled:opacity-50"
          onClick={() => onDeleteTargets(targetTaskIds)}
        >
          <Trash2 size={15} strokeWidth={2} />
          <span>삭제</span>
          {targetTaskIds.length > 1 ? (
            <span className="rounded bg-[#fad2cf] px-1 py-0 text-[10px] font-bold tabular-nums leading-none text-[#842029]">
              {targetTaskIds.length}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
