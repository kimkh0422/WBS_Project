import React, { useState, useEffect } from 'react';
import { X, Edit3, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { getMyProjectAccessRequest, requestProjectEditorAccess } from '../lib/db';
import type { ProjectAccessRequestRow } from '../lib/supabase';

interface ProjectEditAccessRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** 요청 제출·갱신 후(토스트·편집 가능 목록 재조회 등) */
  onSubmitted?: (state: 'sent' | 'already_pending' | 'upgraded') => void;
}

export function ProjectEditAccessRequestModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  onSubmitted,
}: ProjectEditAccessRequestModalProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [request, setRequest] = useState<ProjectAccessRequestRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setError(null);
    let cancelled = false;
    setChecking(true);
    getMyProjectAccessRequest(projectId)
      .then((row) => {
        if (!cancelled) setRequest(row ?? null);
      })
      .catch(() => {
        if (!cancelled) setRequest(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await requestProjectEditorAccess(projectId);
      if (!result.success) {
        setError(result.error ?? '요청에 실패했습니다.');
        return;
      }
      const row = await getMyProjectAccessRequest(projectId);
      setRequest(row ?? null);
      if (result.state) onSubmitted?.(result.state);
    } catch {
      setError('요청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const pendingEditor = request?.status === 'pending' && request.requested_role === 'editor';
  const pendingViewer = request?.status === 'pending' && request.requested_role === 'viewer';

  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[60]')} onClick={onClose}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-md p-6')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
            <Edit3 size={18} />
            프로젝트 편집 권한 요청
          </h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        {checking ? (
          <div className="flex justify-center py-8 text-slate-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              이 프로젝트에서 작업을 추가·수정하려면 소유자·관리자가 <strong>회원 관리</strong>에서 승인해 주어야 합니다. 승인 시{' '}
              <strong>보기·편집</strong> 요청 모두 동일하게 표에서 편집할 수 있습니다. 아래는 그 승인을 요청하는 용도입니다.
            </p>
            <p
              className="text-xs text-slate-500 mb-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 truncate"
              title={projectName}
            >
              대상: {projectName}
            </p>

            {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}

            {pendingEditor ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <strong>편집</strong> 권한 요청이 <strong>대기 중</strong>입니다. 승인되면 편집 가능 프로젝트 목록이 갱신됩니다. 필요 시
                소유자에게 문의하세요.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                {pendingViewer && (
                  <p className="text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    현재 <strong>보기</strong> 권한으로 요청 중입니다. 승인만 되면 편집까지 가능합니다. 라벨을 <strong>편집</strong>으로
                    바꿔 요청하려면 아래 버튼을 누르세요.
                  </p>
                )}
                {request?.status === 'rejected' && (
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    이전 요청이 거절되었습니다. 다시 편집 권한을 요청할 수 있습니다.
                  </p>
                )}
                {request?.status === 'approved' && request.requested_role === 'viewer' && (
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                    보기로 요청했던 기록이 승인된 상태입니다. 멤버로 등록되어 있다면 이미 편집할 수 있습니다. 목록이 갱신되지 않으면
                    새로고침 해 보세요.
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    닫기
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                    {pendingViewer || (request?.status === 'approved' && request.requested_role === 'viewer')
                      ? '편집 권한으로 요청'
                      : '편집 권한 요청 보내기'}
                  </button>
                </div>
              </form>
            )}

            {pendingEditor && (
              <div className="flex justify-end mt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  닫기
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
