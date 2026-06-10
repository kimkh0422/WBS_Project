/**
 * 이메일 도메인 정책.
 * - 회원가입은 @gmtc.kr 사내 메일만 허용한다. 그 외 도메인은 클라이언트·DB(handle_new_user) 양쪽에서 차단.
 * - 외부(외주) 계정 개념은 폐기됨. 기존 외부 계정은 마이그레이션으로 일괄 삭제(20260610130000 참조).
 *
 * 주의: 클라이언트 검증은 UX용일 뿐이며, 실제 가입 차단은 Supabase 트리거(handle_new_user)가 강제한다.
 */

export const INTERNAL_COMPANY_EMAIL_DOMAIN = 'gmtc.kr';

/** @gmtc.kr 사내 메일 여부(로그인·프로필 분류와 동일 규칙) */
export function isInternalCompanyEmail(email: string): boolean {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed) return false;
  const at = trimmed.lastIndexOf('@');
  if (at < 0) return false;
  const domain = trimmed.slice(at + 1);
  return domain === INTERNAL_COMPANY_EMAIL_DOMAIN;
}

/** 회원가입 허용 여부: @gmtc.kr 사내 메일만 허용. */
export function isAllowedSignupEmail(email: string): boolean {
  return isInternalCompanyEmail(email);
}

export const SIGNUP_EMAIL_FORMAT_ERROR = `회원가입은 @${INTERNAL_COMPANY_EMAIL_DOMAIN} 사내 메일만 가능합니다.`;
