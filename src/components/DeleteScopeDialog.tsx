import { AlertTriangle, X } from 'lucide-react';
import type { Project } from '../types';
import { ProjectNameLabel } from './ProjectNameLabel';

interface DeleteScopeDialogProps {
  currentProject: Project | undefined;
  userId: string | undefined;
  /** 프로젝트 삭제 권한(소유자·운영자) */
  realIsAdmin: boolean;
  canEditCurrentProject: boolean;
  deletableProjects: Project[];
  profileMap: Record<string, string>;
  onClose: () => void;
  onChooseDeleteAllProjects: () => void;
  onChooseDeleteProject: (project: Project) => void;
  onChooseDeleteCurrentTasks: () => void;
}

/**
 * 삭제 유형 선택 모달 — 전체 삭제(운영자) / 현재 프로젝트 삭제(소유자·운영자) /
 * 프로젝트 선택 삭제 / 현재 프로젝트 작업만 삭제(편집자).
 * App.tsx 인라인 IIFE에서 분리 — 동작 동일.
 */
export function DeleteScopeDialog({
  currentProject,
  userId,
  realIsAdmin,
  canEditCurrentProject,
  deletableProjects,
  profileMap,
  onClose,
  onChooseDeleteAllProjects,
  onChooseDeleteProject,
  onChooseDeleteCurrentTasks,
}: DeleteScopeDialogProps) {
  const isCurrentProjectOwner = !!currentProject && !!userId && currentProject.ownerId === userId;
  const canDeleteCurrentProject = !!currentProject && (realIsAdmin || isCurrentProjectOwner);
  const hasAnyOption =
    realIsAdmin || canDeleteCurrentProject || deletableProjects.length > 0 || (!!currentProject && canEditCurrentProject);
  return (
    <div className="modal-overlay">
      <div className="modal-content max-w-md">
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
              <AlertTriangle className="text-red-500" size={18} />
            </div>
            <h2 className="text-lg font-bold text-[var(--color-ink)]">삭제 유형 선택</h2>
          </div>
          <button onClick={onClose} className="icon-btn text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">삭제 방식을 선택하세요.</p>
          <div className="mt-4 space-y-2">
            {!hasAnyOption && (
              <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
                삭제 권한이 있는 항목이 없습니다. 본인이 만든 프로젝트만 삭제할 수 있어요.
              </div>
            )}
            {realIsAdmin && (
              <button
                type="button"
                onClick={onChooseDeleteAllProjects}
                className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
              >
                <span className="block font-semibold">
                  전체 삭제{' '}
                  <span className="text-[10px] font-bold uppercase ml-1 px-1.5 py-0.5 bg-red-200 text-red-800 rounded">관리자</span>
                </span>
                <span className="block text-xs text-red-600 mt-0.5">모든 프로젝트/작업을 삭제하고 '새 프로젝트'로 초기화합니다.</span>
              </button>
            )}
            {canDeleteCurrentProject && currentProject && (
              <button
                type="button"
                onClick={() => onChooseDeleteProject(currentProject)}
                className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors mt-3"
              >
                <span className="block font-semibold">현재 보고 있는 프로젝트 삭제</span>
                <span className="block text-xs text-red-600 mt-0.5">
                  '{currentProject.name}' 프로젝트와 소속된 모든 작업을 삭제합니다.
                  {realIsAdmin && currentProject.ownerId && (
                    <span className="block text-red-500/80 mt-0.5">
                      소유:{' '}
                      {currentProject.ownerId === userId
                        ? '내 프로젝트'
                        : currentProject.ownerId
                          ? (profileMap[currentProject.ownerId] ?? '다른 사용자')
                          : '소유자 없음'}
                    </span>
                  )}
                </span>
              </button>
            )}
            {deletableProjects.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500 mt-3">프로젝트 선택해서 삭제 {realIsAdmin ? '(전체)' : '(내 프로젝트)'}</p>
                {deletableProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onChooseDeleteProject(project)}
                    className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
                  >
                    <span className="block font-semibold">
                      <ProjectNameLabel project={project} name={project.name} />
                    </span>
                    <span className="block text-xs text-red-600 mt-0.5">
                      프로젝트와 소속된 모든 작업을 삭제합니다.
                      {realIsAdmin && project.ownerId && (
                        <span className="block text-red-500/80 mt-0.5">
                          소유:{' '}
                          {project.ownerId === userId
                            ? '내 프로젝트'
                            : project.ownerId
                              ? (profileMap[project.ownerId] ?? '다른 사용자')
                              : '소유자 없음'}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {currentProject && canEditCurrentProject && (
              <button
                type="button"
                onClick={onChooseDeleteCurrentTasks}
                className="w-full text-left px-4 py-3 rounded-xl border border-red-200 bg-red-50/80 hover:bg-red-100 text-red-700 font-medium text-sm transition-colors"
              >
                <span className="block font-semibold">현재 프로젝트 작업만 삭제</span>
                <span className="block text-xs text-red-600 mt-0.5">'{currentProject.name}'의 작업만 삭제하고 프로젝트는 유지합니다.</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-end p-5 border-t border-slate-100 bg-slate-50/30">
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
