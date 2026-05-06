import { parseISO, format, isValid } from 'date-fns';
import type { Task, ProjectAssignment as TaskAssignment, WorkEffortUnit } from '../types';
import { taskStoredEffortAsManDays } from './workEffortUnits';
import {
  addBusinessDaysEx,
  subtractBusinessDaysEx,
  differenceInBusinessDaysEx,
  getBusinessDayStringsEx,
  getHolidaysForTaskDates,
  getKoreanHolidaysSet,
} from './calendar';

const ALLOCATION_STEP = 10;
const MIN_ALLOCATION = 10;
const MAX_ALLOCATION = 100;

/** 투입비율 옵션 (10%, 20%, ... 100%) */
export const ALLOCATION_OPTIONS = Array.from(
  { length: (MAX_ALLOCATION - MIN_ALLOCATION) / ALLOCATION_STEP + 1 },
  (_, i) => MIN_ALLOCATION + i * ALLOCATION_STEP,
);

/**
 * 총 투입비율(0~1) 계산. assignments가 없거나 비어 있으면 1 (100%)로 간주.
 */
export function getTotalAllocationRatio(assignments: TaskAssignment[] | undefined): number {
  if (!assignments || assignments.length === 0) return 1;
  const sum = assignments.reduce((s, a) => s + (a.allocationPercent || 0), 0);
  return Math.min(100, Math.max(0, sum)) / 100;
}

/**
 * 작업 공수(MD)와 투입비율로 소요 영업일 수 계산.
 * - 공수(workEffort) = Man-Day(MD): 100% 투입 시 1 영업일 = 1 MD (1인일, 하루 8시간 가정).
 * - 10% 투입이면 1 MD를 하려면 1/0.1 = 10 영업일 소요.
 * - duration = ceil(workEffort / totalAllocation). totalAllocation 0이면 workEffort 그대로.
 */
export function computeDurationBusinessDays(workEffort: number, assignments: TaskAssignment[] | undefined): number {
  if (!Number.isFinite(workEffort) || workEffort <= 0) return 0;
  const ratio = getTotalAllocationRatio(assignments);
  if (ratio <= 0) return Math.ceil(workEffort);
  return Math.ceil(workEffort / ratio);
}

/**
 * 시작일 + 작업공수 + 투입비율 → 종료일(영업일 기준) 계산.
 * 100% = 1 MD당 1 영업일, 10% = 1 MD당 10 영업일. 토·일·공휴일 제외. holidays 미지정 시 한국 공휴일 사용.
 */
export function computeEndDateFromEffort(
  startDate: string,
  workEffort: number,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
): string {
  const start = parseISO(startDate);
  if (!isValid(start)) return startDate;
  const days = computeDurationBusinessDays(workEffort, assignments);
  if (days <= 0) return startDate;
  const hol = holidays ?? getKoreanHolidaysSet(start.getFullYear() - 1, start.getFullYear() + 2);
  const end = addBusinessDaysEx(start, days - 1, hol);
  return format(end, 'yyyy-MM-dd');
}

/**
 * 종료일 + 기간(영업일) → 시작일 역산.
 * workEffort가 있으면 공수·투입비율로 기간 계산, 없으면 originalStart~originalEnd 기간 사용.
 */
export function computeStartDateFromEndDate(
  endDate: string,
  workEffort: number | undefined,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
  originalStart?: string,
  originalEnd?: string,
): string {
  const end = parseISO(endDate);
  if (!isValid(end)) return endDate;
  const hol = holidays ?? getKoreanHolidaysSet(end.getFullYear() - 1, end.getFullYear() + 2);
  let durationDays: number;
  if (typeof workEffort === 'number' && workEffort > 0) {
    durationDays = Math.max(1, computeDurationBusinessDays(workEffort, assignments));
  } else if (originalStart && originalEnd) {
    const s = parseISO(originalStart);
    const e = parseISO(originalEnd);
    durationDays = isValid(s) && isValid(e) ? Math.max(1, differenceInBusinessDaysEx(s, e, hol)) : 1;
  } else {
    return endDate; // 기간 없으면 역산 불가
  }
  const start = subtractBusinessDaysEx(end, durationDays - 1, hol);
  return format(start, 'yyyy-MM-dd');
}

/**
 * 시작일·종료일 + 투입비율 → 작업 공수(MD) 역산.
 * 투입공수(MD) = 영업일 수 × (투입비율/100). 100% 1일 = 1 MD. 토·일·공휴일 제외. holidays 미지정 시 한국 공휴일 사용.
 */
export function computeWorkEffortFromDates(
  startDate: string,
  endDate: string,
  assignments: TaskAssignment[] | undefined,
  holidays?: Set<string>,
): number {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (!isValid(start) || !isValid(end)) return 0;
  const hol = holidays ?? getKoreanHolidaysSet(start.getFullYear() - 1, end.getFullYear() + 2);
  const businessDays = differenceInBusinessDaysEx(start, end, hol);
  if (businessDays <= 0) return 0;
  const ratio = getTotalAllocationRatio(assignments);
  return Math.round(businessDays * ratio * 10) / 10;
}

