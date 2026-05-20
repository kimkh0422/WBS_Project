import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronDown, ChevronUp, LayoutGrid, ListChecks, Flag, Bug, Users, Briefcase, BarChart3 } from 'lucide-react';
import { getDailyVisitors, getDailyVisitCounts, getVisitorRanking, type DailyVisitorRow, type VisitorRankingRow } from '../lib/db';
import { cn, formatNum2 } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import { formatAssigneeDisplay, type PersonDisplayMeta } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import type { ActionDueDateFilter } from '../lib/actionItemDueFilter';
import type { Task, Project } from '../types';
import type { WBSSettings } from '../lib/wbsSettings';
import { DashboardPersonAllocationSection } from './DashboardPersonAllocationSection';
import { DashboardVisitTrendChart } from './DashboardVisitTrendChart';
import { ProjectNameLabel } from './ProjectNameLabel';

export type DashboardDetailKind =
  | 'projects'
  | 'tasks'
  | 'members'
  | 'visitors'
  | 'issues'
  | 'actions'
  | 'milestones'
  | 'allocation'
  | 'project';

interface ProjectStats {
  total: number;
  statusCounts: Record<string, number>;
  progress: number;
  assigneeCount: number;
}

type DashboardProjectsSortKey = 'name' | 'tasks' | 'progress' | 'assignees';

function defaultSortDirForProjectsColumn(key: DashboardProjectsSortKey): 'asc' | 'desc' {
  return key === 'name' ? 'asc' : 'desc';
}

