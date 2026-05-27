import React, { useEffect } from 'react';
import { ChevronLeft, Building2, Briefcase, Users, ListChecks } from 'lucide-react';
import type { Task, Project } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import { cn, formatPercent1 } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import type { OrgMember } from '../data/organization';

export interface DivisionDetailStats {
  id: string;
  name: string;
  total: number;
  doneCount: number;
  issueCount: number;
  projectCount: number;
  /** 대시보드 집계에 포함된 프로젝트(그룹명→사업부 매칭), 표시명 가나다순 */
  registeredProjects: { id: string; label: string }[];
  progress: number;
  assigneeCount: number;
  /** 조직도에서 이 사업부에 매칭된 인원 수 */
  memberCount: number;
  /** 완료 처리되지 않은 작업 수 */
  inProgressCount: number;
}

interface DashboardDivisionDetailProps {
  stats: DivisionDetailStats;
  members: OrgMember[];
  projects: Project[];
  /** 해당 사업부 담당자 작업만, 종료일 순 */
  tasks: Task[];
  projectMap: Map<string, Project>;
  projectTaskCounts: Record<string, number>;
  wbsSettings: WBSSettings;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
  onBack: () => void;
  onOpenProjectTasks: (projectId: string) => void;
  /** 대시보드 투입 섹션으로 스크롤·이 사업부 소속 인원만 필터 */
  onOpenAllocationForDivision?: () => void;
  mobileReadabilityMode?: boolean;
}

const TASK_TABLE_LIMIT = 120;

