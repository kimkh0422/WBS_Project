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
  | 'todo'
  | 'worklog';

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
  'worklog',
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
  'worklog',
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
  /** 운영자(실제 is_admin/관리자 모드) 여부 — 작업 로그(worklog) 전용 뷰 노출 게이트 */
  realIsAdmin?: boolean;
  userEmail?: string;
  isProjectStatusOnly: boolean;
}

export function useAppRouting({ effectiveIsAdmin, realIsAdmin = false, userEmail, isProjectStatusOnly }: UseAppRoutingProps) {
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
    // 기본 작업 화면은 '표+간트'. 헤더 토글은 '표 ↔ 표+간트'만 순환하고 '간트 단독' 모드는 숨긴다.
    set.add('kanban');
    set.add('outlook');
    set.add('gantt');
    if (!effectiveIsAdmin) {
      set.add('mindmap');
    }
    // 작업 로그: 운영자(realIsAdmin)에게만. 그 외에는 URL 직접 진입도 차단(첫 화면으로 리다이렉트).
    if (!realIsAdmin) {
      set.add('worklog');
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
  }, [effectiveIsAdmin, realIsAdmin, userEmail, isProjectStatusOnly]);

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

  // 최초 진입(앱 로드/새로고침)은 무조건 '표+간트'. 직전 세션에서 '표 단독'으로 토글해 URL이 /table로 남아
  // 있었더라도, 다시 들어오면 표+간트로 승격한다. 단, 진입 후 헤더 토글로 표 단독 보기는 그대로 허용
  // (승격은 최초 진입 1회만). dashboardMountedOnceRef와 같은 방식으로 진입 시점의 경로를 기억한다.
  const initialSegmentRef = useRef(typeof window !== 'undefined' ? window.location.pathname.replace(/^\//, '').split('/')[0] || '' : '');
  const initialTablePromotedRef = useRef(false);
  useEffect(() => {
    if (initialTablePromotedRef.current) return;
    if (initialSegmentRef.current !== 'table') {
      // 최초 진입이 표 단독이 아니면 승격 로직을 비활성화(이후 세션 토글은 손대지 않음).
      initialTablePromotedRef.current = true;
      return;
    }
    // 표+간트가 가용해지는 즉시(역할 플래그 비동기 로딩 대비) 1회 승격.
    if (!hiddenViews.has('tablegantt')) {
      initialTablePromotedRef.current = true;
      navigate('/tablegantt', { replace: true });
    }
  }, [hiddenViews, navigate]);

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
