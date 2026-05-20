import React, { useEffect, useRef, useState } from 'react';
import { cn, formatNum2 } from '../lib/utils';
import { manDaysToManMonths } from '../lib/workEffortUnits';

interface EditableAllocationBadgeProps {
  projectName: string;
  allocationPercent: number;
  workEffortMd?: number;
  /** WBS 합산 공수 표기. 기본 M/D (다른 화면 호환). */
  effortDisplayUnit?: 'mm' | 'md';
  /** `stacked`일 때 이름 아래에 작게 표시(예: 소속). */
  subtitle?: string;
  /** 인원 칩 등 한눈에 읽히게 세로 배치. 기본은 한 줄(프로젝트명 배지 등). */
  chipLayout?: 'inline' | 'stacked';
  disabled?: boolean;
  onSave: (percent: number) => void;
  onNavigate?: () => void;
  className?: string;
}

function parseAllocationPercent(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed * 10) / 10));
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

  const commit = () => {
    const next = parseAllocationPercent(inputValue, allocationPercent);
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
      <span className="text-stone-500 text-[10px] font-medium tabular-nums shrink-0">
        {effortDisplayUnit === 'md' ? `${formatNum2(workEffortMd)} M/D` : `${formatNum2(manDaysToManMonths(workEffortMd))} M/M`}
      </span>
    ) : null;

  if (isEditing) {
    const editShell =
      chipLayout === 'stacked'
        ? 'inline-flex flex-col gap-1.5 px-2.5 py-2 rounded-lg border border-teal-200 bg-white text-xs shadow-sm min-w-[11rem] max-w-[16rem]'
        : 'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-white text-xs shadow-sm';

    return (
      <span className={cn(editShell, className)} onClick={(e) => e.stopPropagation()}>
        <div
          className={cn('min-w-0', chipLayout === 'stacked' ? 'flex items-start justify-between gap-2' : 'inline-flex items-center gap-1')}
        >
          <span
            className={cn(
              'text-stone-700',
              chipLayout === 'stacked' ? 'text-sm font-semibold leading-snug break-words min-w-0' : 'max-w-[8rem] truncate',
            )}
            title={projectName}
          >
            {projectName}
          </span>
          <span className={cn('inline-flex items-center gap-0.5 shrink-0', chipLayout === 'stacked' && 'pt-0.5')}>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={inputValue}
              onChange={(e) => {
                const next = e.target.value;
                if (next === '' || /^\d*([.]\d*)?$/.test(next)) setInputValue(next);
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
              title="투입율 (0~100%)"
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
          'inline-flex flex-col gap-1 px-2.5 py-2 rounded-lg border text-left min-w-[11rem] max-w-[16rem]',
          onNavigate
            ? 'border-stone-200/90 bg-stone-50/90 hover:bg-teal-50/50 hover:border-teal-200'
            : 'border-stone-200/90 bg-stone-50/90',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <button
            type="button"
            onClick={onNavigate}
            disabled={!onNavigate}
            className={cn(
              'text-left text-sm font-semibold text-stone-800 leading-snug break-words min-w-0',
              onNavigate ? 'hover:text-teal-800 cursor-pointer' : 'cursor-default',
            )}
            title={onNavigate ? `${projectName} 작업 보기` : projectName}
          >
            {projectName}
          </button>
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
            title={disabled ? undefined : '클릭하여 투입율 수정'}
          >
            {allocationPercent}%
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
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs',
        onNavigate ? 'border-stone-100 bg-stone-50 hover:bg-teal-50/60 hover:border-teal-100' : 'border-stone-100 bg-stone-50',
        className,
      )}
    >
      <button
        type="button"
        onClick={onNavigate}
        disabled={!onNavigate}
        className={cn(
          'text-stone-700 max-w-[8rem] truncate text-left',
          onNavigate ? 'hover:text-teal-800 cursor-pointer' : 'cursor-default',
        )}
        title={onNavigate ? `${projectName} 작업 보기` : projectName}
      >
        {projectName}
      </button>
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
        title={disabled ? undefined : '클릭하여 투입율 수정'}
      >
        {allocationPercent}%
      </button>
      {effortSuffix}
    </span>
  );
}
