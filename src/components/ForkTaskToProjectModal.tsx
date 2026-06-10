import React, { useEffect, useState } from 'react';
import { X, GitBranch } from 'lucide-react';
import type { Project, ProjectKind, Task } from '../types';
import { DEFAULT_NEW_PROJECT_KIND, PROJECT_KINDS, isPrivateProjectKind } from '../lib/projectKind';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';

export interface ForkTaskToProjectInput {
  name: string;
  formalName?: string;
  description?: string;
  pmName: string;
  poName?: string;
  startDate?: string;
  endDate?: string;
  projectKind?: ProjectKind;
  includeInDashboard?: boolean;
}

interface ForkTaskToProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (input: ForkTaskToProjectInput) => void;
  /** 분기 원본 task. 이름·일정 등 기본값 자동 채움 */
  sourceTask: Task | null;
  /** 분기 원본 프로젝트. PM·종류 등 기본값 자동 채움 */
  sourceProject: Project | null;
  /** 생성자(현재 사용자) 표시명 — PM 기본값 폴백 */
  defaultPmName?: string;
  /** 자식 트리 개수 — "○개 하위 작업도 함께 이동" 안내용 */
  descendantCount?: number;
  /** 로그인 사용자 id. 소유자가 아닐 때 「연습」「개인」 항목은 선택 목록에서 제외 */
  currentUserId?: string;
}

