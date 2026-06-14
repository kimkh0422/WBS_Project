import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { X, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn, randomUUID } from '../lib/utils';

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export type ToastOptions = {
  variant?: ToastVariant;
  durationMs?: number;
  id?: string;
  /** 0–100, 동기화 등 장시간 작업 시 진행 막대 */
  progress?: number | null;
  /** 세부 진행 단계 문구 (예: "서버에 반영 중...") */
  detail?: string | null;
};

type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
  progress: number | null;
  detail: string | null;
};

type ToastApi = {
  push: (message: string, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
  tipOnce: (key: string, message: string, options?: Omit<ToastOptions, 'id'>) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

function iconFor(variant: ToastVariant) {
  if (variant === 'success') return <CheckCircle2 size={20} className="text-emerald-700 shrink-0" strokeWidth={2.25} />;
  if (variant === 'warning') return <AlertTriangle size={20} className="text-amber-700 shrink-0" strokeWidth={2.25} />;
  if (variant === 'error') return <AlertTriangle size={20} className="text-red-700 shrink-0" strokeWidth={2.25} />;
  return <Info size={20} className="text-blue-700 shrink-0" strokeWidth={2.25} />;
}

function ringFor(variant: ToastVariant) {
  if (variant === 'success') return 'border-emerald-300/90 bg-emerald-50 ring-2 ring-emerald-500/25';
  if (variant === 'warning') return 'border-amber-300/90 bg-amber-50 ring-2 ring-amber-500/30';
  if (variant === 'error') return 'border-red-300/90 bg-red-50 ring-2 ring-red-500/30';
  return 'border-blue-300/90 bg-blue-50 ring-2 ring-blue-500/25';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const t = timeoutsRef.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, options?: ToastOptions) => {
      const variant: ToastVariant = options?.variant ?? 'info';
      const durationMs = options?.durationMs ?? 3500;
      const id = options?.id ?? randomUUID();

      const progress = options?.progress != null && options.progress >= 0 ? Math.min(100, options.progress) : null;
      const detail = options?.detail ?? null;

      setItems((prev) => {
        // De-dupe by id
        const next = prev.filter((t) => t.id !== id);
        return [{ id, message, variant, durationMs, createdAt: Date.now(), progress, detail }, ...next].slice(0, 4);
      });

      const existing = timeoutsRef.current.get(id);
      if (existing) window.clearTimeout(existing);

      const timeoutId = window.setTimeout(() => dismiss(id), durationMs);
      timeoutsRef.current.set(id, timeoutId);
    },
    [dismiss],
  );

  const tipOnce = useCallback(
    (key: string, message: string, options?: Omit<ToastOptions, 'id'>) => {
      const storageKey = `wbs.toast.tipSeen.${key}`;
      try {
        if (window.localStorage.getItem(storageKey) === '1') return;
        window.localStorage.setItem(storageKey, '1');
      } catch {
        // ignore storage errors; still show tip
      }
      push(message, options);
    },
    [push],
  );

  const api = useMemo<ToastApi>(() => ({ push, dismiss, tipOnce }), [push, dismiss, tipOnce]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed right-3 left-3 sm:right-5 sm:left-auto bottom-3 sm:bottom-5 z-[9999] flex flex-col gap-2.5 w-auto sm:w-[min(24rem,calc(100vw-2.5rem))] max-w-[calc(100vw-1.5rem)] pointer-events-none fixed-bottom-safe">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto border-2 rounded-2xl shadow-[0_12px_40px_-8px_rgba(15,23,42,0.35),0_0_0_1px_rgba(15,23,42,0.06)] backdrop-blur-md bg-white/98 overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-200 motion-safe:zoom-in-95',
              ringFor(t.variant),
            )}
            role={t.variant === 'error' || t.variant === 'warning' ? 'alert' : 'status'}
            aria-live={t.variant === 'error' || t.variant === 'warning' ? 'assertive' : 'polite'}
          >
            <div className="flex items-start gap-3 p-3.5 sm:p-4">
              <div className="mt-0.5 shrink-0">{iconFor(t.variant)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] sm:text-base font-semibold text-slate-900 leading-snug whitespace-pre-wrap break-keep">
                  {t.message}
                </div>
                {t.detail && <div className="text-sm text-slate-600 mt-1.5 leading-snug">{t.detail}</div>}
                {t.progress != null && (
                  <div className="mt-2 h-1.5 rounded-full bg-slate-200/90 overflow-hidden" aria-hidden>
                    <div
                      className="h-full rounded-full bg-blue-500 transition-[width] duration-200 ease-out"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="p-1.5 rounded-lg hover:bg-black/8 text-slate-500 hover:text-slate-900 transition-colors shrink-0"
                title="닫기"
                aria-label="닫기"
              >
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
