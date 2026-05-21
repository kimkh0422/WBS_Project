import React, { useState, useEffect } from 'react';
import { X, Download, FileSpreadsheet, FileJson, FileText, Table } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import type { Project, Task } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import { formatProjectDisplayName } from '../lib/projectKind';

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
  currentProjectId,
  onExport,
}: ExportModalProps) {
  const [scope, setScope] = useState<ExportScope>('all');
  const [selectedFormats, setSelectedFormats] = useState<ExportFormat[]>(['excel']);

  // 모달이 열릴 때 기본 범위/선택을 현재 프로젝트 기준으로 세팅
  useEffect(() => {
    if (!isOpen) return;
    // 현재 프로젝트가 있으면 기본은 "프로젝트 선택"
    if (currentProjectId && projects.some((p) => p.id === currentProjectId)) {
      setScope('selected');
    } else {
      setScope('all');
    }
  }, [isOpen, currentProjectId, projects]);

  // 모달 열 때/범위 변경 시 선택 초기화
  useEffect(() => {
    if (!isOpen) return;
    if (scope === 'all') {
      onSelectedProjectIdsChange(projects.map((p) => p.id));
    } else {
      // 프로젝트 선택: 현재 프로젝트가 있으면 그대로, 없으면 빈 배열
      const currentValid = currentProjectId && projects.some((p) => p.id === currentProjectId);
      onSelectedProjectIdsChange(currentValid ? [currentProjectId] : []);
    }
  }, [isOpen, scope]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
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
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
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
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-slate-600">선택할 프로젝트</label>
                <button type="button" onClick={selectAllProjects} className="text-xs text-[var(--color-accent)] hover:underline">
                  전체 선택
                </button>
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
                        selectedProjectIds.includes(p.id) && 'bg-blue-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
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
