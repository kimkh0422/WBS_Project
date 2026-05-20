import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Briefcase, Info, ListTodo, Users } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { useOrganization } from '../context/OrganizationContext';
import { cn, formatNum2 } from '../lib/utils';
import { DEFAULT_MAN_DAYS_PER_MAN_MONTH, formatAllocationPercentSumForDisplay, manDaysToManMonths } from '../lib/workEffortUnits';
import {
  applyPersonProjectAllocation,
  computePersonAllocations,
  computePersonProjectTaskCounts,
  computePersonProjectWorkEffort,
  computePersonTaskAllocations,
  computeProjectAllocations,
  executePersonProjectAdd,
  mergePersonTaskAllocationsWithOrgDirectory,
  type PersonProjectAddPayload,
} from '../lib/personAllocations';
import {
  buildAssigneeCandidates,
  buildOrgMemberLabelMap,
  buildOrgMemberDisplayMetaMap,
  formatAssigneeDisplay,
} from '../lib/assigneeOptions';
import { formatProjectDisplayName, getProjectKindBadgeClass, resolveProjectKindOrDefault } from '../lib/projectKind';
import { EditableAllocationBadge } from './EditableAllocationBadge';
import { AddPersonProjectAllocation } from './AddPersonProjectAllocation';
import { AddPersonAllocationControl } from './AddPersonAllocationControl';
import { AddProjectPersonAllocation } from './AddProjectPersonAllocation';
import { PersonAllocationDetailPanel } from './PersonAllocationDetailPanel';
import { ProjectAllocationDetailPanel } from './ProjectAllocationDetailPanel';
import type { Project, Task } from '../types';

type AllocationViewMode = 'by-person' | 'by-project';
type PersonMetricMode = 'allocation' | 'task-assignment';
type EffortDisplayUnit = 'mm' | 'md';

const DASHBOARD_EFFORT_DISPLAY_KEY = 'dashboard-person-allocation-effort-unit';

const UNSPECIFIED_PERSON = '(미지정)';

/** 작업 할당 표: 소속(부서) 기준 그룹 라벨 */
function taskAssignmentGroupLabel(person: string, orgDeptByName: Map<string, string>): string {
  if (person === UNSPECIFIED_PERSON) return '담당 미지정';
  if (!orgDeptByName.has(person)) return '조직 미등록 인원';
  const dept = (orgDeptByName.get(person) ?? '').trim();
  return dept ? dept : '소속 미지정';
}

function compareTaskAssignmentGroupLabels(a: string, b: string): number {
  const rank = (l: string): number => {
    if (l === '담당 미지정') return 3;
    if (l === '조직 미등록 인원') return 2;
    if (l === '소속 미지정') return 1;
    return 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, 'ko');
}

/** 투입 현황 툴바 세그먼트: 선택 색을 통일해 인지 부담을 줄임 */
function allocationToolbarSegmentClass(active: boolean, opts?: { compact?: boolean }): string {
  return cn(
    opts?.compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs',
    'font-semibold rounded-md transition-colors',
    active ? 'bg-teal-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100',
  );
}

/** 담당자 키 기준 가나다 정렬. 「미지정」은 항상 맨 뒤. */
function comparePersonSortKey(a: string, b: string): number {
  if (a === UNSPECIFIED_PERSON && b !== UNSPECIFIED_PERSON) return 1;
  if (b === UNSPECIFIED_PERSON && a !== UNSPECIFIED_PERSON) return -1;
  return a.localeCompare(b, 'ko');
}

function formatEffortFromManDays(md: number, unit: EffortDisplayUnit): string {
  if (unit === 'md') return `${formatNum2(md)} M/D`;
  return `${formatNum2(manDaysToManMonths(md))} M/M`;
}

interface TaskAssignmentBadgeProps {
  projectName: string;
  taskCount: number;
  onNavigate?: () => void;
}

