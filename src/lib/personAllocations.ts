import { addMonths, eachMonthOfInterval, format, isValid, parseISO, startOfMonth } from 'date-fns';
import type { Project, ProjectAssignment, Task } from '../types';
import { getEffectiveAllocationPercent } from './workload';

export function normalizeProjectAssignments(
  assignments: ProjectAssignment[],
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

export type ProjectAllocationRow = {
  project: Project;
  assignments: ReturnType<typeof normalizeProjectAssignments>;
  totalPercent: number;
};

export function computeProjectAllocations(projects: Project[]): ProjectAllocationRow[] {
  return projects
    .filter((p) => p.assignments && p.assignments.length > 0)
    .map((p) => {
      const assignments = normalizeProjectAssignments(p.assignments!);
      return {
        project: p,
        assignments,
        totalPercent: assignments.reduce((s, a) => s + (a.allocationPercent || 0), 0),
      };
    });
}

export type PersonAllocationItem = { project: Project; allocationPercent: number };

export type PersonAllocation = {
  person: string;
  items: PersonAllocationItem[];
  totalPercent: number;
};

export function computePersonAllocations(projectAllocations: ProjectAllocationRow[]): PersonAllocation[] {
  const personToProjectPct = new Map<string, Map<string, { project: Project; allocationPercent: number }>>();

  projectAllocations.forEach(({ project, assignments }) => {
    assignments.forEach((a) => {
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
}

/** 프로젝트 투입 추가 시 기존/신규 프로젝트 구분 */
export type PersonProjectAddPayload = { kind: 'existing'; projectId: string } | { kind: 'new'; projectName: string };

/** 투입 추가 UI 입력값으로 프로젝트 매칭 (이름·ID 정확 일치) */
export function findProjectByAllocationInput(input: string, projects: Project[]): Project | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return projects.find((p) => p.id === trimmed || p.name.trim() === trimmed);
}

/** 기존 프로젝트 투입 갱신 또는 신규 프로젝트 생성 후 투입 등록 */
export function executePersonProjectAdd(
  payload: PersonProjectAddPayload,
  person: string,
  percent: number,
  actions: {
    updateAllocation: (projectId: string) => void;
    createProject: (name: string, assignments: ProjectAssignment[]) => void;
  },
): void {
  if (payload.kind === 'existing') {
    actions.updateAllocation(payload.projectId);
    return;
  }
  const assignee = person === '(미지정)' ? '' : person;
  actions.createProject(payload.projectName, [{ assignee, allocationPercent: percent }]);
}

/** 투입율(%) 입력 문자열 파싱. allowZero가 false(기본)이면 0 이하는 null */
export function parseAllocationPercentInput(raw: string, opts?: { allowZero?: boolean }): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (!opts?.allowZero && parsed <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(parsed * 10) / 10));
}

/** 프로젝트 투입 목록에서 특정 담당자의 투입비율을 갱신(동일 이름 중복 행은 하나로 합침). 0%면 해당 담당자 행 제거 */
export function applyPersonProjectAllocation(
  assignments: ProjectAssignment[] | undefined,
  person: string,
  newPercent: number,
): ProjectAssignment[] {
  const targetName = (person || '').trim() || '(미지정)';
  const pct = !Number.isFinite(newPercent) ? 0 : Math.min(100, Math.max(0, Math.round(newPercent * 10) / 10));

  const matchesAssignee = (a: ProjectAssignment) => ((a.assignee || '').trim() || '(미지정)') === targetName;

  if (!assignments?.length) {
    if (pct <= 0) return [];
    return [{ assignee: targetName === '(미지정)' ? '' : targetName, allocationPercent: pct }];
  }

  const hasMatch = assignments.some(matchesAssignee);
  if (!hasMatch) {
    if (pct <= 0) return [...assignments];
    return [...assignments, { assignee: targetName === '(미지정)' ? '' : targetName, allocationPercent: pct }];
  }

  let merged = false;
  const result: ProjectAssignment[] = [];
  for (const a of assignments) {
    if (!matchesAssignee(a)) {
      result.push(a);
      continue;
    }
    if (merged) continue;
    merged = true;
    if (pct > 0) {
      result.push({
        ...a,
        assignee: a.assignee || (targetName === '(미지정)' ? '' : targetName),
        allocationPercent: pct,
      });
    }
  }
  return result;
}

/** 프로젝트 기간 기준 월 목록 (YYYY-MM). 기간 없으면 현재월 포함 12개월 (ProjectModal과 동일) */
export function getProjectMonthKeys(project: Pick<Project, 'startDate' | 'endDate'>): string[] {
  const start = project.startDate ? parseISO(project.startDate) : new Date();
  const end = project.endDate ? parseISO(project.endDate) : addMonths(start, 11);
  if (!isValid(start.getTime()) || !isValid(end.getTime())) {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => format(addMonths(startOfMonth(now), i), 'yyyy-MM'));
  }
  const startMonth = startOfMonth(start);
  const endMonth = startOfMonth(end);
  if (endMonth < startMonth) return [format(startMonth, 'yyyy-MM')];
  return eachMonthOfInterval({ start: startMonth, end: endMonth }).map((m) => format(m, 'yyyy-MM'));
}

/** 프로젝트 투입 인원 수 (투입비율 > 0인 담당자, 이름 중복 합산 후) */
export function countProjectPersonnel(project: Pick<Project, 'assignments'>): number {
  return normalizeProjectAssignments(project.assignments ?? []).length;
}

/**
 * 프로젝트 전체 M/M(인월): 기간 내 각 월별 투입비율(%) 합 / 100.
 * 월별 설정이 있으면 해당 월 값, 없으면 기본 allocationPercent 사용.
 */
export function computeProjectTotalManMonths(project: Pick<Project, 'startDate' | 'endDate' | 'assignments'>): number {
  const assignments = normalizeProjectAssignments(project.assignments ?? []);
  if (assignments.length === 0) return 0;
  const months = getProjectMonthKeys(project);
  let total = 0;
  for (const ym of months) {
    const dateStr = `${ym}-15`;
    for (const a of assignments) {
      const pct = getEffectiveAllocationPercent(a, dateStr);
      if (pct > 0) total += pct / 100;
    }
  }
  return Math.round(total * 10) / 10;
}

/** 담당자 → 프로젝트 ID → 작업 공수(M/D) 합 */
export function computePersonProjectWorkEffort(allTasks: Task[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  allTasks.forEach((task) => {
    const person = (task.assignee || '').trim() || '(미지정)';
    const effort = Number(task.workEffort) || 0;
    if (effort <= 0) return;
    if (!map.has(person)) map.set(person, new Map());
    const projMap = map.get(person)!;
    projMap.set(task.projectId, (projMap.get(task.projectId) ?? 0) + effort);
  });
  return map;
}

/** 담당자 → 프로젝트 ID → 할당 작업 수 */
export function computePersonProjectTaskCounts(allTasks: Task[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  allTasks.forEach((task) => {
    const person = (task.assignee || '').trim() || '(미지정)';
    if (!map.has(person)) map.set(person, new Map());
    const projMap = map.get(person)!;
    projMap.set(task.projectId, (projMap.get(task.projectId) ?? 0) + 1);
  });
  return map;
}

export type PersonTaskAllocationItem = { project: Project; taskCount: number };

export type PersonTaskAllocation = {
  person: string;
  items: PersonTaskAllocationItem[];
  totalTaskCount: number;
};

/** 표시 대상 프로젝트 범위 내 담당자별 할당 작업 수 집계 */
export function computePersonTaskAllocations(projects: Project[], taskCounts: Map<string, Map<string, number>>): PersonTaskAllocation[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));

  return Array.from(taskCounts.entries())
    .map(([person, projMap]) => {
      const items: PersonTaskAllocationItem[] = [];
      for (const [projectId, taskCount] of projMap.entries()) {
        const project = projectById.get(projectId);
        if (!project || taskCount <= 0) continue;
        items.push({ project, taskCount });
      }
      items.sort((a, b) => b.taskCount - a.taskCount);
      const totalTaskCount = items.reduce((s, i) => s + i.taskCount, 0);
      return { person, items, totalTaskCount };
    })
    .filter((row) => row.totalTaskCount > 0)
    .sort((a, b) => b.totalTaskCount - a.totalTaskCount);
}
