import { useEffect, useMemo, useState } from 'react';
import { getMyProjectMemberProjectIds } from '../lib/db';

interface UseExternalPartnerAllowlistParams {
  userId: string | undefined;
  isExternalPartner: boolean;
  effectiveIsAdminGlobal: boolean;
}

/**
 * 외주(external partner) 계정: 공유(project_members) 프로젝트 ID로 클라이언트 목록·상태를 한 번 더 제한.
 * RLS/캐시와 무관하게 클라이언트에서 allowlist를 강제 — WBSProvider.clientProjectAllowlist로 전파.
 * AppWithProviders god 컴포넌트에서 분리 — 동작 동일.
 */
export function useExternalPartnerAllowlist({ userId, isExternalPartner, effectiveIsAdminGlobal }: UseExternalPartnerAllowlistParams) {
  const [externalPartnerBrowseIds, setExternalPartnerBrowseIds] = useState<string[] | undefined>(undefined);
  const [externalPartnerBrowseLoaded, setExternalPartnerBrowseLoaded] = useState(false);

  useEffect(() => {
    if (!userId) {
      setExternalPartnerBrowseIds(undefined);
      setExternalPartnerBrowseLoaded(false);
      return;
    }
    if (!isExternalPartner || effectiveIsAdminGlobal) {
      setExternalPartnerBrowseIds(undefined);
      setExternalPartnerBrowseLoaded(false);
      return;
    }
    let cancelled = false;
    setExternalPartnerBrowseLoaded(false);
    getMyProjectMemberProjectIds()
      .then((ids) => {
        if (!cancelled) {
          setExternalPartnerBrowseIds(ids);
          setExternalPartnerBrowseLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExternalPartnerBrowseIds([]);
          setExternalPartnerBrowseLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, isExternalPartner, effectiveIsAdminGlobal]);

  const externalBrowseKey = externalPartnerBrowseIds === undefined ? '' : [...externalPartnerBrowseIds].sort().join(',');

  const clientProjectAllowlist = useMemo(() => {
    if (!isExternalPartner || effectiveIsAdminGlobal) return undefined;
    if (!externalPartnerBrowseLoaded) return undefined;
    return externalPartnerBrowseIds ?? [];
  }, [isExternalPartner, effectiveIsAdminGlobal, externalPartnerBrowseLoaded, externalBrowseKey]);

  return clientProjectAllowlist;
}
