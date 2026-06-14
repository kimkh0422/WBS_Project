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
  /** replace:true 로 URL을 보정하기 직전 호출 — 미저장 뷰 이탈 가드가 되돌리지 않도록 함 */
  bypassViewLeaveGuardOnce?: () => void;
}

export function useAppRouting({
  effectiveIsAdmin,
  realIsAdmin = false,
  userEmail,
  isProjectStatusOnly,
  bypassViewLeaveGuardOnce,
}: UseAppRoutingProps) {
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
    // 기본 작업 화면은 '표+간트'. '표만'(간트 숨김)·'간트 단독'은 숨긴다 — 항상 표+간트(밸런스)로 작업한다.
    set.add('kanban');
    set.add('outlook');
    set.add('gantt');
    set.add('table');
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

  // 최초 진입(앱 로드·새로고침)은 사용자의 마지막 보기와 무관하게 무조건 '표+간트'로 1회 강제한다.
  // ref 가드로 최초 1회만 실행 — 이후에는 사용자가 헤더·내비로 대시보드·칸반 등 어떤 보기로든 자유롭게 전환할 수 있다.
  // 예외: 모바일 대시보드 고정·표+간트 미가용(상태 전용 사용자)일 때는 강제하지 않는다.
  const initialForcedRef = useRef(false);
  useEffect(() => {
    if (initialForcedRef.current) return;
    initialForcedRef.current = true;
    if (lockMobileToDashboard || hiddenViews.has('tablegantt')) return;
    const seg = window.location.pathname.replace(/^\//, '').split('/')[0] || '';
    if (seg !== 'tablegantt') {
      bypassViewLeaveGuardOnce?.();
      navigate('/tablegantt', { replace: true });
    }
  }, [hiddenViews, lockMobileToDashboard, navigate, bypassViewLeaveGuardOnce]);

  useEffect(() => {
    const path = location.pathname.replace(/^\//, '').split('/')[0] || '';
    const legacyTableTarget: ViewType = hiddenViews.has('tablegantt') ? pickFirstVisibleView(hiddenViews) : 'tablegantt';
    if (path === 'list') {
      bypassViewLeaveGuardOnce?.();
      navigate(`/${legacyTableTarget}`, { replace: true });
    }
    if (path === 'tablekanban') {
      const ganttTarget: ViewType = hiddenViews.has('tablegantt') ? pickFirstVisibleView(hiddenViews) : 'tablegantt';
      bypassViewLeaveGuardOnce?.();
      navigate(`/${ganttTarget}`, { replace: true });
    }
    if (path === 'guide') {
      bypassViewLeaveGuardOnce?.();
      navigate(`/${legacyTableTarget}`, { replace: true });
    }
    // 협조요청 옛 URL(/cooperation, /docreview) → view useMemo에서 'dashboard'로 매핑되어 본 useEffect가 URL을 정리.
  }, [location.pathname, navigate, hiddenViews, bypassViewLeaveGuardOnce]);

  useEffect(() => {
    const segment = location.pathname.replace(/^\//, '').split('/')[0] || '';
    if (segment !== view) {
      bypassViewLeaveGuardOnce?.();
      navigate(`/${view}`, { replace: true });
    }
  }, [location.pathname, view, navigate, hiddenViews, bypassViewLeaveGuardOnce]);

  return {
    view,
    setView,
    hiddenViews,
    lockMobileToDashboard,
    dashboardMountedOnceRef,
  };
}
