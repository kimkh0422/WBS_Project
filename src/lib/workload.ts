import { parseISO, isValid } from 'date-fns';
import type { Task, Project, ProjectAssignment } from '../types';
import { differenceInBusinessDaysEx, getBusinessDayStringsEx, getHolidaysForTaskDates } from './calendar';

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
  dateStr: string,
): number {
  const yyyyMm = dateStr.slice(0, 7);
  if (assignment.monthlyAllocations && assignment.monthlyAllocations[yyyyMm] !== undefined) {
    return assignment.monthlyAllocations[yyyyMm];
  }
  return assignment.allocationPercent ?? 0;
}

function getAssignmentsForTask(task: Task, projectAssignmentsByProjectId: Map<string, ProjectAssignment[]>): ProjectAssignment[] {
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
 *
 * 공수(workEffort)는 일정에 관여하지 않는다 — 이 함수는 작업의 시작·종료일(영업일)과
 * 담당자 투입비율만으로 같은 날 100% 초과 투입(과부하)을 감지해 '경고'로만 사용한다.
 * 과부하를 일정 변경으로 해소하던 기능은 제거됨(공수↔일정 분리).
 */
export function computeWorkloadOverloads(tasks: Task[], projects: Project[]): OverloadResult {
  const projectAssignmentsByProjectId = new Map<string, ProjectAssignment[]>();
  projects.forEach((p) => {
    if (p.assignments && p.assignments.length > 0) {
      projectAssignmentsByProjectId.set(p.id, p.assignments);
    }
  });

  const holidays = getHolidaysForTaskDates(tasks);
  // assignee -> date -> { totalPercent, taskIds }
  const byAssigneeDate = new Map<string, Map<string, { totalPercent: number; taskIds: Set<string> }>>();

  const leafTasks = tasks.filter((t) => !t.isMilestone && t.startDate && t.endDate && !tasks.some((other) => other.parentId === t.id));

  for (const task of leafTasks) {
    const assignments = getAssignmentsForTask(task, projectAssignmentsByProjectId);
    if (assignments.length === 0) continue;

    const start = parseISO(task.startDate);
    const end = parseISO(task.endDate);
    if (!isValid(start) || !isValid(end)) continue;

    const numBusinessDays = Math.max(1, differenceInBusinessDaysEx(start, end, holidays));
    const businessDays = getBusinessDayStringsEx(task.startDate, numBusinessDays, holidays).filter(
      (d) => d >= task.startDate && d <= task.endDate,
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
