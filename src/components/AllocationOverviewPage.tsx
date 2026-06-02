import React, { useMemo, useState } from 'react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { useOrganization } from '../context/OrganizationContext';
import { Briefcase, Users, Edit, ChevronRight, FolderPlus } from 'lucide-react';
import { cn, formatPercent1 } from '../lib/utils';
import {
  applyPersonProjectAllocation,
  computePersonAllocations,
  computePersonProjectWorkEffort,
  computeProjectAllocations,
  executePersonProjectAdd,
  normalizeProjectAssignments,
  type PersonProjectAddPayload,
} from '../lib/personAllocations';
import { EditableAllocationBadge } from './EditableAllocationBadge';
import { AddPersonProjectAllocation } from './AddPersonProjectAllocation';
import { AddProjectPersonAllocation } from './AddProjectPersonAllocation';
import { AddPersonAllocationControl } from './AddPersonAllocationControl';
import {
  buildAssigneeCandidates,
  buildOrgMemberLabelMap,
  buildOrgMemberDisplayMetaMap,
  formatAssigneeDisplay,
} from '../lib/assigneeOptions';
import { Project } from '../types';
import { ProjectNameLabel } from './ProjectNameLabel';
import { formatProjectDisplayName, filterProjectsVisibleToViewer } from '../lib/projectKind';

interface AllocationOverviewPageProps {
  /** 등록 회원 표시명 집합. 인원 추가 자동완성 후보에 포함 */
  registeredMemberDisplayNames?: Set<string>;
  onEditProject?: (project: Project) => void;
  /** 제공 시 상단·목록 하단에서 신규 프로젝트 등록 모달을 엽니다 */
  onCreateProject?: () => void;
  onNavigateToWork?: (projectId: string) => void;
}

type ViewMode = 'by-project' | 'by-person';

