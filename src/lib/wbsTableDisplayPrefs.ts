/** 이 브라우저에서만: 작업표·간트의 레벨 배경·완료 취소선 등 자동 서식 숨김(전역이 켜져 있을 때만 적용) */
const USER_HIDE_AUTO_FORMAT_KEY = 'wbs-hide-table-auto-format';

const CHANGED_EVENT = 'wbs-table-auto-formatting-changed';

export function getUserHidesTableAutoFormatting(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(USER_HIDE_AUTO_FORMAT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setUserHidesTableAutoFormatting(hide: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (hide) window.localStorage.setItem(USER_HIDE_AUTO_FORMAT_KEY, '1');
    else window.localStorage.removeItem(USER_HIDE_AUTO_FORMAT_KEY);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export function subscribeTableAutoFormattingChanged(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => fn();
  const onStorage = (e: StorageEvent) => {
    if (e.key === USER_HIDE_AUTO_FORMAT_KEY) fn();
  };
  window.addEventListener(CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/** 이 브라우저에서만: 셀을 한 번 클릭하면 바로 편집(켜짐) vs 더블클릭·F2로만 편집(꺼짐, 기본) */
const SINGLE_CLICK_EDIT_KEY = 'wbs-single-click-edit';
const SINGLE_CLICK_EDIT_CHANGED_EVENT = 'wbs-single-click-edit-changed';

export function getSingleClickEdit(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SINGLE_CLICK_EDIT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSingleClickEdit(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(SINGLE_CLICK_EDIT_KEY, '1');
    else window.localStorage.removeItem(SINGLE_CLICK_EDIT_KEY);
    window.dispatchEvent(new Event(SINGLE_CLICK_EDIT_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export function subscribeSingleClickEditChanged(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => fn();
  const onStorage = (e: StorageEvent) => {
    if (e.key === SINGLE_CLICK_EDIT_KEY) fn();
  };
  window.addEventListener(SINGLE_CLICK_EDIT_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SINGLE_CLICK_EDIT_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/** 이 브라우저에서만: 고급 도구(자동 서식·가중치·하위일정 균등분할·클릭 편집) 버튼을 툴바에 표시. 기본 숨김, Shift+F12로 토글. 보완 가이드는 상시 표시 */
const ADVANCED_TOOLS_KEY = 'wbs-show-advanced-tools';
const ADVANCED_TOOLS_CHANGED_EVENT = 'wbs-show-advanced-tools-changed';

export function getShowAdvancedTools(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ADVANCED_TOOLS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setShowAdvancedTools(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(ADVANCED_TOOLS_KEY, '1');
    else window.localStorage.removeItem(ADVANCED_TOOLS_KEY);
    window.dispatchEvent(new Event(ADVANCED_TOOLS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

export function subscribeShowAdvancedToolsChanged(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => fn();
  const onStorage = (e: StorageEvent) => {
    if (e.key === ADVANCED_TOOLS_KEY) fn();
  };
  window.addEventListener(ADVANCED_TOOLS_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ADVANCED_TOOLS_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
