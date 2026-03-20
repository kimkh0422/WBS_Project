import { parseISO, format, addDays, isValid } from 'date-fns';
import type { Task, Project, ProjectAssignment } from '../types';
type TaskAssignment = ProjectAssignment;
import {
  addBusinessDaysEx,
  differenceInBusinessDaysEx,
  getBusinessDayStringsEx,
  getHolidaysForTaskDates,
  isNonWorkingDay,
} from './calendar';
import {
  computeDurationBusinessDays,
  computeEndDateFromEffort,
} from './schedule';

/** 인원·일자별 투입 합산 결과 (100% 초과 시 과부하) */
export interface WorkloadDay {
  assignee: string;
  date: string;
  totalPercent: number;
  taskIds: string[];
}

/** 과부하 감지 결과 */
export interface OverloadResult {
  overloads: WorkloadDay[];
  /** 과부하가 있는 작업 ID → 해당 작업이 포함된 과부하 일자 목록 */
  taskIdToOverloadDates: Map<string, WorkloadDay[]>;
}

/** 해당 일자에 적용되는 투입비율. 월별 설정이 있으면 해당 월 값, 없으면 기본 allocationPercent */
export function getEffectiveAllocationPercent(
  assignment: { allocationPercent: number; monthlyAllocations?: Record<string, number> },
  dateStr: string
): number {
  const yyyyMm = dateStr.slice(0, 7);
  if (assignment.monthlyAllocations && assignment.monthlyAllocations[yyyyMm] !== undefined) {
    return assignment.monthlyAllocations[yyyyMm];
  }
  return assignment.allocationPercent ?? 0;
}

function getAssignmentsForTask(
  task: Task,
  projectAssignmentsByProjectId: Map<string, ProjectAssignment[]>
): ProjectAssignment[] {
  if (task.projectId) {
    const pa = projectAssignmentsByProjectId.get(task.projectId);
    if (pa && pa.length > 0) return pa;
  }
  if (task.assignee) {
    return [{ assignee: task.assignee, allocationPercent: 100 }];
  }
  return [];
}

/**
 * 인원·일자별 투입 합산. 100% 초과인 날을 과부하로 반환.
 */
export function computeWorkloadOverloads(
  tasks: Task[],
  projects: Project[]
): OverloadResult {
  const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>();
  projects.forEach((p) => {
    if (p.assignments && p.assignments.length > 0) {
      projectAssignmentsByProjectId.set(p.id, p.assignments);
    }
  });

  const holidays = getHolidaysForTaskDates(tasks);
  // assignee -> date -> { totalPercent, taskIds }
  const byAssigneeDate = new Map<string, Map<string, { totalPercent: number; taskIds: Set<string> }>>();

  const leafTasks = tasks.filter(
    (t) =>
      !t.isMilestone &&
      t.startDate &&
      t.endDate &&
      !tasks.some((other) => other.parentId === t.id)
  );

  for (const task of leafTasks) {
    const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
    if (assignments.length === 0) continue;

    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    if (!isValid(start) || !isValid(end)) continue;

    const numBusinessDays = Math.max(1, differenceInBusinessDaysEx(start, end, holidays));
    const businessDays = getBusinessDayStringsEx(task.startDate, numBusinessDays, holidays).filter(
      (d) => d >= task.startDate && d <= task.endDate
    );

    if (businessDays.length === 0) {
      const d = task.startDate;
      for (const a of assignments) {
        if (!byAssigneeDate.has(a.assignee)) {
          byAssigneeDate.set(a.assignee, new Map());
        }
        const dateMap = byAssigneeDate.get(a.assignee)!;
        if (!dateMap.has(d)) {
          dateMap.set(d, { totalPercent: 0, taskIds: new Set() });
        }
        const cell = dateMap.get(d)!;
        cell.totalPercent += getEffectiveAllocationPercent(a, d);
        cell.taskIds.add(task.id);
      }
    } else {
      for (const dateStr of businessDays) {
        for (const a of assignments) {
          if (!byAssigneeDate.has(a.assignee)) {
            byAssigneeDate.set(a.assignee, new Map());
          }
          const dateMap = byAssigneeDate.get(a.assignee)!;
          if (!dateMap.has(dateStr)) {
            dateMap.set(dateStr, { totalPercent: 0, taskIds: new Set() });
          }
          const cell = dateMap.get(dateStr)!;
          cell.totalPercent += getEffectiveAllocationPercent(a, dateStr);
          cell.taskIds.add(task.id);
        }
      }
    }
  }

  const overloads: WorkloadDay[] = [];
  const taskIdToOverloadDates = new Map<string, WorkloadDay[]>();

  for (const [assignee, dateMap] of byAssigneeDate) {
    for (const [date, cell] of dateMap) {
      if (cell.totalPercent > 100) {
        const wd: WorkloadDay = {
          assignee,
          date,
          totalPercent: Math.round(cell.totalPercent * 10) / 10,
          taskIds: Array.from(cell.taskIds),
        };
        overloads.push(wd);
        for (const tid of cell.taskIds) {
          if (!taskIdToOverloadDates.has(tid)) {
            taskIdToOverloadDates.set(tid, []);
          }
          taskIdToOverloadDates.get(tid)!.push(wd);
        }
      }
    }
  }

  return { overloads, taskIdToOverloadDates };
}

