import { useCallback, useEffect, useState } from 'react';
import { getMyEditableProjectIds } from '../lib/db';

/**
 * 멤버십 기반 편집 가능 프로젝트 ID — 탭 복귀·창 포커스 시 재조회.
 * 일시적 RPC 실패 시 직전 권한을 유지(권한 강등으로 새 작업 추가가 막히던 버그 방지).
 * AppWithProviders god 컴포넌트에서 분리 — 동작 동일.
 */
export function useEditableProjectIds(userId: string | undefined) {
  /** undefined: 로딩 전(편집 제한 미적용). 로드 후 배열로 멤버십 기반 편집 가능 프로젝트 */
  const [myEditableProjectIds, setMyEditableProjectIds] = useState<string[] | undefined>(undefined);

  const refreshEditableProjectIds = useCallback(() => {
    if (!userId) return;
    void getMyEditableProjectIds()
      .then((ids) => setMyEditableProjectIds(ids))
      .catch(() => {
        // 일시적 RPC 실패 시 직전에 조회된 편집 권한을 그대로 유지(권한 강등 방지). 다음 포커스/새로고침에 재시도.
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setMyEditableProjectIds(undefined);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      getMyEditableProjectIds()
        .then((ids) => {
          if (!cancelled) setMyEditableProjectIds(ids);
        })
        .catch(() => {
          // 탭 복귀·창 포커스 시 재조회가 일시적으로 실패해도(특히 인증 토큰 갱신과 겹칠 때)
          // 직전 편집 권한을 유지한다. undefined/[]로 덮어쓰면 멤버·에디터의
          // canEditCurrentProject가 false로 뒤집혀 Insert/Enter 새 작업 추가가 새로고침 전까지 막히던 버그가 있었음.
        });
    };
    refresh();
    // 다른 세션·다른 사용자에 의해 권한이 변경됐을 가능성 — 탭 복귀·창 포커스 시 재조회
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  return { myEditableProjectIds, refreshEditableProjectIds };
}
