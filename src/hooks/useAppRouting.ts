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
  | 'weekreport'
  | 'todo';

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
  'todo',
]);

const MAIN_NAV_VIEW_ORDER: ViewType[] = [
  'dashboard',
  'projects',
  'allocation',
  'todo',
  'outlook',
  'weekreport',
  'table',
  'tablegantt',
  'gantt',
  'kanban',
  'mindmap',
];

function pickFirstVisibleView(hidden: Set<string>): ViewType {
  // 최초 진입(=URL 세그먼트 없음) 기본 화면: 표+간트(작업 화면). hidden이 아니면 우선 사용.
  if (!hidden.has('tablegantt')) return 'tablegantt';
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
    // '표+간트'(tablegantt) 모드는 기본 노출 — 헤더의 표/표+간트/간트 로테이션 토글 동작에 포함됨.
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
    // 협조요청은 별도 페이지에서 대시보드 섹션으로 이전 — 옛 URL은 대시보드로.
    if (segmentRaw === 'cooperation' || segmentRaw === 'docreview') {
      return hiddenViews.has('dashboard') ? pickFirstVisibleView(hiddenViews) : 'dashboard';
    }
    const segment = segmentRaw && VALID_VIEWS.has(segmentRaw) ? segmentRaw : '';

    if (lockMobileToDashboard) {
      if (
        segment &&
        !hiddenViews.has(segment) &&
        (segment === 'dashboard' || segment === 'projects' || segment === 'allocation' || segment === 'todo')
      ) {
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
    // 협조요청 옛 URL(/cooperation, /docreview) → view useMemo에서 'dashboard'로 매핑되어 본 useEffect가 URL을 정리.
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
