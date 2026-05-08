import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getVisitorStats } from '../lib/db';
import { Briefcase, Clock, LayoutGrid, Flag, Loader2, Bug, Building2, Settings2, Check, User } from 'lucide-react';
import { cn, randomUUID, formatNum2 } from '../lib/utils';
import { getStatusColorProps } from '../lib/statusColor';
import type { Task, Project } from '../types';
import type { WBSSettings, StatusConfig } from '../lib/wbsSettings';
import { useOrganization } from '../context/OrganizationContext';
import type { OrgNode } from '../data/organization';

interface ProjectStats {
  total: number;
  statusCounts: Record<string, number>;
  progress: number;
  assigneeCount: number;
}

/** 주어진 task 목록에서 깊이(depth)를 메모이제이션하여 반환하는 getter 생성 */
function buildDepthGetter(taskById: Map<string, Task>): (id: string) => number {
  const memo = new Map<string, number>();
  const get = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const t = taskById.get(id);
    if (!t || !t.parentId || !taskById.has(t.parentId)) {
      memo.set(id, 0);
      return 0;
    }
    const d = get(t.parentId) + 1;
    memo.set(id, d);
    return d;
  };
  return get;
}

/** progress × weight 가중평균 진척율 계산 */
function computeWeightedProgress(items: Task[]): number {
  let totalWeight = 0;
  let acc = 0;
  for (const t of items) {
    const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    const w =
      typeof t.weight === 'number' && Number.isFinite(t.weight)
        ? t.weight
        : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
          ? t.workEffort
          : 0;
    totalWeight += w;
    acc += p * w;
  }
  if (totalWeight > 0) return Math.round(acc / totalWeight);
  if (items.length > 0) return Math.round(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length);
  return 0;
}