export function ForkTaskToProjectModal({
  isOpen,
  onClose,
  onConfirm,
  sourceTask,
  sourceProject,
  defaultPmName = '',
  descendantCount = 0,
  currentUserId,
}: ForkTaskToProjectModalProps) {
  const [name, setName] = useState('');
  const [formalName, setFormalName] = useState('');
  const [description, setDescription] = useState('');
  const [pmName, setPmName] = useState('');
  const [poName, setPoName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [projectKind, setProjectKind] = useState<ProjectKind>(DEFAULT_NEW_PROJECT_KIND);
  const [includeInDashboard, setIncludeInDashboard] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(sourceTask?.name?.trim() || '');
    setFormalName('');
    setDescription(sourceTask?.description?.trim() || '');
    setPmName((sourceProject?.pmName?.trim() || defaultPmName.trim() || '').trim());
    setPoName(sourceProject?.poName?.trim() || '');
    setStartDate(sourceTask?.startDate ? sourceTask.startDate.slice(0, 10) : sourceProject?.startDate?.slice(0, 10) || '');
    setEndDate(sourceTask?.endDate ? sourceTask.endDate.slice(0, 10) : sourceProject?.endDate?.slice(0, 10) || '');
    setProjectKind(sourceProject?.projectKind ?? DEFAULT_NEW_PROJECT_KIND);
    setIncludeInDashboard(true);
    setError(null);
  }, [isOpen, sourceTask, sourceProject, defaultPmName]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        target.blur();
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const projectKindOptions = (() => {
    const canPickPrivate = !sourceProject?.ownerId || (!!currentUserId && sourceProject?.ownerId === currentUserId);
    return canPickPrivate ? PROJECT_KINDS : PROJECT_KINDS.filter((k) => !isPrivateProjectKind(k));
  })();

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError('프로젝트 이름(가칭)을 입력해 주세요.');
      return;
    }
    if (!pmName.trim()) {
      setError('프로젝트 PM을 입력해 주세요.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError('종료일은 시작일보다 이후여야 합니다.');
      return;
    }
    onConfirm({
      name: name.trim(),
      formalName: formalName.trim() || undefined,
      description: description.trim() || undefined,
      pmName: pmName.trim(),
      poName: poName.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      projectKind,
      includeInDashboard,
    });
  };

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div
        className={cn(
          MODAL_PANEL_BASE_CLASS,
          'bg-glass-elevated rounded-[20px] max-w-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col border-[var(--color-line)]',
        )}
      >
        <div className="flex justify-between items-center p-6 border-b border-[var(--color-line)] bg-[var(--color-surface)]/80 backdrop-blur-md">
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-[var(--color-ink)]">
            <GitBranch size={20} className="text-indigo-500" aria-hidden />
            작업을 신규 프로젝트로 분기
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-bg)] rounded-full transition-all text-slate-400 hover:text-[var(--color-ink)] hover:rotate-90 duration-300"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-indigo-900">
            <p className="font-semibold">「{sourceTask?.name || '선택한 작업'}」을(를) 신규 프로젝트로 분리합니다.</p>
            <p className="mt-1 text-xs leading-relaxed text-indigo-900/80">
              {descendantCount > 0 ? (
                <>
                  하위 작업 <strong className="font-semibold">{descendantCount}</strong>개가 신규 프로젝트로 함께 이동하며, 원래 작업은 빈
                  요약 행으로 남아 자식 프로젝트의 진척률·일정·공수를 그대로 표시합니다.
                </>
              ) : (
                <>이 작업에는 하위 작업이 없습니다. 신규 프로젝트는 빈 상태로 생성되며, 원래 작업은 자식 프로젝트의 진척률을 표시합니다.</>
              )}
            </p>
          </div>

          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">필수 입력</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-kind" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  항목 <span className="text-[var(--color-danger)]">*</span>
                </label>
                <select
                  id="fork-modal-kind"
                  value={projectKind}
                  onChange={(e) => setProjectKind(e.target.value as ProjectKind)}
                  disabled={!includeInDashboard}
                  className={cn('input-field w-full', !includeInDashboard && 'cursor-not-allowed bg-slate-100/90 opacity-70')}
                >
                  {projectKindOptions.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-name" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  가칭(약어) <span className="text-[var(--color-danger)]">*</span>
                </label>
                <input
                  id="fork-modal-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field w-full"
                  placeholder="신규 프로젝트의 짧은 이름"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fork-modal-formal" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                정식명칭 <span className="opacity-60 font-normal">(선택)</span>
              </label>
              <textarea
                id="fork-modal-formal"
                value={formalName}
                onChange={(e) => setFormalName(e.target.value)}
                className="input-field min-h-[60px] w-full resize-y"
                placeholder="계약서·보고서용 전체 과제명이 있으면 입력"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-[var(--color-line)] pt-4">
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-pm" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  프로젝트 PM <span className="text-[var(--color-danger)]">*</span>
                </label>
                <input
                  id="fork-modal-pm"
                  type="text"
                  value={pmName}
                  onChange={(e) => setPmName(e.target.value)}
                  className="input-field w-full"
                  placeholder="이름 입력"
                />
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-po" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  프로젝트 PO <span className="opacity-60 font-normal">(선택)</span>
                </label>
                <input
                  id="fork-modal-po"
                  type="text"
                  value={poName}
                  onChange={(e) => setPoName(e.target.value)}
                  className="input-field w-full"
                  placeholder="이름 입력"
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">기본 정보 (선택)</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fork-modal-desc" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                설명
              </label>
              <textarea
                id="fork-modal-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input-field min-h-[72px] w-full"
                placeholder="신규 프로젝트 설명"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-start" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  시작일
                </label>
                <input
                  id="fork-modal-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input-field w-full"
                />
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <label htmlFor="fork-modal-end" className="text-xs font-semibold text-[var(--color-ink-subdued)]">
                  종료일
                </label>
                <input
                  id="fork-modal-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-field w-full"
                />
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              <input
                id="fork-modal-include-dashboard"
                type="checkbox"
                checked={includeInDashboard}
                onChange={(e) => setIncludeInDashboard(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              />
              <label htmlFor="fork-modal-include-dashboard" className="text-sm font-medium text-[var(--color-ink)] cursor-pointer">
                대시보드에 반영
                <p className="mt-0.5 text-xs font-normal text-[var(--color-ink-subdued)]">
                  켜면 요약·집계·프로젝트 카드에 포함될 수 있습니다.
                </p>
              </label>
            </div>
          </section>
        </div>

        {error && (
          <div className="mx-6 mb-2 px-4 py-2.5 rounded-lg bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-[var(--color-danger)] text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 p-6 border-t border-[var(--color-line)] bg-[var(--color-surface)]/80 backdrop-blur">
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim() || !pmName.trim()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            분기하여 프로젝트 생성
          </button>
        </div>
      </div>
    </div>
  );
}
