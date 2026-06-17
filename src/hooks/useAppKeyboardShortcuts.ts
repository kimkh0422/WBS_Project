import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { isComposingKeyEvent } from '../lib/ime';

/** WBS 표 안 셀 편집용 텍스트 INPUT인지 (체크박스·버튼 등 제외) */
function isWbsGridCellTextInput(el: HTMLElement): boolean {
  if (!el.closest?.('[data-wbs-table]') || el.closest?.('[data-quick-add]')) return false;
  if (el.hasAttribute?.('data-wbs-armed')) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'file', 'hidden', 'reset'].includes(t);
}

function isGenericTypingTarget(el: HTMLElement): boolean {
  const tag = el?.tagName;
  if (tag === 'TEXTAREA' || el?.isContentEditable) return true;
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
  return !['checkbox', 'radio', 'button', 'submit', 'file', 'hidden', 'reset'].includes(t);
}

interface KeyboardShortcutsDeps {
  undo: () => void;
  redo: () => void;
  expandToLevel: (level: number) => void;
  setTreeExpandLevel: (level: number) => void;
  setIsShortcutsVisible: Dispatch<SetStateAction<boolean>>;
  /** DB 관리자 또는 비밀번호 관리자 모드일 때만 일반 사용자 화면(memberPreview) 토글 가능 */
  canToggleAdminMemberView: boolean;
  memberPreview: boolean;
  setMemberPreview: (v: boolean) => void;
  /** 일반 사용자 화면 → 관리자 화면 복귀 시 비밀번호 확인 모달 열기 */
  onRequestRestoreAdminView?: () => void;
  pushToast: (message: string, opts?: Record<string, unknown>) => void;
}

export function useAppKeyboardShortcuts(deps: KeyboardShortcutsDeps) {
  const {
    undo,
    redo,
    expandToLevel,
    setTreeExpandLevel,
    setIsShortcutsVisible,
    canToggleAdminMemberView,
    memberPreview,
    setMemberPreview,
    onRequestRestoreAdminView,
    pushToast,
  } = deps;

  // Ctrl+Z: Undo (Ctrl+Shift+Z는 사용하지 않음)
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const target = e.target as HTMLElement;
      // WBS 표 셀 편집 INPUT은 useWbsTableKeyboard(capture)가 처리 — 여기서는 중복 방지
      if (isWbsGridCellTextInput(target)) return;
      if (isGenericTypingTarget(target)) return;
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
      const target = e.target as HTMLElement;
      if (isWbsGridCellTextInput(target)) return;
      if (isGenericTypingTarget(target)) return;
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

  // Shift+?: 단축키 안내 패널 토글 (일반 입력 포커스가 아닐 때만)
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

  // Shift+F12: 관리자 전용 UI ↔ 일반 사용자 화면(memberPreview) 토글
  useEffect(() => {
    const handleAdminMemberViewHotkey = (e: KeyboardEvent) => {
      if (isComposingKeyEvent(e)) return;
      const isF12 = e.key === 'F12' || e.code === 'F12';
      if (!e.shiftKey || !isF12) return;
      if (!canToggleAdminMemberView) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (memberPreview) {
        onRequestRestoreAdminView?.();
        return;
      }
      setMemberPreview(true);
      pushToast('일반 사용자 화면으로 전환했습니다. (Shift+F12로 관리자 화면 복귀)', {
        variant: 'success',
      });
    };
    window.addEventListener('keydown', handleAdminMemberViewHotkey);
    return () => window.removeEventListener('keydown', handleAdminMemberViewHotkey);
  }, [canToggleAdminMemberView, memberPreview, setMemberPreview, onRequestRestoreAdminView, pushToast]);

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
