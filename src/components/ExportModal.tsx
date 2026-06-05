import React, { useState, useEffect } from 'react';
import { X, Download, FileSpreadsheet, FileJson, FileText, Table } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import type { Project, Task } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import { formatProjectDisplayName } from '../lib/projectKind';
import { isProjectMineForUserListFilter } from '../lib/projectMineFilter';

/** 헤더가 전체(`all`)일 때 등 — 「프로젝트 선택」 시 기본으로 체크할 프로젝트 */
function resolveDefaultExportProjectIds(projects: Project[], currentProjectId: string | undefined): string[] {
  if (projects.length === 0) return [];
  const inList = (id: string) => projects.some((p) => p.id === id);
  if (currentProjectId && inList(currentProjectId)) return [currentProjectId];
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('wbs-current-project') ?? window.sessionStorage.getItem('wbs-current-project');
      if (saved && saved !== 'all' && inList(saved)) return [saved];
    }
  } catch {
    /* ignore */
  }
  return projects[0]?.id ? [projects[0].id] : [];
}

export type ExportScope = 'all' | 'selected';
export type ExportFormat = 'excel' | 'json' | 'markdown' | 'csv';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  allTasks: Task[];
  selectedProjectIds: string[];
  onSelectedProjectIdsChange: (ids: string[]) => void;
  wbsMap: Map<string, string>;
  wbsSettings: WBSSettings;
  /** 로그인 사용자 ID. 있으면 「내 프로젝트」 빠른 선택에 사용 */
  currentUserId?: string;
  /** 프로필 본명. PM 이름과 일치하는 프로젝트도 「내 프로젝트」에 포함 */
  currentUserPlainName?: string;
  currentProjectId?: string;
  onExport: (params: { scope: ExportScope; formats: ExportFormat[]; projectIds: string[] }) => void;
}

