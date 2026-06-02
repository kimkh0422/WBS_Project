import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseAllocationPercentInput, suggestPercentForPersonAllocationAdd } from '../lib/personAllocations';

interface AddProjectPersonAllocationProps {
  projectId: string;
  assigneeCandidates: string[];
  /** 이미 이 프로젝트에 투입(비율>0)으로 잡힌 담당자 키 — (a.assignee || '').trim() || '(미지정)' */
  assignedNames: Set<string>;
  /** 이 프로젝트 투입율 합계 — 투입율 입력 기본값 제안에 사용 */
  allocationSumPercentOnProject?: number;
  orgMemberLabelByName?: Map<string, string>;
  onAdd: (person: string, percent: number) => void;
  disabled?: boolean;
  className?: string;
}

function normalizeAssigneeKey(raw: string): string {
  return (raw || '').trim() || '(미지정)';
}

export function AddProjectPersonAllocation({
  projectId,
  assigneeCandidates,
  assignedNames,
  allocationSumPercentOnProject = 0,
  orgMemberLabelByName,
  onAdd,
  disabled,
  className,
}: AddProjectPersonAllocationProps) {
  const personDatalistId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [personInput, setPersonInput] = useState('');
  const [percentInput, setPercentInput] = useState('');

  useEffect(() => {
    if (isAdding) nameInputRef.current?.focus();
  }, [isAdding]);

  const reset = () => {
    setIsAdding(false);
    setPersonInput('');
    setPercentInput('');
  };

  const candidateNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of assigneeCandidates) {
      const key = normalizeAssigneeKey(name);
      if (key === '(미지정)') continue;
      if (assignedNames.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name.trim() || name);
    }
    return out;
  }, [assigneeCandidates, assignedNames]);

  const handleSave = () => {
    const person = personInput.trim();
    if (!person || normalizeAssigneeKey(person) === '(미지정)') return;
    if (assignedNames.has(normalizeAssigneeKey(person))) return;
    const pct = parseAllocationPercentInput(percentInput);
    if (pct == null) return;
    onAdd(person, pct);
    reset();
  };

  if (disabled) return null;

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsAdding(true);
          setPercentInput(String(suggestPercentForPersonAllocationAdd(allocationSumPercentOnProject)));
        }}
        className={cn(
          'inline-flex items-center gap-1 shrink-0 whitespace-nowrap px-2.5 py-1 text-xs font-medium rounded-lg border border-dashed border-teal-300 text-teal-700 bg-teal-50/40 hover:bg-teal-50 hover:border-teal-400 transition-colors',
          className,
        )}
        title="이 프로젝트에 투입 인원 추가"
      >
        <UserPlus size={13} className="shrink-0" aria-hidden />
        인원 추가
      </button>
    );
  }

  const canSave =
    personInput.trim().length > 0 &&
    normalizeAssigneeKey(personInput) !== '(미지정)' &&
    !assignedNames.has(normalizeAssigneeKey(personInput)) &&
    parseAllocationPercentInput(percentInput) != null;

  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-teal-200 bg-white text-xs shadow-sm min-w-0 max-w-full',
        className,
      )}
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
        className="w-32 min-w-0 px-1.5 py-0.5 text-xs border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-300"
        title="조직 회원에서 선택하거나 직접 입력"
      />
      <datalist id={personDatalistId}>
        {candidateNames.map((name) => (
          <option key={`${projectId}:${name}`} value={name} label={orgMemberLabelByName?.get(name)} />
        ))}
      </datalist>
      <span className="inline-flex items-center gap-0.5 shrink-0">
        <input
          type="text"
          inputMode="numeric"
          value={percentInput}
          onChange={(e) => {
            const next = e.target.value;
            if (next === '' || /^\d*$/.test(next)) setPercentInput(next);
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
          title="투입율 (0~100% 정수)"
        />
        <span className="text-teal-600 font-bold">%</span>
      </span>
      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        추가
      </button>
      <button
        type="button"
        onClick={reset}
        className="px-1.5 py-0.5 text-[10px] font-semibold rounded text-stone-500 hover:bg-stone-100 shrink-0"
      >
        취소
      </button>
    </div>
  );
}
