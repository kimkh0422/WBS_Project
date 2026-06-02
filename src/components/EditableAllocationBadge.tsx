import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn, formatNum2, formatPercent1 } from '../lib/utils';
import {
  allocationEffortAllocatedInputTooltip,
  allocationEffortIntegrityCellSummaryTooltip,
  allocationEffortWbsSumTooltip,
  evaluateAllocationEffortIntegrity,
} from '../lib/allocationEffortIntegrity';
import { clampAllocationPercentInt } from '../lib/personAllocations';
import { manDaysToManMonths } from '../lib/workEffortUnits';

interface EditableAllocationBadgeProps {
  projectName: string;
  allocationPercent: number;
  workEffortMd?: number;
  /** WBS 합산 공수 표기. 기본 M/D (다른 화면 호환). */
  effortDisplayUnit?: 'mm' | 'md';
  /** 할당 투입 대비 WBS 공수 불일치 */
  effortIntegrityWarning?: boolean;
  /** `stacked`일 때 이름 아래에 작게 표시(예: 소속). */
  subtitle?: string;
  /** 인원 칩 등 한눈에 읽히게 세로 배치. 기본은 한 줄(프로젝트명 배지 등). */
  chipLayout?: 'inline' | 'stacked';
  disabled?: boolean;
  onSave: (percent: number) => void;
  onNavigate?: () => void;
  /** 카드 빈 영역 클릭 시 상세 팝업 등(이름·투입율 버튼 제외) */
  onOpenDetail?: () => void;
  /** 프로젝트별 인원 카드 등: PM/PO 역할 표시 */
  roleTags?: ('pm' | 'po')[];
  className?: string;
}

function RoleTagBadges({ tags }: { tags: ('pm' | 'po')[] }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {tags.includes('pm') && (
        <span
          className="text-[9px] font-bold text-violet-600 uppercase tracking-wide px-1 py-px rounded border border-violet-200/90 bg-violet-50/90 leading-none"
          title="프로젝트 PM(과제 책임)"
        >
          PM
        </span>
      )}
      {tags.includes('po') && (
        <span
          className="text-[9px] font-bold text-amber-700 uppercase tracking-wide px-1 py-px rounded border border-amber-200/90 bg-amber-50/90 leading-none"
          title="프로젝트 PO"
        >
          PO
        </span>
      )}
    </span>
  );
}