function orgMemberLine(m: OrgMember): string {
  return [m.department, m.name, m.position]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

export function DashboardDivisionDetail({
  stats,
  members,
  projects,
  tasks,
  projectMap,
  projectTaskCounts,
  wbsSettings,
  assigneeDisplayMetaByName,
  onBack,
  onOpenProjectTasks,
  onOpenAllocationForDivision,
  mobileReadabilityMode = false,
}: DashboardDivisionDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const tableTasks = tasks.slice(0, TASK_TABLE_LIMIT);

  return (
    <div className={cn('animate-in fade-in duration-300', mobileReadabilityMode ? 'space-y-5' : 'space-y-8')}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:border-stone-300 transition-colors"
        >
          <ChevronLeft size={18} className="shrink-0" aria-hidden />
          사업부·부서별 현황
        </button>
        <span className="text-xs text-stone-400 hidden sm:inline">Esc로 목록</span>
      </div>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center">
            <Building2 className="text-sky-600" size={22} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1
              className={cn('font-bold text-[var(--color-ink)] tracking-tight break-words', mobileReadabilityMode ? 'text-xl' : 'text-2xl')}
            >
              {stats.name}
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              대시보드에 포함된 프로젝트 중, 프로젝트 그룹(부서명)이 이 사업부에 맞거나 이 사업부 소속 담당자 작업이 있는 항목을 모았습니다.
            </p>
          </div>
        </div>
        <span className="text-sm text-stone-400 tabular-nums shrink-0">
          소속 {stats.memberCount}명 · 프로젝트 {stats.projectCount}개
        </span>
      </header>

      <div className="bg-white border border-stone-200 rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="rounded-lg bg-sky-50/90 border border-sky-100 px-3 py-2.5">
          <div className="text-[10px] font-bold text-sky-700/85 uppercase tracking-wide">등록 프로젝트</div>
          <div className={cn('font-bold text-sky-600 tabular-nums leading-tight mt-0.5', mobileReadabilityMode ? 'text-2xl' : 'text-3xl')}>
            {stats.projectCount}
          </div>
          {stats.registeredProjects.length > 0 && (
            <ul
              className={cn(
                'mt-2 pt-2 border-t border-sky-100/90 space-y-1 max-h-[9rem] overflow-y-auto text-sky-900/90 leading-snug',
                mobileReadabilityMode ? 'text-xs' : 'text-sm',
              )}
            >
              {stats.registeredProjects.map((rp) => (
                <li key={rp.id} className="font-medium break-words" title={rp.label}>
                  {rp.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">전체 진척율</span>
            <span className={cn('font-bold text-indigo-600 tabular-nums', mobileReadabilityMode ? 'text-xl' : 'text-2xl')}>
              {formatPercent1(stats.progress)}%
            </span>
          </div>
          <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, stats.progress)}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-center">
          <div>
            <div className="text-[10px] text-stone-500 mb-0.5">소속 인원</div>
            <div className={cn('font-bold text-stone-800 tabular-nums', mobileReadabilityMode ? 'text-lg' : 'text-xl')}>
              {stats.memberCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500 mb-0.5">전체 Task</div>
            <div className={cn('font-bold text-stone-700 tabular-nums', mobileReadabilityMode ? 'text-lg' : 'text-xl')}>{stats.total}</div>
          </div>
          <div>
            <div className="text-[10px] text-stone-500 mb-0.5">진행 중</div>
            <div className={cn('font-bold text-violet-600 tabular-nums', mobileReadabilityMode ? 'text-lg' : 'text-xl')}>
              {stats.inProgressCount}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-stone-500 pt-2 border-t border-stone-100">
          <span>
            완료 <span className="text-emerald-600 font-semibold tabular-nums">{stats.doneCount}</span>
          </span>
          <span>
            이슈 <span className="text-rose-600 font-semibold tabular-nums">{stats.issueCount}</span>
          </span>
          {stats.assigneeCount !== stats.memberCount && (
            <span className="text-stone-400" title="이 사업부 작업에 배정된 서로 다른 담당자 수">
              담당자 {stats.assigneeCount}명
            </span>
          )}
        </div>
      </div>

      {onOpenAllocationForDivision && (
        <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onOpenAllocationForDivision}
            className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-xl border border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100/90 transition-colors"
          >
            <Users className="shrink-0 text-teal-600" size={18} aria-hidden />
            사업부 투입공수 (소속만)
          </button>
        </div>
      )}

      <section>
        <h2 className={cn('font-bold text-[var(--color-ink)] mb-3 flex items-center gap-2', mobileReadabilityMode ? 'text-lg' : 'text-xl')}>
          <Users className="text-violet-500 shrink-0" size={22} />
          조직 인원
          <span className="text-sm font-normal text-stone-500">({members.length}명)</span>
        </h2>
        {members.length === 0 ? (
          <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
            조직도에서 이 사업부에 매칭된 인원이 없습니다.
          </div>
        ) : mobileReadabilityMode ? (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={`${m.name}-${m.department}`} className="bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm">
                <div className="text-stone-800 font-medium break-words">{orgMemberLine(m)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-xs text-stone-500">
                  <th className="text-left font-medium px-4 py-2">소속 · 이름 · 직급</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={`${m.name}-${m.department}`} className="border-t border-stone-100">
                    <td className="px-4 py-2 min-w-0 text-stone-800 font-medium break-words">{orgMemberLine(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className={cn('font-bold text-[var(--color-ink)] mb-3 flex items-center gap-2', mobileReadabilityMode ? 'text-lg' : 'text-xl')}>
          <Briefcase className="text-indigo-500 shrink-0" size={22} />
          연결 프로젝트
          <span className="text-sm font-normal text-stone-500">({projects.length}개)</span>
        </h2>
        {projects.length === 0 ? (
          <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
            프로젝트 그룹명이 이 사업부 부서명과 매칭되는 프로젝트가 없습니다.
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProjectTasks(p.id)}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-stone-50/80 transition-colors"
              >
                <span className="font-medium text-stone-800 break-words min-w-0">{formatProjectDisplayName(p.name, p.projectKind)}</span>
                <span className="text-xs text-stone-400 shrink-0 tabular-nums">이 사업부 작업 {projectTaskCounts[p.id] ?? 0}건</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2
          className={cn(
            'font-bold text-[var(--color-ink)] mb-3 flex items-center gap-2 flex-wrap',
            mobileReadabilityMode ? 'text-lg' : 'text-xl',
          )}
        >
          <ListChecks className="text-teal-600 shrink-0" size={22} />
          담당 작업
          <span className="text-sm font-normal text-stone-500">
            ({tasks.length}건{tasks.length > TASK_TABLE_LIMIT ? `, 상위 ${TASK_TABLE_LIMIT}건만 표시` : ''})
          </span>
        </h2>
        {tableTasks.length === 0 ? (
          <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
            이 사업부 소속 담당자로 배정된 작업이 없습니다.
          </div>
        ) : mobileReadabilityMode ? (
          <ul className="space-y-2">
            {tableTasks.map((t) => {
              const proj = projectMap.get(t.projectId);
              const sc = wbsSettings.statusConfigs.find((c) => c.id === t.status);
              const colorProps = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpenProjectTasks(t.projectId)}
                    className="w-full text-left bg-white border border-stone-200 rounded-xl px-4 py-3 hover:border-indigo-200 hover:bg-indigo-50/20 transition-colors"
                  >
                    <div className="font-medium text-stone-800 line-clamp-2">{t.name || '(이름 없음)'}</div>
                    <div className="text-xs text-stone-500 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                      <span>{proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}</span>
                      <span>·</span>
                      <span>{formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}</span>
                      <span>·</span>
                      <span>{t.endDate || '—'}</span>
                    </div>
                    <span
                      className={cn('inline-block mt-2 text-[10px] font-medium px-2 py-0.5 rounded-full border', colorProps.className)}
                      style={colorProps.style}
                    >
                      {sc?.name ?? t.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-xs text-stone-500">
                  <th className="text-left font-medium px-3 py-2">작업명</th>
                  <th className="text-left font-medium px-3 py-2 w-36">프로젝트</th>
                  <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                  <th className="text-left font-medium px-3 py-2 w-28">종료일</th>
                  <th className="text-right font-medium px-3 py-2 w-20">진척</th>
                </tr>
              </thead>
              <tbody>
                {tableTasks.map((t) => {
                  const proj = projectMap.get(t.projectId);
                  const sc = wbsSettings.statusConfigs.find((c) => c.id === t.status);
                  const colorProps = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                      onClick={() => onOpenProjectTasks(t.projectId)}
                      title="작업 보기로 이동"
                    >
                      <td className="px-3 py-2 text-stone-800">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ListChecks size={12} className="text-teal-600 shrink-0" aria-hidden />
                          <span className="truncate">{t.name || '(이름 없음)'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-stone-600 break-words">
                        {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                      </td>
                      <td className="px-3 py-2 text-stone-600 truncate">
                        {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                      </td>
                      <td className="px-3 py-2 text-stone-500 tabular-nums">{t.endDate || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border inline-block', colorProps.className)}
                          style={colorProps.style}
                        >
                          {typeof t.progress === 'number' ? `${formatPercent1(t.progress)}%` : (sc?.name ?? '—')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
