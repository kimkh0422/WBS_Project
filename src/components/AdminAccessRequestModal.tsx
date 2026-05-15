import React, { useState, useEffect } from 'react';
import { X, Shield, Loader2 } from 'lucide-react';
import { createAdminAccessRequest, getMyPendingAdminAccessRequest } from '../lib/db';

interface AdminAccessRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 요청 제출 직후(대기 상태 반영) */
  onSubmitted?: () => void;
}

export function AdminAccessRequestModal({ isOpen, onClose, onSubmitted }: AdminAccessRequestModalProps) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMessage('');
    setError(null);
    let cancelled = false;
    setChecking(true);
    getMyPendingAdminAccessRequest()
      .then((row) => {
        if (!cancelled) setHasPending(!!row);
      })
      .catch(() => {
        if (!cancelled) setHasPending(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await createAdminAccessRequest(message);
      if (result.success) {
        setHasPending(true);
        onSubmitted?.();
      } else {
        setError(result.error ?? '요청에 실패했습니다.');
      }
    } catch {
      setError('요청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60] animate-in fade-in duration-150" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-full max-w-md bg-white rounded-2xl shadow-xl border border-[var(--color-line)] p-6 animate-in zoom-in-95 fade-in duration-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Shield size={18} />
            시스템 관리자 권한 요청
          </h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg text-stone-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {checking ? (
          <div className="flex justify-center py-8 text-stone-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : hasPending ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            시스템 관리자 권한 요청이 <strong>대기 중</strong>입니다. 기존 관리자가 처리하면 반영됩니다. 필요 시 관리자에게 문의하세요.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-stone-600 leading-relaxed">
              DB에 등록된 시스템 관리자(<code className="text-xs bg-stone-100 px-1 rounded">is_admin</code>)가 아닌 경우, 여기서 권한을
              요청할 수 있습니다. 승인되면 대시보드·회원 관리 등 관리자 기능을 사용할 수 있습니다.
            </p>
            <div>
              <label htmlFor="admin-req-msg" className="block text-xs font-medium text-stone-600 mb-1.5">
                사유 (선택, 최대 500자)
              </label>
              <textarea
                id="admin-req-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="예: 팀 단위 설정 관리가 필요합니다."
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-[var(--color-line)] bg-stone-50 text-[var(--color-ink)] placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-y min-h-[88px]"
              />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                닫기
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                요청 보내기
              </button>
            </div>
          </form>
        )}

        {!checking && hasPending && (
          <div className="flex justify-end mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    </>
  );
}
