import React from 'react';
import { cn } from '../lib/utils';
import type { Project } from '../types';
import {
  formatProjectDisplayName,
  getProjectDisplayNameBody,
  getProjectKindBadgeClass,
  normalizeProjectKind,
  resolveProjectKind,
  DEFAULT_PROJECT_KIND,
} from '../lib/projectKind';

interface ProjectNameLabelProps {
  name: string;
  projectKind?: Project['projectKind'];
  /** project 객체가 있으면 name·projectKind를 여기서 읽음 */
  project?: Pick<Project, 'name' | 'projectKind'> | null;
  className?: string;
  nameClassName?: string;
  badgeClassName?: string;
  /** false면 구분 뱃지 없이 이름만 */
  showBadge?: boolean;
  /** title 속성. 미지정 시 구분 포함 전체 표시명 */
  title?: string;
}

/** 프로젝트 항목(상품·연구·용역·유지·제품·내부·연습·개인·기타) 뱃지 + 프로젝트명 */
export function ProjectNameLabel({
  name,
  projectKind,
  project,
  className,
  nameClassName,
  badgeClassName,
  showBadge = true,
  title,
}: ProjectNameLabelProps) {
  const rawName = project?.name ?? name;
  const resolvedKind = normalizeProjectKind(projectKind) ?? resolveProjectKind(project ?? null) ?? DEFAULT_PROJECT_KIND;
  const displayName = getProjectDisplayNameBody(rawName, resolvedKind);
  const fullTitle = title ?? formatProjectDisplayName(rawName, resolvedKind);

  return (
    <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)} title={fullTitle}>
      {showBadge && (
        <span
          className={cn(
            'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border leading-none',
            getProjectKindBadgeClass(resolvedKind),
            badgeClassName,
          )}
        >
          {resolvedKind}
        </span>
      )}
      <span className={cn('min-w-0 break-words', nameClassName)}>{displayName}</span>
    </span>
  );
}
