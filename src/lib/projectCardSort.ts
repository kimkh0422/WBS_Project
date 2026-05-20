/** 대시보드·프로젝트 관리 화면에서 동일하게 사용하는 정렬 값. */
export type ProjectCardSortKey = 'default' | 'group' | 'kind' | 'inputMm';

/** localStorage 키: 프로젝트 관리 화면의 정렬 프리셋(기본·그룹순·종류순·투입 M/M)에 사용한다. */
export const PROJECT_CARD_SORT_LS_KEY = 'wbs-dashboard-project-card-sort';

export function parseProjectCardSortKey(raw: string | null | undefined): ProjectCardSortKey {
  if (raw === 'default' || raw === 'group' || raw === 'kind' || raw === 'inputMm') return raw;
  return 'default';
}
