import React, { useState, useEffect, useMemo } from 'react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { ProjectModal } from './ProjectModal';
import { ShareModal } from './ShareModal';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import {
  FolderPlus,
  Trash2,
  Edit,
  Share2,
  Copy,
  List,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Project } from '../types';
import { fetchProfiles, checkIsAdmin } from '../lib/db';

interface ProjectsPageProps {
  onNavigateToWork?: (projectId?: string) => void;
}

export function ProjectsPage({ onNavigateToWork }: ProjectsPageProps) {
  const { user } = useAuth();
  const { projects, allTasks, addProject, updateProject, deleteProject, copyProject, setCurrentProjectId } = useWBS();
  const { push: pushToast } = useToast();

  const [profiles, setProfiles] = useState<{ id: string; email: string | null; full_name?: string | null }[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [shareProjectName, setShareProjectName] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    checkIsAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    fetchProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [user?.id]);

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach(p => {
      const name = p.full_name && String(p.full_name).trim();
      m[p.id] = name || p.email || '(이메일 없음)';
    });
    return m;
  }, [profiles]);

  const effectiveIsAdmin = isAdmin;

  const taskCountByProject = useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach(p => { m[p.id] = 0; });
    allTasks.forEach(t => {
      if (t.projectId && m[t.projectId] !== undefined) m[t.projectId]++;
    });
    return m;
  }, [projects, allTasks]);

  const uniqueProjects = useMemo(() => {
    const byKey = new Map<string, Project>();
    for (const p of projects) {
      const key = `${p.name}::${p.ownerId ?? ''}`;
      const existing = byKey.get(key);
      const count = taskCountByProject[p.id] ?? 0;
      const existingCount = existing ? (taskCountByProject[existing.id] ?? 0) : 0;
      if (!existing || count > existingCount) byKey.set(key, p);
    }
    return Array.from(byKey.values());
  }, [projects, taskCountByProject]);

  const handleSaveProject = (name: string, description: string, startDate?: string, endDate?: string, assignments?: Project['assignments'], minWorkEffortDays?: number) => {
    if (editingProject) {
      updateProject(editingProject.id, { name, description, startDate, endDate, assignments, minWorkEffortDays });
      setEditingProject(null);
    } else {
      addProject(name, description, startDate, endDate, assignments, minWorkEffortDays);
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
    ids.forEach(id => deleteProject(id));
    setSelectedProjectIds(new Set());
    setIsBulkDeleteConfirmOpen(false);
    pushToast(`${ids.length}개 프로젝트가 삭제되었습니다.`, { variant: 'success' });
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProjectIds.size >= uniqueProjects.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(uniqueProjects.map(p => p.id)));
    }
  };

  const handleOpenShare = (project: Project) => {
    setShareProjectId(project.id);
    setShareProjectName(project.name);
  };

  const handleNavigateToWork = (projectId?: string) => {
    if (projectId) setCurrentProjectId(projectId);
    onNavigateToWork?.(projectId);
  };

  return (
    <div className="h-full overflow-auto bg-stone-50/50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)]">프로젝트 관리</h1>
            <p className="text-sm text-stone-500 mt-0.5">프로젝트를 생성·편집·공유·삭제할 수 있습니다.</p>
          </div>
          <button
            onClick={() => { setEditingProject(null); setIsProjectModalOpen(true); }}
            className="btn-primary flex items-center gap-2 shrink-0"
            title="새 프로젝트 생성"
          >
            <FolderPlus size={16} /> 새 프로젝트
          </button>
        </div>

        {/* 툴바: 전체 선택 / 선택 삭제 */}
        {uniqueProjects.length > 1 && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2 bg-white rounded-xl border border-stone-200 shadow-sm">
            <button
              onClick={toggleSelectAll}
              className="text-xs font-medium text-stone-500 hover:text-[var(--color-accent)]"
            >
              {selectedProjectIds.size >= uniqueProjects.length ? '선택 해제' : '전체 선택'}
            </button>
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
              <button
                onClick={() => setIsProjectModalOpen(true)}
                className="btn-primary mt-4"
              >
                새 프로젝트 만들기
              </button>
            </div>
          ) : (
            uniqueProjects.map(project => (
              <div
                key={project.id}
                className={cn(
                  "bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden transition-all",
                  "hover:shadow-md hover:border-stone-300"
                )}
              >
                <div className="flex items-center gap-4 p-4">
                  {uniqueProjects.length > 1 && (
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.has(project.id)}
                      onChange={() => {}}
                      onClick={(e) => { e.stopPropagation(); toggleProjectSelection(project.id); }}
                      className="w-4 h-4 rounded border-stone-300 text-[var(--color-accent)] focus:ring-[var(--color-accent)] shrink-0 cursor-pointer"
                      title="다중 선택"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)] truncate">{project.name}</span>
                      <span className="text-xs text-stone-400 shrink-0">({taskCountByProject[project.id] ?? 0}개 작업)</span>
                    </div>
                    {effectiveIsAdmin && project.ownerId && (
                      <span className="text-xs text-stone-400 truncate block mt-0.5" title={profileMap[project.ownerId] ?? project.ownerId}>
                        {project.ownerId === user?.id ? '내 프로젝트' : (profileMap[project.ownerId] ?? '(알 수 없음)')}
                      </span>
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
                    <button
                      onClick={() => handleOpenShare(project)}
                      className="p-2 rounded-lg text-stone-400 hover:bg-teal-50 hover:text-teal-600 transition-colors"
                      title="공유"
                    >
                      <Share2 size={16} />
                    </button>
                    <button
                      onClick={() => { copyProject(project.id); onNavigateToWork?.(); }}
                      className="p-2 rounded-lg text-stone-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                      title="프로젝트 복사: 내 프로젝트로 복사해 별도 수정"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      onClick={() => { setEditingProject(project); setIsProjectModalOpen(true); }}
                      className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[var(--color-ink)] transition-colors"
                      title="편집"
                    >
                      <Edit size={16} />
                    </button>
                    {uniqueProjects.length > 1 && (
                      <button
                        onClick={() => { setProjectToDelete(project); setIsDeleteConfirmOpen(true); }}
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
            ))
          )}
        </div>
      </div>

      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => { setIsProjectModalOpen(false); setEditingProject(null); }}
        onSave={handleSaveProject}
        project={editingProject}
      />
      <ShareModal
        isOpen={!!shareProjectId}
        onClose={() => { setShareProjectId(null); setShareProjectName(null); }}
        projectId={shareProjectId ?? undefined}
        projectName={shareProjectName ?? undefined}
        isOwner={projects.find(p => p.id === shareProjectId)?.ownerId === user?.id}
      />
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => { setIsDeleteConfirmOpen(false); setProjectToDelete(null); }}
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
    </div>
  );
}
