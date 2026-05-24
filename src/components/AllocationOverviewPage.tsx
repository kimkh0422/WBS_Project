import React, { useMemo, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { useOrganization } from '../context/OrganizationContext';
import { Briefcase, Users, Edit, ChevronRight } from 'lucide-react';
import { cn, formatPercent1 } from '../lib/utils';
import {
  applyPersonProjectAllocation,
  computePersonAllocations,
  computePersonProjectWorkEffort,
  computeProjectAllocations,
  executePersonProjectAdd,
  type PersonProjectAddPayload,
} from '../lib/personAllocations';
import { EditableAllocationBadge } from './EditableAllocationBadge';
import { AddPersonProjectAllocation } from './AddPersonProjectAllocation';
import { AddPersonAllocationControl } from './AddPersonAllocationControl';
import {
  buildAssigneeCandidates,
  buildOrgMemberLabelMap,
  buildOrgMemberDisplayMetaMap,
  formatAssigneeDisplay,
} from '../lib/assigneeOptions';
import { Project } from '../types';
import { ProjectNameLabel } from './ProjectNameLabel';
import { formatProjectDisplayName } from '../lib/projectKind';

interface AllocationOverviewPageProps {
  /** 등록 회원 표시명 집합. 인원 추가 자동완성 후보에 포함 */
  registeredMemberDisplayNames?: Set<string>;
  onEditProject?: (project: Project) => void;
  onNavigateToWork?: (projectId: string) => void;
}

type ViewMode = 'by-project' | 'by-person';

export function AllocationOverviewPage({ registeredMemberDisplayNames, onEditProject, onNavigateToWork }: AllocationOverviewPageProps) {
  const { projects, allTasks, renameAssignee, updateProject, addProject } = useWBS();
  const { orgMembers } = useOrganization();
  const [viewMode, setViewMode] = useState<ViewMode>('by-project');
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const projectAllocations = useMemo(() => computeProjectAllocations(projects), [projects]);
  const personProjectWorkEffort = useMemo(() => computePersonProjectWorkEffort(allTasks), [allTasks]);
  const personAllocations = useMemo(() => computePersonAllocations(projectAllocations), [projectAllocations]);

  // 투입 정보가 없는 프로젝트
  const projectsWithoutAllocation = useMemo(() => {
    return projects.filter((p) => !p.assignments || p.assignments.length === 0);
  }, [projects]);

  const hasAnyAllocation = projectAllocations.length > 0;

  const handleUpdatePersonAllocation = (projectId: string, person: string, percent: number) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const nextAssignments = applyPersonProjectAllocation(project.assignments, person, percent);
    updateProject(projectId, {
      assignments: nextAssignments.length > 0 ? nextAssignments : undefined,
    });
  };

  const handleAddPersonProject = (person: string, payload: PersonProjectAddPayload, percent: number) => {
    executePersonProjectAdd(payload, person, percent, {
      updateAllocation: (projectId) => handleUpdatePersonAllocation(projectId, person, percent),
      createProject: (name, assignments, reportExtras) =>
        addProject(name, undefined, undefined, undefined, assignments, undefined, reportExtras),
    });
  };

  const allocationAssigneeCandidates = useMemo(
    () =>
      buildAssigneeCandidates({
        orgMembers,
        projects,
        extra: registeredMemberDisplayNames ? [...registeredMemberDisplayNames] : undefined,
      }),
    [orgMembers, projects, registeredMemberDisplayNames],
  );
  const allocationOrgLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);
  const allocationDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

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
              프로젝트별로 어떤 인원이 어느 비중으로 투입되어 있는지 한눈에 확인합니다. 인원별 보기에서는 「인원 추가」로 새 담당자를
              등록하고, 「프로젝트」에서 기존 프로젝트를 선택하거나 신규 프로젝트명을 입력해 투입을 추가할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('by-project')}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5',
                  viewMode === 'by-project'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50',
                )}
              >
                <Briefcase size={14} /> 프로젝트별
              </button>
              <button
                onClick={() => setViewMode('by-person')}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5',
                  viewMode === 'by-person'
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50',
                )}
              >
                <Users size={14} /> 인원별
              </button>
            </div>
            {viewMode === 'by-person' && (
              <AddPersonAllocationControl
                availableProjects={projects}
                assigneeCandidates={allocationAssigneeCandidates}
                orgMemberLabelByName={allocationOrgLabelByName}
                onAdd={handleAddPersonProject}
              />
            )}
          </div>
        </div>

        {!hasAnyAllocation ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center space-y-4">
            <Users className="mx-auto text-stone-300" size={48} />
            <p className="text-stone-600 font-medium">등록된 투입 정보가 없습니다.</p>
            <p className="text-sm text-stone-400">아래에서 인원·프로젝트·투입율을 바로 추가하거나, 프로젝트 편집에서 설정할 수 있습니다.</p>
            <AddPersonAllocationControl
              availableProjects={projects}
              assigneeCandidates={allocationAssigneeCandidates}
              orgMemberLabelByName={allocationOrgLabelByName}
              onAdd={handleAddPersonProject}
              className="mx-auto"
            />
            {onEditProject && projects.length > 0 && (
              <button onClick={() => onEditProject(projects[0])} className="btn-secondary mt-2 flex items-center gap-2 mx-auto text-sm">
                <Edit size={14} /> 프로젝트 편집
              </button>
            )}
          </div>
        ) : viewMode === 'by-project' ? (
          <div className="space-y-4">
            {projectAllocations.map(({ project, assignments, totalPercent }) => (
              <div
                key={project.id}
                className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ProjectNameLabel project={project} name={project.name} nameClassName="font-semibold text-[var(--color-ink)]" />
                      <span className="text-xs text-stone-400">총 {formatPercent1(totalPercent)}% 투입</span>
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
                  <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {assignments.map((a) => (
                      <div
                        key={`${project.id}:${a.assignee}`}
                        className="min-w-0 inline-flex flex-col gap-0.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100 text-sm"
                      >
                        <EditableAllocationBadge
                          projectName={formatAssigneeDisplay((a.assignee || '').trim() || '(미지정)', allocationDisplayMetaByName)}
                          allocationPercent={a.allocationPercent}
                          disabled={((a.assignee || '').trim() || '(미지정)') === '(미지정)'}
                          onSave={(percent) => handleUpdatePersonAllocation(project.id, (a.assignee || '').trim() || '(미지정)', percent)}
                          onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                          className="bg-teal-50 border-teal-100 text-sm"
                        />
                        {a.monthlyAllocations && Object.keys(a.monthlyAllocations).length > 0 && (
                          <div className="text-[10px] text-stone-500 flex flex-wrap gap-x-2 gap-y-0">
                            {Object.entries(a.monthlyAllocations)
                              .sort(([k1], [k2]) => k1.localeCompare(k2))
                              .map(([ym, pct]) => (
                                <span key={ym}>
                                  {ym} {formatPercent1(Number(pct))}%
                                </span>
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
                  {projectsWithoutAllocation.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2 rounded-lg bg-stone-50 border border-stone-100">
                      <ProjectNameLabel
                        project={p}
                        name={p.name}
                        className="text-sm text-stone-600"
                        nameClassName="text-sm text-stone-600"
                      />
                      {onEditProject && (
                        <button onClick={() => onEditProject(p)} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
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
            {personAllocations.length === 0 && projects.length > 0 && (
              <div className="bg-white rounded-xl border border-stone-200 p-8 text-center space-y-4">
                <p className="text-sm text-stone-500">투입 인원이 없습니다. 인원을 추가해 주세요.</p>
                <AddPersonAllocationControl
                  availableProjects={projects}
                  assigneeCandidates={allocationAssigneeCandidates}
                  orgMemberLabelByName={allocationOrgLabelByName}
                  onAdd={handleAddPersonProject}
                  className="mx-auto"
                />
              </div>
            )}
            {personAllocations.map(({ person, items, totalPercent }) => (
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
                        <div className="font-semibold text-[var(--color-ink)]">
                          {formatAssigneeDisplay(person, allocationDisplayMetaByName)}
                        </div>
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
                      {items.length}개 프로젝트 · 총 {formatPercent1(totalPercent)}% 투입
                      {(() => {
                        const totalMd = [...(personProjectWorkEffort.get(person)?.values() ?? [])].reduce(
                          (s: number, v: number) => s + v,
                          0,
                        );
                        return totalMd > 0 ? ` · 총 ${totalMd} M/D` : null;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-0">
                  <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                    {items.map(({ project, allocationPercent }) => {
                      const workEffortMd = personProjectWorkEffort.get(person)?.get(project.id) ?? 0;
                      return (
                        <div key={`${person}:${project.id}`} className="min-w-0">
                          <EditableAllocationBadge
                            projectName={formatProjectDisplayName(project.name, project.projectKind)}
                            allocationPercent={allocationPercent}
                            workEffortMd={workEffortMd > 0 ? workEffortMd : undefined}
                            disabled={person === '(미지정)'}
                            onSave={(percent) => handleUpdatePersonAllocation(project.id, person, percent)}
                            onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                            className="text-sm px-3 py-1.5 rounded-lg"
                          />
                        </div>
                      );
                    })}
                    <div className="col-span-full min-w-0">
                      <AddPersonProjectAllocation
                        person={person}
                        assignedProjectIds={new Set(items.map((i) => i.project.id))}
                        availableProjects={projects}
                        allocationSumPercent={totalPercent}
                        disabled={person === '(미지정)'}
                        onAdd={(payload, percent) => handleAddPersonProject(person, payload, percent)}
                      />
                    </div>
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
