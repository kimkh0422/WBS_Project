import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { ExcelImportMeta } from '../lib/excel';
import type { Project } from '../types';

type ImportFilePreview = {
  fileName: string;
  taskCount: number;
  meta: ExcelImportMeta;
};

export const IMPORT_TARGET_NEW = '__new__';

interface ExcelImportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targetProjectId: string, newProjectName?: string) => void;
  totalTaskCount: number;
  files: ImportFilePreview[];
  projects: Project[];
  currentProjectId: string;
}

const colToLetter = (n: number) => {
  if (n < 0) return '-';
  let x = n + 1;
  let s = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

const colRangeLabel = (indices?: number[], fallback?: number) => {
  const cols = (Array.isArray(indices) && indices.length > 0)
    ? [...indices].filter(n => n >= 0).sort((a, b) => a - b)
    : (typeof fallback === 'number' && fallback >= 0 ? [fallback] : []);
  if (cols.length === 0) return '-';
  if (cols.length === 1) return `${colToLetter(cols[0])} (${cols[0] + 1})`;
  return `${colToLetter(cols[0])}~${colToLetter(cols[cols.length - 1])} (${cols[0] + 1}~${cols[cols.length - 1] + 1})`;
};

export function ExcelImportPreviewModal({
  isOpen,
  onClose,
  onConfirm,
  totalTaskCount,
  files,
  projects,
  currentProjectId,
}: ExcelImportPreviewModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const effectiveCurrent = currentProjectId === 'all' ? (projects[0]?.id ?? '') : currentProjectId;
  const [targetProjectId, setTargetProjectId] = useState<string>(effectiveCurrent || IMPORT_TARGET_NEW);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => confirmButtonRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setOpenFiles(prev => {
      const next: Record<string, boolean> = { ...prev };
      for (const f of files) {
        if (next[f.fileName] === undefined) next[f.fileName] = files.length === 1;
      }
      return next;
    });
  }, [isOpen, files]);

  useEffect(() => {
    if (!isOpen) return;
    const next = effectiveCurrent || IMPORT_TARGET_NEW;
    setTargetProjectId(prev => (projects.some(p => p.id === prev) ? prev : next));
    setNewProjectName(prev => prev || `가져온 프로젝트 (${new Date().toLocaleDateString('ko-KR')})`);
  }, [isOpen, effectiveCurrent, projects]);

  const hasAnyUnmapped = useMemo(() => {
    return files.some(f => f.meta.unmappedHeaders.length > 0);
  }, [files]);

  if (!isOpen) return null;

  const effortTooltip =
    '공수(MD)는 1인 1일 기준입니다. 엑셀에 공수 값이 없으면 시작~종료의 근무일수(주말 제외, 양끝 포함)로 자동 산정됩니다.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="text-emerald-600" size={18} />
            <h2 className="text-lg font-bold text-[var(--color-ink)]">데이터 가져오기</h2>
            {hasAnyUnmapped && (
              <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <AlertTriangle size={12} /> 일부 컬럼 미매칭
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-auto">
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              총 <span className="font-bold">{totalTaskCount.toLocaleString()}</span>개의 작업을 가져옵니다.
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">덮어쓸 프로젝트</label>
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (기존 덮어쓰기)
                  </option>
                ))}
                <option value={IMPORT_TARGET_NEW}>+ 새 프로젝트 생성</option>
              </select>
              {targetProjectId === IMPORT_TARGET_NEW && (
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="프로젝트 이름"
                  className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              )}
            </div>
            <div className="text-[12px] text-slate-500">
              아래는 엑셀 컬럼이 앱 필드로 어떻게 매칭되었는지의 자동 감지 결과입니다.
            </div>
            <div className="mt-2 inline-flex items-center gap-2 text-[12px] text-slate-600 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">
              <Info size={14} className="text-slate-500" />
              <span title={effortTooltip} className="cursor-help">
                공수(MD) 안내: 미입력 시 기간(근무일수, 주말 제외)로 자동 산정됩니다.
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {files.map((f) => {
              const isExpanded = !!openFiles[f.fileName];
              const sheet = f.meta.sheetName || '-';
              const headerRowNo = (f.meta.headerRowIndex ?? 0) + 1;
              return (
                <div key={f.fileName} className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFiles(prev => ({ ...prev, [f.fileName]: !isExpanded }))}
                    className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-left min-w-0">
                      {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{f.fileName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          시트 <span className="font-semibold text-slate-700">{sheet}</span> · 헤더 {headerRowNo}행 · 작업 {f.taskCount.toLocaleString()}개 · 인식 방식 {f.meta.mode === 'known' ? '정규(내보내기 포맷)' : '자동(스마트)'}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 shrink-0">
                      매칭 {f.meta.mapped.filter(m => m.columnIndex >= 0).length}/{f.meta.mapped.length}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                        <div className="grid grid-cols-12 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <div className="col-span-3 px-3 py-2">앱 필드</div>
                          <div className="col-span-7 px-3 py-2 border-l border-slate-200">엑셀 컬럼</div>
                          <div className="col-span-2 px-3 py-2 border-l border-slate-200 text-right">열</div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {f.meta.mapped.map((m) => {
                            const ok = m.columnIndex >= 0 && String(m.header ?? '').trim();
                            return (
                              <div key={m.fieldId} className="grid grid-cols-12 text-sm">
                                <div className="col-span-3 px-3 py-2 font-semibold text-slate-700 flex items-center gap-1.5">
                                  <span>{m.fieldLabel}</span>
                                  {m.fieldId === 'workEffort' && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full cursor-help"
                                      title={effortTooltip}
                                    >
                                      <Info size={12} className="text-slate-500" />
                                      MD
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-7 px-3 py-2 border-l border-slate-200">
                                  <span className={cn("font-medium", ok ? "text-slate-800" : "text-red-600")}>
                                    {ok ? m.header : '미매칭'}
                                  </span>
                                  {m.note && (
                                    <span className="ml-2 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                                      {m.note}
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-2 px-3 py-2 border-l border-slate-200 text-right font-mono text-[12px] text-slate-600">
                                  {colRangeLabel(m.columnIndices, m.columnIndex)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {f.meta.unmappedHeaders.length > 0 && (
                        <div className="mt-3 text-[12px] text-slate-600">
                          <div className="font-bold text-slate-700 mb-1">미사용(미매칭) 엑셀 컬럼</div>
                          <div className="flex flex-wrap gap-1.5">
                            {f.meta.unmappedHeaders.slice(0, 24).map((u) => (
                              <span key={`${u.columnIndex}-${u.header}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                                {u.header} <span className="font-mono text-[10px] text-slate-400">{colToLetter(u.columnIndex)}</span>
                              </span>
                            ))}
                            {f.meta.unmappedHeaders.length > 24 && (
                              <span className="text-[11px] text-slate-400">+{f.meta.unmappedHeaders.length - 24}개</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <form
          className="flex justify-end gap-3 p-5 border-t border-slate-100 bg-slate-50/30"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(targetProjectId, targetProjectId === IMPORT_TARGET_NEW ? newProjectName : undefined);
            onClose();
          }}
        >
          <button type="button" onClick={onClose} className="btn-ghost">취소</button>
          <button ref={confirmButtonRef} type="submit" className="btn-primary">
            가져오기
          </button>
        </form>
      </div>
    </div>
  );
}

