import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/**
 * 접속 기록: 로그인 후 앱 진입 시 한 번 기록 + 주기적 활동 하트비트(관리자용 현재 접속자 판별).
 * AppWithProviders god 컴포넌트에서 분리 — 동작 동일.
 */
export function useVisitLogging(userId: string | undefined) {
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userId) return;
    let sessionId = sessionStorage.getItem('wbs-visit-session-id');
    if (!sessionId) {
      sessionId = uuidv4();
      sessionStorage.setItem('wbs-visit-session-id', sessionId);
    }
    const sid = sessionId;
    void (async () => {
      try {
        await supabase.rpc('record_visit', { p_session_id: sid });
      } catch {
        // best-effort; ignore visit logging failures
      }
      try {
        await supabase.rpc('pulse_presence', { p_session_id: sid });
      } catch {
        // best-effort; DB에 마이그레이션 전이면 무시
      }
    })();
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          await supabase.rpc('pulse_presence', { p_session_id: sid });
        } catch {
          /* ignore */
        }
      })();
    }, 45_000);
    return () => window.clearInterval(intervalId);
  }, [userId]);
}
