import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Briefcase, Users } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { useOrganization } from '../context/OrganizationContext';
import { cn, formatNum2 } from '../lib/utils';
import {
  applyPersonProjectAllocation,
  computePersonAllocations,
  computePersonProjectWorkEffort,
  computeProjectAllocations,
  executePersonProjectAdd,
  type PersonProjectAddPayload,
} from '../lib/personAllocations';
import { buildAssigneeCandidates, buildOrgMemberLabelMap, buildOrgMemberPositionMap, formatAssigneeDisplay } from '../lib/assigneeOptions';
import { formatProjectDisplayName } from '../lib/projectKind';
import { EditableAllocationBadge } from './EditableAllocationBadge';
import { AddPersonProjectAllocation } from './AddPersonProjectAllocation';
import { AddPersonAllocationControl } from './AddPersonAllocationControl';
import { AddProjectPersonAllocation } from './AddProjectPersonAllocation';
import type { Project, Task } from '../types';

type AllocationViewMode = 'by-person' | 'by-project';

interface DashboardPersonAllocationSectionProps {
  projects: Project[];
  allTasks: Task[];
  registeredMemberDisplayNames?: Set<string>;
  /** 상단 대시보드 프로젝트 필터가 적용 중일 때 안내 문구 표시 */
  showFilterHint?: boolean;
  onNavigateToWork?: (projectId: string) => void;
}

