import React, { useState, useEffect } from 'react';
import { X, Plus, UserPlus } from 'lucide-react';
import { Project, ProjectAssignment } from '../types';
import { ALLOCATION_OPTIONS } from '../lib/schedule';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, startDate?: string, endDate?: string, assignments?: ProjectAssignment[], minWorkEffortDays?: number) => void;
  project?: Project | null;
}

export function ProjectModal({ isOpen, onClose, onSave, project }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [minWorkEffortDays, setMinWorkEffortDays] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      if (project) {
        setName(project.name);
        setDescription(project.description || '');
        setStartDate(project.startDate || '');
        setEndDate(project.endDate || '');
        setAssignments(project.assignments?.length ? [...project.assignments] : []);
        setMinWorkEffortDays(project.minWorkEffortDays != null ? String(project.minWorkEffortDays) : '');
      } else {
        setName('');
        setDescription('');
        setStartDate('');
        setEndDate('');
        setAssignments([]);
        setMinWorkEffortDays('');
      }
    }
  }, [isOpen, project]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          target.blur();
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (startDate && endDate && startDate > endDate) {
      alert('종료일은 시작일보다 이후여야 합니다.');
      return;
    }
    const parsedMin = minWorkEffortDays.trim() ? parseFloat(minWorkEffortDays) : undefined;
    if (parsedMin !== undefined && (Number.isNaN(parsedMin) || parsedMin < 0)) {
      alert('최소 공수 기준은 0 이상의 숫자를 입력해 주세요.');
      return;
    }
    onSave(name, description, startDate || undefined, endDate || undefined, assignments.length > 0 ? assignments : undefined, parsedMin);
    onClose();
  };

  const addAssignment = () => setAssignments(prev => [...prev, { assignee: '', allocationPercent: 100 }]);
  const removeAssignment = (index: number) => setAssignments(prev => prev.filter((_, i) => i !== index));
  const updateAssignment = (index: number, field: 'assignee' | 'allocationPercent', value: string | number) => {
    setAssignments(prev => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-glass-elevated rounded-[20px] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.2)] w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-300 border border-white/60">
        <div className="flex justify-between items-center p-6 border-b border-slate-200/50 bg-white/40">
          <h2 className="text-xl font-extrabold tracking-tight text-[var(--color-ink)]">
            {project ? '프로젝트 수정' : '새 프로젝트'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/60 rounded-full transition-all text-slate-400 hover:text-slate-800 hover:rotate-90 duration-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
              프로젝트 이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="프로젝트 이름을 입력하세요..."
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
              설명
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field min-h-[80px]"
              placeholder="프로젝트 설명을 입력하세요 (선택 사항)..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                프로젝트 시작일
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
                프로젝트 종료일
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          <p className="text-[10px] text-stone-400 -mt-2">WBS 작업은 이 기간 범위를 벗어날 수 없습니다. (선택 사항)</p>

          <div>
            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">
              작업 최소 공수 기준 (일)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={minWorkEffortDays}
              onChange={(e) => setMinWorkEffortDays(e.target.value)}
              className="input-field"
              placeholder="예: 0.5, 1, 3 (선택 사항)"
            />
            <p className="text-[10px] text-stone-400 mt-1">WBS 작업 세부 분류에 사용됩니다. 0.5d, 1d, 3d 등 숫자로 입력.</p>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <UserPlus size={12} />
              프로젝트 투입인원 (투입비율)
            </label>
            <p className="text-[10px] text-stone-400 mb-2">이 프로젝트에 투입되는 인원과 비율을 설정합니다. 작업별 기간·공수 계산에 적용됩니다. 담당자 이름은 프로젝트 내에서만 사용되며 필요 시 수정할 수 있습니다.</p>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={a.assignee}
                    onChange={(e) => updateAssignment(i, 'assignee', e.target.value)}
                    className="input-field flex-1 py-2 text-sm"
                    placeholder="담당자 이름"
                  />
                  <select
                    value={a.allocationPercent}
                    onChange={(e) => updateAssignment(i, 'allocationPercent', Number(e.target.value))}
                    className="input-field w-24 py-2 text-sm"
                  >
                    {ALLOCATION_OPTIONS.map(pct => <option key={pct} value={pct}>{pct}%</option>)}
                  </select>
                  <button type="button" onClick={() => removeAssignment(i)} className="p-2 text-stone-400 hover:text-red-500 rounded">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addAssignment} className="mt-2 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              <Plus size={12} /> 인원 추가
            </button>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-slate-200/50 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {project ? '저장' : '프로젝트 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