function DetailBackBar({ title, onBack, subtitle }: { title: string; onBack: () => void; subtitle?: string }) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-stone-200 bg-[var(--color-bg)]/95 backdrop-blur-md px-1 pb-4 pt-1 -mt-1">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-600 hover:bg-white hover:text-slate-900 border border-transparent hover:border-stone-200 transition-colors"
      >
        <ChevronLeft size={18} className="shrink-0" aria-hidden />
        대시보드로 돌아가기
      </button>
      <div className="flex items-start gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-ink)] tracking-tight break-words">{title}</h1>
          {subtitle && <p className="text-sm text-stone-500 mt-1">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

export function DashboardDetailPage({
  kind,
  projectId,
  onBack,
  onOpenProjectTable,
  onOpenTaskInTable,
  onOpenAllTasksTable,
  projectsForDashboard,
  allTasksForDashboard,
  projectMap,
  wbsSettings,
  assigneeDisplayMetaByName,
  registeredMemberDisplayNames,
  profileMap,
  summary,
  memberCount,
  visitorStats,
  issueTasksAll,
  actionTasksAll,
  actionDueDateFilter,
  onActionDueDateFilterChange,
  actionTasksWithDueDateCount,
  milestonesAll,
  projectStatsRows,
  displayProjectsForAllocation,
  displayTasksForAllocation,
  dashboardFiltersActive,
  updateTask,
  doneStatusId,
  todoStatusId,
  doneStatusIds,
  isActionTaskCompleted,
  dashboardExcludedCount,
  totalProjectsInAccount,
}: {
  kind: DashboardDetailKind;
  projectId?: string | null;
  onBack: () => void;
  /** 모바일 등에서 미제공 시 작업 표 이동 버튼이 비활성화됩니다. */
  onOpenProjectTable?: (projectId: string) => void;
  /** 제공 시「열기」가 해당 작업 행으로 스크롤하는 표 이동을 수행합니다. */
  onOpenTaskInTable?: (taskId: string, projectId: string) => void;
  onOpenAllTasksTable?: () => void;
  projectsForDashboard: Project[];
  allTasksForDashboard: Task[];
  projectMap: Map<string, Project>;
  wbsSettings: WBSSettings;
  assigneeDisplayMetaByName: Map<string, PersonDisplayMeta>;
  registeredMemberDisplayNames?: Set<string>;
  profileMap?: Record<string, string>;
  summary: { totalProjects: number; totalTasks: number };
  memberCount: number;
  visitorStats: { daily: number; total: number };
  issueTasksAll: Task[];
  actionTasksAll: Task[];
  actionDueDateFilter: ActionDueDateFilter;
  onActionDueDateFilterChange: (v: ActionDueDateFilter) => void;
  /** 마감일(종료일)이 있는 액션 항목 전체 건수(필터와 무관) */
  actionTasksWithDueDateCount: number;
  milestonesAll: Array<Task & { projectName: string }>;
  projectStatsRows: Array<Project & { stats: ProjectStats }>;
  displayProjectsForAllocation: Project[];
  displayTasksForAllocation: Task[];
  dashboardFiltersActive: boolean;
  updateTask: (id: string, patch: Partial<Task>) => void;
  doneStatusId: string;
  todoStatusId: string;
  doneStatusIds: Set<string>;
  isActionTaskCompleted: (t: Task) => boolean;
  dashboardExcludedCount: number;
  totalProjectsInAccount: number;
}) {
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyList, setDailyList] = useState<DailyVisitorRow[]>([]);
  const [visitorRanking, setVisitorRanking] = useState<VisitorRankingRow[]>([]);
  const [visitTrend, setVisitTrend] = useState<{ visitDate: string; count: number }[]>([]);
  const [registeredProjectsSort, setRegisteredProjectsSort] = useState<{
    key: DashboardProjectsSortKey;
    dir: 'asc' | 'desc';
  }>({ key: 'name', dir: 'asc' });

  useEffect(() => {
    if (kind !== 'visitors') return;
    let cancelled = false;
    setDailyLoading(true);
    Promise.all([getDailyVisitors(), getDailyVisitCounts(30), getVisitorRanking()])
      .then(([rows, trend, ranking]) => {
        if (!cancelled) {
          setDailyList(rows);
          setVisitTrend(trend);
          setVisitorRanking(ranking);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDailyList([]);
          setVisitTrend([]);
          setVisitorRanking([]);
        }
      })
      .finally(() => {
        if (!cancelled) setDailyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const memberNamesSorted = useMemo(() => {
    const arr = registeredMemberDisplayNames ? [...registeredMemberDisplayNames] : [];
    arr.sort((a, b) => a.localeCompare(b, 'ko'));
    return arr;
  }, [registeredMemberDisplayNames]);

  const tasksByProjectRows = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of allTasksForDashboard) {
      m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1);
    }
    return [...projectsForDashboard]
      .map((p) => ({ project: p, count: m.get(p.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name, 'ko'));
  }, [allTasksForDashboard, projectsForDashboard]);

  const registeredProjectsSorted = useMemo(() => {
    const rows = [...projectStatsRows];
    const { key, dir } = registeredProjectsSort;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'name':
          cmp = a.name.localeCompare(b.name, 'ko');
          break;
        case 'tasks':
          cmp = a.stats.total - b.stats.total;
          break;
        case 'progress':
          cmp = a.stats.progress - b.stats.progress;
          break;
        case 'assignees':
          cmp = a.stats.assigneeCount - b.stats.assigneeCount;
          break;
        default:
          break;
      }
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
      return a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);
    });
    return rows;
  }, [projectStatsRows, registeredProjectsSort]);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    (wbsSettings.statusConfigs ?? []).forEach((c) => {
      counts[c.id] = 0;
    });
    for (const t of allTasksForDashboard) {
      if (counts[t.status] !== undefined) counts[t.status]++;
      else counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return counts;
  }, [allTasksForDashboard, wbsSettings.statusConfigs]);

  const projectDetailRow = useMemo(() => {
    if (kind !== 'project' || !projectId) return undefined;
    return projectStatsRows.find((p) => p.id === projectId);
  }, [kind, projectId, projectStatsRows]);

  if (kind === 'project' && projectId && !projectDetailRow) {
    return (
      <div className={cn('max-w-7xl mx-auto space-y-6')}>
        <DetailBackBar title="프로젝트 상세" onBack={onBack} subtitle="요청한 프로젝트를 찾을 수 없습니다." />
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-600">
          표시 범위에 해당하는 프로젝트가 없거나 삭제되었습니다.
        </div>
      </div>
    );
  }

  const titleForKind = (): string => {
    switch (kind) {
      case 'projects':
        return '등록된 프로젝트';
      case 'tasks':
        return '등록된 작업 집계';
      case 'members':
        return '회원가입자';
      case 'visitors':
        return '접속 현황';
      case 'issues':
        return '이슈 작업 전체';
      case 'actions':
        return '액션 항목';
      case 'milestones':
        return '마일스톤 전체';
      case 'allocation':
        return '인원·프로젝트 투입 상세';
      case 'project':
        return projectDetailRow ? formatProjectDisplayName(projectDetailRow.name, projectDetailRow.projectKind) : '프로젝트 상세';
      default:
        return '상세';
    }
  };

  return (
    <div className={cn('max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300')}>
      <DetailBackBar
        title={titleForKind()}
        onBack={onBack}
        subtitle={
          kind === 'projects' && dashboardExcludedCount > 0
            ? `※ 집계 제외 ${dashboardExcludedCount}개 프로젝트는 목록·합계에서 뺐습니다. (전체 ${totalProjectsInAccount}개 중)`
            : kind === 'tasks' && dashboardExcludedCount > 0
              ? '※ 집계에서 제외된 프로젝트의 작업은 합계에 포함되지 않습니다.'
              : undefined
        }
      />

      {kind === 'projects' && (
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-xs text-stone-500">
                  <th
                    className="text-left font-medium p-0"
                    aria-sort={
                      registeredProjectsSort.key === 'name' ? (registeredProjectsSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setRegisteredProjectsSort((prev) =>
                          prev.key === 'name'
                            ? { key: 'name', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: 'name', dir: defaultSortDirForProjectsColumn('name') },
                        )
                      }
                      className="w-full text-left px-4 py-2.5 inline-flex items-center gap-1 font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100/80 transition-colors"
                    >
                      프로젝트
                      {registeredProjectsSort.key === 'name' &&
                        (registeredProjectsSort.dir === 'asc' ? (
                          <ChevronUp size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ) : (
                          <ChevronDown size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ))}
                    </button>
                  </th>
                  <th
                    className="text-right font-medium p-0 w-24"
                    aria-sort={
                      registeredProjectsSort.key === 'tasks' ? (registeredProjectsSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setRegisteredProjectsSort((prev) =>
                          prev.key === 'tasks'
                            ? { key: 'tasks', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: 'tasks', dir: defaultSortDirForProjectsColumn('tasks') },
                        )
                      }
                      className="w-full px-3 py-2.5 inline-flex items-center justify-end gap-1 font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100/80 transition-colors"
                    >
                      작업 수
                      {registeredProjectsSort.key === 'tasks' &&
                        (registeredProjectsSort.dir === 'asc' ? (
                          <ChevronUp size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ) : (
                          <ChevronDown size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ))}
                    </button>
                  </th>
                  <th
                    className="text-right font-medium p-0 w-28"
                    aria-sort={
                      registeredProjectsSort.key === 'progress'
                        ? registeredProjectsSort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setRegisteredProjectsSort((prev) =>
                          prev.key === 'progress'
                            ? { key: 'progress', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: 'progress', dir: defaultSortDirForProjectsColumn('progress') },
                        )
                      }
                      className="w-full px-3 py-2.5 inline-flex items-center justify-end gap-1 font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100/80 transition-colors"
                    >
                      진척률
                      {registeredProjectsSort.key === 'progress' &&
                        (registeredProjectsSort.dir === 'asc' ? (
                          <ChevronUp size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ) : (
                          <ChevronDown size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ))}
                    </button>
                  </th>
                  <th
                    className="text-right font-medium p-0 w-32"
                    aria-sort={
                      registeredProjectsSort.key === 'assignees'
                        ? registeredProjectsSort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setRegisteredProjectsSort((prev) =>
                          prev.key === 'assignees'
                            ? { key: 'assignees', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                            : { key: 'assignees', dir: defaultSortDirForProjectsColumn('assignees') },
                        )
                      }
                      className="w-full px-3 py-2.5 inline-flex items-center justify-end gap-1 font-medium text-stone-500 hover:text-stone-800 hover:bg-stone-100/80 transition-colors"
                    >
                      담당자 수
                      {registeredProjectsSort.key === 'assignees' &&
                        (registeredProjectsSort.dir === 'asc' ? (
                          <ChevronUp size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ) : (
                          <ChevronDown size={14} className="shrink-0 text-stone-600" aria-hidden />
                        ))}
                    </button>
                  </th>
                  <th className="text-right font-medium px-3 py-2.5 w-36">작업 표</th>
                </tr>
              </thead>
              <tbody>
                {registeredProjectsSorted.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100 hover:bg-stone-50/70">
                    <td className="px-4 py-2.5 font-medium text-stone-800 break-words">
                      <ProjectNameLabel project={p} name={p.name} nameClassName="font-medium text-stone-800" />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">{p.stats.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-700 font-semibold">{formatNum2(p.stats.progress)}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">{p.stats.assigneeCount}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={!onOpenProjectTable}
                        title={!onOpenProjectTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
                        onClick={() => onOpenProjectTable?.(p.id)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        열기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500">요약 카드의 숫자와 동일하게, 대시보드 집계 범위(제외·필터)에 맞춘 프로젝트만 표시합니다.</p>
        </div>
      )}

      {kind === 'tasks' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">총 작업 수</div>
              <div className="text-3xl font-bold text-[var(--color-ink)] tabular-nums">{summary.totalTasks}</div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">프로젝트 수</div>
              <div className="text-3xl font-bold text-sky-700 tabular-nums">{summary.totalProjects}</div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-bold text-stone-700 flex items-center gap-2">
              <BarChart3 size={16} className="text-violet-600" aria-hidden />
              상태별 작업 수
            </h3>
            <ul className="flex flex-wrap gap-2">
              {(wbsSettings.statusConfigs ?? []).map((c) => (
                <li
                  key={c.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-stone-700">{c.name}</span>
                  <span className="tabular-nums font-bold text-stone-900">{statusBreakdown[c.id] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 text-sm font-bold text-stone-700">프로젝트별 작업 수</div>
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-xs text-stone-500">
                  <th className="text-left font-medium px-4 py-2">프로젝트</th>
                  <th className="text-right font-medium px-3 py-2 w-28">작업 수</th>
                </tr>
              </thead>
              <tbody>
                {tasksByProjectRows.map(({ project, count }) => (
                  <tr key={project.id} className="border-t border-stone-100 hover:bg-stone-50/70">
                    <td className="px-4 py-2 text-stone-800 break-words">{formatProjectDisplayName(project.name, project.projectKind)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <button
                        type="button"
                        disabled={!onOpenProjectTable}
                        title={!onOpenProjectTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
                        onClick={() => onOpenProjectTable?.(project.id)}
                        className="font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {count}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={!onOpenAllTasksTable}
            title={!onOpenAllTasksTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
            onClick={() => onOpenAllTasksTable?.()}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <LayoutGrid size={16} aria-hidden />
            전체 작업 표로 이동
          </button>
        </div>
      )}

      {kind === 'members' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-white p-5 flex items-center gap-3">
            <Users className="text-violet-600 shrink-0" size={28} aria-hidden />
            <div>
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wide">승인된 프로필 기준</div>
              <div className="text-3xl font-bold text-[var(--color-ink)] tabular-nums">{memberCount}명</div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden max-h-[min(70vh,560px)] overflow-y-auto">
            <ul className="divide-y divide-stone-100">
              {memberNamesSorted.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-stone-500">표시할 회원 표시명이 없습니다.</li>
              ) : (
                memberNamesSorted.map((name) => (
                  <li key={name} className="px-4 py-2.5 text-sm text-stone-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0" aria-hidden />
                    <span className="break-words">{formatAssigneeDisplay(name, assigneeDisplayMetaByName) || name}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {kind === 'visitors' && (
        <div className="space-y-4">
          <DashboardVisitTrendChart points={visitTrend} loading={dailyLoading} subtitle="세션당 하루 1회 집계" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">금일 접속(세션)</div>
              <div className="text-3xl font-bold text-blue-600 tabular-nums">{visitorStats.daily}</div>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-1">누적 접속(세션)</div>
              <div className="text-3xl font-bold text-purple-600 tabular-nums">{visitorStats.total}</div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden flex flex-col max-h-[min(65vh,480px)]">
            <div className="px-4 py-3 border-b border-stone-100 text-sm font-bold text-stone-800 shrink-0">금일 접속자 명단</div>
            <div className="p-4 overflow-y-auto flex-1 text-sm">
              {dailyLoading ? (
                <p className="text-stone-500 text-center py-8">불러오는 중…</p>
              ) : dailyList.length === 0 ? (
                <p className="text-stone-500 text-center py-6 text-sm">표시할 기록이 없거나 DB 함수가 아직 배포되지 않았을 수 있습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {dailyList.map((row) => (
                    <li key={row.userId} className="flex items-start justify-between gap-3 py-2 border-b border-stone-100 last:border-0">
                      <span className="font-medium text-stone-800 break-words min-w-0">
                        {formatAssigneeDisplay(row.displayName, assigneeDisplayMetaByName) || row.displayName}
                      </span>
                      <span className="text-xs text-stone-500 tabular-nums shrink-0 whitespace-nowrap">
                        {row.visitedAt
                          ? (() => {
                              const d = new Date(row.visitedAt);
                              return Number.isNaN(d.getTime())
                                ? row.visitedAt
                                : d.toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                            })()
                          : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden flex flex-col max-h-[min(65vh,520px)]">
            <div className="px-4 py-3 border-b border-stone-100 shrink-0">
              <div className="text-sm font-bold text-stone-800">누적 접속 순위</div>
              <div className="text-xs text-stone-500 mt-0.5">세션당 하루 1회 집계 · 접속 횟수 많은 순</div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-sm">
              {dailyLoading ? (
                <p className="text-stone-500 text-center py-8">불러오는 중…</p>
              ) : visitorRanking.length === 0 ? (
                <p className="text-stone-500 text-center py-6 text-sm">
                  표시할 기록이 없거나 DB 함수 <code className="text-xs bg-stone-100 px-1 rounded">get_visitor_ranking</code>이 아직
                  배포되지 않았을 수 있습니다.
                </p>
              ) : (
                <ul className="space-y-2">
                  {visitorRanking.map((row, index) => (
                    <li key={row.userId} className="flex items-start justify-between gap-3 py-2 border-b border-stone-100 last:border-0">
                      <div className="flex items-start gap-2 min-w-0">
                        <span
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-50 text-purple-800 text-xs font-bold tabular-nums shrink-0"
                          aria-label={`${index + 1}위`}
                        >
                          {index + 1}
                        </span>
                        <span className="font-medium text-stone-800 break-words pt-0.5">
                          {formatAssigneeDisplay(row.displayName, assigneeDisplayMetaByName) || row.displayName}
                        </span>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="text-sm font-bold text-purple-700 tabular-nums">{row.visitCount}회</div>
                        <div className="text-[11px] text-stone-500 tabular-nums whitespace-nowrap">
                          마지막{' '}
                          {row.lastVisitedAt
                            ? (() => {
                                const d = new Date(row.lastVisitedAt);
                                return Number.isNaN(d.getTime())
                                  ? row.lastVisitedAt
                                  : d.toLocaleString('ko-KR', {
                                      month: 'numeric',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    });
                              })()
                            : '—'}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {kind === 'issues' && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-stone-800">총 {issueTasksAll.length}건</span>
            <button
              type="button"
              disabled={!onOpenAllTasksTable}
              title={!onOpenAllTasksTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
              onClick={() => onOpenAllTasksTable?.()}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
            >
              작업 표(전체)로 이동
            </button>
          </div>
          <div className="overflow-x-auto max-h-[min(75vh,640px)] overflow-y-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-[1]">
                <tr className="text-xs text-stone-500">
                  <th className="text-left font-medium px-3 py-2">작업명</th>
                  <th className="text-left font-medium px-3 py-2 w-44">프로젝트</th>
                  <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                  <th className="text-left font-medium px-3 py-2 w-28">종료일</th>
                  <th className="text-right font-medium px-3 py-2 w-24">진척률</th>
                  <th className="text-right font-medium px-3 py-2 w-20">표로</th>
                </tr>
              </thead>
              <tbody>
                {issueTasksAll.map((t) => {
                  const proj = projectMap.get(t.projectId);
                  return (
                    <tr key={t.id} className="border-t border-stone-100 hover:bg-rose-50/40">
                      <td className="px-3 py-2 text-stone-800">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Bug size={12} className="text-rose-500 shrink-0" aria-hidden />
                          <span className="break-words">{t.name || '(이름 없음)'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-stone-600 break-words">
                        {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                      </td>
                      <td className="px-3 py-2 text-stone-600 truncate max-w-[10rem]">
                        {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                      </td>
                      <td className="px-3 py-2 text-stone-500 tabular-nums">{t.endDate || '—'}</td>
                      <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
                        {typeof t.progress === 'number' ? `${formatNum2(t.progress)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!onOpenTaskInTable && !onOpenProjectTable}
                          title={
                            !onOpenTaskInTable && !onOpenProjectTable
                              ? '모바일에서는 작업 표로 이동할 수 없습니다.'
                              : onOpenTaskInTable
                                ? '해당 작업 WBS 표로 이동'
                                : undefined
                          }
                          onClick={() => {
                            if (onOpenTaskInTable) onOpenTaskInTable(t.id, t.projectId);
                            else onOpenProjectTable?.(t.projectId);
                          }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          열기
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {kind === 'actions' && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="text-sm font-bold text-stone-800 shrink-0">
                {actionTasksAll.length}건 표시
                {actionTasksWithDueDateCount > 0 && actionTasksAll.length !== actionTasksWithDueDateCount && (
                  <span className="text-stone-500 font-normal"> / 마감일 지정 {actionTasksWithDueDateCount}건</span>
                )}
              </span>
              <div
                className="inline-flex gap-0.5 rounded-lg border border-stone-200 bg-stone-50/80 p-0.5 shrink-0"
                role="group"
                aria-label="액션 항목 마감일 구간"
              >
                {(
                  [
                    { id: 'today' as const, label: '금일' },
                    { id: 'thisWeek' as const, label: '금주' },
                    { id: 'overdue' as const, label: '기한초과' },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onActionDueDateFilterChange(id)}
                    className={cn(
                      'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors',
                      actionDueDateFilter === id ? 'bg-teal-700 text-white' : 'text-stone-600 hover:bg-white',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={!onOpenAllTasksTable}
              title={!onOpenAllTasksTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
              onClick={() => onOpenAllTasksTable?.()}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none shrink-0"
            >
              작업 표(전체)로 이동
            </button>
          </div>
          {actionTasksWithDueDateCount === 0 ? (
            <div className="px-4 py-10 text-sm text-stone-500 text-center leading-relaxed">
              마감일(종료일)이 지정된 액션 항목이 없습니다.
              <br />
              작업 편집에서「액션 항목」을 켜고 종료일을 입력해 주세요.
            </div>
          ) : actionTasksAll.length === 0 ? (
            <div className="px-4 py-10 text-sm text-stone-500 text-center leading-relaxed">
              선택한 구간(
              {actionDueDateFilter === 'today' ? '금일' : actionDueDateFilter === 'thisWeek' ? '금주' : '기한초과'}
              )에 해당하는 액션 항목이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[min(75vh,640px)] overflow-y-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-stone-50 border-b border-stone-200 sticky top-0 z-[1]">
                  <tr className="text-xs text-stone-500">
                    <th className="text-center font-medium px-2 py-2 w-14">완료</th>
                    <th className="text-left font-medium px-3 py-2">작업명</th>
                    <th className="text-left font-medium px-3 py-2 w-44">프로젝트</th>
                    <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                    <th className="text-left font-medium px-3 py-2 w-28">종료일</th>
                    <th className="text-right font-medium px-3 py-2 w-24">진척률</th>
                    <th className="text-right font-medium px-3 py-2 w-20">표로</th>
                  </tr>
                </thead>
                <tbody>
                  {actionTasksAll.map((t) => {
                    const proj = projectMap.get(t.projectId);
                    const done = isActionTaskCompleted(t);
                    return (
                      <tr key={t.id} className={cn('border-t border-stone-100 hover:bg-teal-50/35', done && 'bg-teal-50/25')}>
                        <td className="px-2 py-2 align-middle text-center">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              if (checked) updateTask(t.id, { status: doneStatusId, progress: 100 });
                              else updateTask(t.id, { status: todoStatusId, progress: 0 });
                            }}
                            className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                            title={done ? '완료 해제' : '완료 표시'}
                            aria-label={done ? `${t.name} 액션 완료 해제` : `${t.name} 액션 완료`}
                          />
                        </td>
                        <td className="px-3 py-2 text-stone-800">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <ListChecks size={12} className="text-teal-600 shrink-0" aria-hidden />
                            <span className={cn('break-words', done && 'line-through text-stone-500')}>{t.name || '(이름 없음)'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-stone-600 break-words">
                          {proj ? formatProjectDisplayName(proj.name, proj.projectKind) : '—'}
                        </td>
                        <td className="px-3 py-2 text-stone-600 truncate max-w-[10rem]">
                          {formatAssigneeDisplay(t.assignee, assigneeDisplayMetaByName) || '—'}
                        </td>
                        <td className="px-3 py-2 text-stone-500 tabular-nums">{t.endDate || '—'}</td>
                        <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
                          {typeof t.progress === 'number' ? `${formatNum2(t.progress)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={!onOpenProjectTable}
                            title={!onOpenProjectTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
                            onClick={() => onOpenProjectTable?.(t.projectId)}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
                          >
                            열기
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {kind === 'milestones' && (
        <div className="card-elevated overflow-hidden max-h-[min(75vh,640px)] overflow-y-auto">
          <ul className="divide-y divide-slate-100">
            {milestonesAll.map((task) => (
              <li
                key={task.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 sm:px-6 py-4 hover:bg-slate-50/80 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                    <Flag size={18} className="text-amber-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--color-ink)] break-words">{task.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {task.projectName} · {task.startDate}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {(() => {
                    const sc = wbsSettings.statusConfigs.find((c) => c.id === task.status);
                    const colorProps = getStatusColorProps(sc?.color || 'bg-slate-50 border-slate-100');
                    return (
                      <span
                        className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', colorProps.className, 'text-stone-700')}
                        style={colorProps.style}
                      >
                        {sc?.name ?? task.status}
                      </span>
                    );
                  })()}
                  <button
                    type="button"
                    disabled={!onOpenProjectTable}
                    title={!onOpenProjectTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
                    onClick={() => onOpenProjectTable?.(task.projectId)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none"
                  >
                    작업 표
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {kind === 'allocation' && (
        <div className="space-y-2">
          <p className="text-xs text-stone-500">
            아래에서 투입율·작업 할당을 넓은 화면으로 조정할 수 있습니다. 프로젝트명을 누르면 해당 프로젝트 작업 표로 이동합니다.
          </p>
          <DashboardPersonAllocationSection
            projects={displayProjectsForAllocation}
            allTasks={displayTasksForAllocation}
            profileMap={profileMap}
            registeredMemberDisplayNames={registeredMemberDisplayNames}
            showFilterHint={dashboardFiltersActive}
            onNavigateToWork={onOpenProjectTable}
          />
        </div>
      )}

      {kind === 'project' && projectDetailRow && (
        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
            <p className="text-sm text-stone-600 whitespace-pre-wrap break-words">{projectDetailRow.description || '설명 없음'}</p>
            <div className="flex flex-wrap gap-3 text-sm text-stone-600">
              <span>
                시작일: <strong className="text-stone-900">{projectDetailRow.startDate || '미정'}</strong>
              </span>
              <span className="text-stone-300" aria-hidden>
                ·
              </span>
              <span>
                작업 수: <strong className="text-stone-900 tabular-nums">{projectDetailRow.stats.total}</strong>
              </span>
              <span className="text-stone-300" aria-hidden>
                ·
              </span>
              <span>
                담당자 수: <strong className="text-stone-900 tabular-nums">{projectDetailRow.stats.assigneeCount}</strong>
              </span>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-stone-500 uppercase tracking-wide">전체 진척률</span>
                <span className="text-2xl font-bold text-indigo-600 tabular-nums">{formatNum2(projectDetailRow.stats.progress)}%</span>
              </div>
              <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                  style={{ width: `${Math.min(100, projectDetailRow.stats.progress)}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 pt-2 border-t border-stone-100">
              {(wbsSettings.statusConfigs ?? []).map((config, i) => (
                <span key={config.id} className="whitespace-nowrap">
                  {i > 0 && <span className="text-stone-300 mr-2">·</span>}
                  {config.name}{' '}
                  <span className="tabular-nums font-semibold text-stone-700">{projectDetailRow.stats.statusCounts[config.id] || 0}</span>
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={!onOpenProjectTable}
            title={!onOpenProjectTable ? '모바일에서는 작업 표로 이동할 수 없습니다.' : undefined}
            onClick={() => onOpenProjectTable?.(projectDetailRow.id)}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            <Briefcase size={16} aria-hidden />이 프로젝트 작업 표로 이동
          </button>
        </div>
      )}
    </div>
  );
}
