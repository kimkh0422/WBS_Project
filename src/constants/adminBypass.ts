/**
 * 로컬 "관리자 모드" 비밀번호 (AdminPasswordModal과 동일).
 * Edge Function `admin-delete-user`의 환경변수 WBS_ADMIN_PASSWORD와 맞춰야 비밀번호 관리자도 회원 삭제 가능.
 */
export const WBS_ADMIN_PASSWORD = '6502';

/** 일반 사용자 화면(memberPreview)에서 관리자 화면으로 복귀할 때 요구하는 비밀번호 */
export const WBS_ADMIN_VIEW_RESTORE_PASSWORD = '6503';
