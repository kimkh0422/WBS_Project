import { useEffect, useState } from 'react';
import { getProfileStatus } from '../lib/db';

/**
 * 로그인 사용자 권한 상태 — 관리자·승인·외주·조직 책임자 여부와 담당 조직 노드.
 * AppWithProviders god 컴포넌트에서 분리 — 동작 동일.
 */
export function useViewerStatus(userId: string | undefined) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [userApproved, setUserApproved] = useState(false);
  const [isExternalPartner, setIsExternalPartner] = useState(false);
  const [isOrgScopedManager, setIsOrgScopedManager] = useState(false);
  const [currentUserManagedOrgNodeId, setCurrentUserManagedOrgNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      setUserApproved(false);
      setIsExternalPartner(false);
      setIsOrgScopedManager(false);
      setCurrentUserManagedOrgNodeId(null);
      return;
    }
    getProfileStatus()
      .then((status) => {
        if (status) {
          setIsAdmin(status.isAdmin);
          setIsExternalPartner(status.isExternalPartner);
          // 외주 계정은 승인(approved)이어도 멤버로 공유된 프로젝트만 열람·편집 (전사 탐색·조직도 UI 제외)
          setUserApproved(status.approved && !status.isExternalPartner);
          setIsOrgScopedManager(status.isOrgScopeManager);
          setCurrentUserManagedOrgNodeId(status.managedOrgNodeId);
        }
      })
      .catch(() => {});
  }, [userId]);

  return { isAdmin, userApproved, isExternalPartner, isOrgScopedManager, currentUserManagedOrgNodeId };
}
