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

/** 일시 중단 기간에 제공하는 최근 작업 프로젝트 스냅샷 (public/lockdown/ 정적 파일) */
export const LOGIN_LOCKDOWN_EXPORT = {
  href: '/lockdown/wbs_export_20260706_1544.xlsx',
  fileName: 'wbs_export_20260706_1544.xlsx',
  snapshotLabel: '2026년 7월 6일 15:44',
} as const;

export const LOGIN_LOCKDOWN_EXPORT_HINT =
  '일시 중단 전까지 작업하신 프로젝트 데이터를 엑셀 파일로 받으실 수 있습니다. 재오픈 후 동일 파일로 가져오기(Import)도 가능합니다.';
