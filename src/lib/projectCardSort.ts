/** 대시보드·프로젝트 관리 화면에서 동일하게 사용하는 정렬 값. */
export type ProjectCardSortKey = 'default' | 'group' | 'kind' | 'inputMm';

/** localStorage 키: 대시보드「프로젝트별 상태」와 프로젝트 관리 화면 정렬이 이 값을 공유한다. */
export const PROJECT_CARD_SORT_LS_KEY = 'wbs-dashboard-project-card-sort';

export function parseProjectCardSortKey(raw: string | null | undefined): ProjectCardSortKey {
  if (raw === 'default' || raw === 'group' || raw === 'kind' || raw === 'inputMm') return raw;
  return 'default';
}
