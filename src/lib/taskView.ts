import { FilterState, SortConfig, Task } from '../types';
import { startOfWeek, endOfWeek } from 'date-fns';
import { getTopologicalOrder } from './schedule';

export type TaskWithDepth = Task & { depth: number };

/** 트리 순서(위→아래) + 레벨·WBS 코드. 선행작업 우선 정렬 후 계단식 표현용 */
export type TaskWithWbs = { task: Task; depth: number; wbsCode: string };

export function buildTasksInTreeOrderWithWbs(tasks: Task[]): TaskWithWbs[] {
  const childrenByParent = buildChildrenByParent(tasks);
  const topoOrder = getTopologicalOrder(tasks);
  const topoIndex = new Map<string, number>();
  topoOrder.forEach((id, i) => topoIndex.set(id, i));
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => {
      const tiA = topoIndex.get(a.id) ?? 1e9;
      const tiB = topoIndex.get(b.id) ?? 1e9;
      if (tiA !== tiB) return tiA - tiB;
      return (a.startDate || '').localeCompare(b.startDate || '');
    });
  }
  const result: TaskWithWbs[] = [];
  function walk(parentId: string | null, parentWbs: string, depth: number) {
    const children = childrenByParent.get(parentId) ?? [];
    children.forEach((child, index) => {
      const wbsCode = parentWbs ? `${parentWbs}.${index + 1}` : `${index + 1}`;
      result.push({ task: child, depth, wbsCode });
      walk(child.id, wbsCode, depth + 1);
    });
  }
  walk(null, '', 0);
  return result;
}

export function buildChildrenByParent(tasks: Task[]): Map<string | null, Task[]> {
  const childrenByParent = new Map<string | null, Task[]>();

  for (const task of tasks) {
    const siblings = childrenByParent.get(task.parentId) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parentId, siblings);
  }

  return childrenByParent;
}

export function buildTaskIndex(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map(task => [task.id, task] as const));
}

export function buildParentSet(tasks: Task[]): Set<string> {
  const parentIds = new Set<string>();

  for (const task of tasks) {
    if (task.parentId) {
      parentIds.add(task.parentId);
    }
  }

  return parentIds;
}

function createTaskComparator(sortConfig: SortConfig) {
  return (a: Task, b: Task) => {
    if (!sortConfig) return 0;

    const valA = a[sortConfig.key];
    const valB = b[sortConfig.key];

    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    const comparison = valA < valB ? -1 : 1;
    return sortConfig.direction === 'asc' ? comparison : -comparison;
  };
}

function toDateStr(s: string): string {
  return (s || '').slice(0, 10);
}

function matchesFilters(task: Task, filters: FilterState) {
  if (filters.status !== 'all' && task.status !== filters.status) return false;
  const assigneeName = (task.assignee || '').toLowerCase();
  if (filters.assigneeUnassignedOnly) {
    if (assigneeName.trim().length > 0) return false;
  } else if (filters.assignee && !assigneeName.includes(filters.assignee.toLowerCase())) {
    return false;
  }
  const taskStart = toDateStr(task.startDate);
  const taskEnd = toDateStr(task.endDate);
  const hasTaskStart = !!taskStart;
  const hasTaskEnd = !!taskEnd;
  // 마일스톤/이슈 동시 선택 시: (마일스톤 OR 이슈)만 표시
  if (filters.milestoneOnly && filters.issueOnly) {
    if (!task.isMilestone && !task.isIssue) return false;
  } else {
    if (filters.milestoneOnly && !task.isMilestone) return false;
    if (filters.issueOnly && !task.isIssue) return false;
  }
  // 완료 기한 지난 항목: 종료일이 오늘 이전이고 진행률 100% 미만
  if (filters.pastDueOnly) {
    const today = new Date().toISOString().slice(0, 10);
    if (!taskEnd || taskEnd >= today || (task.progress ?? 0) >= 100) return false;
  }
  // 이번 주에 완료된 항목만 보기: 상태 done + 종료일이 이번 주(월~일) 안에 포함
  if (filters.completedThisWeekOnly) {
    if (task.status !== 'done') return false;
    if (!taskEnd) return false;
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const endDateObj = new Date(taskEnd);
    if (Number.isNaN(endDateObj.getTime())) return false;
    if (endDateObj < weekStart || endDateObj > weekEnd) return false;
  }
  if (filters.startDate && filters.endDate) {
    // 기간 겹침: task가 [startDate, endDate]와 하루라도 겹치면 표시
    if (hasTaskStart && hasTaskEnd) {
      if (taskStart > filters.endDate || taskEnd < filters.startDate) return false;
    } else if (hasTaskStart) {
      // 종료일 없음: 시작일이 금주 내/이전이면 겹침(진행중 작업)
      if (taskStart > filters.endDate) return false;
    } else if (hasTaskEnd) {
      // 시작일 없음: 종료일이 금주 내/이후면 겹침
      if (taskEnd < filters.startDate) return false;
    }
    // 둘 다 없으면 겹침 여부 불명 → 포함(금주업무 필터 시 누락 방지)
  } else {
    if (filters.startDate && hasTaskEnd && taskEnd < filters.startDate) return false;
    if (filters.endDate && hasTaskStart && taskStart > filters.endDate) return false;
  }
  return true;
}

