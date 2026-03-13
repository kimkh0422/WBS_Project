import React, { useState, useEffect } from 'react';
import { Eye, Edit3, Loader2 } from 'lucide-react';
import {
  createProjectAccessRequest,
  getMyProjectAccessRequest,
  rerequestProjectAccess,
} from '../lib/db';
import type { ProjectAccessRequestRow } from '../lib/supabase';

interface ProjectAccessRequestBannerProps {
  projectId: string;
  projectName: string;
  onRequestSent?: () => void;
}

export function ProjectAccessRequestBanner({
  projectId,
  projectName,
  onRequestSent,
}: ProjectAccessRequestBannerProps) {
  const [request, setRequest] = useState<ProjectAccessRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyProjectAccessRequest(projectId)
      .then((r) => {
        if (!cancelled) setRequest(r ?? null);
      })
      .catch(() => {
        if (!cancelled) setRequest(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleRequest = async (role: 'viewer' | 'editor') => {
    setActionLoading(true);
    setError(null);
    try {
      const result = await createProjectAccessRequest(projectId, role);
      if (result.success) {
        setRequest({
          id: result.requestId!,
          project_id: projectId,
          user_id: '',
          requested_role: role,
          status: 'pending',
        });
        onRequestSent?.();
      } else {
        setError(result.error ?? '요청에 실패했습니다.');
      }
    } catch {
      setError('요청에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRerequest = async () => {
    if (!request?.id) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await rerequestProjectAccess(request.id);
      if (result.success) {
        setRequest((prev) => (prev ? { ...prev, status: 'pending' } : null));
        onRequestSent?.();
      } else {
        setError(result.error ?? '재요청에 실패했습니다.');
      }
    } catch {
      setError('재요청에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50/50">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center p-6 bg-slate-50/50">
      <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-700 mb-1">
          이 프로젝트의 내용을 보려면 권한이 필요합니다.
        </p>
        <p className="text-xs text-slate-500 mb-4">
          관리자 또는 프로젝트 소유자가 승인하면 내용을 볼 수 있습니다.
        </p>

        {error && (
          <p className="text-xs text-red-600 mb-3 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        {!request && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleRequest('viewer')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              보기 권한 요청
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleRequest('editor')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Edit3 size={14} />}
              편집 권한 요청
            </button>
          </div>
        )}

        {request?.status === 'pending' && (
          <p className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
            <strong>{request.requested_role === 'editor' ? '편집' : '보기'}</strong> 권한 요청 대기 중입니다. 승인 후 새로고침하면 내용을 볼 수 있습니다.
          </p>
        )}

        {request?.status === 'rejected' && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              요청이 거절되었습니다. 필요 시 다른 권한으로 다시 요청할 수 있습니다.
            </p>
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleRerequest}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              다시 요청
            </button>
          </div>
        )}

        <p className="text-[11px] text-slate-400 mt-4">
          프로젝트: {projectName}
        </p>
      </div>
    </div>
  );
}