export type FixStrategy = 'extend' | 'increaseAllocation';

/**
 * 담당자별 리프 작업 목록 (과부하 해결 시 해당 담당자 전체 작업을 고려)
 */
function getLeafTasksByAssignee(
  tasks: Task[],
  projectAssignmentsByProjectId: Map<string, ProjectAssignment[]>
): Map<string, Task[]> {
  const leafTasks = tasks.filter(
    (t) =>
      !t.isMilestone &&
      t.startDate &&
      t.endDate &&
      !tasks.some((other) => other.parentId === t.id)
  );
  const byAssignee = new Map<string, Task[]>();
  for (const task of leafTasks) {
    const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
    for (const a of assignments) {
      if (!byAssignee.has(a.assignee)) byAssignee.set(a.assignee, []);
      byAssignee.get(a.assignee)!.push(task);
    }
  }
  return byAssignee;
}

/**
 * 기간 연장: 과부하인 작업들을 순차적으로 배치해 같은 날 겹침 제거.
 * 같은 담당자의 과부하 작업 + 같은 기간에 겹치는 다른 작업까지 포함해 순차 배치.
 * 여러 담당자에게 배정된 작업은 한 번만 배치하고, 담당자 처리 순서로 결정.
 */
export function fixOverloadByExtending(
  tasks: Task[],
  projects: Project[],
  overloads: WorkloadDay[]
): Task[] {
  if (overloads.length === 0) return tasks;

  const holidays = getHolidaysForTaskDates(tasks);
  const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>();
  projects.forEach((p) => {
    if (p.assignments && p.assignments.length > 0) {
      projectAssignmentsByProjectId.set(p.id, p.assignments);
    }
  });

  const byId = new Map<string, Task>();
  const result = tasks.map((t) => {
    const copy = { ...t };
    byId.set(copy.id, copy);
    return copy;
  });

  const allTasksByAssignee = getLeafTasksByAssignee(result, projectAssignmentsByProjectId);

  // 담당자별 과부하 작업 + 날짜 범위
  const byAssignee = new Map<string, { taskIds: Set<string>; earliestDate: string; latestDate: string }>();
  for (const o of overloads) {
    if (!byAssignee.has(o.assignee)) {
      byAssignee.set(o.assignee, { taskIds: new Set(), earliestDate: o.date, latestDate: o.date });
    }
    const g = byAssignee.get(o.assignee)!;
    o.taskIds.forEach((tid) => g.taskIds.add(tid));
    if (o.date < g.earliestDate) g.earliestDate = o.date;
    if (o.date > g.latestDate) g.latestDate = o.date;
  }

  // 이미 배치된 작업 ID (여러 담당자 공유 작업 중복 배치 방지)
  const placedTaskIds = new Set<string>();

  // 담당자명 정렬로 처리 순서 고정 (공유 작업 시 일관된 결과)
  const assigneeOrder = Array.from(byAssignee.keys()).sort();

  for (const assignee of assigneeOrder) {
    const g = byAssignee.get(assignee)!;
    // 이미 배치된 작업 제외, 나머지 담당자 작업 중 과부하 작업 또는 과부하 기간과 겹치는 것만 포함
    const allForAssignee = allTasksByAssignee.get(assignee) ?? [];
    const overlapRangeStart = g.earliestDate;
    let overlapRangeEnd = g.latestDate;
    for (const t of allForAssignee) {
      if (g.taskIds.has(t.id) && t.endDate && t.endDate > overlapRangeEnd) {
        overlapRangeEnd = t.endDate;
      }
    }

    const taskList = allForAssignee
      .filter((t) => {
        if (placedTaskIds.has(t.id)) return false;
        if (g.taskIds.has(t.id)) return true;
        const tStart = t.startDate || t.endDate;
        const tEnd = t.endDate || t.startDate;
        if (!tStart || !tEnd) return false;
        return tEnd >= overlapRangeStart && tStart <= overlapRangeEnd;
      })
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    if (taskList.length <= 1) {
      taskList.forEach((t) => placedTaskIds.add(t.id));
      continue;
    }

    let cursor = parseISO(g.earliestDate);
    if (!isValid(cursor)) continue;

    while (isNonWorkingDay(cursor, holidays)) {
      cursor = addDays(cursor, 1);
    }

    for (let i = 0; i < taskList.length; i++) {
      const task = byId.get(taskList[i].id);
      if (!task || task.isMilestone) continue;

      const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
      const effort = typeof task.workEffort === 'number' && task.workEffort > 0 ? task.workEffort : 1;
      const newStart = format(cursor, 'yyyy-MM-dd');
      const endDate = computeEndDateFromEffort(newStart, effort, assignments, holidays);
      task.startDate = newStart;
      task.endDate = endDate;
      placedTaskIds.add(task.id);

      const endParsed = parseISO(endDate);
      cursor = addBusinessDaysEx(endParsed, 1, holidays);
    }
  }

  return result;
}

