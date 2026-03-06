import React, { useMemo } from 'react';
import { useWBS } from '../context/WBSContext';
import { Briefcase, Clock, LayoutGrid, Users } from 'lucide-react';
import { cn } from '../lib/utils';

export function Dashboard({ onNavigate }: { onNavigate?: (view: any, filters: any) => void }) {
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

            const progress = total > 0
                ? Math.round(pTasks.reduce((acc, t) => acc + (t.progress || 0), 0) / total)
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

    // Total summary
    const summary = useMemo(() => {
        const doneStatus = wbsSettings.statusConfigs.find(c => c.progress === 100)?.id || 'done';
        const inProgressStatus = wbsSettings.statusConfigs.find(c => c.progress > 0 && c.progress < 100)?.id || 'in-progress';

        return {
            totalProjects: projects.length,
            totalTasks: allTasks.length,
            totalDone: allTasks.filter(t => t.status === doneStatus).length,
            totalInProgress: allTasks.filter(t => t.status === inProgressStatus).length,
        }
    }, [projects, allTasks, wbsSettings.statusConfigs]);

    // Calculate stats by assignee
    const assigneeStats = useMemo(() => {
        const statsMap: Record<string, {
            total: number,
            statusCounts: Record<string, number>,
            workEffort: number
        }> = {};

        allTasks.forEach(task => {
            const assignee = task.assignee || '미지정';
            if (!statsMap[assignee]) {
                const initialStatusCounts: Record<string, number> = {};
                wbsSettings.statusConfigs.forEach(c => initialStatusCounts[c.id] = 0);
                statsMap[assignee] = {
                    total: 0,
                    statusCounts: initialStatusCounts,
                    workEffort: 0
                };
            }
            const s = statsMap[assignee];
            s.total += 1;
            if (s.statusCounts[task.status] !== undefined) {
                s.statusCounts[task.status]++;
            }
            s.workEffort += (task.workEffort || 0);
        });

        return Object.entries(statsMap).map(([name, stats]) => ({
            name,
            ...stats
        })).sort((a, b) => b.total - a.total);
    }, [allTasks, wbsSettings.statusConfigs]);

    // Visitor tracking logic
    const [visitorStats, setVisitorStats] = React.useState({ daily: 0, total: 0 });

    React.useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        const savedTotal = localStorage.getItem('wbs-visit-total') || '0';
        const savedDaily = localStorage.getItem('wbs-visit-daily') || '0';
        const savedDate = localStorage.getItem('wbs-visit-date') || today;

        let newTotal = parseInt(savedTotal);
        let newDaily = parseInt(savedDaily);

        // Check if session started
        const sessionActive = sessionStorage.getItem('wbs-session-active');
        if (!sessionActive) {
            newTotal += 1;
            if (savedDate !== today) {
                newDaily = 1;
            } else {
                newDaily += 1;
            }
            sessionStorage.setItem('wbs-session-active', 'true');
            localStorage.setItem('wbs-visit-total', newTotal.toString());
            localStorage.setItem('wbs-visit-daily', newDaily.toString());
            localStorage.setItem('wbs-visit-date', today);
        } else if (savedDate !== today) {
            // New day while session still active (unlikely but possible)
            newDaily = 1;
            localStorage.setItem('wbs-visit-daily', newDaily.toString());
            localStorage.setItem('wbs-visit-date', today);
        }

        setVisitorStats({ daily: newDaily, total: newTotal });
    }, []);

    return (
        <div className="h-full overflow-y-auto bg-slate-50/60 p-6 md:p-8">
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
                        <SummaryCard title="금일 접속자" value={visitorStats.daily} subtitle="" highlight="text-blue-600" />
                        <SummaryCard title="누적 접속자" value={visitorStats.total} subtitle="" highlight="text-purple-600" />
                    </div>
                </section>

                {/* Project List */}
                <section>
                    <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
                        <Briefcase className="text-[var(--color-accent)]" size={24} />
                        프로젝트별 상태
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {projectStats.map(project => (
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

function SummaryCard({ title, value, subtitle, highlight, onClick }: { title: string; value: number; subtitle: string; highlight?: string; onClick?: () => void }) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "bg-white rounded-xl p-5 border border-[var(--color-line)] shadow-sm flex flex-col justify-center transform hover:scale-[1.02] transition-transform",
                onClick && "cursor-pointer hover:border-[var(--color-accent)]/30 hover:shadow-md"
            )}
        >
            <div className="text-sm font-medium text-slate-500 mb-1">{title}</div>
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
                "bg-white rounded-xl border border-[var(--color-line)] shadow-sm overflow-hidden hover:shadow-md transition-shadow group",
                onClick && "cursor-pointer hover:border-[var(--color-accent)]/30"
            )}
        >
            <div className="p-5 border-b border-slate-200 bg-slate-50/50">
                <h3 className="text-lg font-bold text-[var(--color-ink)] mb-1 truncate" title={project.name}>
                    {project.name}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-1 mb-3 h-4">
                    {project.description || '설명 없음'}
                </p>

                <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-semibold text-slate-500 w-12">진행률</div>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-accent)] transition-all duration-1000 ease-out"
                            style={{ width: `${s.progress}%` }}
                        />
                    </div>
                    <div className="text-xs font-bold text-[var(--color-ink)] w-8 text-right">{s.progress}%</div>
                </div>
            </div>

            <div className="p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {wbsSettings.statusConfigs.map(config => {
                        // Extract color classes from template or config
                        let colorClasses = "bg-slate-50 text-slate-600 border border-slate-100";
                        if (config.id === 'done') colorClasses = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                        if (config.id === 'in-progress') colorClasses = "bg-blue-50 text-blue-600 border border-blue-100";
                        if (config.id === 'blocked') colorClasses = "bg-red-50 text-red-600 border border-red-100";

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

                <div className="flex items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-200">
                    <div className="flex items-center gap-1">
                        <Clock size={12} />
                        <span>시작: {project.startDate ? project.startDate : '미정'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span>총 작업 {s.total}개</span>
                        <span className="text-slate-300">|</span>
                        <span>팀원 {s.assigneeCount}명</span>
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
                "bg-white rounded-xl p-5 border border-[var(--color-line)] shadow-sm hover:shadow-md transition-shadow",
                onClick && "cursor-pointer hover:border-purple-200"
            )}
        >
            <div className="flex items-center justify-between mb-4">
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

            <div className="space-y-3">
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                    {wbsSettings.statusConfigs.map(config => {
                        const count = stat.statusCounts[config.id] || 0;
                        const pct = (count / total) * 100;
                        if (pct === 0) return null;

                        let color = "bg-slate-300";
                        if (config.id === 'done') color = "bg-emerald-400";
                        if (config.id === 'in-progress') color = "bg-blue-400";
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
                        if (config.id === 'in-progress') dotColor = "bg-blue-400";
                        if (config.id === 'blocked') dotColor = "bg-red-400";

                        return (
                            <div key={config.id} className="flex items-center gap-1">
                                <div className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
                                <span>{Math.round(pct)}%</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function StatBadge({ label, count, color, key }: { label: string; count: number; color: string; key?: React.Key }) {
    return (
        <div key={key} className={`flex flex-col items-center justify-center p-2 rounded-lg ${color}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-80">{label}</span>
            <span className="text-xl font-bold">{count}</span>
        </div>
    );
}
