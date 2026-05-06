import React, { useState, useEffect } from 'react';
import { X, History, Loader2 } from 'lucide-react';
import { fetchAuditLog, type AuditLogEntry, type AuditAction } from '../lib/db';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface AuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null이면 권한 범위 내 전체 프로젝트 이력 조회 (관리자는 모든 이력) */
  projectId: string | null;
  projectName?: string;
  /** 전체 모드에서 프로젝트명 표시용 매핑 */
  projectNameMap?: Record<string, string>;
}

const ACTION_LABEL: Record<AuditAction, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제',
  bulk_update: '일괄 수정',
};

const ENTITY_LABEL: Record<AuditLogEntry['entity_type'], string> = {
  task: '작업',
  project: '프로젝트',
};

function formatChangeSummary(changes: unknown): string | null {
  if (changes == null) return null;
  if (typeof changes === 'object' && changes !== null && 'count' in changes) {
    const c = changes as { count?: number };
    return typeof c.count === 'number' ? `${c.count}개 항목` : null;
  }
  if (Array.isArray(changes) && changes.length > 0) {
    const fields = (changes as Array<{ field?: string }>).map((c) => c.field).filter(Boolean);
    return fields.length > 0 ? fields.join(', ') : null;
  }
  return null;
}

export function AuditLogModal({ isOpen, onClose, projectId, projectName, projectNameMap }: AuditLogModalProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const isAllMode = projectId === null;

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchAuditLog(projectId)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl border border-stone-200 w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-stone-500" />
            <h2 className="text-lg font-semibold text-stone-800">변경 이력</h2>
            {isAllMode ? (
              <span className="text-sm text-amber-700 font-medium">— 전체 프로젝트</span>
            ) : projectName ? (
              <span className="text-sm text-stone-500 truncate max-w-[200px]" title={projectName}>
                — {projectName}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto min-h-0 px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-stone-500">
              <Loader2 className="w-8 h-8 animate-spin mr-2" />
              <span>이력 불러오는 중…</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-stone-500 text-sm">기록된 변경 이력이 없습니다.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">일시</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">사용자</th>
                  {isAllMode && (
                    <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">프로젝트</th>
                  )}
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">구분</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">대상</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">작업</th>
                  <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wider">변경 내용</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const changeSummary = formatChangeSummary(entry.changes);
                  const createdAt = new Date(entry.created_at);
                  const createdAtFull = format(createdAt, 'yyyy.MM.dd HH:mm', { locale: ko });
                  const projectLabel = entry.project_id
                    ? (projectNameMap?.[entry.project_id] ?? `(${entry.project_id.slice(0, 8)}…)`)
                    : '—';
                  return (
                    <tr key={entry.id} className="border-b border-stone-100 hover:bg-stone-50/50">
                      <td className="py-2 px-2 text-stone-600 whitespace-nowrap" title={createdAtFull}>
                        {createdAtFull}
                      </td>
                      <td className="py-2 px-2 text-stone-700">{entry.user_display ?? '—'}</td>
                      {isAllMode && (
                        <td className="py-2 px-2 text-stone-700 max-w-[160px] truncate" title={projectLabel}>
                          {projectLabel}
                        </td>
                      )}
                      <td className="py-2 px-2 text-stone-600">{ENTITY_LABEL[entry.entity_type]}</td>
                      <td className="py-2 px-2 text-stone-700 max-w-[180px] truncate" title={entry.entity_name ?? undefined}>
                        {entry.entity_name ?? (entry.action === 'bulk_update' ? '—' : '—')}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={
                            entry.action === 'delete' ? 'text-red-600' : entry.action === 'create' ? 'text-green-600' : 'text-stone-700'
                          }
                        >
                          {ACTION_LABEL[entry.action]}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-stone-500 text-xs max-w-[160px] truncate" title={changeSummary ?? undefined}>
                        {changeSummary ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t border-stone-200 text-xs text-stone-400">
          누가 언제 무엇을 생성·수정·삭제했는지 표시합니다. 최근 100건까지 조회됩니다.
        </div>
      </div>
    </div>
  );
}