/**
 * 의존성 그래프 기준 위상 정렬: 선행 작업이 먼저 오는 순서.
 * WBS 번호/표시 순서에서 선행작업이 같은 레벨에서 상위에 오도록 할 때 사용.
 * 사이클은 무시하고 진행.
 */
export function getTopologicalOrder(tasks: Task[]): string[] {
  const byId = new Map<string, Task>();
  tasks.forEach((t) => byId.set(t.id, t));

  const deps = new Map<string, string[]>();
  tasks.forEach((t) => {
    const preds = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (preds.length > 0) deps.set(t.id, preds);
  });

  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskIdsByInputOrder = tasks.map((t) => t.id);
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return;
    visiting.add(id);
    const preds = deps.get(id) ?? [];
    const predsSorted = [...preds].sort((a, b) => taskIdsByInputOrder.indexOf(a) - taskIdsByInputOrder.indexOf(b));
    for (const predId of predsSorted) {
      visit(predId);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of taskIdsByInputOrder) {
    visit(id);
  }
  return order;
}

/**
 * 크리티컬 패스(임계 경로) 계산: 슬랙이 0인 작업 ID 집합 반환.
 * 선행관계(FS)와 영업일 기준 기간으로 전진/후진 패스 후 슬랙 = LS - ES === 0 인 작업을 크리티컬로 간주.
 */
export function getCriticalPathTaskIds(
  tasks: Task[],
  projectAssignmentsByProjectId?: Map<string, TaskAssignment[]>,
  /** 프로젝트별 공수 숫자 단위(없으면 일 단위로 간주) */
  projectEffortUnitByProjectId?: Map<string, WorkEffortUnit>,
): Set<string> {
  if (tasks.length === 0) return new Set();
  const byId = new Map<string, Task>();
  tasks.forEach((t) => byId.set(t.id, t));

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  tasks.forEach((t) => {
    const deps = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (deps.length > 0) preds.set(t.id, deps);
    for (const p of deps) {
      if (!succs.has(p)) succs.set(p, []);
      succs.get(p)!.push(t.id);
    }
  });

  const order = getTopologicalOrder(tasks);
  const holidays = getHolidaysForTaskDates(tasks);

  const projectStart = tasks.reduce((min, t) => {
    const d = t.startDate;
    return !d || (min && d < min) ? min : d;
  }, '' as string);
  if (!projectStart) return new Set();

  const startDate = parseISO(projectStart);
  if (!isValid(startDate)) return new Set();

  function dateToIndex(dateStr: string): number {
    const d = parseISO(dateStr);
    if (!isValid(d)) return 0;
    return differenceInBusinessDaysEx(startDate, d, holidays);
  }

  const durationById = new Map<string, number>();
  for (const t of tasks) {
    const assignments = getAssignmentsForTask(t, projectAssignmentsByProjectId);
    let dur: number;
    if (t.isMilestone) {
      dur = 0;
    } else if (typeof t.workEffort === 'number' && t.workEffort > 0) {
      const md = taskStoredEffortAsManDays(t, projectEffortUnitByProjectId);
      dur = Math.max(1, computeDurationBusinessDays(md, assignments));
    } else {
      const s = parseISO(t.startDate);
      const e = parseISO(t.endDate);
      dur = isValid(s) && isValid(e) ? Math.max(1, differenceInBusinessDaysEx(s, e, holidays)) : 1;
    }
    durationById.set(t.id, dur);
  }

  const ES = new Map<string, number>();
  const EF = new Map<string, number>();
  for (const id of order) {
    const task = byId.get(id);
    if (!task) continue;
    const duration = durationById.get(id) ?? 1;
    const predList = preds.get(id);
    const es = !predList || predList.length === 0 ? dateToIndex(task.startDate) : Math.max(...predList.map((p) => EF.get(p) ?? 0)) + 1;
    const ef = duration > 0 ? es + duration - 1 : es;
    ES.set(id, es);
    EF.set(id, ef);
  }

  const projectEnd = Math.max(...Array.from(EF.values()), 0);
  const LS = new Map<string, number>();
  const LF = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const duration = durationById.get(id) ?? 1;
    const succList = succs.get(id);
    const lf = !succList || succList.length === 0 ? projectEnd : Math.min(...succList.map((s) => LS.get(s) ?? projectEnd)) - 1;
    const ls = duration > 0 ? lf - duration + 1 : lf;
    LF.set(id, lf);
    LS.set(id, ls);
  }

  const critical = new Set<string>();
  for (const id of order) {
    const es = ES.get(id) ?? 0;
    const ls = LS.get(id) ?? 0;
    if (ls - es <= 0) critical.add(id);
  }
  return critical;
}

