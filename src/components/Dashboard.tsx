import React, { useMemo, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVisitorStats } from '../lib/db';
import { Briefcase, Clock, LayoutGrid, Users, Flag, CalendarDays } from 'lucide-react';
import { cn, randomUUID, formatNum2 } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { ko } from 'date-fns/locale';
export function Dashboard({ onNavigate, registeredMemberDisplayNames }: { onNavigate?: (view: any, filters: any) => void; registeredMemberDisplayNames?: Set<string> }) {
    const { projects, allTasks, wbsSettings } = useWBS();

    // Calculate stats for each project
    const projectStats = useMemo(() => {
        return projects.map(project => {
            const pTasks = allTasks.filter(t => t.projectId === project.id);
            const total = pTasks.length;

            // Dynamic status counts
            const statusCounts: Record<string, number> = {};
            wbsSettings.statusConfigs.forEach(c => statusCounts[c.id] = 0);
            pTasks.forEach(t => {
                if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
            });

            const assignees = Array.from(new Set(pTasks.map(t => t.assignee).filter(Boolean)));

            // 평균 진척률: 리프(단말) 작업만 기준으로 단순 평균
            const leafTasks = pTasks.filter(t => !pTasks.some(other => other.parentId === t.id));
            const forAggregate = leafTasks.length > 0 ? leafTasks : pTasks;
            const progress = forAggregate.length > 0
                ? Math.round(forAggregate.reduce((acc, t) => acc + (t.progress || 0), 0) / forAggregate.length)
                : 0;

            return {
                ...project,
                stats: {
                    total,
                    statusCounts,
                    progress,
                    assigneeCount: assignees.length
                }
            };
        });
    }, [projects, allTasks, wbsSettings.statusConfigs]);

    // 작업(WBS) 0개인 프로젝트는 대시보드에서 숨김
    const visibleProjectStats = useMemo(
        () => projectStats.filter(p => (p?.stats?.total ?? 0) > 0),
        [projectStats]
    );

    // Total summary (평균 진척은 단말 작업만으로 계산하여 상·하위 이중 집계 방지)
    const summary = useMemo(() => {
        const doneStatus = wbsSettings.statusConfigs.find(c => c.progress === 100)?.id || 'done';
        const inProgressStatus = wbsSettings.statusConfigs.find(c => c.progress > 0 && c.progress < 100)?.id || 'in-progress';

      const totalTasks = allTasks.length;
      const leafTasks = allTasks.filter(t => !allTasks.some(other => other.parentId === t.id));
      const forAggregate = leafTasks.length > 0 ? leafTasks : allTasks;
      const avgProgress =
          forAggregate.length > 0
              ? Math.round(forAggregate.reduce((sum, t) => sum + (t.progress || 0), 0) / forAggregate.length)
              : 0;

        // Global status counts across all projects
        const statusCounts: Record<string, number> = {};
        wbsSettings.statusConfigs.forEach(c => statusCounts[c.id] = 0);
        allTasks.forEach(t => {
            if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
        });

        // Global assignee counts
        const assignees = Array.from(new Set(allTasks.map(t => t.assignee).filter(Boolean)));

        // Earliest project start date
        let earliestStartDate: string | null = null;
        projects.forEach(p => {
            if (p.startDate) {
                if (!earliestStartDate || p.startDate < earliestStartDate) {
                    earliestStartDate = p.startDate;
                }
            }
        });

        const totalMilestones = allTasks.filter(t => t.isMilestone).length;

        return {
            totalProjects: projects.length,
            totalTasks,
            totalDone: allTasks.filter(t => t.status === doneStatus).length,
            totalInProgress: allTasks.filter(t => t.status === inProgressStatus).length,
            totalMilestones,
            avgProgress,
            statusCounts,
            assigneeCount: assignees.length,
            earliestStartDate,
        }
    }, [projects, allTasks, wbsSettings.statusConfigs]);

    // 마일스톤 목록 (날짜순)
    const milestones = useMemo(() => {
        return allTasks
            .filter(t => t.isMilestone)
            .map(t => ({
                ...t,
                projectName: projects.find(p => p.id === t.projectId)?.name ?? '-',
            }))
            .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    }, [allTasks, projects]);

    // 금주 일정: 이번 주(월~일)와 기간이 겹치는 작업 (최하위 WBS만 표시)
    const { weekStartStr, weekEndStr, weekLabel, thisWeekTasks } = useMemo(() => {
        const now = new Date();
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
        const weekStartStr = format(weekStart, 'yyyy-MM-dd');
        const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
        const weekLabel = `${format(weekStart, 'M/d', { locale: ko })} ~ ${format(weekEnd, 'M/d', { locale: ko })}`;
        const leafTaskIds = new Set(
            allTasks.filter(t => !allTasks.some(other => other.parentId === t.id)).map(t => t.id)
        );
        const tasks = allTasks
            .filter(t => leafTaskIds.has(t.id))
            .filter(t => {
                const start = t.startDate || '';
                const end = t.endDate || '';
                return start <= weekEndStr && end >= weekStartStr;
            })
            .map(t => ({
                ...t,
                projectName: projects.find(p => p.id === t.projectId)?.name ?? '-',
            }))
            .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        return { weekStartStr, weekEndStr, weekLabel, thisWeekTasks: tasks };
    }, [allTasks, projects]);

    // Calculate stats by assignee (with project breakdown for M/D)
    const assigneeStats = useMemo(() => {
        const statsMap: Record<string, {
            total: number,
            statusCounts: Record<string, number>,
            workEffort: number,
            projectBreakdown: Array<{ projectId: string; projectName: string; workEffort: number }>
        }> = {};

        allTasks.forEach(task => {
            const assignee = task.assignee || '미지정';
            if (!statsMap[assignee]) {
                const initialStatusCounts: Record<string, number> = {};
                wbsSettings.statusConfigs.forEach(c => initialStatusCounts[c.id] = 0);
                statsMap[assignee] = {
                    total: 0,
                    statusCounts: initialStatusCounts,
                    workEffort: 0,
                    projectBreakdown: []
                };
            }
            const s = statsMap[assignee];
            s.total += 1;
            if (s.statusCounts[task.status] !== undefined) {
                s.statusCounts[task.status]++;
            }
            const effort = task.workEffort || 0;
            s.workEffort += effort;
            if (effort > 0 && task.projectId) {
                const proj = projects.find(p => p.id === task.projectId);
                const name = proj?.name ?? task.projectId;
                const existing = s.projectBreakdown.find(b => b.projectId === task.projectId);
                if (existing) existing.workEffort += effort;
                else s.projectBreakdown.push({ projectId: task.projectId, projectName: name, workEffort: effort });
            }
        });

        const entries = Object.entries(statsMap).map(([name, stats]) => ({
            name,
            ...stats,
            projectBreakdown: stats.projectBreakdown.sort((a, b) => b.workEffort - a.workEffort)
        }));
        // 등록된 회원만 표시: registeredMemberDisplayNames가 있으면 해당 집합에 있는 담당자만, 없으면 기존처럼 전체 표시
        const filtered = registeredMemberDisplayNames && registeredMemberDisplayNames.size > 0
            ? entries.filter(({ name }) => name !== '미지정' && registeredMemberDisplayNames.has(name))
            : entries;
        return filtered.sort((a, b) => b.total - a.total);
    }, [allTasks, projects, wbsSettings.statusConfigs, registeredMemberDisplayNames]);

    // Visitor tracking: DB 기반 (Supabase)
    const { user } = useAuth();
    const [visitorStats, setVisitorStats] = React.useState({ daily: 0, total: 0 });

    React.useEffect(() => {
        if (!isSupabaseConfigured || !supabase || !user) {
            setVisitorStats({ daily: 0, total: 0 });
            return;
        }

        const run = async () => {
            // 세션당 하루 1회만 기록
            let sessionId = sessionStorage.getItem('wbs-visit-session-id');
            if (!sessionId) {
                sessionId = randomUUID();
                sessionStorage.setItem('wbs-visit-session-id', sessionId);
            }

            try {
                await supabase.rpc('record_visit', { p_session_id: sessionId });
            } catch {
                // 무시 (이미 기록된 경우 등)
            }

            try {
                const stats = await getVisitorStats();
                setVisitorStats(stats);
            } catch {
                setVisitorStats({ daily: 0, total: 0 });
            }
        };

        run();
    }, [user?.id]);

    return (
        <div className="h-full overflow-y-auto bg-[var(--color-bg)] p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                {/* Header Summary */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                        <LayoutGrid className="text-slate-500" size={24} />
                        전체 현황 요약
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        <SummaryCard
                            title="총 프로젝트"
                            value={summary.totalProjects}
                            subtitle=""
                            onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '' })}
                        />
                        <SummaryCard
                            title="총 작업 수"
                            value={summary.totalTasks}
                            subtitle=""
                            onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '' })}
                        />
                        <SummaryCard
                            title="진행 중 작업"
                            value={summary.totalInProgress}
                            subtitle=""
                            onClick={() => {
                                const inProgressStatus = wbsSettings.statusConfigs.find(c => c.progress > 0 && c.progress < 100)?.id || 'in-progress';
                                onNavigate?.('kanban', { projectId: 'all', status: inProgressStatus, assignee: '' });
                            }}
                        />
                        <SummaryCard
                            title="완료된 작업"
                            value={summary.totalDone}
                            subtitle=""
                            onClick={() => {
                                const doneStatus = wbsSettings.statusConfigs.find(c => c.progress === 100)?.id || 'done';
                                onNavigate?.('list', { projectId: 'all', status: doneStatus, assignee: '' });
                            }}
                        />
                        <SummaryCard
                            title="평균 진척율"
                            value={`${summary.avgProgress}%`}
                            subtitle=""
                            highlight="text-emerald-600"
                        />
                        <SummaryCard
                            title="마일스톤"
                            value={summary.totalMilestones}
                            subtitle=""
                            highlight="text-amber-600"
                            onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '' })}
                        />
                        <SummaryCard title="금일 접속자" value={visitorStats.daily} subtitle="" highlight="text-blue-600" />
                        <SummaryCard title="누적 접속자" value={visitorStats.total} subtitle="" highlight="text-purple-600" />
                    </div>
                </section>

                {/* Milestones */}
                {milestones.length > 0 && (
                    <section>
                        <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                            <Flag className="text-amber-500" size={24} />
                            마일스톤
                        </h2>
                        <div className="card-elevated overflow-hidden">
                            <ul className="divide-y divide-slate-100">
                                {milestones.map(task => (
                                    <li
                                        key={task.id}
                                        onClick={() => onNavigate?.('list', { projectId: task.projectId, status: 'all', assignee: '' })}
                                        className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50/80 cursor-pointer transition-colors"
                                    >
                                        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                                            <Flag size={18} className="text-amber-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-[var(--color-ink)] truncate">{task.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{task.projectName} · {task.startDate}</div>
                                        </div>
                                        {(() => {
                                                const sc = wbsSettings.statusConfigs.find(c => c.id === task.status);
                                                const colorProps = getStatusColorProps(sc?.color || "bg-slate-50 border-slate-100");
                                                return (
                                                    <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", colorProps.className, "text-stone-700")} style={colorProps.style}>
                                                        {sc?.name ?? task.status}
                                                    </span>
                                                );
                                            })()}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                {/* 금주 일정 */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                        <CalendarDays className="text-sky-500" size={24} />
                        금주 일정
                        <span className="text-sm font-normal text-slate-500">({weekLabel})</span>
                    </h2>
                    <div className="card-elevated overflow-hidden">
                        <div className="px-6 py-4 bg-gradient-to-r from-sky-50 to-indigo-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-sm text-slate-600">
                                이번 주에 진행 중이거나 예정인 작업 <strong className="text-[var(--color-ink)]">{thisWeekTasks.length}</strong>건
                            </span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '', startDate: weekStartStr, endDate: weekEndStr })}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-100 text-sky-700 border border-sky-200 hover:bg-sky-200 transition-colors"
                                >
                                    표·간트에서 보기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('gantt', { projectId: 'all', status: 'all', assignee: '', startDate: weekStartStr, endDate: weekEndStr })}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200 transition-colors"
                                >
                                    간트에서 보기
                                </button>
                            </div>
                        </div>
                        {thisWeekTasks.length === 0 ? (
                            <div className="px-6 py-8 text-center text-slate-500 text-sm">
                                이번 주에 해당하는 일정이 없습니다.
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                                {thisWeekTasks.map(task => (
                                    <li
                                        key={task.id}
                                        onClick={() => onNavigate?.('list', { projectId: task.projectId, status: 'all', assignee: '', startDate: weekStartStr, endDate: weekEndStr })}
                                        className="flex items-center gap-4 px-6 py-3 hover:bg-slate-50/80 cursor-pointer transition-colors"
                                    >
                                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center">
                                            <CalendarDays size={14} className="text-sky-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-[var(--color-ink)] truncate">{task.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                {task.projectName} · {task.startDate} ~ {task.endDate}
                                                {task.isMilestone && <span className="ml-2 text-amber-600">마일스톤</span>}
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                투입: {task.assignments?.length
                                                    ? task.assignments.map(a => `${a.assignee} (${a.allocationPercent}%)`).join(', ')
                                                    : (task.assignee || '미배정')}
                                            </div>
                                        </div>
                                        {(() => {
                                                const sc = wbsSettings.statusConfigs.find(c => c.id === task.status);
                                                const colorProps = getStatusColorProps(sc?.color || "bg-slate-50 border-slate-100");
                                                return (
                                                    <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border shrink-0", colorProps.className, "text-stone-700")} style={colorProps.style}>
                                                        {sc?.name ?? task.status}
                                                    </span>
                                                );
                                            })()}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>

                {/* Project List */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                        <Briefcase className="text-[var(--color-accent)]" size={24} />
                        프로젝트별 상태
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {/* Overall portfolio card */}
                        {projects.length > 0 && (
                            <ProjectCard
                                key="__all-projects"
                                project={{
                                    id: '__all-projects',
                                    name: '전체 프로젝트',
                                    description: '전체 포트폴리오 기준 합산 현황',
                                    startDate: summary.earliestStartDate ?? undefined,
                                    stats: {
                                        total: summary.totalTasks,
                                        statusCounts: summary.statusCounts,
                                        progress: summary.avgProgress,
                                        assigneeCount: summary.assigneeCount,
                                    },
                                }}
                                onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '' })}
                            />
                        )}

                        {visibleProjectStats.map(project => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                onClick={() => onNavigate?.('list', { projectId: project.id, status: 'all', assignee: '' })}
                            />
                        ))}
                    </div>
                </section>

                {/* Assignee Workload */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                        <Users className="text-purple-500" size={24} />
                        인원별 투입 현황
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {assigneeStats.map(stat => (
                            <AssigneeCard
                                key={stat.name}
                                stat={stat}
                                onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: stat.name === '미지정' ? '' : stat.name })}
                            />
                        ))}
                    </div>
                </section>

            </div>
        </div>
    );
}

function SummaryCard({ title, value, subtitle, highlight, onClick }: { title: string; value: number | React.ReactNode; subtitle: string; highlight?: string; onClick?: () => void }) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "card-elevated p-6 flex flex-col justify-center transform hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group/card",
                onClick && "cursor-pointer hover:border-indigo-200"
            )}
        >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent group-hover/card:via-indigo-400 transition-colors duration-500 opacity-0 group-hover/card:opacity-100" />
            <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{title}</div>
            <div className={cn("text-3xl font-bold tracking-tight", highlight || "text-[var(--color-ink)]")}>{value}</div>
            {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
        </div>
    );
}

