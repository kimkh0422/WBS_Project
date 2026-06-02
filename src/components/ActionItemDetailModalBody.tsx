import React from 'react';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import { formatPercent1, cn } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import type { Task, Project } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';

export function ActionItemDetailModalBody({
  task,
  projectMap,
  assigneeDisplayMetaByName,
  wbsSettings,
}: {
  task: Task;
  projectMap: Map<string, Project>;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
  wbsSettings: WBSSettings;
}) {
  const proj = projectMap.get(task.projectId);
  const sc = wbsSettings.statusConfigs.find((c) => c.id === task.status);
  const statusColor = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');

  const desc = (task.description || '').trim();
  const deliv = (task.deliverables || '').trim();
  const hasChecklist = (task.checklist?.length ?? 0) > 0;

  return (
    <div className="space-y-5 text-sm text-slate-700">
      <p className="text-base font-semibold text-slate-900 leading-snug break-words">{task.name || '(이름 없음)'}</p>

      <dl className="space-y-2">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400 shrink-0">프로젝트</dt>
          <dd className="text-right font-medium text-slate-800 break-words min-w-0">
            {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400 shrink-0">담당자</dt>
          <dd className="text-right break-words min-w-0">{formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName) || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400 shrink-0">기한날짜</dt>
          <dd className="tabular-nums text-slate-700">{task.endDate || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400 shrink-0">시작일</dt>
          <dd className="tabular-nums text-slate-700">{task.startDate || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 items-center">
          <dt className="text-slate-400 shrink-0">상태</dt>
          <dd>
            <span
              className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', statusColor.className, 'text-slate-700')}
              style={statusColor.style}
            >
              {sc?.name ?? task.status}
            </span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-400 shrink-0">진척률</dt>
          <dd className="tabular-nums font-semibold text-slate-800">
            {typeof task.progress === 'number' ? `${formatPercent1(task.progress)}%` : '—'}
          </dd>
        </div>
      </dl>

      {(desc || deliv || hasChecklist) && (
        <div className="border-t border-slate-200 pt-4 space-y-4">
          {desc && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">설명</h3>
              <div className="text-slate-800 whitespace-pre-wrap break-words leading-relaxed rounded-lg bg-slate-50/80 border border-slate-100 px-3 py-2.5">
                {desc}
              </div>
            </div>
          )}
          {deliv && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">산출물</h3>
              <div className="text-slate-800 whitespace-pre-wrap break-words leading-relaxed rounded-lg bg-slate-50/80 border border-slate-100 px-3 py-2.5">
                {deliv}
              </div>
            </div>
          )}
          {hasChecklist && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">체크리스트</h3>
              <ul className="space-y-1.5">
                {task.checklist!.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-slate-800">
                    <span className={cn('shrink-0 mt-0.5 text-xs font-mono', c.completed ? 'text-teal-600' : 'text-slate-400')}>
                      {c.completed ? '☑' : '☐'}
                    </span>
                    <span className={cn('break-words', c.completed && 'line-through text-slate-500')}>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
