/**
 * 이메일 도메인 정책.
 * - 사내 직원: @gmtc.kr (전사 프로젝트·조직도 등 기존 권한)
 * - 외주 등: 그 외 도메인으로도 회원가입 가능. DB에서 is_external_partner 로 표시되며,
 *   지엠티가 공유(project_members)한 프로젝트에만 접근한다.
 *
 * 주의: 클라이언트 검증은 UX용일 뿐이며, 실제 권한은 Supabase RLS·ensure_profile 이 결정한다.
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

/** 회원가입: 일반적인 이메일 형식이면 허용(@ 포함) */
export function isAllowedSignupEmail(email: string): boolean {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed || trimmed.length < 5) return false;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

export const SIGNUP_EMAIL_FORMAT_ERROR =
  '올바른 이메일 주소를 입력하세요. 사내 직원은 @gmtc.kr, 외주 파트너는 본인 업체 메일을 사용할 수 있습니다.';