function ProjectCard({ project, onClick }: { project: any; onClick?: () => void; key?: React.Key }) {
    const { wbsSettings } = useWBS();
    const s = project.stats;

    return (
        <div
            onClick={onClick}
            className={cn(
                "card flex flex-col overflow-hidden group",
                onClick && "cursor-pointer hover:border-indigo-200"
            )}
        >
            <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-white to-slate-50/30">
                <h3 className="text-[17px] font-bold text-[var(--color-ink)] mb-1.5 truncate group-hover:text-indigo-600 transition-colors" title={project.name}>
                    {project.name}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-1 mb-3 h-4">
                    {project.description || '설명 없음'}
                </p>

                <div className="flex items-center gap-2 mb-2">
                    <div className="text-[11px] font-bold text-slate-500 w-12 tracking-wide">진척율</div>
                    <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                        <div
                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000 ease-out"
                            style={{ width: `${s.progress}%` }}
                        />
                    </div>
                    <div className="text-xs font-bold text-[var(--color-ink)] w-8 text-right">{formatNum2(s.progress)}%</div>
                </div>
            </div>

            <div className="p-6 flex-1 flex flex-col justify-between bg-white">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {wbsSettings.statusConfigs.map(config => {
                        // Extract color classes from template or config
                        let colorClasses = "bg-slate-50 text-slate-600 border border-slate-100";
                        if (config.id === 'done') colorClasses = "bg-emerald-50 text-emerald-600 border border-emerald-100/50 shadow-sm";
                        if (config.id === 'in-progress') colorClasses = "bg-indigo-50 text-indigo-600 border border-indigo-100/50 shadow-sm";
                        if (config.id === 'blocked') colorClasses = "bg-red-50 text-red-600 border border-red-100/50 shadow-sm";

                        return (
                            <StatBadge
                                key={config.id}
                                label={config.name}
                                count={s.statusCounts[config.id] || 0}
                                color={colorClasses}
                            />
                        );
                    })}
                </div>

                <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 pt-4 border-t border-slate-100/80">
                    <div className="flex items-center gap-1.5">
                        <Clock size={13} className="text-slate-300" />
                        <span>시작: {project.startDate ? project.startDate : '미정'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">작업 {s.total}</span>
                        <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">팀원 {s.assigneeCount}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AssigneeCard({ stat, onClick }: { stat: any; onClick?: () => void; key?: React.Key }) {
    const { wbsSettings } = useWBS();
    const total = stat.total || 1;

    return (
        <div
            onClick={onClick}
            className={cn(
                "card p-5 group",
                onClick && "cursor-pointer hover:border-indigo-200"
            )}
        >
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-[var(--color-ink)] font-bold text-lg">
                        {stat.name.substring(0, 1)}
                    </div>
                    <div className="overflow-hidden">
                        <div className="font-bold text-[var(--color-ink)] truncate">{stat.name}</div>
                        <div className="text-[10px] text-slate-500 font-medium">총 {stat.total}개 작업</div>
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold text-[var(--color-accent)]">{stat.workEffort} M/D</div>
                    <div className="text-[10px] text-slate-500 font-medium tracking-tight">투입 공수</div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                    {wbsSettings.statusConfigs.map(config => {
                        const count = stat.statusCounts[config.id] || 0;
                        const pct = (count / total) * 100;
                        if (pct === 0) return null;

                        let color = "bg-slate-300";
                        if (config.id === 'done') color = "bg-emerald-400";
                        if (config.id === 'in-progress') color = "bg-indigo-400";
                        if (config.id === 'blocked') color = "bg-red-400";

                        return (
                            <div
                                key={config.id}
                                className={cn("h-full", color)}
                                style={{ width: `${pct}%` }}
                                title={`${config.name}: ${Math.round(pct)}%`}
                            />
                        );
                    })}
                </div>

                <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-500 px-0.5">
                    {wbsSettings.statusConfigs.map(config => {
                        const count = stat.statusCounts[config.id] || 0;
                        const pct = (count / total) * 100;
                        if (pct === 0) return null;

                        let dotColor = "bg-slate-300";
                        if (config.id === 'done') dotColor = "bg-emerald-400";
                        if (config.id === 'in-progress') dotColor = "bg-indigo-400";
                        if (config.id === 'blocked') dotColor = "bg-red-400";

                        return (
                            <div key={config.id} className="flex items-center gap-1">
                                <div className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
                                <span>{Math.round(pct)}%</span>
                            </div>
                        );
                    })}
                </div>

                {stat.projectBreakdown && stat.projectBreakdown.length > 0 && (
                    <div className="pt-3 border-t border-slate-100">
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">프로젝트별 투입 공수</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                            {stat.projectBreakdown.map(b => (
                                <span key={b.projectId} className="truncate max-w-[140px]" title={`${b.projectName}: ${b.workEffort} M/D`}>
                                    <span className="font-medium text-[var(--color-ink)]">{b.projectName}</span>
                                    <span className="text-[var(--color-accent)] font-bold ml-1">{b.workEffort} M/D</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatBadge({ label, count, color, key }: { label: string; count: number; color: string; key?: React.Key }) {
    return (
        <div key={key} className={`flex flex-col items-center justify-center p-2.5 rounded-xl transition-transform group-hover:scale-105 duration-300 ${color}`}>
            <span className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-80">{label}</span>
            <span className="text-xl font-black">{count}</span>
        </div>
    );
}
