/** 대시보드 본문 블록 표시 여부(브라우저 localStorage, 사용자별) */

export const DASHBOARD_SECTION_VISIBILITY_KEY = 'wbs-dashboard-section-visibility';

export const DASHBOARD_SECTION_IDS = ['summary', 'issues', 'actions', 'divisions', 'allocation', 'milestones', 'projects'] as const;
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export type DashboardSectionVisibility = Record<DashboardSectionId, boolean>;

export const DASHBOARD_SECTION_LABELS: Record<DashboardSectionId, string> = {
  summary: '전체 현황 요약',
  issues: '이슈 작업',
  actions: '액션 항목',
  divisions: '사업부·부서별 현황',
  allocation: '인원·프로젝트 투입 현황',
  milestones: '마일스톤',
  projects: '프로젝트별 상태',
};

export const WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED = 'wbs-dashboard-section-visibility-changed';

export function getDefaultDashboardSectionVisibility(): DashboardSectionVisibility {
  return Object.fromEntries(DASHBOARD_SECTION_IDS.map((id) => [id, true])) as DashboardSectionVisibility;
}

export function readDashboardSectionVisibility(): DashboardSectionVisibility {
  const defaults = getDefaultDashboardSectionVisibility();
  try {
    const raw = localStorage.getItem(DASHBOARD_SECTION_VISIBILITY_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...defaults };
    const rec = parsed as Record<string, unknown>;
    const out = { ...defaults };
    for (const id of DASHBOARD_SECTION_IDS) {
      if (id in rec && typeof rec[id] === 'boolean') {
        out[id] = rec[id];
      }
    }
    return out;
  } catch {
    return { ...defaults };
  }
}

export function writeDashboardSectionVisibility(next: DashboardSectionVisibility): void {
  try {
    const defaults = getDefaultDashboardSectionVisibility();
    const sameAsDefault = DASHBOARD_SECTION_IDS.every((id) => !!next[id] === !!defaults[id]);
    if (sameAsDefault) {
      localStorage.removeItem(DASHBOARD_SECTION_VISIBILITY_KEY);
    } else {
      localStorage.setItem(DASHBOARD_SECTION_VISIBILITY_KEY, JSON.stringify(next));
    }
    window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED));
  } catch {
    /* ignore */
  }
}

/** 저장값 제거 후 기본(모두 표시)으로 — 설정에서 초기화할 때 사용 */
export function resetDashboardSectionVisibility(): void {
  try {
    localStorage.removeItem(DASHBOARD_SECTION_VISIBILITY_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED));
}