function TaskAssignmentBadge({ projectName, taskCount, onNavigate }: TaskAssignmentBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs',
        onNavigate ? 'border-stone-100 bg-stone-50 hover:bg-violet-50/60 hover:border-violet-100' : 'border-stone-100 bg-stone-50',
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate?.();
        }}
        disabled={!onNavigate}
        className={cn(
          'text-stone-700 max-w-[8rem] truncate text-left',
          onNavigate ? 'hover:text-violet-800 cursor-pointer' : 'cursor-default',
        )}
        title={onNavigate ? `${projectName} 작업 보기` : projectName}
      >
        {projectName}
      </button>
      <span className="text-violet-600 font-bold tabular-nums shrink-0">{taskCount}건</span>
    </span>
  );
}

interface DashboardPersonAllocationSectionProps {
  projects: Project[];
  allTasks: Task[];
  /** PM 표시 등 프로필 id → 이름(평문) */
  profileMap?: Record<string, string>;
  registeredMemberDisplayNames?: Set<string>;
  /** 상단 대시보드 프로젝트 필터가 적용 중일 때 안내 문구 표시 */
  showFilterHint?: boolean;
  onNavigateToWork?: (projectId: string) => void;
}

export function DashboardPersonAllocationSection({
  projects,
  allTasks,
  profileMap,
  registeredMemberDisplayNames,
  showFilterHint,
  onNavigateToWork,
}: DashboardPersonAllocationSectionProps) {
  const { updateProject, addProject, wbsSettings } = useWBS();
  const { orgMembers } = useOrganization();
  const [allocationViewMode, setAllocationViewMode] = useState<AllocationViewMode>('by-person');
  const [personMetricMode, setPersonMetricMode] = useState<PersonMetricMode>('allocation');
  /** 인원별 보기에서 행 클릭 시 상세 패널에 표시할 담당자(저장 키는 trim된 이름 또는 '(미지정)'). */
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  /** 프로젝트별 보기에서 행 클릭 시 상세 패널에 표시할 프로젝트 ID. */
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [effortDisplayUnit, setEffortDisplayUnit] = useState<EffortDisplayUnit>(() => {
    if (typeof window === 'undefined') return 'mm';
    try {
      const v = window.localStorage.getItem(DASHBOARD_EFFORT_DISPLAY_KEY);
      if (v === 'md' || v === 'mm') return v;
    } catch {
      /* ignore */
    }
    return 'mm';
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_EFFORT_DISPLAY_KEY, effortDisplayUnit);
    } catch {
      /* ignore */
    }
  }, [effortDisplayUnit]);

  useEffect(() => {
    if (allocationViewMode !== 'by-person') setSelectedPerson(null);
  }, [allocationViewMode]);

  useEffect(() => {
    if (allocationViewMode !== 'by-project') setSelectedProjectId(null);
  }, [allocationViewMode]);

  useEffect(() => {
    if (!selectedPerson && !selectedProjectId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPerson(null);
        setSelectedProjectId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPerson, selectedProjectId]);

  const projectAllocations = useMemo(() => computeProjectAllocations(projects), [projects]);
  const personProjectWorkEffort = useMemo(() => computePersonProjectWorkEffort(allTasks), [allTasks]);
  const personProjectTaskCounts = useMemo(() => computePersonProjectTaskCounts(allTasks), [allTasks]);
  const personAllocations = useMemo(() => computePersonAllocations(projectAllocations), [projectAllocations]);
  const personTaskAllocationsRaw = useMemo(
    () => computePersonTaskAllocations(projects, personProjectTaskCounts),
    [projects, personProjectTaskCounts],
  );
  const hasOrgMemberDirectory = (orgMembers?.length ?? 0) > 0;
  const personTaskRows = useMemo(
    () =>
      hasOrgMemberDirectory ? mergePersonTaskAllocationsWithOrgDirectory(personTaskAllocationsRaw, orgMembers) : personTaskAllocationsRaw,
    [hasOrgMemberDirectory, orgMembers, personTaskAllocationsRaw],
  );
  const orgDeptByNameForTasks = useMemo(() => {
    const m = new Map<string, string>();
    for (const member of orgMembers ?? []) {
      const n = member?.name?.trim();
      if (!n) continue;
      if (!m.has(member.name)) m.set(member.name, member.department ?? '');
    }
    return m;
  }, [orgMembers]);
  const maxPersonTaskCount = useMemo(() => personTaskRows.reduce((max, row) => Math.max(max, row.totalTaskCount), 0), [personTaskRows]);

  const personTaskRowsGrouped = useMemo(() => {
    const sorted = [...personTaskRows].sort((a, b) => comparePersonSortKey(a.person, b.person));
    if (!hasOrgMemberDirectory) {
      return [{ label: null as string | null, rows: sorted }];
    }
    const groupMap = new Map<string, typeof sorted>();
    for (const row of sorted) {
      const label = taskAssignmentGroupLabel(row.person, orgDeptByNameForTasks);
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label)!.push(row);
    }
    const labels = [...groupMap.keys()].sort(compareTaskAssignmentGroupLabels);
    return labels.map((label) => ({ label, rows: groupMap.get(label)! }));
  }, [hasOrgMemberDirectory, personTaskRows, orgDeptByNameForTasks]);

  useEffect(() => {
    if (!selectedPerson) return;
    const inAllocation = personAllocations.some((r) => r.person === selectedPerson);
    const inTask = personTaskRows.some((r) => r.person === selectedPerson);
    const visible = personMetricMode === 'task-assignment' ? inTask : inAllocation;
    if (!visible) setSelectedPerson(null);
  }, [selectedPerson, personMetricMode, personAllocations, personTaskRows]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!projectAllocations.some((r) => r.project.id === selectedProjectId)) setSelectedProjectId(null);
  }, [selectedProjectId, projectAllocations]);

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

  const selectedProjectRow = useMemo(() => {
    if (!selectedProjectId) return undefined;
    return projectAllocations.find((r) => r.project.id === selectedProjectId);
  }, [selectedProjectId, projectAllocations]);

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

  const togglePersonRowSelect = (person: string) => {
    setSelectedProjectId(null);
    setSelectedPerson((prev) => (prev === person ? null : person));
  };

  const toggleProjectRowSelect = (projectId: string) => {
    setSelectedPerson(null);
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  };

  const filterHintSuffix = showFilterHint ? ' · 상단 필터에 맞춘 프로젝트만 집계합니다.' : '';

  const allocationHelpBullets = useMemo(() => {
    const unitLine = `공수 단위(M/M·M/D)는 우측 툴바에서 바꿀 수 있으며, 1 M/M = ${DEFAULT_MAN_DAYS_PER_MAN_MONTH} M/D입니다.`;
    const tail = filterHintSuffix.trim();
    if (allocationViewMode === 'by-project') {
      return [
        '프로젝트별 담당 인원과 투입 비율을 표시합니다.',
        `총 투입은 투입비율 합을 맨먼스로 환산합니다(100% = 1 M/M). ${unitLine}`,
        '「투입 현황」막대와 오른쪽 숫자는 합계 대비 비율을 같이 봅니다(100%를 넘으면 막대는 꽉 차고 수치에 초과가 표시됩니다).',
        '이름이 적힌 칩에서 비율을 클릭하면 수정할 수 있고, 「+ 인원」으로 담당자를 추가합니다.',
        '프로젝트 행을 클릭하면 투입·작업·PM 등 상세 정보가 표 아래에 펼쳐집니다.',
        tail,
      ].filter(Boolean);
    }
    if (personMetricMode === 'task-assignment') {
      return [
        'WBS 작업 담당자 기준으로 프로젝트별 할당 건수를 집계합니다.',
        '조직 인원이 등록되어 있으면 소속(부서)별로 묶어 표시하며, 할당이 없으면 0건으로 보입니다.',
        `막대와 %는 표시 중인 인원 중 최대 할당 건수 대비 비율입니다. ${unitLine}`,
        '프로젝트명을 클릭하면 해당 프로젝트 작업 화면으로 이동합니다.',
        '담당자 행을 클릭하면 할당·투입 상세가 표 아래에 펼쳐집니다.',
        tail,
      ].filter(Boolean);
    }
    return [
      '프로젝트에 설정한 투입비율 합계입니다. 여러 프로젝트에 동시 투입하면 100%를 초과할 수 있습니다.',
      `총 투입·WBS 공수 합은 선택한 단위로 표시됩니다(총 투입은 100% = 1 M/M 기준). ${unitLine}`,
      '프로젝트별 투입율(%)을 클릭하면 바로 수정할 수 있습니다.',
      '「인원 추가」로 새 담당자를 등록하고, 「+ 프로젝트」로 다른 프로젝트 투입을 추가할 수 있습니다.',
      '담당자 행을 클릭하면 투입·작업·PM 등 상세 정보가 표 아래에 펼쳐집니다.',
      tail,
    ].filter(Boolean);
  }, [allocationViewMode, personMetricMode, filterHintSuffix]);

  return (
    <section>
      <motion.div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-[var(--color-ink)] flex items-center gap-2 flex-wrap">
          {allocationViewMode === 'by-person' ? (
            personMetricMode === 'task-assignment' ? (
              <ListTodo className="text-violet-600" size={24} />
            ) : (
              <Users className="text-teal-600" size={24} />
            )
          ) : (
            <Briefcase className="text-teal-600" size={24} />
          )}
          {allocationViewMode === 'by-person'
            ? personMetricMode === 'task-assignment'
              ? '인원별 작업 할당 현황'
              : '인원별 투입율 현황'
            : '프로젝트별 투입율 현황'}
          <span className="text-sm font-medium text-stone-400">
            {allocationViewMode === 'by-person'
              ? personMetricMode === 'task-assignment'
                ? `${personTaskRows.length}명`
                : `${personAllocations.length}명`
              : `${projectAllocations.length}개`}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <motion.div
            layout
            className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-stone-200 bg-gradient-to-b from-white to-stone-50/90 p-1 shadow-sm"
            role="toolbar"
            aria-label="투입 현황 보기·단위"
          >
            <div
              className="inline-flex gap-0.5 rounded-lg bg-stone-100/80 p-0.5 ring-1 ring-stone-200/50"
              role="group"
              aria-label="집계 기준"
            >
              <button
                type="button"
                onClick={() => setAllocationViewMode('by-person')}
                className={allocationToolbarSegmentClass(allocationViewMode === 'by-person')}
              >
                인원별
              </button>
              <button
                type="button"
                onClick={() => setAllocationViewMode('by-project')}
                className={allocationToolbarSegmentClass(allocationViewMode === 'by-project')}
              >
                프로젝트별
              </button>
            </div>
            {allocationViewMode === 'by-person' && (
              <>
                <span className="hidden sm:block w-px h-5 shrink-0 bg-stone-200" aria-hidden />
                <div
                  className="inline-flex gap-0.5 rounded-lg bg-stone-100/80 p-0.5 ring-1 ring-stone-200/50"
                  role="group"
                  aria-label="인원별 표시 지표"
                >
                  <button
                    type="button"
                    onClick={() => setPersonMetricMode('allocation')}
                    className={allocationToolbarSegmentClass(personMetricMode === 'allocation')}
                  >
                    투입율
                  </button>
                  <button
                    type="button"
                    onClick={() => setPersonMetricMode('task-assignment')}
                    className={allocationToolbarSegmentClass(personMetricMode === 'task-assignment')}
                  >
                    작업 할당
                  </button>
                </div>
              </>
            )}
            <span className="hidden sm:block w-px h-5 shrink-0 bg-stone-200" aria-hidden />
            <div
              className="inline-flex gap-0.5 rounded-lg bg-stone-100/80 p-0.5 ring-1 ring-stone-200/50"
              role="group"
              aria-label="공수 단위"
              title={`1 M/M = ${DEFAULT_MAN_DAYS_PER_MAN_MONTH} M/D`}
            >
              <button
                type="button"
                onClick={() => setEffortDisplayUnit('mm')}
                className={allocationToolbarSegmentClass(effortDisplayUnit === 'mm')}
              >
                M/M
              </button>
              <button
                type="button"
                onClick={() => setEffortDisplayUnit('md')}
                className={allocationToolbarSegmentClass(effortDisplayUnit === 'md')}
              >
                M/D
              </button>
            </div>
          </motion.div>
          {allocationViewMode === 'by-person' && personMetricMode === 'allocation' && (
            <AddPersonAllocationControl
              availableProjects={projects}
              assigneeCandidates={allocationAssigneeCandidates}
              orgMemberLabelByName={allocationOrgLabelByName}
              onAdd={handleAddPersonProject}
            />
          )}
        </div>
      </motion.div>

      <details className="group mb-3 -mt-1 rounded-xl border border-stone-200/90 bg-gradient-to-b from-stone-50/80 to-white px-3 py-2.5 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-semibold text-stone-700 [&::-webkit-details-marker]:hidden flex items-center gap-2">
          <Info className="h-4 w-4 text-teal-600 shrink-0" aria-hidden />표 읽는 법 · 단위 안내
          <span className="text-xs font-normal text-stone-400 group-open:hidden">(펼치기)</span>
        </summary>
        <ul className="mt-2.5 space-y-1.5 pl-7 text-sm text-stone-600 leading-relaxed marker:text-stone-400 list-disc">
          {allocationHelpBullets.map((line, idx) => (
            <li key={`allocation-help-${idx}`}>{line}</li>
          ))}
        </ul>
      </details>

      {allocationViewMode === 'by-person' ? (
        personMetricMode === 'task-assignment' ? (
          personTaskRows.length === 0 ? (
            <motion.div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
              {hasOrgMemberDirectory
                ? '표시할 직원 행이 없습니다. 조직 인원 이름을 확인해 주세요.'
                : '표시 중인 프로젝트에 할당된 작업이 없습니다.'}
            </motion.div>
          ) : (
            <motion.div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-stone-50 border-b border-stone-200">
                    <tr className="text-xs text-stone-500">
                      <th className="text-left font-medium px-4 py-2.5 w-36">담당자</th>
                      <th className="text-center font-medium px-2 py-2.5 w-16">프로젝트</th>
                      <th className="text-right font-medium px-3 py-2.5 w-28">총 할당</th>
                      <th className="text-left font-medium px-3 py-2.5 w-32">할당 현황</th>
                      <th className="text-left font-medium px-3 py-2.5">프로젝트별</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personTaskRowsGrouped.map((group) => (
                      <React.Fragment key={group.label ?? '__all'}>
                        {group.label != null && (
                          <tr className="bg-stone-100/90 border-t border-stone-200">
                            <td colSpan={5} className="px-4 py-2 text-xs font-bold text-stone-600">
                              {group.label}
                            </td>
                          </tr>
                        )}
                        {group.rows.map(({ person, items, totalTaskCount }) => {
                          const personDisplay = formatAssigneeDisplay(person, allocationDisplayMetaByName);
                          const totalMd = [...(personProjectWorkEffort.get(person)?.values() ?? [])].reduce((s, v) => s + v, 0);
                          const barWidth = maxPersonTaskCount > 0 ? (totalTaskCount / maxPersonTaskCount) * 100 : 0;
                          return (
                            <tr
                              key={person}
                              onClick={() => togglePersonRowSelect(person)}
                              className={cn(
                                'border-t border-stone-100 hover:bg-stone-50/50 align-top cursor-pointer transition-colors',
                                selectedPerson === person && 'bg-violet-50/40 ring-1 ring-inset ring-violet-200/70',
                              )}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <motion.div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold shrink-0 text-sm">
                                    {person.substring(0, 1)}
                                  </motion.div>
                                  <span className="font-semibold text-stone-800 truncate" title={personDisplay}>
                                    {personDisplay}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-3 text-center tabular-nums text-stone-600">{items.length}</td>
                              <td className="px-3 py-3 text-right">
                                <div className="font-bold tabular-nums text-violet-600">{totalTaskCount}건</div>
                                {totalMd > 0 && (
                                  <div className="text-[10px] text-stone-400 tabular-nums mt-0.5">
                                    {formatEffortFromManDays(totalMd, effortDisplayUnit)}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden min-w-[4rem]">
                                    <div className="h-full rounded-full transition-all bg-violet-500" style={{ width: `${barWidth}%` }} />
                                  </div>
                                  {maxPersonTaskCount > 0 && (
                                    <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{Math.round(barWidth)}%</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                <div className="flex flex-wrap gap-1.5">
                                  {items.map(({ project, taskCount }) => (
                                    <TaskAssignmentBadge
                                      key={`${person}:${project.id}`}
                                      projectName={formatProjectDisplayName(project.name, project.projectKind)}
                                      taskCount={taskCount}
                                      onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                                    />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedPerson && (
                <PersonAllocationDetailPanel
                  person={selectedPerson}
                  projects={projects}
                  allocationItems={personAllocations.find((r) => r.person === selectedPerson)?.items ?? []}
                  personProjectWorkEffort={personProjectWorkEffort}
                  allTasks={allTasks}
                  effortDisplayUnit={effortDisplayUnit}
                  orgMemberLabelByName={allocationOrgLabelByName}
                  displayMetaByName={allocationDisplayMetaByName}
                  statusConfigs={wbsSettings.statusConfigs}
                  onClose={() => setSelectedPerson(null)}
                  onNavigateToWork={onNavigateToWork}
                  profileMap={profileMap}
                />
              )}
            </motion.div>
          )
        ) : personAllocations.length === 0 ? (
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
          <motion.div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr className="text-xs text-stone-500">
                    <th className="text-left font-medium px-4 py-2.5 w-36">담당자</th>
                    <th className="text-center font-medium px-2 py-2.5 w-16">프로젝트</th>
                    <th className="text-right font-medium px-3 py-2.5 w-28">총 투입</th>
                    <th className="text-left font-medium px-3 py-2.5 w-32">투입 현황</th>
                    <th className="text-left font-medium px-3 py-2.5">프로젝트별</th>
                  </tr>
                </thead>
                <tbody>
                  {personAllocations.map(({ person, items, totalPercent }) => {
                    const personDisplay = formatAssigneeDisplay(person, allocationDisplayMetaByName);
                    const totalMd = [...(personProjectWorkEffort.get(person)?.values() ?? [])].reduce((s, v) => s + v, 0);
                    const barWidth = Math.min(100, totalPercent);
                    return (
                      <tr
                        key={person}
                        onClick={() => togglePersonRowSelect(person)}
                        className={cn(
                          'border-t border-stone-100 hover:bg-stone-50/50 align-top cursor-pointer transition-colors',
                          selectedPerson === person && 'bg-teal-50/35 ring-1 ring-inset ring-teal-200/70',
                        )}
                      >
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
                          <div className={cn('font-bold tabular-nums text-base', totalPercent > 100 ? 'text-amber-600' : 'text-stone-800')}>
                            {formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit)}
                          </div>
                          {totalPercent > 100 && <div className="text-[11px] font-medium text-amber-600 mt-0.5">투입 합계 100% 초과</div>}
                          {totalMd > 0 && (
                            <div className="text-[10px] text-stone-400 tabular-nums mt-0.5">
                              {formatEffortFromManDays(totalMd, effortDisplayUnit)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5 min-w-[9rem]">
                            <div className="flex-1 h-2.5 bg-stone-100 rounded-full overflow-hidden min-w-[4rem] ring-1 ring-stone-200/40">
                              <div
                                className={cn('h-full rounded-full transition-all', totalPercent > 100 ? 'bg-amber-500' : 'bg-teal-500')}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                'text-xs tabular-nums shrink-0 w-[3.25rem] text-right',
                                totalPercent > 100 ? 'text-amber-700 font-semibold' : 'text-stone-500',
                              )}
                              title={totalPercent > 100 ? `실제 합계 ${formatNum2(totalPercent)}%` : undefined}
                            >
                              {totalPercent > 100 ? `${formatNum2(totalPercent)}%` : `${Math.round(barWidth)}%`}
                            </span>
                            {totalPercent > 100 && (
                              <span className="text-[10px] font-semibold text-amber-600 shrink-0 hidden sm:inline">초과</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap gap-1.5">
                            {items.map(({ project, allocationPercent }) => {
                              const workEffortMd = personProjectWorkEffort.get(person)?.get(project.id) ?? 0;
                              return (
                                <EditableAllocationBadge
                                  key={`${person}:${project.id}`}
                                  projectName={formatProjectDisplayName(project.name, project.projectKind)}
                                  allocationPercent={allocationPercent}
                                  workEffortMd={workEffortMd > 0 ? workEffortMd : undefined}
                                  effortDisplayUnit={effortDisplayUnit}
                                  disabled={person === UNSPECIFIED_PERSON}
                                  onSave={(percent) => handleUpdatePersonAllocation(project.id, person, percent)}
                                  onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                                />
                              );
                            })}
                            <AddPersonProjectAllocation
                              person={person}
                              assignedProjectIds={new Set(items.map((i) => i.project.id))}
                              availableProjects={projects}
                              disabled={person === UNSPECIFIED_PERSON}
                              onAdd={(payload, percent) => handleAddPersonProject(person, payload, percent)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selectedPerson && (
              <PersonAllocationDetailPanel
                person={selectedPerson}
                projects={projects}
                allocationItems={personAllocations.find((r) => r.person === selectedPerson)?.items ?? []}
                personProjectWorkEffort={personProjectWorkEffort}
                allTasks={allTasks}
                effortDisplayUnit={effortDisplayUnit}
                orgMemberLabelByName={allocationOrgLabelByName}
                displayMetaByName={allocationDisplayMetaByName}
                statusConfigs={wbsSettings.statusConfigs}
                onClose={() => setSelectedPerson(null)}
                onNavigateToWork={onNavigateToWork}
                profileMap={profileMap}
              />
            )}
          </motion.div>
        )
      ) : projectAllocations.length === 0 ? (
        <motion.div className="text-sm text-stone-400 bg-white border border-stone-200 rounded-xl p-6 text-center">
          표시 중인 프로젝트에 투입 인원이 없습니다.
        </motion.div>
      ) : (
        <motion.div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr className="text-[11px] text-stone-500 uppercase tracking-wide">
                  <th className="text-left font-semibold px-4 py-3 min-w-[12rem]">프로젝트</th>
                  <th className="text-center font-semibold px-2 py-3 w-20">인원</th>
                  <th className="text-right font-semibold px-3 py-3 w-32">총 투입</th>
                  <th className="text-left font-semibold px-3 py-3 w-40">투입 현황</th>
                  <th className="text-left font-semibold px-3 py-3 min-w-[18rem]">인원별</th>
                </tr>
              </thead>
              <tbody>
                {projectAllocations.map(({ project, assignments, totalPercent }) => {
                  const kind = resolveProjectKindOrDefault(project);
                  const barPct = Math.min(100, totalPercent);
                  return (
                    <tr
                      key={project.id}
                      onClick={() => toggleProjectRowSelect(project.id)}
                      className={cn(
                        'border-t border-stone-100 hover:bg-stone-50/50 align-top cursor-pointer transition-colors',
                        selectedProjectId === project.id && 'bg-orange-50/40 ring-1 ring-inset ring-orange-200/80',
                      )}
                    >
                      <td className="px-4 py-3 align-top min-w-[12rem] max-w-[22rem]">
                        <div className="flex flex-col gap-1.5">
                          <span
                            className={cn(
                              'inline-flex self-start items-center px-2 py-0.5 rounded-md text-[11px] font-bold border',
                              getProjectKindBadgeClass(kind),
                            )}
                          >
                            {kind}
                          </span>
                          <span className="text-sm font-semibold text-stone-900 leading-snug break-words">{project.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center tabular-nums text-stone-700 font-medium">{assignments.length}</td>
                      <td className="px-3 py-3 text-right align-middle">
                        <div className={cn('font-bold tabular-nums text-base', totalPercent > 100 ? 'text-amber-600' : 'text-stone-800')}>
                          {formatAllocationPercentSumForDisplay(totalPercent, effortDisplayUnit)}
                        </div>
                        {totalPercent > 100 && <div className="text-[11px] font-medium text-amber-600 mt-0.5">투입 합계 100% 초과</div>}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex items-center gap-2.5 min-w-[9rem]">
                          <div className="flex-1 h-2.5 bg-stone-100 rounded-full overflow-hidden min-w-[4rem] ring-1 ring-stone-200/40">
                            <div
                              className={cn('h-full rounded-full transition-[width]', totalPercent > 100 ? 'bg-amber-500' : 'bg-teal-500')}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              'text-xs tabular-nums shrink-0 w-[3.25rem] text-right',
                              totalPercent > 100 ? 'text-amber-700 font-semibold' : 'text-stone-500',
                            )}
                            title={totalPercent > 100 ? `실제 합계 ${formatNum2(totalPercent)}%` : undefined}
                          >
                            {totalPercent > 100 ? `${formatNum2(totalPercent)}%` : `${Math.round(barPct)}%`}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-2">
                          {assignments.map((a) => {
                            const meta = allocationDisplayMetaByName.get(a.assignee);
                            const subtitleFromMeta =
                              meta && (meta.department || meta.position)
                                ? [meta.department, meta.position].filter(Boolean).join(' · ')
                                : '';
                            const subtitle = subtitleFromMeta || allocationOrgLabelByName.get(a.assignee) || undefined;
                            return (
                              <EditableAllocationBadge
                                key={`${project.id}:${a.assignee}`}
                                projectName={a.assignee}
                                allocationPercent={a.allocationPercent}
                                subtitle={subtitle}
                                chipLayout="stacked"
                                disabled={a.assignee === UNSPECIFIED_PERSON}
                                onSave={(percent) => handleUpdatePersonAllocation(project.id, a.assignee, percent)}
                                onNavigate={onNavigateToWork ? () => onNavigateToWork(project.id) : undefined}
                              />
                            );
                          })}
                          <AddProjectPersonAllocation
                            projectName={project.name}
                            assignedPersons={new Set(assignments.map((a) => a.assignee))}
                            assigneeCandidates={allocationAssigneeCandidates}
                            onAdd={(personName, percent) => handleUpdatePersonAllocation(project.id, personName, percent)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedProjectRow && (
            <ProjectAllocationDetailPanel
              project={selectedProjectRow.project}
              assignments={selectedProjectRow.assignments}
              totalPercent={selectedProjectRow.totalPercent}
              allTasks={allTasks}
              effortDisplayUnit={effortDisplayUnit}
              orgMemberLabelByName={allocationOrgLabelByName}
              displayMetaByName={allocationDisplayMetaByName}
              statusConfigs={wbsSettings.statusConfigs}
              onClose={() => setSelectedProjectId(null)}
              onNavigateToWork={onNavigateToWork}
              profileMap={profileMap}
            />
          )}
        </motion.div>
      )}
    </section>
  );
}
