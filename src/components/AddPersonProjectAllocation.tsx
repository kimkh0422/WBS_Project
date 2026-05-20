import React, { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { findProjectByAllocationInput, parseAllocationPercentInput, type PersonProjectAddPayload } from '../lib/personAllocations';
import type { Project } from '../types';

interface AddPersonProjectAllocationProps {
  person: string;
  assignedProjectIds: Set<string>;
  availableProjects: Project[];
  onAdd: (payload: PersonProjectAddPayload, percent: number) => void;
  disabled?: boolean;
  className?: string;
}

export function AddPersonProjectAllocation({
  person,
  assignedProjectIds,
  availableProjects,
  onAdd,
  disabled,
  className,
}: AddPersonProjectAllocationProps) {
  const datalistId = useId();
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [projectInput, setProjectInput] = useState('');
  const [percentInput, setPercentInput] = useState('');

  const unassignedProjects = availableProjects.filter((p) => !assignedProjectIds.has(p.id));

  useEffect(() => {
    if (isAdding) projectInputRef.current?.focus();
  }, [isAdding]);

  const reset = () => {
    setIsAdding(false);
    setProjectInput('');
    setPercentInput('');
  };

  const resolvePayload = (): PersonProjectAddPayload | null => {
    const trimmed = projectInput.trim();
    if (!trimmed) return null;
    const matched = findProjectByAllocationInput(trimmed, availableProjects);
    if (matched) return { kind: 'existing', projectId: matched.id };
    return { kind: 'new', projectName: trimmed };
  };

  const handleSave = () => {
    const payload = resolvePayload();
    const pct = parseAllocationPercentInput(percentInput);
    if (!payload || pct == null) return;
    onAdd(payload, pct);
    reset();
  };

  const canSave = Boolean(projectInput.trim()) && parseAllocationPercentInput(percentInput) != null;

  if (disabled) return null;

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className={cn(
          'inline-flex items-center gap-1 shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-lg border border-dashed border-teal-300 text-teal-700 bg-teal-50/40 hover:bg-teal-50 hover:border-teal-400 transition-colors',
          className,
        )}
        title={`${person}님에게 프로젝트 투입 추가`}
      >
        <Plus size={13} className="shrink-0" aria-hidden />
        프로젝트
      </button>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-md border border-teal-200 bg-white text-xs shadow-sm',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={projectInputRef}
        type="text"
        list={datalistId}
        value={projectInput}
        onChange={(e) => setProjectInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSave) handleSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            reset();
          }
        }}
        placeholder="프로젝트명"
        className="max-w-[10rem] px-1.5 py-0.5 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 truncate"
        title="기존 프로젝트 선택 또는 신규 프로젝트명 입력"
      />
      <datalist id={datalistId}>
        {unassignedProjects.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <input
        type="text"
        inputMode="decimal"
        value={percentInput}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '' || /^\d*([.]\d*)?$/.test(next)) setPercentInput(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSave) handleSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            reset();
          }
        }}
        placeholder="%"
        className="w-10 px-1 py-0.5 text-xs font-bold text-teal-700 border border-teal-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 tabular-nums"
        title="투입율 (0~100%)"
      />
      <span className="text-teal-600 font-bold">%</span>
      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        추가
      </button>
      <button type="button" onClick={reset} className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-stone-500 hover:bg-stone-100">
        취소
      </button>
    </span>
  );
}