export function DashboardPersonAllocationSection({
  projects,
  allTasks,
  registeredMemberDisplayNames,
  showFilterHint,
  onNavigateToWork,
}: DashboardPersonAllocationSectionProps) {
  const { updateProject, addProject } = useWBS();
  const { orgMembers } = useOrganization();
  const [allocationViewMode, setAllocationViewMode] = useState<AllocationViewMode>('by-person');

  const projectAllocations = useMemo(() => computeProjectAllocations(projects), [projects]);
  const personProjectWorkEffort = useMemo(() => computePersonProjectWorkEffort(allTasks), [allTasks]);
  const personAllocations = useMemo(() => computePersonAllocations(projectAllocations), [projectAllocations]);

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
  const allocationPositionByName = useMemo(() => buildOrgMemberPositionMap(orgMembers), [orgMembers]);

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
      createProject: (name, assignments) => addProject(name, undefined, undefined, undefined, assignments),
    });
  };

  const filterHintSuffix = showFilterHint ? ' · 상단 필터에 맞춘 프로젝트만 집계합니다.' : '';

  return (
    <section>
      <motion.div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap">
          {allocationViewMode === 'by-person' ? (
            <Users className="text-teal-600" size={24} />
          ) : (
            <Briefcase className="text-teal-600" size={24} />
          )}
          {allocationViewMode === 'by-person' ? '인원별 투입율 현황' : '프로젝트별 투입율 현황'}
          <span className="text-sm font-medium text-stone-400">
            {allocationViewMode === 'by-person' ? `${personAllocations.length}명` : `${projectAllocations.length}개`}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <motion.div className="flex gap-1 p-0.5 rounded-lg border border-stone-200 bg-white">
            <button
              type="button"
              onClick={() => setAllocationViewMode('by-person')}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-md transition-colors',
                allocationViewMode === 'by-person' ? 'bg-teal-600 text-white' : 'text-stone-600 hover:bg-stone-50',
              )}
            >
              인원별
            </button>
            <button
              type="button"
              onClick={() => setAllocationViewMode('by-project')}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-md transition-colors',
                allocationViewMode === 'by-project' ? 'bg-teal-600 text-white' : 'text-stone-600 hover:bg-stone-50',
              )}
            >
              프로젝트별
            </button>
          </motion.div>
          {allocationViewMode === 'by-person' && (
            <AddPersonAllocationControl
              availableProjects={projects}
              assigneeCandidates={allocationAssigneeCandidates}
              orgMemberLabelByName={allocationOrgLabelByName}
              onAdd={handleAddPersonProject}
            />
          )}
        </div>
      </motion.div>

      <p className="text-xs text-stone-500 mb-3 -mt-2">
        {allocationViewMode === 'by-person'
          ? `프로젝트 설정 투입비율 합계입니다. 여러 프로젝트에 동시 투입 시 100%를 초과할 수 있습니다. 프로젝트별 투입율(%)을 클릭하면 바로 수정할 수 있습니다. 「인원 추가」로 새 담당자를 등록하고, 「+ 프로젝트」로 다른 프로젝트 투입을 추가하세요.${filterHintSuffix}`
          : `프로젝트별 투입 인원과 비율입니다. 투입율(%) 클릭으로 수정하고 「+ 인원」으로 담당자를 추가하세요.${filterHintSuffix}`}
      </p>

      {allocationViewMode === 'by-person' ? (
        personAllocations.length === 0 ? (
          <motion.div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center space-y-4">
            <p>{projectAllocations.length === 0 ? '표시 중인 프로젝트에 투입 인원이 없습니다.' : '투입 정보가 없습니다.'}</p>
            {projects.length > 0 && (
              <AddPersonAllocationControl
                availableProjects={projects}
                assigneeCandidates={allocationAssigneeCandidates}
                orgMemberLabelByName={allocationOrgLabelByName}
                onAdd={handleAddPersonProject}
                className="mx-auto"
              />
            )}
          </motion.div>
        ) : (
          <motion.div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-xs text-stone-500">
                  <th className="text-left font-medium px-4 py-2.5 w-36">담당자</th>
                  <th className="text-center font-medium px-2 py-2.5 w-16">프로젝트</th>
                  <th className="text-right font-medium px-3 py-2.5 w-28">총 투입</th>
                  <th className="text-left font-medium px-3 py-2.5 w-32">투입 현황</th>
                  <th className="text-left font-medium px-3 py-2.5">프로젝트별</th>
                  <th className="w-24 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {personAllocations.map(({ person, items, totalPercent }) => {
                  const personDisplay = formatAssigneeDisplay(person, allocationPositionByName);
                  const totalMd = [...(personProjectWorkEffort.get(person)?.values() ?? [])].reduce((s, v) => s + v, 0);
                  const barWidth = Math.min(100, totalPercent);
                  return (
                    <tr key={person} className="border-t border-stone-100 hover:bg-stone-50/50 align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <motion.div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold shrink-0 text-sm">
                            {person.substring(0, 1)}
                          </motion.div>
                          <span className="font-semibold text-stone-800 truncate" title={personDisplay}>
                            {personDisplay}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center tabular-nums text-stone-600">{items.length}</td>
                      <td className="px-3 py-3 text-right">
                        <div className={cn('font-bold tabular-nums', totalPercent > 100 ? 'text-amber-600' : 'text-orange-600')}>
                          {formatNum2(totalPercent)}%
                        </div>
                        {totalMd > 0 && <div className="text-[10px] text-stone-400 tabular-nums mt-0.5">{formatNum2(totalMd)} M/D</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden min-w-[4rem]">
                            <div
                              className={cn('h-full rounded-full transition-all', totalPercent > 100 ? 'bg-amber-500' : 'bg-teal-500')}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          {totalPercent > 100 && <span className="text-[10px] font-semibold text-amber-600 shrink-0">100% 초과</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(({ project, allocationPercent }) => {
                            const workEffortMd = personProjectWorkEffort.get(person)?.get(project.id) ?? 0;
                            return (
                              <EditableAllocationBadge
                                key={`${person}:${project.id}`}
                                projectName={formatProjectDisplayName(project.name, project.projectKind)}
                                allocationPercent={allocationPercent}
                                workEffortMd={workEffortMd > 0 ? workEffortMd : undefined}
                                disabled={person === '(미지정)'}
                                onSave={(percent) => handleUpdatePersonAllocation(project.id, person, percent)}
                                onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                              />
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <AddPersonProjectAllocation
                          person={person}
                          assignedProjectIds={new Set(items.map((i) => i.project.id))}
                          availableProjects={projects}
                          disabled={person === '(미지정)'}
                          onAdd={(payload, percent) => handleAddPersonProject(person, payload, percent)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        )
      ) : projectAllocations.length === 0 ? (
        <motion.div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
          표시 중인 프로젝트에 투입 인원이 없습니다.
        </motion.div>
      ) : (
        <motion.div className="bg-white border border-stone-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr className="text-xs text-stone-500">
                <th className="text-left font-medium px-4 py-2.5">프로젝트</th>
                <th className="text-center font-medium px-2 py-2.5 w-16">인원</th>
                <th className="text-right font-medium px-3 py-2.5 w-28">총 투입</th>
                <th className="text-left font-medium px-3 py-2.5 w-32">투입 현황</th>
                <th className="text-left font-medium px-3 py-2.5">인원별</th>
                <th className="w-24 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {projectAllocations.map(({ project, assignments, totalPercent }) => (
                <tr key={project.id} className="border-t border-stone-100 hover:bg-stone-50/50 align-top">
                  <td className="px-4 py-3 font-semibold text-stone-800 break-words max-w-[12rem]">
                    {formatProjectDisplayName(project.name, project.projectKind)}
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums text-stone-600">{assignments.length}</td>
                  <td className="px-3 py-3 text-right">
                    <div className={cn('font-bold tabular-nums', totalPercent > 100 ? 'text-amber-600' : 'text-orange-600')}>
                      {formatNum2(totalPercent)}%
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden min-w-[4rem]">
                      <div
                        className={cn('h-full rounded-full', totalPercent > 100 ? 'bg-amber-500' : 'bg-teal-500')}
                        style={{ width: `${Math.min(100, totalPercent)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {assignments.map((a) => (
                        <EditableAllocationBadge
                          key={`${project.id}:${a.assignee}`}
                          projectName={formatAssigneeDisplay(a.assignee, allocationPositionByName)}
                          allocationPercent={a.allocationPercent}
                          disabled={a.assignee === '(미지정)'}
                          onSave={(percent) => handleUpdatePersonAllocation(project.id, a.assignee, percent)}
                          onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3 align-middle">
                    <AddProjectPersonAllocation
                      projectName={project.name}
                      assignedPersons={new Set(assignments.map((a) => a.assignee))}
                      assigneeCandidates={allocationAssigneeCandidates}
                      onAdd={(personName, percent) => handleUpdatePersonAllocation(project.id, personName, percent)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}
    </section>
  );
}
