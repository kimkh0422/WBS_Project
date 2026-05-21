/**
 * 앱 전역 모달·다이얼로그 공통 시각 스타일.
 * 배경 딤·블러·패널 그림자를 통일해 팝업 체감 품질을 맞춘다.
 */

/** 배경 딤만(회원 관리처럼 형제로 `fixed` 패널을 올릴 때). flex·패딩 없음 */
export const MODAL_SCRIM_CLASS = 'fixed inset-0 bg-slate-950/45 backdrop-blur-md animate-in fade-in duration-200';

/** 배경 + 가운데 정렬(일반 중앙 모달) */
export const MODAL_BACKDROP_CLASS =
  'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200';

/** 패널에 max-w·max-h·flex 방향 등은 호출부에서 덧붙인다. */
export const MODAL_PANEL_BASE_CLASS =
  'bg-[var(--color-surface)] rounded-2xl border border-slate-200/90 shadow-[0_22px_45px_-15px_rgba(15,23,42,0.28),0_0_0_1px_rgba(15,23,42,0.04)] outline-none w-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200';