export function AllocationOverviewPage({
  registeredMemberDisplayNames,
  onEditProject,
  onCreateProject,
  onNavigateToWork,
}: AllocationOverviewPageProps) {
  const { projects, allTasks, renameAssignee, updateProject, addProject } = useWBS();
  const { user } = useAuth();
  const visibleProjects = useMemo(() => filterProjectsVisibleToViewer(projects, user?.id), [projects, user?.id]);
  const { orgMembers } = useOrganization();
  const [viewMode, setViewMode] = useState<ViewMode>('by-project');
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const projectAllocations = useMemo(() => computeProjectAllocations(visibleProjects), [visibleProjects]);
  const personProjectWorkEffort = useMemo(() => computePersonProjectWorkEffort(allTasks), [allTasks]);
  const personAllocations = useMemo(() => computePersonAllocations(projectAllocations), [projectAllocations]);

  // 투입 정보가 없는 프로젝트
  const projectsWithoutAllocation = useMemo(() => {
    return visibleProjects.filter((p) => !p.assignments || p.assignments.length === 0);
  }, [visibleProjects]);

  const hasAnyAllocation = projectAllocations.length > 0;

  const handleUpdatePersonAllocation = (projectId: string, person: string, percent: number) => {
    const project = visibleProjects.find((p) => p.id === projectId);
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
        projects: visibleProjects,
        extra: registeredMemberDisplayNames ? [...registeredMemberDisplayNames] : undefined,
      }),
    [orgMembers, visibleProjects, registeredMemberDisplayNames],
  );
  const allocationOrgLabelByName = useMemo(() => buildOrgMemberLabelMap(orgMembers), [orgMembers]);
  const allocationDisplayMetaByName = useMemo(() => buildOrgMemberDisplayMetaMap(orgMembers), [orgMembers]);

  return (
    <div className="h-full overflow-auto bg-slate-50/50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2">
              <Users className="text-teal-600" size={24} />
              투입 현황
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              투입 인원·프로젝트별 투입 비율·인원별 WBS 공수(M/D)를 이 화면에서 확인하고 편집합니다. 프로젝트별 보기에서는 각 카드의 「인원
              추가」로 해당 프로젝트에 바로 투입할 수 있고, 인원별 보기에서는 「인원 추가」로 담당자를 등록한 뒤 「프로젝트」에서 기존·신규
              프로젝트를 골라 투입을 넣을 수 있습니다.
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
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
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
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                <Users size={14} /> 인원별
              </button>
            </div>
            {onCreateProject && (
              <button
                type="button"
                onClick={onCreateProject}
                className="btn-primary flex items-center gap-1.5 text-xs sm:text-sm px-3 py-1.5 sm:py-2"
                title="새 프로젝트를 등록합니다"
              >
                <FolderPlus size={16} />새 프로젝트
              </button>
            )}
            {viewMode === 'by-person' && (
              <AddPersonAllocationControl
                availableProjects={visibleProjects}
                assigneeCandidates={allocationAssigneeCandidates}
                orgMemberLabelByName={allocationOrgLabelByName}
                onAdd={handleAddPersonProject}
              />
            )}
          </div>
        </div>

        {!hasAnyAllocation ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-4">
            <Users className="mx-auto text-slate-300" size={48} />
            <p className="text-slate-600 font-medium">등록된 투입 정보가 없습니다.</p>
            <p className="text-sm text-slate-400">아래에서 인원·프로젝트·투입율을 바로 추가하거나, 프로젝트 편집에서 설정할 수 있습니다.</p>
            {onCreateProject && (
              <button type="button" onClick={onCreateProject} className="btn-primary inline-flex items-center gap-2 mx-auto">
                <FolderPlus size={16} />새 프로젝트
              </button>
            )}
            <AddPersonAllocationControl
              availableProjects={visibleProjects}
              assigneeCandidates={allocationAssigneeCandidates}
              orgMemberLabelByName={allocationOrgLabelByName}
              onAdd={handleAddPersonProject}
              className="mx-auto"
            />
            {onEditProject && visibleProjects.length > 0 && (
              <button
                onClick={() => onEditProject(visibleProjects[0])}
                className="btn-secondary mt-2 flex items-center gap-2 mx-auto text-sm"
              >
                <Edit size={14} /> 프로젝트 편집
              </button>
            )}
          </div>
        ) : viewMode === 'by-project' ? (
          <div className="space-y-4">
            {projectAllocations.map(({ project, assignments, totalPercent }) => {
              const assignedNameKeys = new Set(assignments.map((a) => (a.assignee || '').trim() || '(미지정)'));
              return (
                <div
                  key={project.id}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ProjectNameLabel project={project} name={project.name} nameClassName="font-semibold text-[var(--color-ink)]" />
                        <span className="text-xs text-slate-400">총 {formatPercent1(totalPercent)}% 투입</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onEditProject && (
                        <button
                          onClick={() => onEditProject(project)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[var(--color-ink)] transition-colors"
                          title="프로젝트 편집"
                        >
                          <Edit size={16} />
                        </button>
                      )}
                      {onNavigateToWork && (
                        <button
                          onClick={() => onNavigateToWork(project.id)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-600 transition-colors"
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
                            <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0">
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
                      <div className="col-span-full min-w-0 flex flex-wrap items-center gap-2 pt-0.5">
                        <AddProjectPersonAllocation
                          projectId={project.id}
                          assigneeCandidates={allocationAssigneeCandidates}
                          assignedNames={assignedNameKeys}
                          allocationSumPercentOnProject={totalPercent}
                          orgMemberLabelByName={allocationOrgLabelByName}
                          onAdd={(person, percent) => handleAddPersonProject(person, { kind: 'existing', projectId: project.id }, percent)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {projectsWithoutAllocation.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-200">
                <h3 className="text-sm font-semibold text-slate-500 mb-3">투입 정보 미설정 프로젝트</h3>
                <div className="space-y-2">
                  {projectsWithoutAllocation.map((p) => {
                    const assignedNameKeys = new Set(
                      normalizeProjectAssignments(p.assignments ?? []).map((a) => (a.assignee || '').trim() || '(미지정)'),
                    );
                    const sumOnProject = normalizeProjectAssignments(p.assignments ?? []).reduce(
                      (s, a) => s + (a.allocationPercent || 0),
                      0,
                    );
                    return (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 rounded-lg bg-slate-50 border border-slate-100"
                      >
                        <ProjectNameLabel
                          project={p}
                          name={p.name}
                          className="text-sm text-slate-600 min-w-0"
                          nameClassName="text-sm text-slate-600"
                        />
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <AddProjectPersonAllocation
                            projectId={p.id}
                            assigneeCandidates={allocationAssigneeCandidates}
                            assignedNames={assignedNameKeys}
                            allocationSumPercentOnProject={sumOnProject}
                            orgMemberLabelByName={allocationOrgLabelByName}
                            onAdd={(person, percent) => handleAddPersonProject(person, { kind: 'existing', projectId: p.id }, percent)}
                          />
                          {onEditProject && (
                            <button onClick={() => onEditProject(p)} className="text-xs text-teal-600 hover:text-teal-700 font-medium">
                              투입 설정
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {onCreateProject && (
              <button
                type="button"
                onClick={onCreateProject}
                className="w-full flex flex-col sm:flex-row items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed border-slate-200 bg-white/60 text-slate-500 hover:border-teal-300 hover:bg-teal-50/40 hover:text-teal-800 transition-colors"
                title="새 프로젝트를 등록합니다"
              >
                <FolderPlus size={22} className="text-teal-600 shrink-0" />
                <span className="text-sm font-semibold">여기를 눌러 새 프로젝트 추가</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {personAllocations.length === 0 && visibleProjects.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
                <p className="text-sm text-slate-500">투입 인원이 없습니다. 인원을 추가해 주세요.</p>
                <AddPersonAllocationControl
                  availableProjects={visibleProjects}
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
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
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
                          className="w-full sm:w-64 px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-200"
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
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
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
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-[var(--color-ink)] transition-colors"
                            title="이름 변경"
                          >
                            <Edit size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-slate-500">
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
                        availableProjects={visibleProjects}
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
