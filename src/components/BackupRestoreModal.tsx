import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileJson, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import type { Project } from '../types';
import type { BackupData } from '../lib/export';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmFull: () => void;
  onConfirmIntoProject: (targetProjectId: string) => void;
  data: BackupData | null;
  projects: Project[];
  currentProjectId: string;
}

export function BackupRestoreModal({
  isOpen,
  onClose,
  onConfirmFull,
  onConfirmIntoProject,
  data,
  projects,
  currentProjectId,
}: BackupRestoreModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const effectiveCurrent = currentProjectId === 'all' ? (projects[0]?.id ?? '') : currentProjectId;
  const [mode, setMode] = useState<'full' | 'project'>('full');
  const [targetProjectId, setTargetProjectId] = useState<string>(effectiveCurrent || '');

  useEffect(() => {
    if (!isOpen) return;
    setTargetProjectId((prev) => (projects.some((p) => p.id === prev) ? prev : effectiveCurrent || (projects[0]?.id ?? '')));
  }, [isOpen, effectiveCurrent, projects]);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => confirmButtonRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  const taskCount = data.tasks.length;
  const projectCount = data.projects.length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'full') {
      onConfirmFull();
    } else if (targetProjectId) {
      onConfirmIntoProject(targetProjectId);
    }
    onClose();
  };

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md overflow-hidden')}>
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <FileJson className="text-amber-600" size={20} />
            <h2 className="text-lg font-bold text-[var(--color-ink)]">백업 데이터 가져오기</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            프로젝트 <span className="font-bold">{projectCount}</span>개, 작업{' '}
            <span className="font-bold">{taskCount.toLocaleString()}</span>개가 포함된 백업입니다.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">복원 방식</label>
            <div className="space-y-2">
              <label
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  mode === 'full' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input type="radio" name="restoreMode" checked={mode === 'full'} onChange={() => setMode('full')} className="mt-1" />
                <div>
                  <span className="font-medium text-slate-800">전체 복원</span>
                  <p className="text-xs text-slate-500 mt-0.5">모든 프로젝트와 작업이 백업 내용으로 덮어씌워집니다.</p>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  projects.length === 0 ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                  mode === 'project' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50',
                )}
              >
                <input
                  type="radio"
                  name="restoreMode"
                  checked={mode === 'project'}
                  onChange={() => projects.length > 0 && setMode('project')}
                  disabled={projects.length === 0}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="font-medium text-slate-800">선택한 프로젝트에 덮어쓰기</span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {projects.length === 0 ? '프로젝트가 없습니다. 전체 복원을 선택하세요.' : '백업의 작업을 선택한 프로젝트에 덮어씁니다.'}
                  </p>
                  {mode === 'project' && projects.length > 0 && (
                    <select
                      value={targetProjectId}
                      onChange={(e) => setTargetProjectId(e.target.value)}
                      className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </div>

          {mode === 'full' && (
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span className="text-xs">현재 모든 데이터가 백업 내용으로 교체됩니다.</span>
            </div>
          )}
        </div>

        <form className="flex justify-end gap-3 p-5 border-t border-slate-100 bg-slate-50/30" onSubmit={handleSubmit}>
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button
            ref={confirmButtonRef}
            type="submit"
            className={cn('btn-primary', mode === 'full' && 'bg-red-600 hover:bg-red-700')}
            disabled={mode === 'project' && !targetProjectId}
          >
            {mode === 'full' ? '전체 복원' : '덮어쓰기'}
          </button>
        </form>
      </div>
    </div>
  );
}