/** 작업별 투입비율: 프로젝트 투입인력 사용 */
function getAssignmentsForTask(task: Task, projectAssignmentsByProjectId?: Map<string, TaskAssignment[]>): TaskAssignment[] | undefined {
  if (projectAssignmentsByProjectId && task.projectId) {
    const pa = projectAssignmentsByProjectId.get(task.projectId);
    if (pa && pa.length > 0) return pa;
  }
  return undefined;
}

/**
 * 선행관계(FS)에 따라 시작일을 일관되게 조정하고,
 * 투입공수(workEffort)와 투입비율(assignments)로 완료일을 계상.
 * - 선행 작업 종료일 이후에만 시작.
 * - 기간 = 작업공수 / 총투입비율(영업일). 완료일 = 시작일 + 기간.
 * - 상위 작업은 하위 작업 구간으로 맞춤.
 */
export function applyDependencySchedule(
  tasks: Task[],
  projectAssignmentsByProjectId?: Map<string, TaskAssignment[]>,
  /** 이번에 delta로 옮긴 작업(34번+하위 등). 재계산에서 제외해 덮어쓰지 않음 */
  excludeFromRecalc?: Set<string>,
  projectEffortUnitByProjectId?: Map<string, WorkEffortUnit>,
): Task[] {
  const byId = new Map<string, Task>();
  const result = tasks.map((t) => {
    const copy = { ...t };
    byId.set(copy.id, copy);
    return copy;
  });

  const deps = new Map<string, string[]>();
  result.forEach((t) => {
    const preds = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (preds.length > 0) deps.set(t.id, preds);
  });
  const order = getTopologicalOrder(result);
  const holidays = getHolidaysForTaskDates(result);
  const locked = (t: Task) => new Set(t.userLockedFields ?? []);

  // 선행관계(dependencies)가 지정된 작업만 일정 제약에 연쇄 반응.
  for (const id of order) {
    const task = byId.get(id)!;
    if (excludeFromRecalc?.has(id)) continue;

    const taskLocked = locked(task);
    if (taskLocked.has('startDate')) continue;

    const predIds = deps.get(id);
    if (!predIds || predIds.length === 0) continue;

    let maxPredEnd = '';
    for (const predId of predIds) {
      const pred = byId.get(predId);
      if (!pred?.endDate) continue;
      if (!maxPredEnd || pred.endDate > maxPredEnd) maxPredEnd = pred.endDate;
    }

    if (maxPredEnd) {
      const minStart = format(addBusinessDaysEx(parseISO(maxPredEnd), 1, holidays), 'yyyy-MM-dd');
      task.startDate = minStart;

      const originalTask = tasks.find((t) => t.id === id);
      if (originalTask && !taskLocked.has('endDate')) {
        const s = parseISO(originalTask.startDate);
        const e = parseISO(originalTask.endDate);
        if (isValid(s) && isValid(e)) {
          const durationDays = Math.max(1, differenceInBusinessDaysEx(s, e, holidays));
          task.endDate = format(addBusinessDaysEx(parseISO(minStart), durationDays - 1, holidays), 'yyyy-MM-dd');
        }
      }
    }
  }

  // 투입공수·투입비율로 완료일 계상 (endDate 고정 작업은 제외)
  for (const task of result) {
    if (excludeFromRecalc?.has(task.id)) continue;
    if (locked(task).has('endDate')) continue;
    const workEffort = typeof task.workEffort === 'number' && task.workEffort > 0 ? task.workEffort : undefined;
    if (workEffort == null) continue;
    const effortMd = taskStoredEffortAsManDays(task, projectEffortUnitByProjectId);
    if (!(effortMd > 0)) continue;
    const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
    const start = parseISO(task.startDate);
    if (!isValid(start)) continue;
    task.endDate = computeEndDateFromEffort(task.startDate, effortMd, assignments, holidays);
  }

  // 상위 작업은 하위 작업의 시작일/종료일 범위로 맞춤
  const byParent = new Map<string | null, Task[]>();
  result.forEach((t) => {
    const pid = t.parentId ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(t);
  });
  const depthOrder = (parentId: string | null): string[] => {
    const children = byParent.get(parentId) ?? [];
    const ids: string[] = [];
    for (const c of children) {
      ids.push(c.id);
      ids.push(...depthOrder(c.id));
    }
    return ids;
  };
  const allIdsByDepth = depthOrder(null);
  const lockedRollup = (t: Task) => new Set(t.userLockedFields ?? []);
  for (let i = allIdsByDepth.length - 1; i >= 0; i--) {
    const id = allIdsByDepth[i];
    const task = byId.get(id)!;
    const taskLocked = lockedRollup(task);
    const children = byParent.get(id) ?? [];
    if (children.length === 0) continue;
    const starts = children.map((c) => c.startDate).filter(Boolean);
    const ends = children.map((c) => c.endDate).filter(Boolean);
    if (starts.length > 0 && !taskLocked.has('startDate')) task.startDate = starts.reduce((a, b) => (a < b ? a : b));
    if (ends.length > 0 && !taskLocked.has('endDate')) task.endDate = ends.reduce((a, b) => (a > b ? a : b));
  }

  return result;
}
