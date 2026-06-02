/** 대시보드 각 본문 블록의 표/카드 표시 방식(브라우저 localStorage, 사용자별) */

import { DASHBOARD_SECTION_IDS, type DashboardSectionId } from './dashboardSections';

export const DASHBOARD_SECTION_LAYOUT_KEY = 'wbs-dashboard-section-layout';

export type DashboardSectionLayoutMode = 'table' | 'card';

export type DashboardSectionLayout = Record<DashboardSectionId, DashboardSectionLayoutMode>;

export const WBS_DASHBOARD_SECTION_LAYOUT_CHANGED = 'wbs-dashboard-section-layout-changed';

/** PC 기본: 카드형 목록 */
export function getDefaultDashboardSectionLayout(): DashboardSectionLayout {
  return {
    summary: 'card',
    divisions: 'card',
    projects: 'card',
  };
}

export function readDashboardSectionLayout(): DashboardSectionLayout {
  const defaults = getDefaultDashboardSectionLayout();
  try {
    const raw = localStorage.getItem(DASHBOARD_SECTION_LAYOUT_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...defaults };
    const rec = parsed as Record<string, unknown>;
    const out = { ...defaults };
    for (const id of DASHBOARD_SECTION_IDS) {
      const v = rec[id];
      if (v === 'table' || v === 'card') {
        out[id] = v;
      }
    }
    return out;
  } catch {
    return { ...defaults };
  }
}

export function writeDashboardSectionLayout(next: DashboardSectionLayout): void {
  try {
    const defaults = getDefaultDashboardSectionLayout();
    const sameAsDefault = DASHBOARD_SECTION_IDS.every((id) => next[id] === defaults[id]);
    if (sameAsDefault) {
      localStorage.removeItem(DASHBOARD_SECTION_LAYOUT_KEY);
    } else {
      localStorage.setItem(DASHBOARD_SECTION_LAYOUT_KEY, JSON.stringify(next));
    }
    window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_LAYOUT_CHANGED));
  } catch {
    /* ignore */
  }
}

export function resetDashboardSectionLayout(): void {
  try {
    localStorage.removeItem(DASHBOARD_SECTION_LAYOUT_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(WBS_DASHBOARD_SECTION_LAYOUT_CHANGED));
}
