import React, { useEffect, useCallback, useRef, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { isComposingKeyEvent } from '../lib/ime';

interface KeyboardShortcutsDeps {
  undo: () => void;
  redo: () => void;
  expandToLevel: (level: number) => void;
  setTreeExpandLevel: (level: number) => void;
  navigateWithTip: (view: string) => void;
  hiddenViews: Set<string>;
  setIsShortcutsVisible: Dispatch<SetStateAction<boolean>>;
  setIsAdminPasswordModalOpen: (open: boolean) => void;
  pushChangesToDbRef: MutableRefObject<(scope: 'current' | 'all') => Promise<unknown>>;
  setIsDbPushInProgress: (v: boolean) => void;
  pushToast: (message: string, opts?: Record<string, unknown>) => void;
}

export function useAppKeyboardShortcuts(deps: KeyboardShortcutsDeps) {
  const {
    undo,
    redo,
    expandToLevel,
    setTreeExpandLevel,
    navigateWithTip,
    hiddenViews,
    setIsShortcutsVisible,
    setIsAdminPasswordModalOpen,
    pushChangesToDbRef,
    setIsDbPushInProgress,
    pushToast,
  } = deps;

  // Ctrl+Z / Ctrl+Shift+Z: Undo/Redo
  useEffect(() => {
    const handleUndoRedo = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleUndoRedo);
    return () => window.removeEventListener('keydown', handleUndoRedo);
  }, [undo, redo]);

  // Ctrl+Alt+1..9: Expand tree to level
  useEffect(() => {
    const handleExpandLevelHotkey = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (!(e.altKey && (e.ctrlKey || e.metaKey))) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const level = parseInt(e.key, 10);
      e.preventDefault();
      setTreeExpandLevel(level);
      expandToLevel(level);
    };
    window.addEventListener('keydown', handleExpandLevelHotkey);
    return () => window.removeEventListener('keydown', handleExpandLevelHotkey);
  }, [expandToLevel, setTreeExpandLevel]);

  // Ctrl+Shift+1~7: View switch
  useEffect(() => {
    const VIEW_SHORTCUTS: Record<string, string> = {
      Digit1: 'dashboard',
      Digit2: 'allocation',
      Digit3: 'list',
      Digit4: 'table',
      Digit5: 'gantt',
      Digit6: 'kanban',
      Digit7: 'mindmap',
    };
    const handleViewShortcut = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      const nextView = VIEW_SHORTCUTS[e.code];
      if (!nextView) return;
      if (hiddenViews.has(nextView)) return;
      e.preventDefault();
      navigateWithTip(nextView);
    };
    window.addEventListener('keydown', handleViewShortcut);
    return () => window.removeEventListener('keydown', handleViewShortcut);
  }, [navigateWithTip, hiddenViews]);

  // ?: Toggle shortcuts sidebar
  useEffect(() => {
    const handleShortcutsToggle = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const el = e.target as HTMLElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const isQuestion = e.key === '?' || (e.key === '/' && e.shiftKey);
      if (!isQuestion) return;
      e.preventDefault();
      setIsShortcutsVisible((prev) => !prev);
    };
    window.addEventListener('keydown', handleShortcutsToggle);
    return () => window.removeEventListener('keydown', handleShortcutsToggle);
  }, [setIsShortcutsVisible]);

  // Shift+F12: Admin mode
  useEffect(() => {
    const handleAdminHotkey = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.shiftKey && e.key === 'F12') {
        e.preventDefault();
        setIsAdminPasswordModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleAdminHotkey);
    return () => window.removeEventListener('keydown', handleAdminHotkey);
  }, [setIsAdminPasswordModalOpen]);

  // Ctrl+S: Save to DB
  useEffect(() => {
    const handleSaveHotkey = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 's') return;
      if (!isSupabaseConfigured) return;

      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const el = document.activeElement as HTMLElement | null;
        const inTable = el && /^INPUT|TEXTAREA|SELECT$/i.test(el.tagName) && el.closest?.('[data-wbs-table]');
        if (inTable) {
          el.blur();
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        }
        setIsDbPushInProgress(true);
        try {
          await pushChangesToDbRef.current('all');
        } finally {
          setIsDbPushInProgress(false);
        }
      };
      void run().catch((err: unknown) => {
        setIsDbPushInProgress(false);
        pushToast(err instanceof Error ? err.message : '서버 반영 실패', { variant: 'error' });
      });
    };
    window.addEventListener('keydown', handleSaveHotkey, true);
    return () => window.removeEventListener('keydown', handleSaveHotkey, true);
  }, [pushChangesToDbRef, setIsDbPushInProgress, pushToast]);
}
