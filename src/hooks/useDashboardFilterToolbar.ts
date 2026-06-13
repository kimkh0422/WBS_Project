import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import type { ViewType } from './useAppRouting';

/**
 * 대시보드 부서·프로젝트 표시 도구줄의 표시 상태 — 기본 숨김, 헤더 필터 버튼으로만 토글.
 * dashboard 외 화면으로 나가면 자동 숨김. WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useDashboardFilterToolbar(view: ViewType) {
  const { tipOnce } = useToast();
  const [dashboardFiltersActive, setDashboardFiltersActive] = useState(false);
  /** 대시보드 부서·프로젝트 표시 도구줄: 기본 숨김, 헤더 필터 버튼으로만 표시 */
  const [showDashboardFilterToolbar, setShowDashboardFilterToolbar] = useState(false);

  useEffect(() => {
    if (view !== 'dashboard') {
      setDashboardFiltersActive(false);
      setShowDashboardFilterToolbar(false);
    }
  }, [view]);

  useEffect(() => {
    const h = (e: Event) => {
      const ev = e as CustomEvent<{ active?: boolean }>;
      if (ev.detail && typeof ev.detail.active === 'boolean') setDashboardFiltersActive(ev.detail.active);
    };
    window.addEventListener('wbs-dashboard-filters-active', h as EventListener);
    return () => window.removeEventListener('wbs-dashboard-filters-active', h as EventListener);
  }, []);

  const onDashboardFilterToolbarClick = useCallback(() => {
    setShowDashboardFilterToolbar((wasOpen) => {
      const next = !wasOpen;
      if (next) {
        tipOnce('menu.filter.dashboard', '상단 도구줄에서 부서·프로젝트 표시 범위를 조정할 수 있어요.');
        setTimeout(() => {
          document.getElementById('dashboard-filter-toolbar-host')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 0);
      }
      return next;
    });
  }, [tipOnce]);

  return { dashboardFiltersActive, showDashboardFilterToolbar, onDashboardFilterToolbarClick };
}
