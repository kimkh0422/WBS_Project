import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
}

export function ShareModal({ isOpen, onClose, projectName }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50 animate-in fade-in duration-150" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-xl border border-[var(--color-line)] p-6 animate-in zoom-in-95 fade-in duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-ink)]">공유</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 transition-colors">
            <X size={18} />
          </button>
        </div>
        {projectName && (
          <p className="text-sm text-stone-500 mb-3">프로젝트: {projectName}</p>
        )}
        <p className="text-xs text-stone-400 mb-2">아래 링크를 복사하여 팀원과 공유할 수 있습니다.</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="flex-1 px-3 py-2 text-sm border border-[var(--color-line)] rounded-lg bg-stone-50 text-stone-600"
          />
          <button
            onClick={handleCopyLink}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors",
              copied ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"
            )}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '복사됨' : '링크 복사'}
          </button>
        </div>
        <p className="text-[11px] text-stone-400 mt-3">동일한 환경(네트워크/권한)에서만 접속 가능할 수 있습니다.</p>
      </div>
    </>
  );
}
