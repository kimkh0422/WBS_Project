import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useFocusTrap } from './useFocusTrap';
import { isSupabaseConfigured } from '../lib/supabase';
import { formatProjectDisplayName } from '../lib/projectKind';
import type { Project } from '../types';

type PushChangesToDb = (scope: 'current' | 'all') => Promise<unknown>;

interface UseUnsavedChangesGuardParams {
  currentProjectId: string;
  projects: Project[];
  hasLocalChangesSinceSync: boolean;
  pushChangesToDb: PushChangesToDb;
  discardUnsavedChangesReloadFromServer: () => Promise<unknown>;
  setCurrentProjectId: (id: string) => void;
}

/**
 * 미저장 변경 가드 — 수동 저장(Ctrl+S/버튼), 프로젝트 전환 확인 모달, 새로고침/닫기 경고를 한곳에서 관리.
 *
 * 저장 모델: 편집마다 자동 DB push 하던 방식을 "수동 저장"으로 전환해 편집 중 렉을 제거한다.
 *  - 로컬 변경은 WBSContext가 즉시 localStorage에 보존하므로 새로고침해도 데이터는 유지된다.
 *  - 서버(DB) 반영은 Ctrl+S 또는 우측 하단 "저장" 버튼으로만 수행한다.
 *  - 미저장 상태로 헤더·필터 등에서 다른 프로젝트를 선택할 때 확인 모달로 저장을 유도한다(requestProjectSwitch).
 *  - 미저장 상태로 창을 닫거나 새로고침하면 브라우저 경고로 이탈 전 저장을 유도한다.
 *
 * 앱 내 화면(URL) 이동 시 미저장 확인은 Data Router의 useBlocker가 필요했으나, RouterProvider 전환이
 * React 19에서 초기 렌더 크래시(removeChild)를 일으켜 BrowserRouter로 되돌렸다. 따라서 URL 이동 가드는
 * 제거한다. 프로젝트 전환 확인(requestProjectSwitch)과 새로고침·닫기 경고(beforeunload)는 그대로 동작한다.
 *
 * WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useUnsavedChangesGuard({
  currentProjectId,
  projects,
  hasLocalChangesSinceSync,
  pushChangesToDb,
  discardUnsavedChangesReloadFromServer,
  setCurrentProjectId,
}: UseUnsavedChangesGuardParams) {
  const { push: pushToast } = useToast();

  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;

  const pushChangesToDbRef = useRef(pushChangesToDb);
  pushChangesToDbRef.current = pushChangesToDb;

  const hasLocalChangesRef = useRef(hasLocalChangesSinceSync);
  hasLocalChangesRef.current = hasLocalChangesSinceSync;

  const [isDbPushInProgress, setIsDbPushInProgress] = useState(false);

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

  const saveNow = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!hasLocalChangesRef.current) {
      pushToast('변경사항이 없습니다.', { variant: 'info', durationMs: 1500, id: 'manual-save' });
      return;
    }
    setIsDbPushInProgress(true);
    try {
      await flushInlineCellEditsBeforeSave();
      await pushChangesToDbRef.current('all');
      pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '서버에 반영하지 못했습니다.';
      // 본인 프로젝트는 정상 저장되고 타인 프로젝트만 RLS로 거부될 수 있으므로 권한 메시지는 성공으로 간주.
      if (/편집 권한이 없습니다/.test(msg)) {
        pushToast('저장되었습니다.', { variant: 'success', durationMs: 1800, id: 'manual-save' });
      } else {
        pushToast(msg, { variant: 'error', durationMs: 6000, id: `db-push:${msg}` });
      }
    } finally {
      setIsDbPushInProgress(false);
    }
  }, [pushToast, flushInlineCellEditsBeforeSave]);

  // Ctrl/Cmd+S: 수동 저장(브라우저 기본 저장 대화상자 차단). 편집 중이면 먼저 blur로 입력을 확정한 뒤 저장.
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
  /** 프로젝트 전환 확인 모달: 저장 또는「저장 안 함」처리 중 이중 클릭·닫기 방지 */
  const [projectSwitchAction, setProjectSwitchAction] = useState<'save' | 'discard' | null>(null);
  const projectSwitchBusy = projectSwitchAction !== null;
  const projectSwitchDialogRef = useRef<HTMLDivElement>(null);

  const requestProjectSwitch = useCallback((targetProjectId: string, run: () => void) => {
    if (targetProjectId === currentProjectIdRef.current) {
      run();
      return;
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
      await pushChangesToDbRef.current('all');
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
  }, [projectSwitchBusy, projectSwitchPrompt, flushInlineCellEditsBeforeSave, pushToast]);

  const handleProjectSwitchDiscardProceed = useCallback(async () => {
    if (projectSwitchBusy || !projectSwitchPrompt) return;
    setProjectSwitchAction('discard');
    try {
      await discardUnsavedChangesReloadFromServer();
      const run = pendingProjectSwitchRunRef.current;
      pendingProjectSwitchRunRef.current = null;
      setProjectSwitchPrompt(null);
      run?.();
    } catch {
      /* handleDbError에서 토스트 처리 */
    } finally {
      setProjectSwitchAction(null);
    }
  }, [projectSwitchBusy, projectSwitchPrompt, discardUnsavedChangesReloadFromServer]);

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

  // 미저장 상태에서 창 닫기/새로고침/이탈 시 브라우저 경고 → 저장하지 않은 변경 손실 방지.
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
        await pushChangesToDbRef.current('all');
      } catch {
        /* reload anyway */
      }
    }
    window.location.reload();
  }, [hasLocalChangesSinceSync]);

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
  };
}
