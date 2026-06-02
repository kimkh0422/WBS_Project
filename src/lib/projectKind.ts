import type { Project, ProjectKind } from '../types';

export type { ProjectKind };

export const PROJECT_KINDS: ProjectKind[] = ['상품', '연구', '용역', '유지', '제품', '내부', '연습', '개인', '기타'];

/** 본인(소유자)에게만 노출되는 항목. 대시보드·목록·검색 등에서 타인에게 숨김 */
export const PRIVATE_PROJECT_KINDS: readonly ProjectKind[] = ['연습', '개인'];

export function isPrivateProjectKind(kind: string | null | undefined): boolean {
  const k = normalizeProjectKind(kind);
  return k === '연습' || k === '개인';
}

/**
 * 연습·개인 프로젝트는 소유자 본인에게만 공유 뷰에 표시.
 * ownerId가 없으면 구 데이터 호환으로 비공개 숨김을 적용하지 않음.
 */
export function isPrivateProjectHiddenFromViewer(
  project: Pick<Project, 'projectKind' | 'ownerId'>,
  viewerUserId: string | undefined,
): boolean {
  if (!isPrivateProjectKind(project.projectKind)) return false;
  if (!viewerUserId) return true;
  if (!project.ownerId) return false;
  return project.ownerId !== viewerUserId;
}

export function filterProjectsVisibleToViewer<T extends Pick<Project, 'projectKind' | 'ownerId'>>(
  projectList: readonly T[],
  viewerUserId: string | undefined,
): T[] {
  return projectList.filter((p) => !isPrivateProjectHiddenFromViewer(p, viewerUserId));
}

/** DB·UI에서 구분이 비어 있을 때(기존 데이터 호환): 집계·표시용 기본값 */
export const DEFAULT_PROJECT_KIND: ProjectKind = '기타';

/** 새 프로젝트 생성 시 항목 구분 기본값 */
export const DEFAULT_NEW_PROJECT_KIND: ProjectKind = '기타';

/** 현재 앱에서 허용하는 구분 문자열만 인정 */
export function normalizeProjectKind(value: string | null | undefined): ProjectKind | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return PROJECT_KINDS.includes(trimmed as ProjectKind) ? (trimmed as ProjectKind) : undefined;
}

/**
 * DB에 남아 있는 구버전 `project_kind` 값을 현재 구분으로 바꿔 읽을 때 사용.
 * - `사업` → `용역`
 * - 그 외 알 수 없는 값은 undefined (이후 `resolveProjectKindOrDefault`로 기타 처리)
 */
export function migrateDbProjectKindToAppKind(value: string | null | undefined): ProjectKind | undefined {
  const n = normalizeProjectKind(value);
  if (n) return n;
  const t = value?.trim();
  if (t === '사업') return '용역';
  return undefined;
}

export function getProjectKindBadgeClass(kind: ProjectKind): string {
  switch (kind) {
    case '상품':
      return 'bg-rose-100 text-rose-800 border-rose-200/80';
    case '연구':
      return 'bg-violet-100 text-violet-700 border-violet-200/80';
    case '용역':
      return 'bg-sky-100 text-sky-700 border-sky-200/80';
    case '유지':
      return 'bg-teal-100 text-teal-800 border-teal-200/80';
    case '제품':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200/80';
    case '내부':
      return 'bg-slate-100 text-slate-800 border-slate-200/80';
    case '연습':
      return 'bg-amber-100 text-amber-900 border-amber-200/80';
    case '개인':
      return 'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200/80';
    case '기타':
      return 'bg-stone-100 text-stone-600 border-stone-200/80';
  }
}

/** UI·보내기 등에 쓰는 표시명. `projectKind`가 없으면 기본(기타) 구분을 붙인다. */
export function formatProjectDisplayName(name: string, kind?: ProjectKind): string {
  const k = normalizeProjectKind(kind) ?? DEFAULT_PROJECT_KIND;
  return `[${k}] ${name}`;
}

/**
 * 자유 입력이 `[구분] 프로젝트명` 형태(자동완성·칩과 동일 패턴)이면 이름·구분을 분리한다.
 * 알 수 없는 구분이거나 이름이 비면 원문 전체를 이름으로 둔다.
 */
export function parseKindBracketPrefixForNewProject(raw: string): { name: string; projectKind?: ProjectKind } {
  const trimmed = raw.trim();
  const m = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!m) return { name: trimmed };
  const kind = normalizeProjectKind(m[1]);
  const rest = m[2].trim();
  if (!kind || !rest) return { name: trimmed };
  return { name: rest, projectKind: kind };
}