export function ExportModal({
  isOpen,
  onClose,
  projects,
  allTasks,
  selectedProjectIds,
  onSelectedProjectIdsChange,
  wbsSettings,
  currentUserId,
  currentUserPlainName = '',
  currentProjectId,
  onExport,
}: ExportModalProps) {
  const [scope, setScope] = useState<ExportScope>('all');
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>(['excel']);
  const prevOpenScopeRef = React.useRef<{ open: boolean; scope: ExportScope } | null>(null);
  /** 프로젝트 선택 모드에서 한 번이라도 체크가 있었는지(사용자가 전부 해제한 뒤 자동 재선택 방지) */
  const selectedModeHadNonEmptyRef = React.useRef(false);

  // 모달이 열릴 때 기본은 전보내기(모든 프로젝트·작업)
  useEffect(() => {
    if (!isOpen) return;
    setScope('all');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      selectedModeHadNonEmptyRef.current = false;
      return;
    }
    if (scope === 'all') {
      selectedModeHadNonEmptyRef.current = false;
      return;
    }
    if (selectedProjectIds.length > 0) selectedModeHadNonEmptyRef.current = true;
  }, [isOpen, scope, selectedProjectIds]);

  // 모달 열 때/범위 변경 시 선택 초기화
  useEffect(() => {
    if (!isOpen) {
      prevOpenScopeRef.current = null;
      return;
    }
    if (scope === 'all') {
      onSelectedProjectIdsChange(projects.map((p) => p.id));
      prevOpenScopeRef.current = { open: true, scope: 'all' };
      return;
    }
    const prev = prevOpenScopeRef.current;
    const shouldInitSelection = !prev || prev.scope === 'all';
    prevOpenScopeRef.current = { open: true, scope: 'selected' };
    if (shouldInitSelection) {
      onSelectedProjectIdsChange(resolveDefaultExportProjectIds(projects, currentProjectId));
    }
  }, [isOpen, scope, projects, currentProjectId, onSelectedProjectIdsChange]);

  // 「전체→선택」 직후 목록이 비어 있다가 로드되는 경우 기본 프로젝트 채움
  useEffect(() => {
    if (!isOpen || scope !== 'selected' || projects.length === 0) return;
    if (selectedProjectIds.length > 0) return;
    if (selectedModeHadNonEmptyRef.current) return;
    const next = resolveDefaultExportProjectIds(projects, currentProjectId);
    if (next.length > 0) onSelectedProjectIdsChange(next);
  }, [isOpen, scope, projects, currentProjectId, selectedProjectIds.length, onSelectedProjectIdsChange]);

  const toggleProject = (id: string) => {
    if (selectedProjectIds.includes(id)) {
      onSelectedProjectIdsChange(selectedProjectIds.filter((x) => x !== id));
    } else {
      onSelectedProjectIdsChange([...selectedProjectIds, id]);
    }
  };

  const selectAllProjects = () => {
    onSelectedProjectIdsChange(projects.map((p) => p.id));
  };

  const favoriteIdSet = React.useMemo(() => new Set(wbsSettings.favoriteProjectIds ?? []), [wbsSettings.favoriteProjectIds]);

  const myProjectIds = React.useMemo(
    () =>
      currentUserId ? projects.filter((p) => isProjectMineForUserListFilter(p, currentUserId, currentUserPlainName)).map((p) => p.id) : [],
    [projects, currentUserId, currentUserPlainName],
  );

  const favoriteProjectIdsInList = React.useMemo(
    () => projects.filter((p) => favoriteIdSet.has(p.id)).map((p) => p.id),
    [projects, favoriteIdSet],
  );

  const selectMyProjectsOnly = () => {
    onSelectedProjectIdsChange(myProjectIds);
  };

  const selectFavoritesOnly = () => {
    onSelectedProjectIdsChange(favoriteProjectIdsInList);
  };

  const taskCountByProject = React.useMemo(() => {
    const m: Record<string, number> = {};
    projects.forEach((p) => {
      m[p.id] = 0;
    });
    allTasks.forEach((t) => {
      if (t.projectId && m[t.projectId] !== undefined) m[t.projectId]++;
    });
    return m;
  }, [projects, allTasks]);

  const canExport = (scope === 'all' || selectedProjectIds.length > 0) && selectedFormats.length > 0;

  const toggleFormat = (format: ExportFormat) => {
    setSelectedFormats((prev) => (prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]));
  };

  const selectAllFormats = () => {
    setSelectedFormats(['excel', 'json', 'markdown', 'csv']);
  };

  const handleExport = () => {
    if (!canExport) return;
    const projectIds = scope === 'all' ? projects.map((p) => p.id) : selectedProjectIds;
    onExport({ scope, formats: selectedFormats, projectIds });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md overflow-hidden')}>
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Download size={20} className="text-[var(--color-accent)]" />
            <h2 className="text-lg font-bold text-[var(--color-ink)]">내보내기</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 범위 선택 */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">내보낼 범위</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={cn(
                  'flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border transition-all',
                  scope === 'all'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                전체
              </button>
              <button
                type="button"
                onClick={() => setScope('selected')}
                className={cn(
                  'flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border transition-all',
                  scope === 'selected'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                프로젝트 선택
              </button>
            </div>
          </div>

          {/* 프로젝트 선택 (scope가 selected일 때) */}
          {scope === 'selected' && (
            <div>
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-600 shrink-0">선택할 프로젝트</label>
                <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs sm:max-w-[70%] sm:text-right">
                  <button type="button" onClick={selectAllProjects} className="text-[var(--color-accent)] hover:underline">
                    전체 선택
                  </button>
                  {currentUserId && (
                    <>
                      <span className="text-slate-300 select-none" aria-hidden>
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={selectMyProjectsOnly}
                        disabled={myProjectIds.length === 0}
                        title={
                          myProjectIds.length === 0
                            ? '소유·PM(본인 이름) 일치 프로젝트가 목록에 없습니다'
                            : '내가 소유하거나 PM인 프로젝트만 체크'
                        }
                        className="text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        내 프로젝트
                      </button>
                    </>
                  )}
                  {favoriteIdSet.size > 0 && (
                    <>
                      <span className="text-slate-300 select-none" aria-hidden>
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={selectFavoritesOnly}
                        disabled={favoriteProjectIdsInList.length === 0}
                        title={
                          favoriteProjectIdsInList.length === 0
                            ? '관심으로 지정한 프로젝트가 현재 목록에 없습니다'
                            : '관심(즐겨찾기) 프로젝트만 체크'
                        }
                        className="text-[var(--color-accent)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        관심만
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50/50">
                {projects.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2 text-center">프로젝트가 없습니다.</p>
                ) : (
                  projects.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-white transition-colors',
                        selectedProjectIds.includes(p.id) && 'bg-indigo-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 flex-1 break-words">{formatProjectDisplayName(p.name, p.projectKind)}</span>
                      <span className="text-xs text-slate-400 tabular-nums">{taskCountByProject[p.id] ?? 0}개</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 파일 형식 선택 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-600">파일 형식</label>
              <button type="button" onClick={selectAllFormats} className="text-xs text-[var(--color-accent)] hover:underline">
                전체 선택
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleFormat('excel')}
                className={cn(
                  'flex-1 min-w-0 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all',
                  selectedFormats.includes('excel')
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                <FileSpreadsheet size={18} />
                <span className="text-sm font-medium">Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFormat('json')}
                className={cn(
                  'flex-1 min-w-0 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all',
                  selectedFormats.includes('json')
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                <FileJson size={18} />
                <span className="text-sm font-medium">JSON (.json)</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFormat('markdown')}
                className={cn(
                  'flex-1 min-w-0 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all',
                  selectedFormats.includes('markdown')
                    ? 'bg-slate-100 text-slate-800 border-slate-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                <FileText size={18} />
                <span className="text-sm font-medium">Markdown (.md)</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFormat('csv')}
                className={cn(
                  'flex-1 min-w-0 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-all',
                  selectedFormats.includes('csv')
                    ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                <Table size={18} />
                <span className="text-sm font-medium">CSV (.csv)</span>
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {selectedFormats.length === 1 && selectedFormats[0] === 'excel' && '엑셀에서 편집 후 다시 가져올 수 있습니다.'}
              {selectedFormats.length === 1 && selectedFormats[0] === 'json' && '프로젝트·작업·설정을 백업 형식으로 저장합니다.'}
              {selectedFormats.length === 1 && selectedFormats[0] === 'markdown' && '문서·위키에 붙여넣기 좋은 마크다운 형식입니다.'}
              {selectedFormats.length === 1 && selectedFormats[0] === 'csv' && '범용 CSV 형식으로 Excel·스프레드시트에서 열 수 있습니다.'}
              {selectedFormats.length > 1 && '선택한 모든 형식으로 내보내기가 진행됩니다.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-slate-100 bg-slate-50/30">
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={!canExport}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
