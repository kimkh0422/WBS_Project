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

  // Ctrl+Z: Undo (Ctrl+Shift+Z는 사용하지 않음)
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener('keydown', handleUndo);
    return () => window.removeEventListener('keydown', handleUndo);
  }, [undo]);

  // Ctrl+Y / Cmd+Y / Ctrl+Shift+Z / Cmd+Shift+Z: Redo
  useEffect(() => {
    const handleRedo = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const isCtrlY = k === 'y' && !e.shiftKey;
      const isCtrlShiftZ = k === 'z' && e.shiftKey;
      if (!isCtrlY && !isCtrlShiftZ) return;
      e.preventDefault();
      redo();
    };
    window.addEventListener('keydown', handleRedo);
    return () => window.removeEventListener('keydown', handleRedo);
  }, [redo]);

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

  // (제거됨) Alt+1~7 뷰 전환 단축키 — 사용자 요청으로 비활성화.
  // 뷰 전환은 헤더 탭 또는 네비게이션 메뉴를 통해 수행.

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

  // Ctrl+S: 즉시 서버 반영 기능 제거 (사용자 요청). 자동 저장만 사용.
  // 단, 브라우저의 '페이지 저장' 다이얼로그가 뜨지 않도록 preventDefault만 수행.
  useEffect(() => {
    const handleSaveHotkey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 's') return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handleSaveHotkey, true);
    return () => window.removeEventListener('keydown', handleSaveHotkey, true);
  }, []);
}
