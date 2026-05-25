import { addMonths, eachMonthOfInterval, format, isValid, parseISO, startOfMonth } from 'date-fns';
import type { OrgMember } from '../data/organization';
import type { Project, ProjectAssignment, Task } from '../types';
import {
  inferProjectTopDivisionId,
  UNASSIGNED_DIVISION_SPLIT_PREFIX,
  UNASSIGNED_PERSON_KEY,
  type AllocationDivisionInferInput,
} from './allocationDivisionInfer';
import { formatProjectDisplayName, parseKindBracketPrefixForNewProject } from './projectKind';
import { round1 } from './utils';
import { getEffectiveAllocationPercent } from './workload';

/** 원시 assignments에서 해당 담당자의 월별 투입(%)을 합칩니다(동일 키는 마지막 값). */
export function mergeMonthlyAllocationsForAssignee(project: Project, assignee: string): Record<string, number> | null {
  const target = (assignee || '').trim() || '(미지정)';
  const out: Record<string, number> = {};
  for (const a of project.assignments ?? []) {
    const key = (a.assignee || '').trim() || '(미지정)';
    if (key !== target) continue;
    if (!a.monthlyAllocations) continue;
    for (const [ym, v] of Object.entries(a.monthlyAllocations)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[ym] = n;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

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
  return projects.find((p) => p.id === trimmed || p.name.trim() === trimmed || formatProjectDisplayName(p.name, p.projectKind) === trimmed);
}

/** 기존 프로젝트 투입 갱신 또는 신규 프로젝트 생성 후 투입 등록 */
export function executePersonProjectAdd(
  payload: PersonProjectAddPayload,
  person: string,
  percent: number,
  actions: {
    updateAllocation: (projectId: string) => void;
    createProject: (name: string, assignments: ProjectAssignment[], reportExtras?: Partial<Pick<Project, 'projectKind'>>) => void;
  },
): void {
  if (payload.kind === 'existing') {
    actions.updateAllocation(payload.projectId);
    return;
  }
  const assignee = person === '(미지정)' ? '' : person;
  const { name, projectKind } = parseKindBracketPrefixForNewProject(payload.projectName);
  actions.createProject(name, [{ assignee, allocationPercent: percent }], projectKind ? { projectKind } : undefined);
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

/**
 * 인원 행에서 프로젝트 투입을 추가할 때 투입율 입력란 기본값.
 * 합계가 100% 미만이면 남은 비중, 이미 100% 이상이면 10%를 제안(직접 수정 가능).
 */
export function suggestPercentForPersonAllocationAdd(totalPercentAcrossProjects: number): number {
  const t = Number(totalPercentAcrossProjects);
  const safe = !Number.isFinite(t) ? 0 : t;
  const headroom = Math.round((100 - safe) * 10) / 10;
  if (headroom > 0) return Math.min(100, headroom);
  return 10;
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

/** 프로젝트 내 담당자별 WBS 공수(M/D) 합 */
export function computeProjectAssigneeWorkEffort(allTasks: Task[], projectId: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of allTasks) {
    if (t.projectId !== projectId) continue;
    const person = (t.assignee || '').trim() || '(미지정)';
    const effort = Number(t.workEffort) || 0;
    if (effort <= 0) continue;
    map.set(person, (map.get(person) ?? 0) + effort);
  }
  return map;
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

/** 담당자 → 프로젝트 ID → workEffort×(진척%/100) 합(M/D) — 공수 가중 완료 반영량 */
export function computePersonProjectEarnedEffort(allTasks: Task[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const task of allTasks) {
    const person = (task.assignee || '').trim() || '(미지정)';
    const effort = Number(task.workEffort) || 0;
    if (effort <= 0) continue;
    const p = typeof task.progress === 'number' && Number.isFinite(task.progress) ? Math.min(100, Math.max(0, task.progress)) : 0;
    const earned = effort * (p / 100);
    if (!map.has(person)) map.set(person, new Map());
    const projMap = map.get(person)!;
    projMap.set(task.projectId, (projMap.get(task.projectId) ?? 0) + earned);
  }
  return map;
}

/** WBS 작업에 배정된 공수(M/D) 기준: 담당자별·프로젝트별 항목 */
export type PersonWorkEffortItem = { project: Project; workEffortMd: number; earnedEffortMd: number };

export type PersonWorkEffortAllocation = {
  person: string;
  items: PersonWorkEffortItem[];
  /** 담당자 전체 WBS 공수 합(M/D) */
  totalMd: number;
  /** Σ(workEffort×진척%/100), 공수 가중 완료 반영량(M/D) */
  totalEarnedMd: number;
};

/**
 * 공수 합 대비 완료 반영 비율(%). Σ(earned)/Σ(effort)×100.
 */
export function computePersonWorkEffortWeightedProgressPct(row: Pick<PersonWorkEffortAllocation, 'totalMd' | 'totalEarnedMd'>): number {
  const t = row.totalMd;
  if (!Number.isFinite(t) || t <= 0) return 0;
  const raw = (row.totalEarnedMd / t) * 100;
  return round1(Math.min(100, Math.max(0, raw)));
}

/**
 * 표시 대상 `projects` 범위의 작업만 집계합니다.
 * `workEffort`가 0보다 큰 작업만 합산하며, 프로젝트당 공수 합이 큰 순으로 정렬합니다.
 */
export function computePersonWorkEffortAllocationsFromTasks(projects: Project[], allTasks: Task[]): PersonWorkEffortAllocation[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const effortMap = computePersonProjectWorkEffort(allTasks);
  const earnedMap = computePersonProjectEarnedEffort(allTasks);

  return Array.from(effortMap.entries())
    .map(([person, projMap]) => {
      const items: PersonWorkEffortItem[] = [];
      const personEarned = earnedMap.get(person);
      for (const [projectId, md] of projMap.entries()) {
        const project = projectById.get(projectId);
        if (!project || !Number.isFinite(md) || md <= 0) continue;
        const earned = personEarned?.get(projectId);
        const earnedEffortMd = typeof earned === 'number' && Number.isFinite(earned) ? earned : 0;
        items.push({ project, workEffortMd: md, earnedEffortMd });
      }
      items.sort((a, b) => b.workEffortMd - a.workEffortMd);
      const totalMd = items.reduce((s, i) => s + i.workEffortMd, 0);
      const totalEarnedMd = items.reduce((s, i) => s + i.earnedEffortMd, 0);
      return { person, items, totalMd, totalEarnedMd };
    })
    .filter((row) => row.items.length > 0)
    .sort((a, b) => b.totalMd - a.totalMd);
}

/**
 * `(미지정)` 담당 공수 행을, 프로젝트의 PM·PO·소유자 부서로 추정한 최상위 사업부별로 나눈다(표시·집계 전용, WBS 담당은 바꾸지 않음).
 * 추론 불가 항목은 기존처럼 `(미지정)` 한 행에 남긴다.
 */
export function splitUnassignedPersonWorkEffortByInferredDivision(
  rows: PersonWorkEffortAllocation[],
  ctx: AllocationDivisionInferInput | undefined,
): PersonWorkEffortAllocation[] {
  if (!ctx) return rows;

  const out: PersonWorkEffortAllocation[] = [];

  for (const row of rows) {
    if (row.person !== UNASSIGNED_PERSON_KEY) {
      out.push(row);
      continue;
    }

    const byDiv = new Map<string, PersonWorkEffortItem[]>();
    const unknown: PersonWorkEffortItem[] = [];

    for (const it of row.items) {
      const did = inferProjectTopDivisionId(it.project, ctx);
      if (!did) unknown.push(it);
      else {
        if (!byDiv.has(did)) byDiv.set(did, []);
        byDiv.get(did)!.push(it);
      }
    }

    const sortedEntries = [...byDiv.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
    for (const [divId, items] of sortedEntries) {
      items.sort((a, b) => b.workEffortMd - a.workEffortMd);
      const totalMd = items.reduce((s, i) => s + i.workEffortMd, 0);
      if (totalMd <= 0) continue;
      const totalEarnedMd = items.reduce((s, i) => s + i.earnedEffortMd, 0);
      out.push({
        person: `${UNASSIGNED_DIVISION_SPLIT_PREFIX}${divId}`,
        items,
        totalMd,
        totalEarnedMd,
      });
    }

    if (unknown.length > 0) {
      unknown.sort((a, b) => b.workEffortMd - a.workEffortMd);
      const totalMd = unknown.reduce((s, i) => s + i.workEffortMd, 0);
      if (totalMd > 0) {
        const totalEarnedMd = unknown.reduce((s, i) => s + i.earnedEffortMd, 0);
        out.push({ person: UNASSIGNED_PERSON_KEY, items: unknown, totalMd, totalEarnedMd });
      }
    }
  }

  return out.sort((a, b) => b.totalMd - a.totalMd);
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

/**
 * 조직 인원 디렉터리가 있을 때, 인원별 작업 할당 표에 조직의 전체 직원을 포함한다.
 * - 조직 멤버 순서를 먼저 채우고, 작업에는 있으나 조직에 없는 담당자는 뒤에 이어 붙인다.
 * - 할당이 없는 직원은 totalTaskCount 0, items 빈 배열로 둔다.
 */
export function mergePersonTaskAllocationsWithOrgDirectory(
  base: PersonTaskAllocation[],
  orgMembers: OrgMember[] | undefined,
): PersonTaskAllocation[] {
  const byPerson = new Map(base.map((r) => [r.person, r]));
  const seen = new Set<string>();
  const out: PersonTaskAllocation[] = [];

  for (const m of orgMembers ?? []) {
    const name = (m.name || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(byPerson.get(name) ?? { person: name, items: [], totalTaskCount: 0 });
  }

  for (const row of base) {
    if (seen.has(row.person)) continue;
    seen.add(row.person);
    out.push(row);
  }

  return out;
}
