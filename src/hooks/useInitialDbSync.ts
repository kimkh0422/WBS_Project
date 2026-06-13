import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { isSupabaseConfigured } from '../lib/supabase';

const WBS_INITIAL_DB_SYNC_ONCE_KEY = 'wbs.initial-db-sync.once.done';

type SyncWithDb = (scope: 'current' | 'all', onProgress?: (percent: number, message: string) => void) => Promise<unknown>;

interface UseInitialDbSyncParams {
  isLoading: boolean;
  syncWithDb: SyncWithDb;
}

/**
 * 최초 접속 시 DB 자동 동기화(1회).
 * - executeDbSync: 진행률 콜백으로 동기화를 돌리고 성공 여부를 반환.
 * - 진행률 state(isDbSyncing·dbSyncStep)는 향후 동기화 UI에서 참조할 수 있어 유지하되, 현재는 내부 보관.
 * WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useInitialDbSync({ isLoading, syncWithDb }: UseInitialDbSyncParams) {
  const { push: pushToast } = useToast();
  const [isDbSyncing, setIsDbSyncing] = useState(false);
  const [dbSyncStep, setDbSyncStep] = useState<{ pct: number; msg: string } | null>(null);
  const initialDbSyncDoneRef = useRef(false);

  const executeDbSync = useCallback(
    async (scope: 'current' | 'all'): Promise<boolean> => {
      // 동기화 진행/완료 토스트는 노이즈가 커서 일시 숨김 처리.
      // 진행률 state(setDbSyncStep)는 다른 UI에서 참조될 수 있어 유지.
      setIsDbSyncing(true);
      setDbSyncStep({ pct: 0, msg: '시작…' });
      try {
        await syncWithDb(scope, (pct, message) => {
          setDbSyncStep({ pct, msg: message });
        });
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'DB 동기화에 실패했습니다.';
        // 실패만 사용자에게 알림(같은 id로 누적 디바운스).
        pushToast(msg, { variant: 'error', id: 'db-sync', durationMs: 8000 });
        return false;
      } finally {
        setIsDbSyncing(false);
        setDbSyncStep(null);
      }
    },
    [syncWithDb, pushToast],
  );

  // 최초 페이지 접속 시 DB 자동 동기화 (로그인 + Supabase 설정 완료)
  useEffect(() => {
    if (initialDbSyncDoneRef.current) return;
    if (window.localStorage.getItem(WBS_INITIAL_DB_SYNC_ONCE_KEY) === '1') {
      initialDbSyncDoneRef.current = true;
      return;
    }
    if (!isSupabaseConfigured) return;
    if (isLoading) return;
    initialDbSyncDoneRef.current = true;
    void (async () => {
      const ok = await executeDbSync('all');
      if (ok) window.localStorage.setItem(WBS_INITIAL_DB_SYNC_ONCE_KEY, '1');
      else initialDbSyncDoneRef.current = false;
    })();
  }, [isLoading, executeDbSync]);

  return { executeDbSync, isDbSyncing, dbSyncStep };
}
