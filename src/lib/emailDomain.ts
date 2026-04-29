/**
 * 사내 도입을 위한 이메일 도메인 정책.
 * 회원가입은 회사 메일(@gmtc.kr)로만 허용한다.
 *
 * 주의: 이 검증은 "클라이언트 측" 가드일 뿐이라 API를 직접 호출하면 우회될 수 있다.
 * 강제 차단이 필요하면 Supabase Auth Hook(Before User Created) 또는
 * 서버측 트리거로 추가 방어해야 한다.
 */

export const ALLOWED_SIGNUP_DOMAIN = 'gmtc.kr';

export function isAllowedSignupEmail(email: string): boolean {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed) return false;
  const at = trimmed.lastIndexOf('@');
  if (at < 0) return false;
  const domain = trimmed.slice(at + 1);
  return domain === ALLOWED_SIGNUP_DOMAIN;
}

export const SIGNUP_DOMAIN_ERROR = `회원가입은 회사 메일(@${ALLOWED_SIGNUP_DOMAIN})로만 가능합니다.`;
