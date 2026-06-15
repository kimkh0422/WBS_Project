import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Location, NavigateFunction } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useFocusTrap } from './useFocusTrap';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatProjectDisplayName } from '../lib/projectKind';
import { labelForViewPath, viewSegmentFromPathname, type UnsavedViewLeaveMode } from '../lib/viewPathLabels';
import type { Project } from '../types';

type PushChangesToDb = (scope: 'current' | 'all') => Promise<unknown>;

interface UseUnsavedChangesGuardParams {
  currentProjectId: string;
  projects: Project[];
  hasLocalChangesSinceSync: boolean;
  pushChangesToDb: PushChangesToDb;
  discardUnsavedChangesReloadFromServer: () => Promise<unknown>;
  setCurrentProjectId: (id: string) => void;
  location: Pick<Location, 'pathname' | 'search'>;
  navigate: NavigateFunction;
}

/**
 * 미저장 변경 가드 — 수동 저장(Ctrl+S/버튼), 프로젝트 전환 확인 모달, 새로고침/닫기 경고,
 * 뷰(URL 첫 세그먼트) 전환·뒤로 가기 시 저장 여부 확인.
 *
 * BrowserRouter 환경에서는 `useBlocker`를 쓸 수 없어, URL의 뷰 세그먼트가 바뀌는 시점에
 * `useLayoutEffect`로 한 번 되돌린 뒤 모달을 띄우고(깜빡임 최소화), 사용자가 선택하면 목적지로 다시 이동한다.
 */
