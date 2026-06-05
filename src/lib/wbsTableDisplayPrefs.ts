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
