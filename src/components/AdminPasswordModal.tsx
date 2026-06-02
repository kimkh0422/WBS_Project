import React, { useState } from 'react';
import { X, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { WBS_ADMIN_PASSWORD } from '../constants/adminBypass';

interface AdminPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AdminPasswordModal({ isOpen, onClose, onSuccess }: AdminPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === WBS_ADMIN_PASSWORD) {
      onSuccess();
      setPassword('');
      setError(false);
    } else {
      setError(true);
      setPassword('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[60]')} onClick={onClose}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-sm p-6')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Lock size={18} />
            관리자 모드 전환
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">비밀번호를 입력하세요.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(false);
            }}
            placeholder="비밀번호"
            className={`w-full px-4 py-3 rounded-xl border text-[var(--color-ink)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
              error ? 'border-red-500 bg-red-50' : 'border-[var(--color-line)] bg-slate-50'
            }`}
            autoFocus
          />
          {error && <p className="text-red-500 text-sm mt-2">비밀번호가 올바르지 않습니다.</p>}
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium text-sm"
            >
              취소
            </button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white hover:bg-teal-700 font-medium text-sm">
              확인
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
