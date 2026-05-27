/** 대시보드 본문 블록 표시 여부(브라우저 localStorage, 사용자별) */

export const DASHBOARD_SECTION_VISIBILITY_KEY = 'wbs-dashboard-section-visibility-v2';

/** v1 키 — v2 도입 시 한 번 읽어 이슈·액션은 끈 채로 이관 후 삭제 */
const LEGACY_DASHBOARD_SECTION_VISIBILITY_KEY = 'wbs-dashboard-section-visibility';

export const DASHBOARD_SECTION_IDS = ['summary', 'issues', 'actions', 'divisions', 'allocation', 'milestones', 'projects'] as const;
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export type DashboardSectionVisibility = Record<DashboardSectionId, boolean>;

export const DASHBOARD_SECTION_LABELS: Record<DashboardSectionId, string> = {
  summary: '전체 현황 요약',
  issues: '이슈 작업',
  actions: '액션 항목',
  divisions: '사업부·부서별 현황',
  allocation: '인원·사업부 투입공수',
  milestones: '마일스톤',
  projects: '프로젝트별 상태',
};

export const WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED = 'wbs-dashboard-section-visibility-changed';

export function getDefaultDashboardSectionVisibility(): DashboardSectionVisibility {
  const all = Object.fromEntries(DASHBOARD_SECTION_IDS.map((id) => [id, false])) as DashboardSectionVisibility;
  /** 첫 화면: 요약 + 인원별 투입 요약 + 프로젝트 목록 — 그 외는 설정에서 켤 수 있음 */
  all.summary = true;
  all.projects = true;
  all.allocation = true;
  /** 이슈·액션·부서·마일스톤은 기본 숨김 */
  all.issues = false;
  all.actions = false;
  all.divisions = false;
  all.milestones = false;
  return all;
}

function mergeStoredVisibility(raw: string, defaults: DashboardSectionVisibility): DashboardSectionVisibility | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    const out = { ...defaults };
    for (const id of DASHBOARD_SECTION_IDS) {
      if (id in rec && typeof rec[id] === 'boolean') {
        out[id] = rec[id];
      }
    }
    return out;
  } catch {
    return null;
  }
}

function persistVisibility(next: DashboardSectionVisibility): void {
  const defaults = getDefaultDashboardSectionVisibility();
  const sameAsDefault = DASHBOARD_SECTION_IDS.every((id) => !!next[id] === !!defaults[id]);
  if (sameAsDefault) {
    localStorage.removeItem(DASHBOARD_SECTION_VISIBILITY_KEY);
  } else {
    localStorage.setItem(DASHBOARD_SECTION_VISIBILITY_KEY, JSON.stringify(next));
  }
  window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED));
}

export function readDashboardSectionVisibility(): DashboardSectionVisibility {
  const defaults = getDefaultDashboardSectionVisibility();
  try {
    const raw = localStorage.getItem(DASHBOARD_SECTION_VISIBILITY_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_DASHBOARD_SECTION_VISIBILITY_KEY);
      if (legacy) {
        const merged = mergeStoredVisibility(legacy, defaults) ?? { ...defaults };
        merged.issues = false;
        merged.actions = false;
        try {
          persistVisibility(merged);
          localStorage.removeItem(LEGACY_DASHBOARD_SECTION_VISIBILITY_KEY);
        } catch {
          /* ignore */
        }
        return { ...merged };
      }
    }
    if (!raw) return { ...defaults };
    const out = mergeStoredVisibility(raw, defaults);
    return out ? { ...out } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function writeDashboardSectionVisibility(next: DashboardSectionVisibility): void {
  try {
    persistVisibility(next);
  } catch {
    /* ignore */
  }
}

/** 저장값 제거 후 앱 기본값(이슈·액션 블록 꺼짐)으로 — 설정에서 초기화할 때 사용 */
export function resetDashboardSectionVisibility(): void {
  try {
    localStorage.removeItem(DASHBOARD_SECTION_VISIBILITY_KEY);
    localStorage.removeItem(LEGACY_DASHBOARD_SECTION_VISIBILITY_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED));
}
