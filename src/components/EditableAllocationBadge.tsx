import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

interface EditableAllocationBadgeProps {
  projectName: string;
  allocationPercent: number;
  workEffortMd?: number;
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

  if (isEditing) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-white text-xs shadow-sm', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-stone-700 max-w-[8rem] truncate" title={projectName}>
          {projectName}
        </span>
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
      {workEffortMd != null && workEffortMd > 0 && (
        <span className="text-stone-500 text-[10px] font-medium tabular-nums shrink-0">{workEffortMd} M/D</span>
      )}
    </span>
  );
}