export function Dashboard({
  onNavigate,
  registeredMemberDisplayNames,
  accessibleProjectIds,
  myInvolvedProjectIds,
  currentUserDisplay,
}: {
  onNavigate?: (view: string, filters: Record<string, string>) => void;
  registeredMemberDisplayNames?: Set<string>;
  /** undefined: 전체(관리자). Set이면 그 ID 집합에 속한 프로젝트만 노출 (본인 참여 프로젝트). */
  accessibleProjectIds?: Set<string>;
  /** "내가 포함된 프로젝트" 빠른 필터 대상 ID. owner/멤버/작업 담당자 매칭. undefined면 토글 비활성. */
  myInvolvedProjectIds?: Set<string>;
  /** 현재 사용자 표시 이름. 부서 매칭("내가 포함된 부서") 등에 사용. */
  currentUserDisplay?: string;
}) {
  const { projects: allProjects, allTasks: allTasksRaw, wbsSettings } = useWBS();
  // 권한 필터: accessibleProjectIds가 주어지면 그 집합으로 프로젝트와 작업을 좁힘.
  const projects = useMemo(
    () => (accessibleProjectIds ? allProjects.filter((p) => accessibleProjectIds.has(p.id)) : allProjects),
    [allProjects, accessibleProjectIds],
  );
  const allTasks = useMemo(
    () => (accessibleProjectIds ? allTasksRaw.filter((t) => accessibleProjectIds.has(t.projectId)) : allTasksRaw),
    [allTasksRaw, accessibleProjectIds],
  );
  const { orgTree, orgMembers } = useOrganization();

  // 조직 트리의 최상위 자식(사업부/본부) 목록
  const topLevelDivisions = useMemo<OrgNode[]>(() => orgTree.children?.[0]?.children ?? [], [orgTree]);

  // 멤버 이름 → 최상위 사업부/본부 ID 매핑 (자식 노드 포함 모든 멤버를 그 division에 매핑)
  const memberToDivisionId = useMemo(() => {
    const m = new Map<string, string>();
    const collect = (node: OrgNode, divisionId: string) => {
      const deptSet = new Set(node.departments ?? []);
      for (const member of orgMembers) {
        if (deptSet.has(member.department) && !m.has(member.name)) m.set(member.name, divisionId);
      }
      for (const child of node.children ?? []) collect(child, divisionId);
    };
    topLevelDivisions.forEach((division) => collect(division, division.id));
    return m;
  }, [topLevelDivisions, orgMembers]);

  // 공유 파생 데이터 — 여러 useMemo에서 재사용
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  // 자식이 있는 task의 ID 집합 — leaf 판별 O(n)화
  const parentIdSet = useMemo(() => {
    const s = new Set<string>();
    allTasks.forEach((t) => {
      if (t.parentId) s.add(t.parentId);
    });
    return s;
  }, [allTasks]);

  // Calculate stats for each project
  const projectStats = useMemo(() => {
    return projects.map((project) => {
      const pTasks = allTasks.filter((t) => t.projectId === project.id);
      const total = pTasks.length;

      // Dynamic status counts
      const statusCounts: Record<string, number> = {};
      wbsSettings.statusConfigs.forEach((c) => (statusCounts[c.id] = 0));
      pTasks.forEach((t) => {
        if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
      });

      const assignees = Array.from(new Set(pTasks.map((t) => t.assignee).filter(Boolean)));

      // 전체 진척율: 1레벨 WBS의 (progress×weight) 가중평균 우선. (weight 없으면 공수로 대체)
      // 1레벨이 없으면 폴백으로 리프(단말) 단순 평균.
      const taskById = new Map<string, Task>(pTasks.map((t) => [t.id, t]));
      const getDepth = buildDepthGetter(taskById);
      const level1 = pTasks.filter((t) => getDepth(t.id) === 1);
      // 프로젝트 내 부모 ID 세트로 leaf 판별 O(n)화
      const pParentIdSet = new Set(pTasks.map((t) => t.parentId).filter(Boolean));
      const leafTasks = pTasks.filter((t) => !pParentIdSet.has(t.id));
      const forAggregate = leafTasks.length > 0 ? leafTasks : pTasks;
      const progress =
        level1.length > 0
          ? computeWeightedProgress(level1)
          : forAggregate.length > 0
            ? Math.round(forAggregate.reduce((acc, t) => acc + (t.progress || 0), 0) / forAggregate.length)
            : 0;

      return {
        ...project,
        stats: {
          total,
          statusCounts,
          progress,
          assigneeCount: assignees.length,
        },
      };
    });
  }, [projects, allTasks, wbsSettings.statusConfigs]);

  // 작업(WBS) 0개인 프로젝트는 대시보드에서 숨김
  const visibleProjectStats = useMemo(() => projectStats.filter((p) => (p?.stats?.total ?? 0) > 0), [projectStats]);

  // ─── 대시보드 표시 프로젝트 사용자 선택 (localStorage 저장) ──────────────
  // null = 모든 프로젝트 표시 (기본). Set = 명시적으로 선택된 프로젝트만 표시.
  const DASHBOARD_VISIBLE_KEY = 'wbs-dashboard-visible-project-ids';
  const [dashboardVisibleIds, setDashboardVisibleIds] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_VISIBLE_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set<string>(arr.filter((x): x is string => typeof x === 'string')) : null;
    } catch {
      return null;
    }
  });
  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const projectPickerRef = useRef<HTMLDivElement>(null);

  // 선택 외부 클릭 시 닫기
  useEffect(() => {
    if (!isProjectPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (projectPickerRef.current && !projectPickerRef.current.contains(e.target as Node)) {
        setIsProjectPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isProjectPickerOpen]);

  const persistDashboardVisible = (next: Set<string> | null) => {
    if (next === null) {
      localStorage.removeItem(DASHBOARD_VISIBLE_KEY);
    } else {
      localStorage.setItem(DASHBOARD_VISIBLE_KEY, JSON.stringify(Array.from(next)));
    }
    setDashboardVisibleIds(next);
  };
  const toggleDashboardProject = (id: string) => {
    // 현재 null(=모두 표시)이면 모든 프로젝트 ID로 채운 뒤 클릭한 것 토글
    const base: Set<string> = dashboardVisibleIds ?? new Set<string>(visibleProjectStats.map((p) => p.id as string));
    const next = new Set<string>(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDashboardVisible(next);
  };
  const showAllDashboardProjects = () => persistDashboardVisible(null);

  // ─── 빠른 필터: 내가 포함된 프로젝트만 ──────────────────────────────────
  const MY_ONLY_KEY = 'wbs-dashboard-my-only';
  const [showMyOnly, setShowMyOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MY_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleShowMyOnly = () => {
    setShowMyOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(MY_ONLY_KEY, '1');
        else localStorage.removeItem(MY_ONLY_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 사용자 선택 + "내 프로젝트만" 토글 적용한 최종 표시 목록.
  // 우선순위: showMyOnly가 켜져 있으면 그것만 적용 (사용자 체크 선택은 무시).
  // 아니면 사용자 체크 선택이 있으면 그것 적용. 둘 다 없으면 전체.
  const displayProjectStats = useMemo(() => {
    if (showMyOnly && myInvolvedProjectIds) {
      return visibleProjectStats.filter((p) => myInvolvedProjectIds.has(p.id));
    }
    if (!dashboardVisibleIds) return visibleProjectStats;
    return visibleProjectStats.filter((p) => dashboardVisibleIds.has(p.id));
  }, [visibleProjectStats, dashboardVisibleIds, showMyOnly, myInvolvedProjectIds]);

  // Total summary (전체 진척율: 1레벨 가중평균 우선, 폴백으로 리프 평균)
  const summary = useMemo(() => {
    const doneStatus = wbsSettings.statusConfigs.find((c) => c.progress === 100)?.id || 'done';
    const inProgressStatus = wbsSettings.statusConfigs.find((c) => c.progress > 0 && c.progress < 100)?.id || 'in-progress';

    const totalTasks = allTasks.length;
    const taskById = new Map<string, Task>(allTasks.map((t) => [t.id, t]));
    const getDepth = buildDepthGetter(taskById);
    const level1 = allTasks.filter((t) => getDepth(t.id) === 1);
    // parentIdSet(공유)으로 leaf 판별 O(n)화
    const leafTasks = allTasks.filter((t) => !parentIdSet.has(t.id));
    const forAggregate = leafTasks.length > 0 ? leafTasks : allTasks;
    const avgProgress =
      level1.length > 0
        ? computeWeightedProgress(level1)
        : forAggregate.length > 0
          ? Math.round(forAggregate.reduce((sum, t) => sum + (t.progress || 0), 0) / forAggregate.length)
          : 0;

    // Global status counts across all projects
    const statusCounts: Record<string, number> = {};
    wbsSettings.statusConfigs.forEach((c) => (statusCounts[c.id] = 0));
    allTasks.forEach((t) => {
      if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
    });

    // Global assignee counts
    const assignees = Array.from(new Set(allTasks.map((t) => t.assignee).filter(Boolean)));

    // Earliest project start date
    let earliestStartDate: string | null = null;
    projects.forEach((p) => {
      if (p.startDate) {
        if (!earliestStartDate || p.startDate < earliestStartDate) {
          earliestStartDate = p.startDate;
        }
      }
    });

    const totalMilestones = allTasks.filter((t) => t.isMilestone).length;

    return {
      totalProjects: projects.length,
      totalTasks,
      totalDone: allTasks.filter((t) => t.status === doneStatus).length,
      totalInProgress: allTasks.filter((t) => t.status === inProgressStatus).length,
      totalMilestones,
      avgProgress,
      statusCounts,
      assigneeCount: assignees.length,
      earliestStartDate,
    };
  }, [projects, allTasks, wbsSettings.statusConfigs, parentIdSet]);

  // 마일스톤 목록 (날짜순)
  const milestones = useMemo(() => {
    return allTasks
      .filter((t) => t.isMilestone)
      .map((t) => ({
        ...t,
        projectName: projectMap.get(t.projectId)?.name ?? '-',
      }))
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  }, [allTasks, projectMap]);

  // 이슈 작업 목록 (상위 50건, 종료일 빠른 순)
  const issueTasks = useMemo(() => {
    return allTasks
      .filter((t) => t.isIssue)
      .sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''))
      .slice(0, 50);
  }, [allTasks]);

  // 사업부/본부별 작업 현황 집계 (담당자 이름이 그 division의 멤버에 매핑되는 작업들)
  const divisionStats = useMemo(() => {
    const doneStatusIds = new Set((wbsSettings.statusConfigs ?? []).filter((c) => c.progress === 100).map((c) => c.id));
    const stats = topLevelDivisions.map((division) => {
      const tasks = allTasks.filter((t) => {
        const a = (t.assignee || '').trim();
        return !!a && memberToDivisionId.get(a) === division.id;
      });
      const total = tasks.length;
      const doneCount = tasks.filter((t) => doneStatusIds.has(t.status) || (typeof t.progress === 'number' && t.progress >= 100)).length;
      const issueCount = tasks.filter((t) => t.isIssue).length;
      const assigneeSet = new Set(tasks.map((t) => (t.assignee || '').trim()).filter(Boolean));
      const progress = computeWeightedProgress(tasks);
      return {
        id: division.id,
        name: division.name,
        total,
        doneCount,
        issueCount,
        progress,
        assigneeCount: assigneeSet.size,
      };
    });
    // 작업이 있는 사업부 우선 + 인원만 있는 사업부도 보여주기
    return stats.sort((a, b) => b.total - a.total || b.assigneeCount - a.assigneeCount);
  }, [topLevelDivisions, allTasks, memberToDivisionId, wbsSettings.statusConfigs]);

  // ─── 사업부 표시 필터 (사용자 선택 + 내가 포함된 부서 토글) ─────────────
  const DIVISION_VISIBLE_KEY = 'wbs-dashboard-visible-division-ids';
  const DIVISION_MY_ONLY_KEY = 'wbs-dashboard-division-my-only';
  const [divisionVisibleIds, setDivisionVisibleIds] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(DIVISION_VISIBLE_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? new Set<string>(arr.filter((x): x is string => typeof x === 'string')) : null;
    } catch {
      return null;
    }
  });
  const [showMyDivisionOnly, setShowMyDivisionOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DIVISION_MY_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [isDivisionPickerOpen, setIsDivisionPickerOpen] = useState(false);
  const divisionPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isDivisionPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (divisionPickerRef.current && !divisionPickerRef.current.contains(e.target as Node)) {
        setIsDivisionPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isDivisionPickerOpen]);

  const persistDivisionVisible = (next: Set<string> | null) => {
    if (next === null) localStorage.removeItem(DIVISION_VISIBLE_KEY);
    else localStorage.setItem(DIVISION_VISIBLE_KEY, JSON.stringify(Array.from(next)));
    setDivisionVisibleIds(next);
  };
  const toggleDivision = (id: string) => {
    const base: Set<string> = divisionVisibleIds ?? new Set<string>(divisionStats.map((d) => d.id));
    const next = new Set<string>(base);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistDivisionVisible(next);
  };
  const showAllDivisions = () => persistDivisionVisible(null);
  const toggleShowMyDivisionOnly = () => {
    setShowMyDivisionOnly((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(DIVISION_MY_ONLY_KEY, '1');
        else localStorage.removeItem(DIVISION_MY_ONLY_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 현재 사용자가 속한 부서 ID (organizationMembers의 이름 매칭)
  const myDivisionId = useMemo(() => {
    const name = (currentUserDisplay || '').trim();
    if (!name) return undefined;
    return memberToDivisionId.get(name);
  }, [currentUserDisplay, memberToDivisionId]);

  // 사용자 선택 + "내 부서만" 토글 적용한 최종 표시 부서 목록.
  // 우선순위: showMyDivisionOnly가 켜져 있으면 그것만 적용. 아니면 사용자 체크 선택.
  const displayDivisionStats = useMemo(() => {
    if (showMyDivisionOnly) {
      if (!myDivisionId) return [];
      return divisionStats.filter((d) => d.id === myDivisionId);
    }
    if (!divisionVisibleIds) return divisionStats;
    return divisionStats.filter((d) => divisionVisibleIds.has(d.id));
  }, [divisionStats, divisionVisibleIds, showMyDivisionOnly, myDivisionId]);

  // Visitor tracking: DB 기반 (Supabase)
  const { user } = useAuth();
  const [visitorStats, setVisitorStats] = React.useState({ daily: 0, total: 0 });
  const [loadingVisitorStats, setLoadingVisitorStats] = React.useState(false);

  React.useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !user) {
      setVisitorStats({ daily: 0, total: 0 });
      setLoadingVisitorStats(false);
      return;
    }

    const run = async () => {
      setLoadingVisitorStats(true);
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
      } finally {
        setLoadingVisitorStats(false);
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
                const inProgressStatus = wbsSettings.statusConfigs.find((c) => c.progress > 0 && c.progress < 100)?.id || 'in-progress';
                onNavigate?.('kanban', { projectId: 'all', status: inProgressStatus, assignee: '' });
              }}
            />
            <SummaryCard
              title="완료된 작업"
              value={summary.totalDone}
              subtitle=""
              onClick={() => {
                const doneStatus = wbsSettings.statusConfigs.find((c) => c.progress === 100)?.id || 'done';
                onNavigate?.('list', { projectId: 'all', status: doneStatus, assignee: '' });
              }}
            />
            <SummaryCard title="평균 진척율" value={`${summary.avgProgress}%`} subtitle="" highlight="text-emerald-600" />
            <SummaryCard
              title="마일스톤"
              value={summary.totalMilestones}
              subtitle=""
              highlight="text-amber-600"
              onClick={() => onNavigate?.('list', { projectId: 'all', status: 'all', assignee: '' })}
            />
            <SummaryCard
              title="금일 접속자"
              value={loadingVisitorStats ? <Loader2 size={14} className="animate-spin text-stone-400" /> : visitorStats.daily}
              subtitle=""
              highlight="text-blue-600"
            />
            <SummaryCard
              title="누적 접속자"
              value={loadingVisitorStats ? <Loader2 size={14} className="animate-spin text-stone-400" /> : visitorStats.total}
              subtitle=""
              highlight="text-purple-600"
            />
          </div>
        </section>

        {/* 이슈 작업 목록 — 전체 현황 요약 바로 아래 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--color-ink)] mb-4 flex items-center gap-2">
            <Bug className="text-rose-500" size={24} />
            이슈 작업
            <span className="text-sm font-medium text-stone-400">{issueTasks.length}건</span>
          </h2>
          {issueTasks.length === 0 ? (
            <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
              등록된 이슈 작업이 없습니다.
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr className="text-xs text-stone-500">
                    <th className="text-left font-medium px-3 py-2">작업명</th>
                    <th className="text-left font-medium px-3 py-2 w-40">프로젝트</th>
                    <th className="text-left font-medium px-3 py-2 w-28">담당자</th>
                    <th className="text-left font-medium px-3 py-2 w-28">종료일</th>
                    <th className="text-right font-medium px-3 py-2 w-20">진척률</th>
                  </tr>
                </thead>
                <tbody>
                  {issueTasks.map((t) => {
                    const proj = projectMap.get(t.projectId);
                    return (
                      <tr
                        key={t.id}
                        className="border-t border-stone-100 hover:bg-stone-50/60 cursor-pointer"
                        onClick={() => onNavigate?.('list', { projectId: t.projectId, status: 'all', assignee: '' })}
                        title="작업 보기로 이동"
                      >
                        <td className="px-3 py-2 text-stone-800">
                          <div className="flex items-center gap-1.5">
                            <Bug size={12} className="text-rose-500 shrink-0" />
                            <span className="truncate">{t.name || '(이름 없음)'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-stone-600 truncate">{proj?.name ?? '—'}</td>
                        <td className="px-3 py-2 text-stone-600 truncate">{t.assignee || '—'}</td>
                        <td className="px-3 py-2 text-stone-500 tabular-nums">{t.endDate || '—'}</td>
                        <td className="px-3 py-2 text-right text-stone-600 tabular-nums">
                          {typeof t.progress === 'number' ? `${formatNum2(t.progress)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 사업부·부서별 현황 */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Building2 className="text-sky-500" size={24} />
              사업부·부서별 현황
              <span className="text-sm font-normal text-stone-500 ml-1">
                ({displayDivisionStats.length}
                {(divisionVisibleIds || showMyDivisionOnly) && divisionStats.length !== displayDivisionStats.length
                  ? ` / ${divisionStats.length}`
                  : ''}
                개)
              </span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* 내 부서만 토글 */}
              {currentUserDisplay && (
                <button
                  type="button"
                  onClick={toggleShowMyDivisionOnly}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                    showMyDivisionOnly
                      ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
                      : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
                  )}
                  title={myDivisionId ? '내가 소속된 부서만 표시' : '조직도에서 본인 매칭 안 됨'}
                  aria-pressed={showMyDivisionOnly}
                  disabled={!myDivisionId}
                >
                  <User size={13} />
                  내가 포함된 부서만
                  {showMyDivisionOnly && <Check size={12} strokeWidth={3} />}
                </button>
              )}
              {/* 필터 (부서 표시) */}
              <div className="relative" ref={divisionPickerRef}>
                <button
                  type="button"
                  onClick={() => setIsDivisionPickerOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 transition-colors"
                  title="대시보드에 표시할 부서 선택"
                >
                  <Settings2 size={13} />
                  필터
                  {divisionVisibleIds && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-bold">
                      {divisionVisibleIds.size}
                    </span>
                  )}
                </button>
                {isDivisionPickerOpen && (
                  <div className="absolute right-0 mt-2 w-72 max-h-[60vh] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl z-30 p-2">
                    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stone-100 mb-1">
                      <span className="text-[11px] font-bold text-stone-500 uppercase whitespace-nowrap">표시할 부서</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => persistDivisionVisible(new Set(divisionStats.map((d) => d.id)))}
                          className="text-[11px] text-sky-600 hover:text-sky-800 font-medium"
                          title="모든 부서 선택"
                        >
                          모두 선택
                        </button>
                        <button
                          type="button"
                          onClick={() => persistDivisionVisible(new Set())}
                          className="text-[11px] text-stone-500 hover:text-stone-700 font-medium"
                          title="모든 부서 해제"
                        >
                          모두 해제
                        </button>
                      </div>
                    </div>
                    {divisionStats.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-stone-400 text-center">표시 가능한 부서가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {divisionStats.map((d) => {
                          const checked = divisionVisibleIds === null ? true : divisionVisibleIds.has(d.id);
                          return (
                            <li key={d.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border',
                                    checked ? 'bg-sky-600 border-sky-600 text-white' : 'border-stone-300 bg-white',
                                  )}
                                >
                                  {checked && <Check size={11} strokeWidth={3} />}
                                </span>
                                <input type="checkbox" checked={checked} onChange={() => toggleDivision(d.id)} className="sr-only" />
                                <span className="text-sm text-stone-700 truncate" title={d.name}>
                                  {d.name}
                                </span>
                                <span className="ml-auto text-[10px] text-stone-400 shrink-0">{d.assigneeCount}명</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="px-2 pt-2 mt-1 border-t border-stone-100">
                      <button
                        type="button"
                        onClick={showAllDivisions}
                        className="w-full text-[11px] text-stone-500 hover:text-sky-700 font-medium py-1"
                        title="필터 해제 (기본 상태로)"
                      >
                        필터 초기화 (기본)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {displayDivisionStats.length === 0 ? (
            <div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
              {divisionStats.length === 0
                ? '조직도 데이터를 불러오는 중이거나 매칭되는 부서가 없습니다.'
                : showMyDivisionOnly
                  ? '내가 포함된 부서가 조직도에서 매칭되지 않습니다. 토글을 해제하세요.'
                  : '[필터]에서 표시할 부서를 선택하세요. (또는 필터 초기화)'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {displayDivisionStats.map((d) => (
                <div key={d.id} className="bg-white border border-stone-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="font-semibold text-stone-800 truncate" title={d.name}>
                      {d.name}
                    </h3>
                    <span className="text-xs text-stone-400 shrink-0 ml-2">{d.assigneeCount}명</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <div className="text-lg font-bold text-stone-700 tabular-nums">{d.total}</div>
                      <div className="text-[10px] text-stone-400">전체</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-emerald-600 tabular-nums">{d.doneCount}</div>
                      <div className="text-[10px] text-stone-400">완료</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-rose-600 tabular-nums">{d.issueCount}</div>
                      <div className="text-[10px] text-stone-400">이슈</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, d.progress)}%` }} />
                    </div>
                    <span className="text-[11px] font-semibold text-stone-600 tabular-nums w-10 text-right">{d.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                {milestones.map((task) => (
                  <li
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onNavigate?.('list', { projectId: task.projectId, status: 'all', assignee: '' })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onNavigate?.('list', { projectId: task.projectId, status: 'all', assignee: '' });
                      }
                    }}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                      <Flag size={18} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[var(--color-ink)] truncate">{task.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {task.projectName} · {task.startDate}
                      </div>
                    </div>
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
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Project List */}
        <section>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Briefcase className="text-[var(--color-accent)]" size={24} />
              프로젝트별 상태
              <span className="text-sm font-normal text-stone-500 ml-1">
                ({displayProjectStats.length}
                {(dashboardVisibleIds || showMyOnly) && visibleProjectStats.length !== displayProjectStats.length
                  ? ` / ${visibleProjectStats.length}`
                  : ''}
                개)
              </span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* 내가 포함된 프로젝트만 토글 */}
              {myInvolvedProjectIds && (
                <button
                  type="button"
                  onClick={toggleShowMyOnly}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                    showMyOnly
                      ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
                  )}
                  title="소유자·멤버·작업 담당자(이름 매칭) 중 하나라도 해당하면 포함"
                  aria-pressed={showMyOnly}
                >
                  <User size={13} />
                  내가 포함된 프로젝트만
                  {showMyOnly && <Check size={12} strokeWidth={3} />}
                </button>
              )}
              {/* 필터 (프로젝트 표시) */}
              <div className="relative" ref={projectPickerRef}>
                <button
                  type="button"
                  onClick={() => setIsProjectPickerOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 transition-colors"
                  title="대시보드에 표시할 프로젝트 선택"
                >
                  <Settings2 size={13} />
                  필터
                  {dashboardVisibleIds && (
                    <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                      {dashboardVisibleIds.size}
                    </span>
                  )}
                </button>
                {isProjectPickerOpen && (
                  <div className="absolute right-0 mt-2 w-72 max-h-[60vh] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl z-30 p-2">
                    <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stone-100 mb-1">
                      <span className="text-[11px] font-bold text-stone-500 uppercase whitespace-nowrap">표시할 프로젝트</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => persistDashboardVisible(new Set(visibleProjectStats.map((p) => p.id as string)))}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                          title="모든 프로젝트 선택"
                        >
                          모두 선택
                        </button>
                        <button
                          type="button"
                          onClick={() => persistDashboardVisible(new Set())}
                          className="text-[11px] text-stone-500 hover:text-stone-700 font-medium"
                          title="모든 프로젝트 해제"
                        >
                          모두 해제
                        </button>
                      </div>
                    </div>
                    {visibleProjectStats.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-stone-400 text-center">표시 가능한 프로젝트가 없습니다.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {visibleProjectStats.map((p) => {
                          const checked = dashboardVisibleIds === null ? true : dashboardVisibleIds.has(p.id);
                          return (
                            <li key={p.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 cursor-pointer">
                                <span
                                  className={cn(
                                    'inline-flex items-center justify-center w-4 h-4 rounded border',
                                    checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stone-300 bg-white',
                                  )}
                                >
                                  {checked && <Check size={11} strokeWidth={3} />}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDashboardProject(p.id)}
                                  className="sr-only"
                                />
                                <span className="text-sm text-stone-700 truncate" title={p.name}>
                                  {p.name}
                                </span>
                                <span className="ml-auto text-[10px] text-stone-400 shrink-0">{p.stats?.total ?? 0}건</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="px-2 pt-2 mt-1 border-t border-stone-100">
                      <button
                        type="button"
                        onClick={showAllDashboardProjects}
                        className="w-full text-[11px] text-stone-500 hover:text-indigo-700 font-medium py-1"
                        title="필터 해제 (기본 상태로)"
                      >
                        필터 초기화 (기본)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {displayProjectStats.length === 0 ? (
              <div className="col-span-full text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
                {visibleProjectStats.length === 0
                  ? '작업이 있는 프로젝트가 없습니다.'
                  : showMyOnly
                    ? '내가 포함된 프로젝트가 없습니다. [내가 포함된 프로젝트만] 토글을 해제하세요.'
                    : '[필터]에서 표시할 프로젝트를 선택하세요. (또는 필터 초기화)'}
              </div>
            ) : (
              displayProjectStats.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onClick={() => onNavigate?.('list', { projectId: project.id, status: 'all', assignee: '' })}
                  wbsSettings={wbsSettings}
                />
              ))
            )}
          </div>
        </section>

        {/* 번다운 차트: 일시 숨김 처리 (관리자에게도 비표시) */}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  highlight,
  onClick,
}: {
  title: string;
  value: number | React.ReactNode;
  subtitle: string;
  highlight?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'card-elevated p-6 flex flex-col justify-center transform hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group/card',
        onClick && 'cursor-pointer hover:border-indigo-200',
      )}
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent group-hover/card:via-indigo-400 transition-colors duration-500 opacity-0 group-hover/card:opacity-100" />
      <div className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">{title}</div>
      <div className={cn('text-3xl font-bold tracking-tight', highlight || 'text-[var(--color-ink)]')}>{value}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  );
}

function ProjectCard({
  project,
  onClick,
  wbsSettings,
}: {
  project: Project & { stats: ProjectStats };
  onClick?: () => void;
  key?: React.Key;
  wbsSettings: WBSSettings;
}) {
  const s = project.stats;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn('card flex flex-col overflow-hidden group', onClick && 'cursor-pointer hover:border-indigo-200')}
    >
      <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-white to-slate-50/30">
        <h3
          className="text-[17px] font-bold text-[var(--color-ink)] mb-1.5 truncate group-hover:text-indigo-600 transition-colors"
          title={project.name}
        >
          {project.name}
        </h3>
        <p className="text-xs text-slate-500 line-clamp-1 mb-3 h-4">{project.description || '설명 없음'}</p>

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
          {wbsSettings.statusConfigs.map((config) => {
            // Extract color classes from template or config
            let colorClasses = 'bg-slate-50 text-slate-600 border border-slate-100';
            if (config.id === 'done') colorClasses = 'bg-emerald-50 text-emerald-600 border border-emerald-100/50 shadow-sm';
            if (config.id === 'in-progress') colorClasses = 'bg-indigo-50 text-indigo-600 border border-indigo-100/50 shadow-sm';
            if (config.id === 'blocked') colorClasses = 'bg-red-50 text-red-600 border border-red-100/50 shadow-sm';

            return <StatBadge key={config.id} label={config.name} count={s.statusCounts[config.id] || 0} color={colorClasses} />;
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

function StatBadge({ label, count, color, key }: { label: string; count: number; color: string; key?: React.Key }) {
  return (
    <div
      key={key}
      className={`flex flex-col items-center justify-center p-2.5 rounded-xl transition-transform group-hover:scale-105 duration-300 ${color}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-80">{label}</span>
      <span className="text-xl font-black">{count}</span>
    </div>
  );
}
