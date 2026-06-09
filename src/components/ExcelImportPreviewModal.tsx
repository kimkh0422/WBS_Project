import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, FileSpreadsheet, Info, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { ExcelImportMeta, type ExcelImportFieldId } from '../lib/excel';
import type { Project } from '../types';
import { formatProjectDisplayName } from '../lib/projectKind';
import { ConfirmDialog } from './ConfirmDialog';

type ImportFilePreview = {
  fileName: string;
  taskCount: number;
  meta: ExcelImportMeta;
  /** 사용자가 미사용 컬럼을 사용자 정의 컬럼으로 추가한 항목들(columnIndex 기준 매칭) */
  customColumns: Array<{ id: string; name: string; columnIndex: number }>;
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
  /** 사용자가 미리보기 행에서 직접 엑셀 컬럼을 골랐을 때 호출 */
  onMappingChange?: (fileIndex: number, fieldId: ExcelImportFieldId, columnIndex: number) => void;
  /** 사용자가 미사용 컬럼 chip을 클릭해 사용자 정의 컬럼으로 추가/해제 토글 */
  onCustomColumnToggle?: (fileIndex: number, header: string, columnIndex: number) => void;
  /** "모두 추가/해제"처럼 파일의 사용자 정의 컬럼을 한 번에 set — 연속 토글 시의 stale state 문제 회피 */
  onCustomColumnsSet?: (fileIndex: number, items: Array<{ header: string; columnIndex: number }>) => void;
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
  const cols =
    Array.isArray(indices) && indices.length > 0
      ? [...indices].filter((n) => n >= 0).sort((a, b) => a - b)
      : typeof fallback === 'number' && fallback >= 0
        ? [fallback]
        : [];
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
  onMappingChange,
  onCustomColumnToggle,
  onCustomColumnsSet,
}: ExcelImportPreviewModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const effectiveCurrent = currentProjectId === 'all' ? (projects[0]?.id ?? '') : currentProjectId;
  const [targetProjectId, setTargetProjectId] = useState<string>(effectiveCurrent || IMPORT_TARGET_NEW);
  const [newProjectName, setNewProjectName] = useState('');
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    isOpen: boolean;
    targetProjectId: string;
    newProjectName?: string;
  }>({ isOpen: false, targetProjectId: '' });

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
    setOpenFiles((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const f of files) {
        if (next[f.fileName] === undefined) next[f.fileName] = files.length === 1;
      }
      return next;
    });
  }, [isOpen, files]);

  // 모달이 열릴 때 덮어쓸 프로젝트를 현재 보고 있는 프로젝트로 디폴트 설정
  useEffect(() => {
    if (!isOpen) return;
    const defaultProjectId = effectiveCurrent || IMPORT_TARGET_NEW;
    setTargetProjectId(defaultProjectId);
    setNewProjectName((prev) => prev || `가져온 프로젝트 (${new Date().toLocaleDateString('ko-KR')})`);
  }, [isOpen, effectiveCurrent, projects]);

  const hasAnyUnmapped = useMemo(() => {
    return files.some((f) => f.meta.unmappedHeaders.length > 0);
  }, [files]);

  if (!isOpen) return null;

  const effortTooltip =
    '공수(MD)는 1인 1일 기준입니다. 엑셀에 공수 값이 없으면 시작~종료의 근무일수(주말 제외, 양끝 포함)로 자동 산정됩니다.';

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-3xl overflow-hidden')}>
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
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatProjectDisplayName(p.name, p.projectKind)} (기존 덮어쓰기)
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
                  className="mt-2 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              )}
            </div>
            <div className="text-[12px] text-slate-500">아래는 엑셀 컬럼이 앱 필드로 어떻게 매칭되었는지의 자동 감지 결과입니다.</div>
            <div className="mt-2 inline-flex items-center gap-2 text-[12px] text-slate-600 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg">
              <Info size={14} className="text-slate-500" />
              <span title={effortTooltip} className="cursor-help">
                공수(MD) 안내: 미입력 시 기간(근무일수, 주말 제외)로 자동 산정됩니다.
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {files.map((f, fileIndex) => {
              const isExpanded = !!openFiles[f.fileName];
              const sheet = f.meta.sheetName || '-';
              const headerRowNo = (f.meta.headerRowIndex ?? 0) + 1;
              // select 옵션: 헤더가 비어있지 않은 컬럼만 노출 (정렬은 컬럼 인덱스 순)
              const headerOptions = f.meta.headerRow.map((h, i) => ({ value: i, label: String(h ?? '').trim() })).filter((o) => o.label);
              return (
                <div key={f.fileName} className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFiles((prev) => ({ ...prev, [f.fileName]: !isExpanded }))}
                    className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-left min-w-0">
                      {isExpanded ? (
                        <ChevronDown size={16} className="text-slate-400" />
                      ) : (
                        <ChevronRight size={16} className="text-slate-400" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{f.fileName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          시트 <span className="font-semibold text-slate-700">{sheet}</span> · 헤더 {headerRowNo}행 · 작업{' '}
                          {f.taskCount.toLocaleString()}개 · 인식 방식 {f.meta.mode === 'known' ? '정규(내보내기 포맷)' : '자동(스마트)'}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 shrink-0">
                      매칭 {f.meta.mapped.filter((m) => m.columnIndex >= 0).length}/{f.meta.mapped.length}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                        <div className="grid grid-cols-12 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <div className="col-span-3 px-3 py-2">앱 필드</div>
                          <div className="col-span-9 px-3 py-2 border-l border-slate-200">엑셀 컬럼 매핑</div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {f.meta.mapped.map((m) => {
                            const ok = m.columnIndex >= 0 && String(m.header ?? '').trim();
                            const hasMultiCols = Array.isArray(m.columnIndices) && m.columnIndices.length > 1;
                            return (
                              <div key={m.fieldId} className="grid grid-cols-12 text-sm items-center">
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
                                <div className="col-span-9 px-3 py-2 border-l border-slate-200 flex flex-wrap items-center gap-2">
                                  {onMappingChange ? (
                                    <select
                                      value={m.columnIndex >= 0 ? m.columnIndex : -1}
                                      onChange={(e) => onMappingChange(fileIndex, m.fieldId, Number(e.target.value))}
                                      className={cn(
                                        'text-xs border rounded px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 max-w-full',
                                        ok ? 'border-slate-200 text-slate-800' : 'border-red-300 text-red-600',
                                      )}
                                    >
                                      <option value={-1}>(매핑 안 함)</option>
                                      {headerOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {colToLetter(o.value)} ({o.value + 1}) — {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className={cn('font-medium', ok ? 'text-slate-800' : 'text-red-600')}>
                                      {ok ? `${colToLetter(m.columnIndex)} (${m.columnIndex + 1}) — ${m.header}` : '미매칭'}
                                    </span>
                                  )}
                                  {hasMultiCols && (
                                    <span className="text-[10px] font-mono text-slate-500">
                                      다중: {colRangeLabel(m.columnIndices, m.columnIndex)}
                                    </span>
                                  )}
                                  {m.note && (
                                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                                      {m.note}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {f.meta.unmappedHeaders.length > 0 && (
                        <div className="mt-3 text-[12px] text-slate-600">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="font-bold text-slate-700">
                              미사용(미매칭) 엑셀 컬럼
                              {onCustomColumnToggle && (
                                <span className="ml-2 font-normal text-[11px] text-slate-500">
                                  · 클릭하면 사용자 정의 컬럼으로 추가됩니다
                                </span>
                              )}
                            </div>
                            {onCustomColumnsSet &&
                              f.meta.unmappedHeaders.length > 1 &&
                              (() => {
                                const addedCols = new Set(f.customColumns.map((c) => c.columnIndex));
                                const allAdded = f.meta.unmappedHeaders.every((u) => addedCols.has(u.columnIndex));
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // 모두 추가/해제: 한 번의 콜백으로 파일의 customColumns 전체를 set (연속 토글 시 stale state 회피)
                                      const removeCols = new Set(f.meta.unmappedHeaders.map((u) => u.columnIndex));
                                      if (allAdded) {
                                        // 미사용 헤더에 해당하는 항목만 제거(다른 경로로 추가된 항목은 유지)
                                        const next = f.customColumns
                                          .filter((c) => !removeCols.has(c.columnIndex))
                                          .map((c) => ({ header: c.name, columnIndex: c.columnIndex }));
                                        onCustomColumnsSet(fileIndex, next);
                                      } else {
                                        // 기존 항목 + 아직 안 추가된 미사용 헤더를 모두 추가
                                        const next = [...f.customColumns.map((c) => ({ header: c.name, columnIndex: c.columnIndex }))];
                                        for (const u of f.meta.unmappedHeaders) {
                                          if (!addedCols.has(u.columnIndex)) next.push({ header: u.header, columnIndex: u.columnIndex });
                                        }
                                        onCustomColumnsSet(fileIndex, next);
                                      }
                                    }}
                                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
                                  >
                                    {allAdded ? '모두 해제' : '모두 추가'}
                                  </button>
                                );
                              })()}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {f.meta.unmappedHeaders.slice(0, 24).map((u) => {
                              const isAdded = f.customColumns.some((c) => c.columnIndex === u.columnIndex);
                              if (onCustomColumnToggle) {
                                return (
                                  <button
                                    type="button"
                                    key={`${u.columnIndex}-${u.header}`}
                                    onClick={() => onCustomColumnToggle(fileIndex, u.header, u.columnIndex)}
                                    className={cn(
                                      'inline-flex items-center gap-1 text-[11px] font-semibold border px-2 py-0.5 rounded-full transition-colors',
                                      isAdded
                                        ? 'text-indigo-700 bg-indigo-50 border-indigo-300 hover:bg-indigo-100'
                                        : 'text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100',
                                    )}
                                    title={isAdded ? '사용자 정의 컬럼에서 제거' : '사용자 정의 컬럼으로 추가'}
                                  >
                                    {isAdded ? <Check size={11} /> : <Plus size={11} />}
                                    {u.header}
                                    <span className="font-mono text-[10px] text-slate-400">{colToLetter(u.columnIndex)}</span>
                                  </button>
                                );
                              }
                              return (
                                <span
                                  key={`${u.columnIndex}-${u.header}`}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full"
                                >
                                  {u.header} <span className="font-mono text-[10px] text-slate-400">{colToLetter(u.columnIndex)}</span>
                                </span>
                              );
                            })}
                            {f.meta.unmappedHeaders.length > 24 && (
                              <span className="text-[11px] text-slate-400">+{f.meta.unmappedHeaders.length - 24}개</span>
                            )}
                          </div>
                          {f.customColumns.length > 0 && (
                            <div className="mt-2 text-[11px] text-slate-500">
                              사용자 정의 컬럼 {f.customColumns.length}개 추가됨 — 가져오기 시 전역 표 설정에 등록되어 다른 프로젝트에서도
                              보입니다.
                            </div>
                          )}
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
            if (targetProjectId !== IMPORT_TARGET_NEW) {
              setOverwriteConfirm({
                isOpen: true,
                targetProjectId,
                newProjectName: undefined,
              });
              return;
            }
            onConfirm(targetProjectId, newProjectName);
            onClose();
          }}
        >
          <button type="button" onClick={onClose} className="btn-ghost">
            취소
          </button>
          <button ref={confirmButtonRef} type="submit" className="btn-primary">
            가져오기
          </button>
        </form>
      </div>

      <ConfirmDialog
        isOpen={overwriteConfirm.isOpen}
        onClose={() => setOverwriteConfirm((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          if (overwriteConfirm.targetProjectId) {
            onConfirm(overwriteConfirm.targetProjectId, overwriteConfirm.newProjectName);
            onClose();
          }
          setOverwriteConfirm({ isOpen: false, targetProjectId: '' });
        }}
        title="기존 프로젝트 덮어쓰기"
        message={
          overwriteConfirm.targetProjectId
            ? `기존 프로젝트 "${(() => {
                const tp = projects.find((p) => p.id === overwriteConfirm.targetProjectId);
                return tp ? formatProjectDisplayName(tp.name, tp.projectKind) : '선택한 프로젝트';
              })()}"을(를) 덮어쓸까요?\n기존 작업 데이터가 가져온 데이터로 대체됩니다.`
            : ''
        }
        confirmLabel="가져오기"
        isDanger={true}
      />
    </div>
  );
}
