import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseAllocationPercentInput } from '../lib/personAllocations';

interface AddProjectPersonAllocationProps {
  projectName: string;
  assignedPersons: Set<string>;
  assigneeCandidates: string[];
  onAdd: (person: string, percent: number) => void;
  disabled?: boolean;
  className?: string;
}

export function AddProjectPersonAllocation({
  projectName,
  assignedPersons,
  assigneeCandidates,
  onAdd,
  disabled,
  className,
}: AddProjectPersonAllocationProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [person, setPerson] = useState('');
  const [percentInput, setPercentInput] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);

  const unassignedPersons = assigneeCandidates.filter((name) => !assignedPersons.has(name));

  useEffect(() => {
    if (isAdding) selectRef.current?.focus();
  }, [isAdding]);

  const reset = () => {
    setIsAdding(false);
    setPerson('');
    setPercentInput('');
  };

  const handleSave = () => {
    const trimmed = (person || '').trim();
    const pct = parseAllocationPercentInput(percentInput);
    if (!trimmed || pct == null) return;
    onAdd(trimmed, pct);
    reset();
  };

  if (disabled || unassignedPersons.length === 0) return null;

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsAdding(true);
          setPerson(unassignedPersons[0] ?? '');
        }}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-stone-300 text-xs text-stone-500 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50/50 transition-colors',
          className,
        )}
        title={`${projectName}에 인원 투입 추가`}
      >
        <Plus size={12} />
        인원
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
      <select
        ref={selectRef}
        value={person}
        onChange={(e) => setPerson(e.target.value)}
        className="max-w-[10rem] px-1.5 py-0.5 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 truncate"
        title="담당자 선택"
      >
        {unassignedPersons.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <input
        type="text"
        inputMode="decimal"
        value={percentInput}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '' || /^\d*([.]\d*)?$/.test(next)) setPercentInput(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
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
        disabled={!person.trim() || parseAllocationPercentInput(percentInput) == null}
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
