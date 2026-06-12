/**
 * 로그인 상태 유지(remember me) 설정 + Supabase 인증 저장소 라우팅.
 *
 * - remember=true(기본): 세션을 localStorage에 저장 → 브라우저를 닫았다 열어도 자동로그인 유지.
 * - remember=false: 세션을 sessionStorage에 저장 → 탭/브라우저를 닫으면 로그아웃(공용 PC 대응).
 *
 * remember 플래그 자체는 항상 localStorage에 저장한다. 다음 방문 때 어느 저장소에서
 * 세션 토큰을 읽을지 동기적으로 결정해야 하므로(앱 부팅 시점) localStorage가 적합하다.
 */
const REMEMBER_KEY = 'wbs-auth-remember';

/** 현재 '로그인 상태 유지' 설정. 미설정(최초 방문) 기본값은 유지함(true). */
export function getRememberMe(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(REMEMBER_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

/** '로그인 상태 유지' 설정 저장. 로그인 직전(토큰 기록 전)에 호출해 저장 위치를 결정한다. */
export function setRememberMe(remember: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    /* ignore */
  }
}

type SimpleStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/**
 * remember 설정에 따라 localStorage(유지) 또는 sessionStorage(임시)로 라우팅하는
 * Supabase auth 저장소 어댑터.
 *
 * - getItem: 활성 저장소에서만 읽는다(해제했는데 localStorage 잔존 토큰으로 자동로그인되는 일 방지).
 * - setItem: 활성 저장소에 쓰고, 반대편 저장소의 동일 키는 제거해 중복/혼선을 막는다.
 * - removeItem: 두 저장소 모두에서 제거(로그아웃 시 깔끔하게 정리).
 */
export function createRememberAwareAuthStorage(): SimpleStorage {
  const active = (): Storage => (getRememberMe() ? window.localStorage : window.sessionStorage);
  const other = (): Storage => (getRememberMe() ? window.sessionStorage : window.localStorage);
  return {
    getItem: (key) => {
      try {
        return active().getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        active().setItem(key, value);
        other().removeItem(key);
      } catch {
        /* ignore */
      }
    },
    removeItem: (key) => {
      try {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