export function resolveProjectKind(project?: Pick<Project, 'projectKind'> | null): ProjectKind | undefined {
  return project?.projectKind;
}

export function resolveProjectKindOrDefault(project?: Pick<Project, 'projectKind'> | null): ProjectKind {
  return normalizeProjectKind(project?.projectKind) ?? DEFAULT_PROJECT_KIND;
}

export type ProjectKindGroup<T extends Pick<Project, 'projectKind'>> = {
  kind: ProjectKind;
  projects: T[];
};

/** 상품 → 연구 → 용역 → 유지 → 제품 → 내부 → 연습 → 개인 → 기타 순으로 프로젝트를 묶음. projectKind 미설정은 기타. */
export function groupProjectsByKind<T extends Pick<Project, 'projectKind'>>(
  projects: readonly T[],
  options?: { omitEmpty?: boolean },
): ProjectKindGroup<T>[] {
  const omitEmpty = options?.omitEmpty ?? true;
  const buckets = new Map<ProjectKind, T[]>(PROJECT_KINDS.map((k) => [k, []]));
  for (const p of projects) {
    buckets.get(resolveProjectKindOrDefault(p))!.push(p);
  }
  const groups = PROJECT_KINDS.map((kind) => ({ kind, projects: buckets.get(kind)! }));
  return omitEmpty ? groups.filter((g) => g.projects.length > 0) : groups;
}

/** 구분별 목록에서 `include_in_dashboard = false` 프로젝트를 묶는 섹션 제목 */
export const DASHBOARD_UNLISTED_SECTION_LABEL = '집계제외';

export function getDashboardUnlistedBadgeClass(): string {
  return 'bg-amber-50 text-amber-900 border-amber-200/80';
}

/** 프로젝트 목록 표·헤더 드롭다운의 종류 칼럼/섹션 뱃지 */
export function getProjectListKindBadgeMeta(project: Pick<Project, 'includeInDashboard' | 'projectKind'>): {
  label: string;
  badgeClass: string;
} {
  if (project.includeInDashboard === false) {
    return { label: DASHBOARD_UNLISTED_SECTION_LABEL, badgeClass: getDashboardUnlistedBadgeClass() };
  }
  const kind = resolveProjectKindOrDefault(project);
  return { label: kind, badgeClass: getProjectKindBadgeClass(kind) };
}

/** 종류순 정렬: 대시보드 미반영은 항상 마지막(기타 다음) */
export function projectListKindSortRank(project: Pick<Project, 'includeInDashboard' | 'projectKind'>): number {
  if (project.includeInDashboard === false) return PROJECT_KINDS.length;
  return PROJECT_KINDS.indexOf(resolveProjectKindOrDefault(project));
}

export type ProjectsGroupedForKindListView<T extends Pick<Project, 'projectKind' | 'includeInDashboard'>> = {
  sectionKey: string;
  headerLabel: string;
  headerBadgeClass: string;
  projects: T[];
};

/**
 * 구분별 보기: 대시보드에 반영하지 않는 프로젝트는 `DASHBOARD_UNLISTED_SECTION_LABEL` 섹션으로만 묶음.
 * 나머지는 기존 `groupProjectsByKind`와 동일.
 */
export function groupProjectsForKindListView<T extends Pick<Project, 'projectKind' | 'includeInDashboard'>>(
  projects: readonly T[],
  options?: { omitEmpty?: boolean },
): ProjectsGroupedForKindListView<T>[] {
  const omitEmpty = options?.omitEmpty ?? true;
  const excluded: T[] = [];
  const included: T[] = [];
  for (const p of projects) {
    if (p.includeInDashboard === false) excluded.push(p);
    else included.push(p);
  }
  const kindGroups = groupProjectsByKind(included, { omitEmpty });
  const sections: ProjectsGroupedForKindListView<T>[] = kindGroups.map((g) => ({
    sectionKey: `kind:${g.kind}`,
    headerLabel: g.kind,
    headerBadgeClass: getProjectKindBadgeClass(g.kind),
    projects: g.projects,
  }));
  if (excluded.length > 0 || !omitEmpty) {
    sections.push({
      sectionKey: 'dashboard-unlisted',
      headerLabel: DASHBOARD_UNLISTED_SECTION_LABEL,
      headerBadgeClass: getDashboardUnlistedBadgeClass(),
      projects: excluded,
    });
  }
  return sections;
}
