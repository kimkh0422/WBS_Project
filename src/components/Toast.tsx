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
  /** 세부 진행 단계 문구 (예: "AI에 요청 전송 중...") */
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
  if (variant === 'success') return <CheckCircle2 size={16} className="text-emerald-600" />;
  if (variant === 'warning') return <AlertTriangle size={16} className="text-amber-600" />;
  if (variant === 'error') return <AlertTriangle size={16} className="text-red-600" />;
  return <Info size={16} className="text-blue-600" />;
}

function ringFor(variant: ToastVariant) {
  if (variant === 'success') return 'border-emerald-200 bg-emerald-50/60';
  if (variant === 'warning') return 'border-amber-200 bg-amber-50/60';
  if (variant === 'error') return 'border-red-200 bg-red-50/60';
  return 'border-blue-200 bg-blue-50/60';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
    const t = timeoutsRef.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const push = useCallback((message: string, options?: ToastOptions) => {
    const variant: ToastVariant = options?.variant ?? 'info';
    const durationMs = options?.durationMs ?? 3500;
    const id = options?.id ?? randomUUID();

    const progress = options?.progress != null && options.progress >= 0 ? Math.min(100, options.progress) : null;
    const detail = options?.detail ?? null;

    setItems(prev => {
      // De-dupe by id
      const next = prev.filter(t => t.id !== id);
      return [{ id, message, variant, durationMs, createdAt: Date.now(), progress, detail }, ...next].slice(0, 4);
    });

    const existing = timeoutsRef.current.get(id);
    if (existing) window.clearTimeout(existing);

    const timeoutId = window.setTimeout(() => dismiss(id), durationMs);
    timeoutsRef.current.set(id, timeoutId);
  }, [dismiss]);

  const tipOnce = useCallback((key: string, message: string, options?: Omit<ToastOptions, 'id'>) => {
    const storageKey = `wbs.toast.tipSeen.${key}`;
    try {
      if (window.localStorage.getItem(storageKey) === '1') return;
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // ignore storage errors; still show tip
    }
    push(message, options);
  }, [push]);

  const api = useMemo<ToastApi>(() => ({ push, dismiss, tipOnce }), [push, dismiss, tipOnce]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed right-4 left-4 sm:left-auto bottom-4 z-[100] flex flex-col gap-2 w-auto sm:w-[320px] max-w-[calc(100vw-2rem)] pointer-events-none fixed-bottom-safe">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto border rounded-xl shadow-lg backdrop-blur bg-white/85 overflow-hidden",
              ringFor(t.variant)
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2 p-3">
              <div className="mt-0.5 shrink-0">{iconFor(t.variant)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm sm:text-[12px] font-semibold text-slate-800 leading-snug whitespace-pre-wrap break-keep">
                  {t.message}
                </div>
                {t.detail && (
                  <div className="text-xs text-slate-500 mt-1 leading-snug">
                    {t.detail}
                  </div>
                )}
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
                className="p-1 rounded-md hover:bg-black/5 text-slate-400 hover:text-slate-700 transition-colors"
                title="닫기"
              >
                <X size={14} />
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