export function useUnsavedChangesGuard({
  currentProjectId,
  projects,
  hasLocalChangesSinceSync,
  pushChangesToDb,
  discardUnsavedChangesReloadFromServer,
  setCurrentProjectId,
  location,
  navigate,
}: UseUnsavedChangesGuardParams) {
  const { push: pushToast } = useToast();

  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;

  const pushChangesToDbRef = useRef(pushChangesToDb);
  pushChangesToDbRef.current = pushChangesToDb;

  const hasLocalChangesRef = useRef(hasLocalChangesSinceSync);
  hasLocalChangesRef.current = hasLocalChangesSinceSync;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [isDbPushInProgress, setIsDbPushInProgress] = useState(false);

  /** replace:true 라우터 보정·가드 통과 1회용 navigate 직전에 true */
  const allowViewNavigationOnceRef = useRef(false);

  const bypassViewLeaveGuardOnce = useCallback(() => {
    allowViewNavigationOnceRef.current = true;
  }, []);

  /** 표 셀 인라인 편집 값이 React 상태에 커밋된 뒤 DB 동기화를 돌리기 위한 짧은 대기 (Ctrl+S와 동일). */
  const flushInlineCellEditsBeforeSave = useCallback(async () => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
      ae.blur();
    }
    await new Promise<void>((r) => {
      window.setTimeout(r, 60);
    });
  }, []);

  /** 단일 프로젝트 선택 시에는 `current`만 서버에 올려 비교·전송량을 줄인다. '전체' 보기이면 `all`. */
  const resolveManualPushScope = useCallback((): 'current' | 'all' => {
    const pid = currentProjectIdRef.current;
    return pid && pid !== 'all' ? 'current' : 'all';
  }, []);

  const saveNow = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!hasLocalChangesRef.current) {
      pushToast('변경사항이 없습니다.', { variant: 'info', durationMs: 1500, id: 'manual-save' });
      return;
    }
    setIsDbPushInProgress(true);
    try {
      await flushInlineCellEditsBeforeSave();
      const scope = resolveManualPushScope();
      await pushChangesToDbRef.current(scope);
      if (scope === 'current' && hasLocalChangesRef.current) {
        pushToast(
          '현재 프로젝트는 서버에 반영되었습니다. 다른 프로젝트에 올리지 않은 변경이나 삭제 대기가 남아 있을 수 있어 저장 표시가 유지됩니다. 필요하면 한 번 더 저장해 주세요.',
          { variant: 'info', durationMs: 5500, id: 'manual-save' },
        );
      } else {
        pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
      if (/편집 권한이 없습니다/.test(msg)) {
        pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
      } else {
        pushToast(msg, { variant: 'error', durationMs: 6000, id: `db-push:${msg}` });
      }
    } finally {
      setIsDbPushInProgress(false);
    }
  }, [pushToast, flushInlineCellEditsBeforeSave, resolveManualPushScope]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [saveNow]);

  /** 서버 미반영 편집이 있을 때 다른 프로젝트로 바꾸기 전 확인 */
  const pendingProjectSwitchRunRef = useRef<(() => void) | null>(null);
  const [projectSwitchPrompt, setProjectSwitchPrompt] = useState<{ targetProjectId: string } | null>(null);
  const projectSwitchPromptRef = useRef(projectSwitchPrompt);
  projectSwitchPromptRef.current = projectSwitchPrompt;

  // ─── 뷰 이탈(뒤로 가기·다른 메뉴) — requestProjectSwitch보다 먼저 선언(TDZ 방지)
  const pendingViewNavigationRef = useRef<(() => void) | null>(null);
  const pathLeaveTargetRef = useRef<{ toFullPath: string; toLabel: string } | null>(null);
  const [viewLeavePrompt, setViewLeavePrompt] = useState<{
    mode: UnsavedViewLeaveMode;
    targetLabel?: string;
  } | null>(null);
  const viewLeavePromptRef = useRef(viewLeavePrompt);
  viewLeavePromptRef.current = viewLeavePrompt;

  const [projectSwitchAction, setProjectSwitchAction] = useState<'save' | 'discard' | null>(null);
  const projectSwitchBusy = projectSwitchAction !== null;
  const projectSwitchDialogRef = useRef<HTMLDivElement>(null);

  const requestProjectSwitch = useCallback((targetProjectId: string, run: () => void) => {
    if (targetProjectId === currentProjectIdRef.current) {
      run();
      return;
    }
    if (viewLeavePromptRef.current) {
      setViewLeavePrompt(null);
      pendingViewNavigationRef.current = null;
      pathLeaveTargetRef.current = null;
    }
    if (!isSupabaseConfigured || !hasLocalChangesRef.current) {
      run();
      return;
    }
    pendingProjectSwitchRunRef.current = run;
    setProjectSwitchPrompt({ targetProjectId });
  }, []);

  useFocusTrap(projectSwitchDialogRef, !!projectSwitchPrompt);

  useEffect(() => {
    if (!projectSwitchPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (projectSwitchBusy) return;
        e.preventDefault();
        pendingProjectSwitchRunRef.current = null;
        setProjectSwitchPrompt(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [projectSwitchPrompt, projectSwitchBusy]);

  const handleProjectSwitchSaveAndProceed = useCallback(async () => {
    if (projectSwitchBusy || !projectSwitchPrompt) return;
    setProjectSwitchAction('save');
    try {
      await flushInlineCellEditsBeforeSave();
      await pushChangesToDbRef.current(resolveManualPushScope());
      const run = pendingProjectSwitchRunRef.current;
      pendingProjectSwitchRunRef.current = null;
      setProjectSwitchPrompt(null);
      run?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
      if (/편집 권한이 없습니다/.test(msg)) {
        const run = pendingProjectSwitchRunRef.current;
        pendingProjectSwitchRunRef.current = null;
        setProjectSwitchPrompt(null);
        run?.();
      } else {
        pushToast(msg, { variant: 'error', durationMs: 6000 });
      }
    } finally {
      setProjectSwitchAction(null);
    }
  }, [projectSwitchBusy, projectSwitchPrompt, flushInlineCellEditsBeforeSave, pushToast, resolveManualPushScope]);

  const handleProjectSwitchDiscardProceed = useCallback(() => {
    if (!projectSwitchPromptRef.current) return;
    // 모달은 즉시 닫고, 서버 기준으로 되돌린 뒤 전환(저장 안 함 — 대기 문구 없음)
    setProjectSwitchPrompt(null);
    setProjectSwitchAction(null);
    void (async () => {
      try {
        await discardUnsavedChangesReloadFromServer();
        const run = pendingProjectSwitchRunRef.current;
        pendingProjectSwitchRunRef.current = null;
        run?.();
      } catch {
        /* handleDbError에서 토스트 처리 */
      }
    })();
  }, [discardUnsavedChangesReloadFromServer]);

  const handleProjectSwitchCancel = useCallback(() => {
    if (projectSwitchBusy) return;
    pendingProjectSwitchRunRef.current = null;
    setProjectSwitchPrompt(null);
  }, [projectSwitchBusy]);

  const setCurrentProjectIdGuarded = useCallback(
    (id: string) => {
      requestProjectSwitch(id, () => setCurrentProjectId(id));
    },
    [requestProjectSwitch, setCurrentProjectId],
  );

  const [viewLeaveAction, setViewLeaveAction] = useState<'save' | 'discard' | null>(null);
  const viewLeaveBusy = viewLeaveAction !== null;
  const viewLeaveDialogRef = useRef<HTMLDivElement>(null);

  const prevViewSegmentRef = useRef<string | null>(null);
  const prevViewFullPathRef = useRef<string>('');

  const requestNavigation = useCallback((run: () => void) => {
    if (projectSwitchPromptRef.current) {
      run();
      return;
    }
    if (viewLeavePromptRef.current) {
      if (viewLeavePromptRef.current.mode === 'programmatic') {
        pendingViewNavigationRef.current = run;
      }
      return;
    }
    if (!isSupabaseConfigured || !hasLocalChangesRef.current) {
      run();
      return;
    }
    pendingViewNavigationRef.current = run;
    setViewLeavePrompt({ mode: 'programmatic' });
  }, []);

  useFocusTrap(viewLeaveDialogRef, !!viewLeavePrompt);

  useLayoutEffect(() => {
    const fullPath = `${location.pathname}${location.search || ''}`;
    const seg = viewSegmentFromPathname(location.pathname);
    const prevSeg = prevViewSegmentRef.current;

    if (prevSeg === null) {
      prevViewSegmentRef.current = seg;
      prevViewFullPathRef.current = fullPath;
      return;
    }

    if (seg === prevSeg) {
      prevViewFullPathRef.current = fullPath;
      return;
    }

    if (allowViewNavigationOnceRef.current) {
      allowViewNavigationOnceRef.current = false;
      prevViewSegmentRef.current = seg;
      prevViewFullPathRef.current = fullPath;
      return;
    }

    if (!isSupabaseConfigured || !hasLocalChangesSinceSync || viewLeavePromptRef.current) {
      prevViewSegmentRef.current = seg;
      prevViewFullPathRef.current = fullPath;
      return;
    }

    const restorePath = prevViewFullPathRef.current || fullPath;
    pathLeaveTargetRef.current = {
      toFullPath: fullPath.startsWith('/') ? fullPath : `/${fullPath}`,
      toLabel: labelForViewPath(fullPath),
    };
    allowViewNavigationOnceRef.current = true;
    navigateRef.current(restorePath, { replace: true });
    setViewLeavePrompt({ mode: 'path', targetLabel: pathLeaveTargetRef.current?.toLabel });
  }, [location.pathname, location.search, hasLocalChangesSinceSync]);

  useEffect(() => {
    if (!viewLeavePrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewLeaveBusy) return;
        e.preventDefault();
        pendingViewNavigationRef.current = null;
        pathLeaveTargetRef.current = null;
        setViewLeavePrompt(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewLeavePrompt, viewLeaveBusy]);

  const proceedPendingViewNavigation = useCallback(() => {
    const run = pendingViewNavigationRef.current;
    pendingViewNavigationRef.current = null;
    const pathLeave = pathLeaveTargetRef.current;
    pathLeaveTargetRef.current = null;
    allowViewNavigationOnceRef.current = true;
    if (pathLeave) {
      navigateRef.current(pathLeave.toFullPath, { replace: false });
    } else {
      run?.();
    }
  }, []);

  const handleViewLeaveSaveAndProceed = useCallback(async () => {
    if (viewLeaveBusy || !viewLeavePrompt) return;
    setViewLeaveAction('save');
    try {
      await flushInlineCellEditsBeforeSave();
      await pushChangesToDbRef.current(resolveManualPushScope());
      setViewLeavePrompt(null);
      proceedPendingViewNavigation();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
      if (/편집 권한이 없습니다/.test(msg)) {
        setViewLeavePrompt(null);
        proceedPendingViewNavigation();
      } else {
        pushToast(msg, { variant: 'error', durationMs: 6000 });
      }
    } finally {
      setViewLeaveAction(null);
    }
  }, [viewLeaveBusy, viewLeavePrompt, flushInlineCellEditsBeforeSave, proceedPendingViewNavigation, pushToast, resolveManualPushScope]);

  const handleViewLeaveDiscardProceed = useCallback(() => {
    if (!viewLeavePromptRef.current) return;
    // 확인 창은 즉시 닫고, 미반영 변경은 서버 데이터로 되돌린 뒤 이동
    setViewLeavePrompt(null);
    setViewLeaveAction(null);
    void (async () => {
      try {
        await discardUnsavedChangesReloadFromServer();
        proceedPendingViewNavigation();
      } catch {
        /* handleDbError */
      }
    })();
  }, [discardUnsavedChangesReloadFromServer, proceedPendingViewNavigation]);

  const handleViewLeaveCancel = useCallback(() => {
    if (viewLeaveBusy) return;
    pendingViewNavigationRef.current = null;
    pathLeaveTargetRef.current = null;
    setViewLeavePrompt(null);
  }, [viewLeaveBusy]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasLocalChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const requestRefresh = useCallback(async () => {
    if (hasLocalChangesSinceSync && isSupabaseConfigured) {
      try {
        await pushChangesToDbRef.current(resolveManualPushScope());
      } catch {
        /* reload anyway */
      }
    }
    window.location.reload();
  }, [hasLocalChangesSinceSync, resolveManualPushScope]);

  const projectSwitchTargetLabel = useMemo(() => {
    if (!projectSwitchPrompt) return '';
    const p = projects.find((x) => x.id === projectSwitchPrompt.targetProjectId);
    return p ? formatProjectDisplayName(p.name, p.projectKind) : projectSwitchPrompt.targetProjectId;
  }, [projectSwitchPrompt, projects]);

  return {
    saveNow,
    isDbPushInProgress,
    requestRefresh,
    requestProjectSwitch,
    setCurrentProjectIdGuarded,
    projectSwitchPrompt,
    projectSwitchAction,
    projectSwitchBusy,
    projectSwitchDialogRef,
    projectSwitchTargetLabel,
    handleProjectSwitchSaveAndProceed,
    handleProjectSwitchDiscardProceed,
    handleProjectSwitchCancel,
    bypassViewLeaveGuardOnce,
    requestNavigation,
    viewLeavePrompt,
    viewLeaveAction,
    viewLeaveBusy,
    viewLeaveDialogRef,
    handleViewLeaveSaveAndProceed,
    handleViewLeaveDiscardProceed,
    handleViewLeaveCancel,
  };
}
