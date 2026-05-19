import type { Project, ProjectKind } from '../types';

export type { ProjectKind };

export const PROJECT_KINDS: ProjectKind[] = ['연구', '사업', '기타'];

export const DEFAULT_PROJECT_KIND: ProjectKind = '기타';

export function normalizeProjectKind(value: string | null | undefined): ProjectKind | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return PROJECT_KINDS.includes(trimmed as ProjectKind) ? (trimmed as ProjectKind) : undefined;
}

export function getProjectKindBadgeClass(kind: ProjectKind): string {
  switch (kind) {
    case '연구':
      return 'bg-violet-100 text-violet-700 border-violet-200/80';
    case '사업':
      return 'bg-sky-100 text-sky-700 border-sky-200/80';
    case '기타':
      return 'bg-stone-100 text-stone-600 border-stone-200/80';
  }
}

export function formatProjectDisplayName(name: string, kind?: ProjectKind): string {
  return kind ? `[${kind}] ${name}` : name;
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

/** 연구 → 사업 → 기타 순으로 프로젝트를 묶음. projectKind 미설정은 기타. */
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
