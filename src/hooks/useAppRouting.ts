import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMatchMedia } from './useMatchMedia';
import { isInternalCompanyEmail } from '../lib/emailDomain';

export type ViewType =
  | 'table'
  | 'tablegantt'
  | 'gantt'
  | 'kanban'
  | 'mindmap'
  | 'dashboard'
  | 'projects'
  | 'allocation'
  | 'outlook'
  | 'weekreport';

const VALID_VIEWS = new Set<string>([
  'table',
  'tablegantt',
  'gantt',
  'kanban',
  'mindmap',
  'dashboard',
  'projects',
  'allocation',
  'outlook',
  'weekreport',
]);

const MAIN_NAV_VIEW_ORDER: ViewType[] = [
  'dashboard',
  'projects',
  'allocation',
  'outlook',
  'weekreport',
  'table',
  'tablegantt',
  'gantt',
  'kanban',
  'mindmap',
];

function pickFirstVisibleView(hidden: Set<string>): ViewType {
  for (const v of MAIN_NAV_VIEW_ORDER) {
    if (!hidden.has(v)) return v;
  }
  return 'dashboard';
}

interface UseAppRoutingProps {
  effectiveIsAdmin: boolean;
  userEmail?: string;
  isProjectStatusOnly: boolean;
}

export function useAppRouting({ effectiveIsAdmin, userEmail, isProjectStatusOnly }: UseAppRoutingProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const setView = useCallback(
    (v: ViewType) => {
      navigate(`/${v}`, { replace: false });
    },
    [navigate],
  );

  const hiddenViews = useMemo(() => {
    const raw = import.meta.env.VITE_HIDDEN_VIEWS as string | undefined;
    const value = typeof raw === 'string' ? raw.trim() : '';
    const set = new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    set.add('tablegantt');
    set.add('kanban');
    set.add('outlook');
    if (!effectiveIsAdmin) {
      set.add('mindmap');
    }
    if (!isInternalCompanyEmail(userEmail ?? '')) {
      set.add('weekreport');
    }
    if (isProjectStatusOnly) {
      for (const v of ['table', 'tablegantt', 'gantt', 'kanban', 'projects', 'mindmap'] as const) {
        set.add(v);
      }
    }
    return set;
  }, [effectiveIsAdmin, userEmail, isProjectStatusOnly]);

  const isMobileLayout = useMatchMedia('(max-width: 767px)');
  const lockMobileToDashboard = isMobileLayout && !hiddenViews.has('dashboard');

  const view: ViewType = useMemo(() => {
    const segmentRaw = location.pathname.replace(/^\//, '').split('/')[0] || '';
    const segment = segmentRaw && VALID_VIEWS.has(segmentRaw) ? segmentRaw : '';

    if (lockMobileToDashboard) {
      if (segment && !hiddenViews.has(segment) && (segment === 'dashboard' || segment === 'projects' || segment === 'allocation')) {
        return segment as ViewType;
      }
      for (const v of ['dashboard', 'projects'] as const) {
        if (!hiddenViews.has(v)) return v;
      }
      return pickFirstVisibleView(hiddenViews);
    }

    if (segment && !hiddenViews.has(segment)) return segment as ViewType;
    return pickFirstVisibleView(hiddenViews);
  }, [location.pathname, hiddenViews, lockMobileToDashboard]);

  const dashboardMountedOnceRef = useRef(
    typeof window !== 'undefined' && (window.location.pathname.replace(/^\//, '').split('/')[0] || '') === 'dashboard',
  );
  if (view === 'dashboard') dashboardMountedOnceRef.current = true;

  useEffect(() => {
    const path = location.pathname.replace(/^\//, '').split('/')[0] || '';
    const legacyTableTarget: ViewType = hiddenViews.has('table') ? pickFirstVisibleView(hiddenViews) : 'table';
    if (path === 'list') navigate(`/${legacyTableTarget}`, { replace: true });
    if (path === 'tablekanban') {
      const ganttTarget: ViewType = hiddenViews.has('tablegantt') ? pickFirstVisibleView(hiddenViews) : 'tablegantt';
      navigate(`/${ganttTarget}`, { replace: true });
    }
    if (path === 'guide') navigate(`/${legacyTableTarget}`, { replace: true });
  }, [location.pathname, navigate, hiddenViews]);

  useEffect(() => {
    const segment = location.pathname.replace(/^\//, '').split('/')[0] || '';
    if (segment !== view) {
      navigate(`/${view}`, { replace: true });
    }
  }, [location.pathname, view, navigate]);

  return {
    view,
    setView,
    hiddenViews,
    lockMobileToDashboard,
    dashboardMountedOnceRef,
  };
}
