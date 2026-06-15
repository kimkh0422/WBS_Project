import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';

type Variant = 'error' | 'warning';

/**
 * 모달·섹션에 표시하는 `error` 문자열과 동일한 내용을 토스트로도 알립니다.
 * (사용자가 다른 화면을 보고 있어도 실패 원인을 놓치지 않도록)
 */
export function useErrorStateWithToast(config?: { variant?: Variant; durationMs?: number; toastId?: string }) {
  const { push } = useToast();
  const [error, setErrorState] = useState<string | null>(null);
  const lastToastedRef = useRef<string | null>(null);
  const variant = config?.variant ?? 'error';
  const durationMs = config?.durationMs ?? 8000;
  const toastId = config?.toastId ?? 'wbs-inline-error';

  const setError = useCallback((msg: string | null) => {
    setErrorState(msg);
  }, []);

  useEffect(() => {
    if (!error) {
      lastToastedRef.current = null;
      return;
    }
    if (error === lastToastedRef.current) return;
    lastToastedRef.current = error;
    push(error, { variant, durationMs, id: toastId });
  }, [error, push, variant, durationMs, toastId]);

  return { error, setError };
}