export function EditableAllocationBadge({
  projectName,
  allocationPercent,
  workEffortMd,
  effortDisplayUnit = 'md',
  subtitle,
  chipLayout = 'inline',
  disabled,
  onSave,
  onNavigate,
  onOpenDetail,
  roleTags,
  effortIntegrityWarning,
  className,
}: EditableAllocationBadgeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(allocationPercent));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setInputValue(String(allocationPercent));
  }, [allocationPercent, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const wbsMd = workEffortMd ?? 0;
  const integrityResult = useMemo(() => evaluateAllocationEffortIntegrity(allocationPercent, wbsMd), [allocationPercent, wbsMd]);

  const percentEditTitle = allocationEffortAllocatedInputTooltip(allocationPercent, effortDisplayUnit, {
    aggregate: 'single_project',
  });

  const cardShellTitle = useMemo(() => {
    if (effortIntegrityWarning) {
      return [
        allocationEffortIntegrityCellSummaryTooltip(integrityResult, effortDisplayUnit, {
          aggregate: 'single_project',
        }),
        chipLayout === 'stacked'
          ? '조작: 카드 빈 영역 → 상세, 프로젝트명 → 작업 표, 비율 → 수정'
          : '조작: 빈 영역 → 상세, 이름 → 작업 표, 비율 → 수정',
      ].join('\n\n');
    }
    if (onOpenDetail) {
      return chipLayout === 'stacked'
        ? '카드 빈 영역: 상세 정보 · 이름: 작업 표 · 비율: 수정'
        : '빈 영역: 상세 · 이름: 작업 표 · 비율: 수정';
    }
    return undefined;
  }, [effortIntegrityWarning, integrityResult, effortDisplayUnit, chipLayout, onOpenDetail]);

  const commit = () => {
    const trimmed = inputValue.trim();
    const parsed = trimmed === '' ? allocationPercent : parseFloat(trimmed);
    const next = !Number.isFinite(parsed) ? allocationPercent : clampAllocationPercentInt(parsed);
    setInputValue(String(next));
    setIsEditing(false);
    if (next !== allocationPercent) onSave(next);
  };

  const cancel = () => {
    setInputValue(String(allocationPercent));
    setIsEditing(false);
  };

  const effortSuffix =
    workEffortMd != null && workEffortMd > 0 ? (
      <span
        className="text-stone-500 text-[10px] font-medium tabular-nums shrink-0 cursor-help"
        title={allocationEffortWbsSumTooltip(workEffortMd, effortDisplayUnit, { aggregate: 'single_project' })}
      >
        {effortDisplayUnit === 'md' ? `${formatNum2(workEffortMd)} M/D` : `${formatNum2(manDaysToManMonths(workEffortMd))} M/M`}
      </span>
    ) : null;

  const effectiveRoleTags = roleTags?.filter((x) => x === 'pm' || x === 'po') ?? [];

  if (isEditing) {
    const editShell =
      chipLayout === 'stacked'
        ? 'inline-flex flex-col gap-1.5 px-2.5 py-2 rounded-lg border border-teal-200 bg-white text-xs shadow-sm min-w-[11rem] max-w-[min(100%,22rem)]'
        : 'inline-flex flex-wrap items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-white text-xs shadow-sm max-w-[min(100%,24rem)]';

    return (
      <span className={cn(editShell, className)} onClick={(e) => e.stopPropagation()}>
        <div
          className={cn(
            'min-w-0',
            chipLayout === 'stacked' ? 'flex items-start justify-between gap-2' : 'inline-flex items-center gap-1 flex-wrap',
          )}
        >
          <span className={cn('inline-flex items-start gap-1.5 min-w-0 flex-wrap', chipLayout === 'stacked' && 'flex-1')}>
            <span
              className={cn(
                'text-stone-700',
                chipLayout === 'stacked'
                  ? 'text-sm font-semibold leading-snug break-words min-w-0'
                  : 'text-sm font-medium leading-snug break-words whitespace-normal min-w-0',
              )}
              title={projectName}
            >
              {projectName}
            </span>
            {effectiveRoleTags.length > 0 ? <RoleTagBadges tags={effectiveRoleTags} /> : null}
          </span>
          <span className={cn('inline-flex items-center gap-0.5 shrink-0', chipLayout === 'stacked' && 'pt-0.5')}>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={inputValue}
              onChange={(e) => {
                const next = e.target.value;
                if (next === '' || /^\d*$/.test(next)) setInputValue(next);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              onBlur={commit}
              className="w-12 px-1 py-0.5 text-xs font-bold text-teal-700 border border-teal-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 tabular-nums"
              title={`투입율 (0~100%).\n\n${percentEditTitle}`}
            />
            <span className="text-teal-600 font-bold">%</span>
          </span>
        </div>
        {chipLayout === 'stacked' && subtitle ? (
          <span className="text-[11px] text-stone-500 leading-tight break-words">{subtitle}</span>
        ) : null}
        {chipLayout === 'stacked' && effortSuffix ? <div className="text-[11px]">{effortSuffix}</div> : null}
        {chipLayout === 'inline' && effortSuffix}
      </span>
    );
  }

  if (chipLayout === 'stacked') {
    return (
      <span
        className={cn(
          'inline-flex flex-col gap-1 px-2.5 py-2 rounded-lg border text-left min-w-[11rem] max-w-[min(100%,22rem)]',
          onNavigate
            ? 'border-stone-200/90 bg-stone-50/90 hover:bg-teal-50/50 hover:border-teal-200'
            : 'border-stone-200/90 bg-stone-50/90',
          onOpenDetail && 'cursor-pointer',
          effortIntegrityWarning && 'border-amber-300/90 bg-amber-50/70 ring-1 ring-amber-200/60',
          className,
        )}
        onClick={
          onOpenDetail
            ? () => {
                onOpenDetail();
              }
            : undefined
        }
        title={cardShellTitle}
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1 flex items-start gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.();
              }}
              disabled={!onNavigate}
              className={cn(
                'text-left text-sm font-semibold text-stone-800 leading-snug break-words min-w-0',
                onNavigate ? 'hover:text-teal-800 cursor-pointer' : 'cursor-default',
              )}
              title={onNavigate ? `${projectName} 작업 보기` : projectName}
            >
              {projectName}
            </button>
            {effectiveRoleTags.length > 0 ? <RoleTagBadges tags={effectiveRoleTags} /> : null}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (disabled) return;
              setIsEditing(true);
            }}
            className={cn(
              'text-teal-700 font-bold tabular-nums shrink-0 rounded-md bg-white/80 border border-teal-100 px-1.5 py-0.5 text-xs shadow-sm',
              disabled ? 'cursor-default opacity-60' : 'hover:bg-teal-100/90 cursor-pointer',
            )}
            title={disabled ? undefined : `클릭하여 투입율 수정\n\n${percentEditTitle}`}
          >
            {formatPercent1(allocationPercent)}%
          </button>
        </div>
        {subtitle ? <span className="text-[11px] text-stone-500 leading-snug break-words">{subtitle}</span> : null}
        {effortSuffix}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 py-1 rounded-md border text-xs max-w-full',
        onNavigate ? 'border-stone-100 bg-stone-50 hover:bg-teal-50/60 hover:border-teal-100' : 'border-stone-100 bg-stone-50',
        onOpenDetail && 'cursor-pointer',
        effortIntegrityWarning && 'border-amber-300/90 bg-amber-50/70 ring-1 ring-amber-200/60',
        className,
      )}
      onClick={onOpenDetail ? () => onOpenDetail() : undefined}
      title={cardShellTitle}
    >
      <span className="inline-flex items-center gap-1 min-w-0 flex-wrap">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate?.();
          }}
          disabled={!onNavigate}
          className={cn(
            'text-stone-700 text-left break-words whitespace-normal leading-snug min-w-0 max-w-[min(100%,22rem)]',
            onNavigate ? 'hover:text-teal-800 cursor-pointer' : 'cursor-default',
          )}
          title={onNavigate ? `${projectName} 작업 보기` : projectName}
        >
          {projectName}
        </button>
        {effectiveRoleTags.length > 0 ? <RoleTagBadges tags={effectiveRoleTags} /> : null}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setIsEditing(true);
        }}
        className={cn(
          'text-teal-600 font-bold tabular-nums shrink-0 rounded px-0.5',
          disabled ? 'cursor-default' : 'hover:bg-teal-100/80 cursor-pointer',
        )}
        title={disabled ? undefined : `클릭하여 투입율 수정\n\n${percentEditTitle}`}
      >
        {formatPercent1(allocationPercent)}%
      </button>
      {effortSuffix}
    </span>
  );
}