/**
 * 투입율 증가: 과부하 작업 중 투입율이 100% 미만인 경우 100%로 올리고 종료일 재계산.
 */
export function fixOverloadByIncreasingAllocation(
  tasks: Task[],
  projects: Project[],
  overloads: WorkloadDay[]
): Task[] {
  if (overloads.length === 0) return tasks;

  const holidays = getHolidaysForTaskDates(tasks);
  const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>();
  projects.forEach((p) => {
    if (p.assignments && p.assignments.length > 0) {
      projectAssignmentsByProjectId.set(p.id, p.assignments);
    }
  });

  const byId = new Map<string, Task>();
  const result = tasks.map((t) => {
    const copy = { ...t };
    byId.set(copy.id, copy);
    return copy;
  });

  const taskIdsToFix = new Set<string>();
  for (const o of overloads) {
    o.taskIds.forEach((id) => taskIdsToFix.add(id));
  }

  for (const taskId of taskIdsToFix) {
    const task = byId.get(taskId);
    if (!task || task.isMilestone) continue;

    const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
    const hasUnderAllocated = assignments.some((a) => (a.allocationPercent || 0) < 100);
    if (!hasUnderAllocated) continue;

    const newAssignments: TaskAssignment[] = assignments.map((a) => ({
      ...a,
      allocationPercent: 100,
    }));

    const effort = typeof task.workEffort === 'number' && task.workEffort > 0 ? task.workEffort : 1;
    task.endDate = computeEndDateFromEffort(task.startDate, effort, newAssignments, holidays);
  }

  return result;
}
