import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Project } from '../types';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, startDate?: string) => void;
  project?: Project | null;
}

export function ProjectModal({ isOpen, onClose, onSave, project }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (project) {
        setName(project.name);
        setDescription(project.description || '');
        setStartDate(project.startDate || '');
      } else {
        setName('');
        setDescription('');
        setStartDate('');
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
    onSave(name, description, startDate || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)]">
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
          <h2 className="text-lg font-bold text-[var(--color-ink)]">
            {project ? '프로젝트 수정' : '새 프로젝트'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]">
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
            <p className="text-[10px] text-stone-400 mt-1">프로젝트의 시작 날짜를 설정하세요 (선택 사항)...</p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-line)] mt-2">
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
