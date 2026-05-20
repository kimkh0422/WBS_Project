import React, { useEffect, useId, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { findProjectByAllocationInput, parseAllocationPercentInput, type PersonProjectAddPayload } from '../lib/personAllocations';
import { formatProjectDisplayName } from '../lib/projectKind';
import type { Project } from '../types';

interface AddPersonAllocationControlProps {
  availableProjects: Project[];
  assigneeCandidates: string[];
  orgMemberLabelByName?: Map<string, string>;
  onAdd: (person: string, payload: PersonProjectAddPayload, percent: number) => void;
  className?: string;
}

export function AddPersonAllocationControl({
  availableProjects,
  assigneeCandidates,
  orgMemberLabelByName,
  onAdd,
  className,
}: AddPersonAllocationControlProps) {
  const personDatalistId = useId();
  const projectDatalistId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [personInput, setPersonInput] = useState('');
  const [projectInput, setProjectInput] = useState('');
  const [percentInput, setPercentInput] = useState('');

  useEffect(() => {
    if (isAdding) nameInputRef.current?.focus();
  }, [isAdding]);

  const reset = () => {
    setIsAdding(false);
    setPersonInput('');
    setProjectInput('');
    setPercentInput('');
  };

  const resolveProjectPayload = (): PersonProjectAddPayload | null => {
    const trimmed = projectInput.trim();
    if (!trimmed) return null;
    const matched = findProjectByAllocationInput(trimmed, availableProjects);
    if (matched) return { kind: 'existing', projectId: matched.id };
    return { kind: 'new', projectName: trimmed };
  };

  const handleSave = () => {
    const person = personInput.trim();
    if (!person || person === '(미지정)') return;
    const payload = resolveProjectPayload();
    const pct = parseAllocationPercentInput(percentInput);
    if (!payload || pct == null) return;
    onAdd(person, payload, pct);
    reset();
  };

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border-2 border-teal-600 text-teal-700 bg-white shadow-sm hover:bg-teal-600 hover:text-white hover:border-teal-600 transition-colors',
          className,
        )}
      >
        <UserPlus size={14} />
        인원 추가
      </button>
    );
  }

  const canSave =
    personInput.trim().length > 0 &&
    personInput.trim() !== '(미지정)' &&
    projectInput.trim().length > 0 &&
    parseAllocationPercentInput(percentInput) != null;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 p-3 rounded-xl border border-teal-200 bg-white shadow-sm', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={nameInputRef}
        type="text"
        list={personDatalistId}
        value={personInput}
        onChange={(e) => setPersonInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSave) handleSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            reset();
          }
        }}
        placeholder="담당자 이름"
        className="w-36 px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300"
        title="조직 회원에서 선택하거나 직접 입력"
      />
      <datalist id={personDatalistId}>
        {assigneeCandidates.map((name) => (
          <option key={name} value={name} label={orgMemberLabelByName?.get(name)} />
        ))}
      </datalist>
      <input
        type="text"
        list={projectDatalistId}
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
        className="max-w-[12rem] px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 truncate"
        title="기존 프로젝트 선택 또는 신규 프로젝트명 입력"
      />
      <datalist id={projectDatalistId}>
        {availableProjects.map((p) => (
          <option key={p.id} value={formatProjectDisplayName(p.name, p.projectKind)} />
        ))}
      </datalist>
      <span className="inline-flex items-center gap-0.5">
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
          className="w-10 px-1 py-1 text-xs font-bold text-teal-700 border border-teal-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300 tabular-nums"
          title="투입율 (0~100%)"
        />
        <span className="text-teal-600 font-bold text-xs">%</span>
      </span>
      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        추가
      </button>
      <button
        type="button"
        onClick={reset}
        className="px-2.5 py-1 text-xs font-semibold rounded-lg text-stone-600 border border-stone-200 hover:bg-stone-50"
      >
        취소
      </button>
    </div>
  );
}
