/**
 * 앱 전역 모달·다이얼로그 공통 시각 스타일.
 * 배경 딤·블러·패널 그림자를 통일해 팝업 체감 품질을 맞춘다.
 */

/** 배경 딤만(회원 관리처럼 형제로 `fixed` 패널을 올릴 때). flex·패딩 없음 */
export const MODAL_SCRIM_CLASS = 'fixed inset-0 bg-slate-950/55 backdrop-blur-md backdrop-saturate-150 animate-in fade-in duration-200';

/** 배경 + 가운데 정렬(일반 중앙 모달). z는 표·간트 split 상단 도킹(z-[60])보다 위, 토스트(z-[100])보다 아래. */
export const MODAL_BACKDROP_CLASS =
  'fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 backdrop-blur-md backdrop-saturate-150 p-3 sm:p-4 animate-in fade-in duration-200';

/**
 * 패널 기본형. max-w·max-h·flex 방향 등은 호출부에서 덧붙인다.
 * 그림자는 접지(contact)·부유(float)·헤어라인 링 3겹으로 쌓아 떠 있는 느낌을 살린다.
 */
export const MODAL_PANEL_BASE_CLASS =
  'bg-[var(--color-surface)] rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_-3px_rgba(15,23,42,0.12),0_26px_56px_-16px_rgba(15,23,42,0.34),0_0_0_1px_rgba(15,23,42,0.05)] outline-none w-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200';

/** 헤더 바: 상단 라이트 그라데이션 + 하단 헤어라인. BaseModal·ConfirmDialog 등에서 공유. */
export const MODAL_HEADER_CLASS =
  'flex justify-between items-center gap-3 px-5 sm:px-6 py-4 border-b border-slate-200/70 bg-gradient-to-b from-slate-50/80 to-transparent';

/** 푸터 바: 상단 헤어라인 + 옅은 베이스 톤. */
export const MODAL_FOOTER_CLASS = 'flex justify-end gap-3 px-5 sm:px-6 py-4 border-t border-slate-200/70 bg-slate-50/40';

/** 우상단 닫기(X) 버튼 공통 스타일. */
export const MODAL_CLOSE_BUTTON_CLASS =
  'p-2 rounded-xl transition-colors text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 ring-1 ring-transparent hover:ring-slate-300/60';
