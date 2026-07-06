/**
 * 로그인 일시 중단(시범운영·안정화 기간).
 * 전사 오픈 시 `LOGIN_LOCKDOWN_ENABLED`를 false로 바꾸거나 배포 환경변수로 끈다.
 */
export const LOGIN_LOCKDOWN_ENABLED = true;

const envOff =
  String(import.meta.env.VITE_LOGIN_LOCKDOWN ?? '')
    .trim()
    .toLowerCase() === 'false';

/** 운영 빌드에서 로그인 차단 여부. devauth 우회는 App/AuthContext에서 별도 처리. */
export function isLoginLockdownActive(): boolean {
  return LOGIN_LOCKDOWN_ENABLED && !envOff;
}

export const LOGIN_LOCKDOWN_MESSAGE =
  '지엠티 스마트시트는 당분간 시스템 안정화를 위해 로그인을 일시 중단합니다. 운영기술 개발실에서 시범운영을 진행한 뒤, 다른 부서로 순차 확대할 예정입니다. 조금만 기다려 주시면 감사하겠습니다.';

export const LOGIN_LOCKDOWN_DURATION_HINT = '전사 오픈까지 약 1개월 정도 소요될 수 있습니다.';
