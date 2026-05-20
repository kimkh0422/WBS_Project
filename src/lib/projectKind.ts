import type { Project, ProjectKind } from '../types';

export type { ProjectKind };

export const PROJECT_KINDS: ProjectKind[] = ['상품', '연구', '용역', '유지', '제품', '기타'];

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
    case '기타':
      return 'bg-stone-100 text-stone-600 border-stone-200/80';
  }
}

/** UI·보내기 등에 쓰는 표시명. `projectKind`가 없으면 기본(기타) 구분을 붙인다. */
export function formatProjectDisplayName(name: string, kind?: ProjectKind): string {
  const k = normalizeProjectKind(kind) ?? DEFAULT_PROJECT_KIND;
  return `[${k}] ${name}`;
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

/** 상품 → 연구 → 용역 → 유지 → 제품 → 기타 순으로 프로젝트를 묶음. projectKind 미설정은 기타. */
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