function createDepthGetter(taskMap: Map<string, Task>) {
  const depthMemo = new Map<string, number>();

  const getDepth = (taskId: string): number => {
    const cached = depthMemo.get(taskId);
    if (cached !== undefined) return cached;

    const task = taskMap.get(taskId);
    if (!task || !task.parentId || !taskMap.has(task.parentId)) {
      depthMemo.set(taskId, 0);
      return 0;
    }

    const depth = getDepth(task.parentId) + 1;
    depthMemo.set(taskId, depth);
    return depth;
  };

  return getDepth;
}

export function buildVisibleTasks(
  tasks: Task[],
  filters: FilterState,
  sortConfig: SortConfig,
  options?: { preserveDepthOnFiltered?: boolean }
): TaskWithDepth[] {
  const preserveDepthOnFiltered = options?.preserveDepthOnFiltered ?? false;
  const baseTasks = filters.projectId === 'all'
    ? tasks
    : tasks.filter(task => task.projectId === filters.projectId);
  const hasFilters =
    filters.status !== 'all' ||
    filters.assignee ||
    filters.assigneeUnassignedOnly ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly ||
    !!filters.pastDueOnly ||
    !!filters.completedThisWeekOnly;
  const levelFilter = typeof filters.level === 'number';
  const targetLevel = levelFilter ? filters.level! : 0;
  const compare = createTaskComparator(sortConfig);

  if (hasFilters) {
    const filteredTasks = baseTasks.filter(task => matchesFilters(task, filters));

    const taskMap = buildTaskIndex(baseTasks);
    const getDepth = createDepthGetter(taskMap);

    let withDepth = preserveDepthOnFiltered
      ? [...filteredTasks].sort(compare).map(task => ({ ...task, depth: getDepth(task.id) }))
      : [...filteredTasks].sort(compare).map(task => ({ ...task, depth: 0 }));

    if (levelFilter) {
      withDepth = withDepth.filter(t => t.depth + 1 === targetLevel);
    }
    return withDepth;
  }

  const childrenByParent = buildChildrenByParent(baseTasks);
  const useWbsOrder = !sortConfig || sortConfig.key === 'wbs';
  if (sortConfig && !useWbsOrder) {
    for (const siblings of childrenByParent.values()) {
      siblings.sort(compare);
    }
  } else {
    // WBS 정렬(또는 정렬 없음): 선행작업 우선, 동일하면 시작일 빠른 순 (일정 순서에 맞는 WBS)
    const topoOrder = getTopologicalOrder(baseTasks);
    const topoIndex = new Map<string, number>();
    topoOrder.forEach((id, i) => topoIndex.set(id, i));
    for (const siblings of childrenByParent.values()) {
      siblings.sort((a, b) => {
        const tiA = topoIndex.get(a.id) ?? 1e9;
        const tiB = topoIndex.get(b.id) ?? 1e9;
        if (tiA !== tiB) return tiA - tiB;
        return (a.startDate || '').localeCompare(b.startDate || '');
      });
    }
  }

  const visibleTasks: TaskWithDepth[] = [];
  const stack = [...(childrenByParent.get(null) ?? [])].reverse().map(task => ({ task, depth: 0 }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const level = current.depth + 1;
    if (!levelFilter || level === targetLevel) {
      visibleTasks.push({ ...current.task, depth: current.depth });
    }

    if (!current.task.expanded) continue;

    const children = childrenByParent.get(current.task.id);
    if (!children || children.length === 0) continue;

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ task: children[index], depth: current.depth + 1 });
    }
  }

  return visibleTasks;
}
