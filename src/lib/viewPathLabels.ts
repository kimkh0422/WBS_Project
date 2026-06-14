/** 뷰 이탈 확인 모달: 프로그램적 setView vs 브라우저 뒤로 가기 등 URL 변경 */
export type UnsavedViewLeaveMode = 'programmatic' | 'path';

/** URL 첫 세그먼트(뷰) → 사용자에게 보여 줄 짧은 이름 */
const VIEW_SEGMENT_LABELS: Record<string, string> = {
  dashboard: '대시보드',
  projects: '프로젝트 관리',
  allocation: '투입현황',
  todo: '칸반(할일)',
  outlook: '영업 아웃룩',
  weekreport: '주간업무보고',
  table: '표',
  tablegantt: '표+간트',
  gantt: '간트',
  kanban: '칸반',
  mindmap: '마인드맵',
  worklog: '작업 로그',
};

export function viewSegmentFromPathname(pathname: string): string {
  return pathname.replace(/^\//, '').split('/')[0] || '';
}

export function labelForViewPath(pathnameWithOptionalSearch: string): string {
  const pathOnly = pathnameWithOptionalSearch.split('?')[0] ?? pathnameWithOptionalSearch;
  const seg = viewSegmentFromPathname(pathOnly);
  const base = (VIEW_SEGMENT_LABELS[seg] ?? seg) || '다른 화면';
  const q = pathnameWithOptionalSearch.includes('?');
  return q ? `${base} (상세)` : base;
}
