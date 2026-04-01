import React, { useMemo, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { Briefcase, Users, Edit, ChevronRight, UserCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { Project, ProjectAssignment } from '../types';

interface AllocationOverviewPageProps {
  /** 등록 회원 표시명 집합. 있으면 "회원만 표시" 토글이 노출되고, 켜면 이 집합에 있는 담당자만 표시 */
  registeredMemberDisplayNames?: Set<string>;
  onEditProject?: (project: Project) => void;
  onNavigateToWork?: (projectId: string) => void;
}

type ViewMode = 'by-project' | 'by-person';

function normalizeProjectAssignments(
  assignments: ProjectAssignment[]
): Array<{ assignee: string; allocationPercent: number; monthlyAllocations?: Record<string, number> }> {
  const map = new Map<string, { allocationPercent: number; monthlyAllocations?: Record<string, number> }>();
  for (const a of assignments) {
    const name = (a.assignee || '').trim() || '(미지정)';
    const pct = Number(a.allocationPercent || 0);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    if (!map.has(name)) map.set(name, { allocationPercent: 0, monthlyAllocations: undefined });
    const cur = map.get(name)!;
    cur.allocationPercent += pct;
    if (a.monthlyAllocations && Object.keys(a.monthlyAllocations).length > 0 && !cur.monthlyAllocations) {
      cur.monthlyAllocations = a.monthlyAllocations;
    }
  }
  return Array.from(map.entries())
    .map(([assignee, v]) => ({ assignee, allocationPercent: v.allocationPercent, monthlyAllocations: v.monthlyAllocations }))
    .sort((a, b) => b.allocationPercent - a.allocationPercent);
}

export function AllocationOverviewPage({ registeredMemberDisplayNames, onEditProject, onNavigateToWork }: AllocationOverviewPageProps) {
  const { projects, allTasks, renameAssignee } = useWBS();
  const [viewMode, setViewMode] = useState<ViewMode>('by-project');
  const [membersOnly, setMembersOnly] = useState(false);
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // 프로젝트별 투입 현황 (assignments가 있는 프로젝트만, 또는 전체)
  const projectAllocations = useMemo(() => {
    return projects
      .filter(p => p.assignments && p.assignments.length > 0)
      .map(p => {
        const assignments = normalizeProjectAssignments(p.assignments!);
        return {
          project: p,
          assignments,
          totalPercent: assignments.reduce((s, a) => s + (a.allocationPercent || 0), 0),
        };
      });
  }, [projects]);

  // 인원별·프로젝트별 실제 투입 공수(M/D): 작업 공수 합계
  const personProjectWorkEffort = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    allTasks.forEach(task => {
      const person = (task.assignee || '').trim() || '(미지정)';
      const effort = Number(task.workEffort) || 0;
      if (effort <= 0) return;
      if (!map.has(person)) map.set(person, new Map());
      const projMap = map.get(person)!;
      projMap.set(task.projectId, (projMap.get(task.projectId) ?? 0) + effort);
    });
    return map;
  }, [allTasks]);

  // 인원별 투입 현황: 담당자 → [{ project, allocationPercent }]
  const personAllocations = useMemo(() => {
    const personToProjectPct = new Map<string, Map<string, { project: Project; allocationPercent: number }>>();

    projectAllocations.forEach(({ project, assignments }) => {
      assignments.forEach(a => {
        const person = (a.assignee || '').trim() || '(미지정)';
        const pct = Number(a.allocationPercent || 0);
        if (!Number.isFinite(pct) || pct <= 0) return;

        if (!personToProjectPct.has(person)) personToProjectPct.set(person, new Map());
        const projMap = personToProjectPct.get(person)!;
        const existing = projMap.get(project.id);
        projMap.set(project.id, {
          project,
          allocationPercent: (existing?.allocationPercent ?? 0) + pct,
        });
      });
    });

    return Array.from(personToProjectPct.entries())
      .map(([person, projMap]) => {
        const items = Array.from(projMap.values()).sort((a, b) => b.allocationPercent - a.allocationPercent);
        const totalPercent = items.reduce((s, i) => s + i.allocationPercent, 0);
        return { person, items, totalPercent };
      })
      .sort((a, b) => b.totalPercent - a.totalPercent);
  }, [projectAllocations]);

  // 회원만 표시 시: 등록 회원(profiles)에 있는 담당자만 필터
  const memberSet = registeredMemberDisplayNames;
  const displayProjectAllocations = useMemo(() => {
    if (!membersOnly || !memberSet?.size) return projectAllocations;
    return projectAllocations
      .map(({ project, assignments, totalPercent }) => {
        const filtered = assignments.filter(a => memberSet.has(a.assignee));
        const total = filtered.reduce((s, a) => s + (a.allocationPercent || 0), 0);
        return { project, assignments: filtered, totalPercent: total };
      })
      .filter(({ assignments }) => assignments.length > 0);
  }, [projectAllocations, membersOnly, memberSet]);

  const displayPersonAllocations = useMemo(() => {
    if (!membersOnly || !memberSet?.size) return personAllocations;
    return personAllocations.filter(p => memberSet.has(p.person));
  }, [personAllocations, membersOnly, memberSet]);

  // 투입 정보가 없는 프로젝트
  const projectsWithoutAllocation = useMemo(() => {
    return projects.filter(p => !p.assignments || p.assignments.length === 0);
  }, [projects]);

  const hasAnyAllocation = projectAllocations.length > 0;
  const showMembersOnlyToggle = Boolean(registeredMemberDisplayNames?.size);

  return (
    <div className="h-full overflow-auto bg-stone-50/50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Users className="text-teal-600" size={24} />
              프로젝트 투입 현황
            </h1>
            <p className="text-sm text-stone-500 mt-0.5">
              프로젝트별로 어떤 인원이 어느 비중으로 투입되어 있는지 한눈에 확인합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('by-project')}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5",
                  viewMode === 'by-project'
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                )}
              >
                <Briefcase size={14} /> 프로젝트별
              </button>
              <button
                onClick={() => setViewMode('by-person')}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5",
                  viewMode === 'by-person'
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                )}
              >
                <Users size={14} /> 인원별
              </button>
            </div>
            {showMembersOnlyToggle && (
              <label className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-stone-600 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={membersOnly}
                  onChange={(e) => setMembersOnly(e.target.checked)}
                  className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                />
                <UserCheck size={14} className="text-teal-600 shrink-0" />
                <span>회원만 표시</span>
              </label>
            )}
          </div>
        </div>

        {!hasAnyAllocation ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
            <Users className="mx-auto text-stone-300 mb-4" size={48} />
            <p className="text-stone-600 font-medium">등록된 투입 정보가 없습니다.</p>
            <p className="text-sm text-stone-400 mt-1">
              프로젝트 편집에서 투입인원과 투입비율을 설정해 주세요.
            </p>
            {onEditProject && projects.length > 0 && (
              <button
                onClick={() => onEditProject(projects[0])}
                className="btn-primary mt-4 flex items-center gap-2 mx-auto"
              >
                <Edit size={14} /> 프로젝트 편집
              </button>
            )}
          </div>
        ) : viewMode === 'by-project' ? (
          <div className="space-y-4">
            {membersOnly && displayProjectAllocations.length === 0 && projectAllocations.length > 0 && (
              <p className="text-sm text-stone-500 text-center py-4">등록 회원에 해당하는 투입이 없습니다.</p>
            )}
            {displayProjectAllocations.map(({ project, assignments, totalPercent }) => (
              <div
                key={project.id}
                className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--color-ink)]">{project.name}</span>
                      <span className="text-xs text-stone-400">
                        총 {totalPercent}% 투입
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onEditProject && (
                      <button
                        onClick={() => onEditProject(project)}
                        className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[var(--color-ink)] transition-colors"
                        title="프로젝트 편집"
                      >
                        <Edit size={16} />
                      </button>
                    )}
                    {onNavigateToWork && (
                      <button
                        onClick={() => onNavigateToWork(project.id)}
                        className="p-2 rounded-lg text-stone-400 hover:bg-teal-50 hover:text-teal-600 transition-colors"
                        title="작업 보기"
                      >
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-4 pb-4 pt-0">
                  <div className="flex flex-wrap gap-2">
                    {assignments.map((a) => (
                      <div
                        key={`${project.id}:${a.assignee}`}
                        className="inline-flex flex-col gap-0.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--color-ink)]">{a.assignee || '(미지정)'}</span>
                          <span className="text-teal-600 font-bold">{a.allocationPercent}%</span>
                        </div>
                        {a.monthlyAllocations && Object.keys(a.monthlyAllocations).length > 0 && (
                          <div className="text-[10px] text-stone-500 flex flex-wrap gap-x-2 gap-y-0">
                            {Object.entries(a.monthlyAllocations)
                              .sort(([k1], [k2]) => k1.localeCompare(k2))
                              .map(([ym, pct]) => (
                                <span key={ym}>{ym} {pct}%</span>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {projectsWithoutAllocation.length > 0 && (
              <div className="mt-6 pt-6 border-t border-stone-200">
                <h3 className="text-sm font-semibold text-stone-500 mb-3">투입 정보 미설정 프로젝트</h3>
                <div className="space-y-2">
                  {projectsWithoutAllocation.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-4 py-2 rounded-lg bg-stone-50 border border-stone-100"
                    >
                      <span className="text-sm text-stone-600">{p.name}</span>
                      {onEditProject && (
                        <button
                          onClick={() => onEditProject(p)}
                          className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                        >
                          투입 설정
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {membersOnly && displayPersonAllocations.length === 0 && personAllocations.length > 0 && (
              <p className="text-sm text-stone-500 text-center py-4">등록 회원에 해당하는 투입이 없습니다.</p>
            )}
            {displayPersonAllocations.map(({ person, items, totalPercent }) => (
              <div
                key={person}
                className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold shrink-0">
                    {person.substring(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingPerson === person ? (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-full sm:w-64 px-3 py-1.5 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-200"
                          placeholder="투입 인원 이름"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const next = (editingName || '').trim();
                              if (next && next !== person) renameAssignee(person, next);
                              setEditingPerson(null);
                              setEditingName('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => {
                              setEditingPerson(null);
                              setEditingName('');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-[var(--color-ink)]">{person}</div>
                        {person !== '(미지정)' && (
                          <button
                            onClick={() => {
                              setEditingPerson(person);
                              setEditingName(person);
                            }}
                            className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-[var(--color-ink)] transition-colors"
                            title="이름 변경"
                          >
                            <Edit size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-stone-500">
                      {items.length}개 프로젝트 · 총 {totalPercent}% 투입
                      {(() => {
                        const totalMd = [...(personProjectWorkEffort.get(person)?.values() ?? [])].reduce((s: number, v: number) => s + v, 0);
                        return totalMd > 0 ? ` · 총 ${totalMd} M/D` : null;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-0">
                  <div className="flex flex-wrap gap-2">
                    {items.map(({ project, allocationPercent }) => {
                      const workEffortMd = personProjectWorkEffort.get(person)?.get(project.id) ?? 0;
                      return (
                        <button
                          key={`${person}:${project.id}`}
                          onClick={() => onNavigateToWork?.(project.id)}
                          className={cn(
                            "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                            onNavigateToWork
                              ? "bg-stone-50 border-stone-100 hover:bg-teal-50 hover:border-teal-100 cursor-pointer"
                              : "bg-stone-50 border-stone-100"
                          )}
                          title={`${project.name}: 투입 ${allocationPercent}%, 공수 ${workEffortMd} M/D`}
                        >
                          <span className="text-stone-700">{project.name}</span>
                          <span className="text-teal-600 font-bold">{allocationPercent}%</span>
                          {workEffortMd > 0 && (
                            <span className="text-stone-500 text-xs font-medium">{workEffortMd} M/D</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
