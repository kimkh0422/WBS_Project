/**
 * 개발 전용 로그인 우회 — UI를 로그인 없이 미리보기/검증하기 위한 장치.
 *
 * - 운영 빌드(`import.meta.env.DEV === false`)에서는 **항상 비활성**(완전 죽은 코드)이라 보안 위험 없음.
 * - 활성: 주소에 `?devauth=1` (한 번 켜면 localStorage에 기억되어 페이지 이동에도 유지).
 * - 해제: `?devauth=0`.
 *
 * 활성 시:
 *   1) AuthContext가 가짜 사용자(세션)를 주입해 로그인 화면을 건너뛴다.
 *   2) 앱은 `useLocalOnly`(로컬 전용) 모드로 동작하고 샘플 데이터를 시드한다 → **실제 DB에는 읽기/쓰기 안 함**.
 */
const KEY = 'wbs-dev-auth-bypass';

export const DEV_BYPASS_USER_ID = '00000000-0000-4000-8000-0000000000de';

export function isDevAuthBypass(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('devauth');
    if (q === '1' || q === 'true') {
      window.localStorage.setItem(KEY, '1');
      return true;
    }
    if (q === '0' || q === 'false') {
      window.localStorage.removeItem(KEY);
      return false;
    }
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
