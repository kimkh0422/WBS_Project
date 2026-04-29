import React, { useState, useEffect, useMemo } from 'react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { ProjectModal } from './ProjectModal';
import { ShareModal } from './ShareModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ProjectGroupManagerModal } from './ProjectGroupManagerModal';
import { useToast } from './Toast';
import { FolderPlus, Trash2, Edit, Share2, Copy, List, ChevronRight, ChevronDown, Loader2, FolderOpen, FolderCog } from 'lucide-react';
import { cn } from '../lib/utils';
import { Project } from '../types';
import type { ProjectGroup } from '../lib/wbsSettings';
import { fetchProfiles, checkIsAdmin, getProjectOwnerDisplayNames, getMyEditableProjectIds } from '../lib/db';

interface ProjectsPageProps {
  onNavigateToWork?: (projectId?: string) => void;
}

type ProjectSortKey = 'default' | 'task_desc' | 'task_asc';

export function ProjectsPage({ onNavigateToWork }: ProjectsPageProps) {
  const { user } = useAuth();
  const { projects, allTasks, addProject, updateProject, deleteProject, copyProject, setCurrentProjectId, wbsSettings } = useWBS();
  const { push: pushToast } = useToast();

  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null }[]>([]);
  const [ownerDisplayNames, setOwnerDisplayNames] = useState<Record<string, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  // 편집 권한이 부여된 프로젝트 ID. undefined: 로딩 전(fail-open으로 편집 버튼 표시)
  const [myEditableProjectIds, setMyEditableProjectIds] = useState<string[] | undefined>(undefined);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [shareProjectName, setShareProjectName] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [projectSort, setProjectSort] = useState<ProjectSortKey>('default');
  const [groupByOwner, setGroupByOwner] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wbs-projects-collapsed-groups');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });
  const toggleGroupCollapsed = (id: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem('wbs-projects-collapsed-groups', JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (!user?.id) return;
    checkIsAdmin()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
    getMyEditableProjectIds()
      .then(setMyEditableProjectIds)
      .catch(() => setMyEditableProjectIds([]));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setLoadingProfiles(false);
      return;
    }
    setLoadingProfiles(true);
    fetchProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setLoadingProfiles(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !projects.length) {
      setOwnerDisplayNames({});
      return;
    }
    const knownIds = new Set<string>(profiles.map((p) => p.id));
    const missingOwnerIds = [...new Set<string>(projects.map((p) => p.ownerId).filter((id): id is string => !!id))].filter(
      (id) => !knownIds.has(id),
    );
    if (missingOwnerIds.length === 0) {
      setOwnerDisplayNames({});
      return;
    }
    getProjectOwnerDisplayNames(missingOwnerIds).then(setOwnerDisplayNames);
  }, [user?.id, projects, profiles]);

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    Object.assign(m, ownerDisplayNames);
    return m;
  }, [profiles, ownerDisplayNames]);

  const effectiveIsAdmin = isAdmin;

  // 권한 헬퍼: 시스템 관리자 / 프로젝트 소유자 / 편집 멤버
  const isProjectOwner = (p: Project) => !!user?.id && p.ownerId === user.id;
  const canManageProject = (p: Project) => effectiveIsAdmin || isProjectOwner(p);
  const canEditProject = (p: Project) => canManageProject(p) || myEditableProjectIds === undefined || myEditableProjectIds.includes(p.id);

  const taskCountByProject = useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach((p) => {
      m[p.id] = 0;
    });
    allTasks.forEach((t) => {
      if (t.projectId && m[t.projectId] !== undefined) m[t.projectId]++;
    });
    return m;
  }, [projects, allTasks]);

  // id 기준으로만 표시 (사용자별 복사본이 원본과 합쳐지지 않음)
  const uniqueProjects = useMemo(() => {
    const seen = new Set<string>();
    return projects.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [projects]);

  const sortedProjects = useMemo(() => {
    if (projectSort === 'default') return uniqueProjects;
    const copy = [...uniqueProjects];
    const dir = projectSort === 'task_asc' ? 1 : -1;
    copy.sort((a, b) => {
      const ac = taskCountByProject[a.id] ?? 0;
      const bc = taskCountByProject[b.id] ?? 0;
      if (ac !== bc) return (ac - bc) * dir;
      const nameCmp = a.name.localeCompare(b.name, 'ko');
      if (nameCmp !== 0) return nameCmp;
      return a.id.localeCompare(b.id);
    });
    return copy;
  }, [uniqueProjects, projectSort, taskCountByProject]);

  const ownerLabel = (ownerId: string | undefined) => {
    if (!ownerId) return '소유자 미지정';
    if (ownerId === user?.id) return '내 프로젝트';
    return profileMap[ownerId] ?? `사용자 (${ownerId.slice(0, 8)}…)`;
  };

  const sortedGroups = useMemo<ProjectGroup[]>(() => {
    const list = wbsSettings.projectGroups ?? [];
    return [...list].sort((a, b) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [wbsSettings.projectGroups]);

  const projectsGroupedByGroup = useMemo(() => {
    const map = new Map<string, Project[]>();
    sortedGroups.forEach((g) => map.set(g.id, []));
    map.set('__none__', []);
    for (const p of sortedProjects) {
      const k = p.groupId && map.has(p.groupId) ? p.groupId : '__none__';
      map.get(k)!.push(p);
    }
    return map;
  }, [sortedProjects, sortedGroups]);

  const projectsGroupedByOwner = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of sortedProjects) {
      const k = p.ownerId ?? '__none__';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    const entries = [...map.entries()] as [string, Project[]][];
    entries.sort(([ka], [kb]) => {
      if (user?.id && ka === user.id) return -1;
      if (user?.id && kb === user.id) return 1;
      if (ka === '__none__') return 1;
      if (kb === '__none__') return -1;
      return ownerLabel(ka === '__none__' ? undefined : ka).localeCompare(ownerLabel(kb === '__none__' ? undefined : kb), 'ko');
    });
    return entries;
  }, [sortedProjects, user?.id, profileMap]);

  const handleSaveProject = (
    name: string,
    description: string,
    startDate?: string,
    endDate?: string,
    assignments?: Project['assignments'],
    minWorkEffortDays?: number,
    reportCategory?: string,
    reportAgency?: string,
    reportBudgetThisYear?: string,
    reportTotalPeriod?: string,
    reportNameShort?: string,
    reportNameFull?: string,
  ) => {
    if (editingProject) {
      updateProject(editingProject.id, {
        name,
        description,
        startDate,
        endDate,
        assignments,
        minWorkEffortDays,
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
      });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, endDate, assignments, minWorkEffortDays, {
        reportCategory,
        reportAgency,
        reportBudgetThisYear,
        reportTotalPeriod,
        reportNameShort,
        reportNameFull,
      });
    }
    setIsProjectModalOpen(false);
  };

  const handleDeleteProject = () => {
    if (projectToDelete) {
      deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    }
    setIsDeleteConfirmOpen(false);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedProjectIds);
    ids.forEach((id) => deleteProject(id));
    setSelectedProjectIds(new Set());
    setIsBulkDeleteConfirmOpen(false);
    pushToast(`${ids.length}개 프로젝트가 삭제되었습니다.`, { variant: 'success' });
  };

  // 일괄 삭제 선택 가능한 프로젝트(소유자·관리자만)
  const manageableProjects = useMemo(() => uniqueProjects.filter((p) => canManageProject(p)), [uniqueProjects, effectiveIsAdmin, user?.id]);

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProjectIds.size >= manageableProjects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(manageableProjects.map((p) => p.id)));
    }
  };

  const handleOpenShare = (project: Project) => {
    setShareProjectId(project.id);
    setShareProjectName(project.name);
  };

  const selectZeroTaskProjects = () => {
    const emptyIds = manageableProjects.filter((p) => (taskCountByProject[p.id] ?? 0) === 0).map((p) => p.id);
    setSelectedProjectIds(new Set(emptyIds));
  };

  const handleNavigateToWork = (projectId?: string) => {
    if (projectId) setCurrentProjectId(projectId);
    onNavigateToWork?.(projectId);
  };

  const renderProjectCard = (project: Project) => {
    const canManage = canManageProject(project);
    const canEdit = canEditProject(project);
    return (
      <div
        key={project.id}
        role="button"
        tabIndex={0}
        className={cn(
          'bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden transition-all',
          'hover:shadow-md hover:border-stone-300 cursor-pointer',
        )}
        onDoubleClick={() => {
          if (!canEdit) return;
          setEditingProject(project);
          setIsProjectModalOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (!canEdit) return;
            e.preventDefault();
            setEditingProject(project);
            setIsProjectModalOpen(true);
          }
        }}
        title={canEdit ? '더블클릭: 편집' : '편집 권한이 없습니다'}
      >
        <div className="flex items-center gap-4 p-4">
          {manageableProjects.length > 1 && canManage && (
            <input
              type="checkbox"
              checked={selectedProjectIds.has(project.id)}
              onChange={() => {}}
              onClick={(e) => {
                e.stopPropagation();
                toggleProjectSelection(project.id);
              }}
              className="w-4 h-4 rounded border-stone-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)] shrink-0 cursor-pointer"
              title="다중 선택 (삭제 권한이 있는 프로젝트만 선택 가능)"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--color-ink)] truncate">{project.name}</span>
              {(taskCountByProject[project.id] ?? 0) > 0 && (
                <span className="text-xs text-stone-400 shrink-0">({taskCountByProject[project.id] ?? 0}개 작업)</span>
              )}
            </div>
            <span
              className="text-xs text-stone-400 truncate block mt-0.5"
              title={project.ownerId ? (profileMap[project.ownerId] ?? project.ownerId) : undefined}
            >
              소유(만든 사람):{' '}
              {loadingProfiles && project.ownerId && project.ownerId !== user?.id ? (
                <Loader2 size={14} className="inline-block align-middle animate-spin text-stone-400" />
              ) : (
                ownerLabel(project.ownerId)
              )}
            </span>
            {sortedGroups.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                <FolderOpen size={11} className="text-stone-300 shrink-0" />
                {canEdit ? (
                  <select
                    value={project.groupId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateProject(project.id, { groupId: val === '' ? undefined : val });
                    }}
                    className="text-[11px] text-stone-500 bg-transparent border border-stone-200 rounded px-1.5 py-0.5 hover:border-stone-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    title="그룹 선택"
                  >
                    <option value="">그룹 미지정</option>
                    {sortedGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-stone-400">
                    {sortedGroups.find((g) => g.id === project.groupId)?.name ?? '그룹 미지정'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => handleNavigateToWork(project.id)}
              className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[var(--color-accent)] transition-colors"
              title="작업 보기"
            >
              <List size={16} />
            </button>
            {canManage && (
              <button
                onClick={() => handleOpenShare(project)}
                className="p-2 rounded-lg text-stone-400 hover:bg-teal-50 hover:text-teal-600 transition-colors"
                title="공유"
              >
                <Share2 size={16} />
              </button>
            )}
            <button
              onClick={() => {
                copyProject(project.id);
                onNavigateToWork?.();
              }}
              className="p-2 rounded-lg text-stone-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
              title="프로젝트 복사: 내 프로젝트로 복사해 별도 수정"
            >
              <Copy size={16} />
            </button>
            {canEdit && (
              <button
                onClick={() => {
                  setEditingProject(project);
                  setIsProjectModalOpen(true);
                }}
                className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[var(--color-ink)] transition-colors"
                title="편집"
              >
                <Edit size={16} />
              </button>
            )}
            {uniqueProjects.length > 1 && canManage && (
              <button
                onClick={() => {
                  setProjectToDelete(project);
                  setIsDeleteConfirmOpen(true);
                }}
                className="p-2 rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="삭제"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
        {onNavigateToWork && (
          <button
            onClick={() => handleNavigateToWork(project.id)}
            className="w-full px-4 py-2 text-left text-xs font-medium text-stone-400 hover:bg-stone-50 hover:text-[var(--color-accent)] flex items-center gap-1 border-t border-stone-100"
          >
            작업 보기 <ChevronRight size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto bg-stone-50/50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)]">프로젝트 관리</h1>
            <p className="text-sm text-stone-500 mt-0.5">프로젝트를 생성·편집·공유·삭제할 수 있습니다.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {effectiveIsAdmin && (
              <button
                onClick={() => setIsGroupManagerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-stone-600 hover:text-stone-800 bg-white border border-stone-200 hover:border-stone-300 rounded-lg transition-colors"
                title="프로젝트 그룹 추가·이름변경·삭제·순서 변경"
              >
                <FolderCog size={14} /> 그룹 관리
              </button>
            )}
            <button
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              className="btn-primary flex items-center gap-2"
              title="새 프로젝트 생성"
            >
              <FolderPlus size={16} /> 새 프로젝트
            </button>
          </div>
        </div>

        {uniqueProjects.length > 0 && uniqueProjects.length < 2 && (
          <div className="flex items-center gap-2 mb-4">
            <label className="flex items-center gap-1.5 text-xs font-medium text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                checked={groupByOwner}
                onChange={(e) => setGroupByOwner(e.target.checked)}
                className="rounded border-stone-300 text-[var(--color-accent)]"
              />
              소유자별 그룹으로 보기
            </label>
          </div>
        )}

        {/* 툴바: 전체 선택 / 선택 삭제 (소유자·관리자만 다중 삭제 가능) */}
        {manageableProjects.length > 1 && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2 bg-white rounded-xl border border-stone-200 shadow-sm">
            <button
              onClick={toggleSelectAll}
              className="text-xs font-medium text-stone-500 hover:text-[var(--color-accent)]"
              title={effectiveIsAdmin ? '전체 프로젝트 선택' : '내가 만든 프로젝트만 선택됩니다'}
            >
              {selectedProjectIds.size >= manageableProjects.length ? '선택 해제' : '전체 선택'}
            </button>
            <button
              onClick={selectZeroTaskProjects}
              disabled={manageableProjects.every((p) => (taskCountByProject[p.id] ?? 0) > 0)}
              className={cn(
                'text-xs font-medium',
                manageableProjects.every((p) => (taskCountByProject[p.id] ?? 0) > 0)
                  ? 'text-stone-300 cursor-not-allowed'
                  : 'text-stone-500 hover:text-[var(--color-accent)]',
              )}
              title="작업이 0개인 프로젝트만 선택 (삭제 권한이 있는 항목 중)"
            >
              0개만 선택
            </button>
            <div className="h-4 w-px bg-stone-200/80" />
            <label className="flex items-center gap-1.5 text-xs font-medium text-stone-600 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={groupByOwner}
                onChange={(e) => setGroupByOwner(e.target.checked)}
                className="rounded border-stone-300 text-[var(--color-accent)]"
              />
              소유자별 그룹
            </label>
            <div className="h-4 w-px bg-stone-200/80" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-stone-400">정렬</span>
              <select
                value={projectSort}
                onChange={(e) => setProjectSort(e.target.value as ProjectSortKey)}
                className="px-2 py-1 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all"
                title="프로젝트 정렬"
              >
                <option value="default">기본</option>
                <option value="task_desc">작업 많은 순</option>
                <option value="task_asc">작업 적은 순</option>
              </select>
            </div>
            {selectedProjectIds.size > 0 && (
              <button
                onClick={() => setIsBulkDeleteConfirmOpen(true)}
                className="text-xs font-medium text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 size={12} /> 선택 삭제 ({selectedProjectIds.size}개)
              </button>
            )}
          </div>
        )}

        {/* 프로젝트 목록 */}
        <div className="space-y-2">
          {uniqueProjects.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
              <FolderPlus className="mx-auto text-stone-300 mb-4" size={48} />
              <p className="text-stone-500 font-medium">등록된 프로젝트가 없습니다.</p>
              <p className="text-sm text-stone-400 mt-1">새 프로젝트를 만들어 시작하세요.</p>
              <button onClick={() => setIsProjectModalOpen(true)} className="btn-primary mt-4">
                새 프로젝트 만들기
              </button>
            </div>
          ) : groupByOwner ? (
            <div className="space-y-8">
              {projectsGroupedByOwner.map(([ownerKey, list]) => (
                <section key={ownerKey}>
                  <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2 px-1 flex flex-wrap items-center gap-2 border-b border-stone-200/80 pb-2">
                    <span>{ownerLabel(ownerKey === '__none__' ? undefined : ownerKey)}</span>
                    <span className="font-normal text-stone-400 tabular-nums">프로젝트 {list.length}개</span>
                  </h2>
                  <div className="space-y-2">{list.map((p) => renderProjectCard(p))}</div>
                </section>
              ))}
            </div>
          ) : sortedGroups.length > 0 ? (
            <div className="space-y-6">
              {[...sortedGroups, { id: '__none__', name: '그룹 미지정' } as ProjectGroup].map((g) => {
                const list = projectsGroupedByGroup.get(g.id) ?? [];
                if (g.id === '__none__' && list.length === 0) return null;
                const collapsed = collapsedGroupIds.has(g.id);
                return (
                  <section key={g.id}>
                    <h2 className="mb-3 px-1 flex items-center gap-3 border-b border-stone-200/80 pb-2.5">
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(g.id)}
                        className="flex items-center gap-2 text-stone-800 hover:text-indigo-600"
                        aria-expanded={!collapsed}
                      >
                        {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                        <FolderOpen size={20} className={g.id === '__none__' ? 'text-stone-300' : 'text-amber-500'} />
                        <span className="text-base font-bold">{g.name}</span>
                      </button>
                      <span className="text-xs font-medium text-stone-400 tabular-nums">프로젝트 {list.length}개</span>
                    </h2>
                    {!collapsed &&
                      (list.length > 0 ? (
                        <div className="space-y-2 pl-1">{list.map((p) => renderProjectCard(p))}</div>
                      ) : (
                        <div className="text-xs text-stone-400 px-2 py-3">소속된 프로젝트가 없습니다.</div>
                      ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">{sortedProjects.map((p) => renderProjectCard(p))}</div>
          )}
        </div>
      </div>

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        onSave={handleSaveProject}
        project={editingProject}
        allProjects={projects}
      />
      <ShareModal
        isOpen={!!shareProjectId}
        onClose={() => {
          setShareProjectId(null);
          setShareProjectName(null);
        }}
        projectId={shareProjectId ?? undefined}
        projectName={shareProjectName ?? undefined}
        isOwner={projects.find((p) => p.id === shareProjectId)?.ownerId === user?.id}
        isAdmin={effectiveIsAdmin}
        profileMap={profileMap}
        profiles={profiles.map((p) => ({ id: p.id, full_name: p.full_name ?? null, email: p.email ?? null }))}
        ownerId={projects.find((p) => p.id === shareProjectId)?.ownerId}
      />
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setProjectToDelete(null);
        }}
        onConfirm={handleDeleteProject}
        title="프로젝트 삭제"
        message={projectToDelete ? `'${projectToDelete.name}' 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까?` : ''}
        confirmLabel="삭제"
        isDanger={true}
      />
      <ConfirmDialog
        isOpen={isBulkDeleteConfirmOpen}
        onClose={() => setIsBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        title="선택 프로젝트 일괄 삭제"
        message={`선택한 ${selectedProjectIds.size}개 프로젝트와 소속된 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="일괄 삭제"
        isDanger={true}
      />
      {isGroupManagerOpen && <ProjectGroupManagerModal isOpen onClose={() => setIsGroupManagerOpen(false)} />}
    </div>
  );
}
