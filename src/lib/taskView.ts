import { FilterState, SortConfig, Task } from '../types';
import { startOfWeek, endOfWeek } from 'date-fns';
import { getTopologicalOrder } from './schedule';

export type TaskWithDepth = Task & { depth: number };

/** 트리 순서(위→아래) + 레벨·WBS 코드. 형제는 평탄 저장 순서 우선(Alt+↑↓ 반영), 동순 시 선행·시작일로 보조 정렬 */
export type TaskWithWbs = { task: Task; depth: number; wbsCode: string };

/** `tasks` 배열에서 각 id가 처음 나타나는 인덱스 — 형제 표시 순·Alt+행 이동과 동기 */
function buildFirstFlatIndexMap(tasks: Task[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    const id = tasks[i]!.id;
    if (!m.has(id)) m.set(id, i);
  }
  return m;
}

export type BuildTasksInTreeOrderOptions = {
  /** parentId=null 인 루트만: WBS 번호 부여 없이 건너뛰고, 그 자식부터 1, 2, … 번호 */
  isWbsTreeRootSkip?: (task: Task) => boolean;
};

export function buildTasksInTreeOrderWithWbs(tasks: Task[], options?: BuildTasksInTreeOrderOptions): TaskWithWbs[] {
  const childrenByParent = buildChildrenByParent(tasks);
  const flatIndex = buildFirstFlatIndexMap(tasks);
  const topoOrder = getTopologicalOrder(tasks);
  const topoIndex = new Map<string, number>();
  topoOrder.forEach((id, i) => topoIndex.set(id, i));
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => {
      const fiA = flatIndex.get(a.id) ?? 1e9;
      const fiB = flatIndex.get(b.id) ?? 1e9;
      if (fiA !== fiB) return fiA - fiB;
      const tiA = topoIndex.get(a.id) ?? 1e9;
      const tiB = topoIndex.get(b.id) ?? 1e9;
      if (tiA !== tiB) return tiA - tiB;
      return (a.startDate || '').localeCompare(b.startDate || '');
    });
  }
  const result: TaskWithWbs[] = [];
  const skipRoot = options?.isWbsTreeRootSkip;

  function walk(parentId: string | null, parentWbs: string, depth: number) {
    const children = childrenByParent.get(parentId) ?? [];
    let numIndex = 0;
    for (const child of children) {
      if (parentId === null && skipRoot?.(child)) {
        walk(child.id, parentWbs, depth);
        continue;
      }
      numIndex += 1;
      const wbsCode = parentWbs ? `${parentWbs}.${numIndex}` : `${numIndex}`;
      result.push({ task: child, depth, wbsCode });
      walk(child.id, wbsCode, depth + 1);
    }
  }
  walk(null, '', 0);
  return result;
}

export function buildChildrenByParent(tasks: Task[]): Map<string | null, Task[]> {
  const childrenByParent = new Map<string | null, Task[]>();

  const normalizeParentId = (parentId: Task['parentId']): string | null => {
    if (parentId == null) return null;
    const v = String(parentId).trim();
    if (!v || v === 'null' || v === 'undefined') return null;
    return v;
  };

  for (const task of tasks) {
    const pid = normalizeParentId(task.parentId);
    const siblings = childrenByParent.get(pid) ?? [];
    siblings.push(task);
    childrenByParent.set(pid, siblings);
  }

  return childrenByParent;
}

export function buildTaskIndex(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task] as const));
}

export function buildParentSet(tasks: Task[]): Set<string> {
  const parentIds = new Set<string>();

  for (const task of tasks) {
    if (task.parentId != null) {
      const v = String(task.parentId).trim();
      if (!v || v === 'null' || v === 'undefined') continue;
      parentIds.add(v);
    }
  }

  return parentIds;
}

/** 부모 task id → 직속 자식 개수 (`buildParentSet`과 동일한 parentId 정규화 규칙) */
export function buildDirectChildCountByParentId(tasks: Task[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentId == null) continue;
    const v = String(task.parentId).trim();
    if (!v || v === 'null' || v === 'undefined') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
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
  // 시작 전 항목: 시작일이 오늘 이후(미래)인 작업만 표시
  if (filters.notStartedYetOnly) {
    const today = new Date().toISOString().slice(0, 10);
    if (!taskStart || taskStart <= today) return false;
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
  if (filters.searchText) {
    const q = filters.searchText.toLowerCase();
    const nameMatch = (task.name || '').toLowerCase().includes(q);
    const descMatch = (task.description || '').toLowerCase().includes(q);
    if (!nameMatch && !descMatch) return false;
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

/** Tab/Shift+Tab 직후 한 번: WBS 형제 정렬의 최종 타이브레이커(인덱스 작을수록 위) */
let pendingWbsSiblingTieBreak: Map<string, number> | null = null;

export function primeWbsSiblingOrderTieBreak(idsInVisualOrder: string[]): void {
  if (idsInVisualOrder.length === 0) {
    pendingWbsSiblingTieBreak = null;
    return;
  }
  pendingWbsSiblingTieBreak = new Map(idsInVisualOrder.map((id, i) => [id, i]));
}

function takeWbsSiblingOrderTieBreak(): Map<string, number> | null {
  const t = pendingWbsSiblingTieBreak;
  pendingWbsSiblingTieBreak = null;
  return t;
}

/** 형제 노드 정렬: 컬럼 정렬 또는 WBS(저장 순·선행·시작일·Tab 직후 타이브레이커) — 필터/비필터 트리 순회 공통 */
function orderSiblingsForTree(
  childrenByParent: Map<string | null, Task[]>,
  baseTasks: Task[],
  sortConfig: SortConfig,
  siblingTieBreak: Map<string, number> | null,
) {
  const compare = createTaskComparator(sortConfig);
  const useWbsOrder = !sortConfig || sortConfig.key === 'wbs';
  if (sortConfig && !useWbsOrder) {
    for (const siblings of childrenByParent.values()) {
      siblings.sort(compare);
    }
  } else {
    const flatIndex = buildFirstFlatIndexMap(baseTasks);
    const topoOrder = getTopologicalOrder(baseTasks);
    const topoIndex = new Map<string, number>();
    topoOrder.forEach((id, i) => topoIndex.set(id, i));
    for (const siblings of childrenByParent.values()) {
      siblings.sort((a, b) => {
        const fiA = flatIndex.get(a.id) ?? 1e9;
        const fiB = flatIndex.get(b.id) ?? 1e9;
        if (fiA !== fiB) return fiA - fiB;
        const tiA = topoIndex.get(a.id) ?? 1e9;
        const tiB = topoIndex.get(b.id) ?? 1e9;
        if (tiA !== tiB) return tiA - tiB;
        const sd = (a.startDate || '').localeCompare(b.startDate || '');
        if (sd !== 0) return sd;
        if (siblingTieBreak) {
          const ra = siblingTieBreak.get(a.id);
          const rb = siblingTieBreak.get(b.id);
          if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
        }
        return 0;
      });
    }
  }
}

export function buildVisibleTasks(
  tasks: Task[],
  filters: FilterState,
  sortConfig: SortConfig,
  options?: { preserveDepthOnFiltered?: boolean; projectTitleSkip?: (task: Task) => boolean },
): TaskWithDepth[] {
  const preserveDepthOnFiltered = options?.preserveDepthOnFiltered ?? false;
  const projectTitleSkip = options?.projectTitleSkip;
  const baseTasks =
    filters.projectIds === 'all' ? tasks : tasks.filter((task) => task.projectId && filters.projectIds.includes(task.projectId));
  const hasFilters =
    filters.status !== 'all' ||
    filters.assignee ||
    filters.assigneeUnassignedOnly ||
    filters.startDate ||
    filters.endDate ||
    !!filters.milestoneOnly ||
    !!filters.issueOnly ||
    !!filters.pastDueOnly ||
    !!filters.completedThisWeekOnly ||
    !!filters.notStartedYetOnly ||
    !!filters.searchText;
  const levelFilter = typeof filters.level === 'number';
  const targetLevel = levelFilter ? filters.level! : 0;
  const compare = createTaskComparator(sortConfig);
  const siblingTieBreak = takeWbsSiblingOrderTieBreak();

  if (hasFilters) {
    if (preserveDepthOnFiltered) {
      // 표·간트: 필터 중에도 트리 + expanded·「레벨 N까지 펼치기」가 동작하도록 순회
      const childrenByParent = buildChildrenByParent(baseTasks);
      orderSiblingsForTree(childrenByParent, baseTasks, sortConfig, siblingTieBreak);
      const taskMap = buildTaskIndex(baseTasks);
      const getDepth = createDepthGetter(taskMap);

      const subtreeHasFilterMatch = new Map<string, boolean>();
      const subtreeMatches = (taskId: string): boolean => {
        const hit = subtreeHasFilterMatch.get(taskId);
        if (hit !== undefined) return hit;
        const t = taskMap.get(taskId);
        if (!t) {
          subtreeHasFilterMatch.set(taskId, false);
          return false;
        }
        if (matchesFilters(t, filters)) {
          subtreeHasFilterMatch.set(taskId, true);
          return true;
        }
        for (const ch of childrenByParent.get(taskId) ?? []) {
          if (subtreeMatches(ch.id)) {
            subtreeHasFilterMatch.set(taskId, true);
            return true;
          }
        }
        subtreeHasFilterMatch.set(taskId, false);
        return false;
      };

      const visibleTasks: TaskWithDepth[] = [];
      const stack = [...(childrenByParent.get(null) ?? [])].reverse().map((task) => ({ task, depth: 0 }));

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        if (!subtreeMatches(current.task.id)) continue;

        if (projectTitleSkip?.(current.task)) {
          // 자식이 있으면 제목 루트는 생략하고 바로 하위로 내려간다(WBS #는 자식부터 1…).
          // 자식이 없으면 제목 행을 숨기면 표가 완전히 비어 보이므로 이 경우에는 제목 루트를 표시한다.
          const ch = childrenByParent.get(current.task.id);
          if (ch?.length) {
            for (let index = ch.length - 1; index >= 0; index -= 1) {
              stack.push({ task: ch[index]!, depth: current.depth });
            }
            continue;
          }
        }

        const level = current.depth + 1;
        if (!levelFilter || level === targetLevel) {
          const depthVal = projectTitleSkip ? current.depth : getDepth(current.task.id);
          visibleTasks.push({ ...current.task, depth: depthVal });
        }

        if (!current.task.expanded) continue;
        const children = childrenByParent.get(current.task.id);
        if (!children || children.length === 0) continue;
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({ task: children[index]!, depth: current.depth + 1 });
        }
      }

      return visibleTasks;
    }

    const filteredTasks = baseTasks.filter((task) => matchesFilters(task, filters));

    let withDepth = [...filteredTasks].sort(compare).map((task) => ({ ...task, depth: 0 }));

    if (levelFilter) {
      const taskMap = buildTaskIndex(baseTasks);
      const getDepth = createDepthGetter(taskMap);
      withDepth = withDepth.map((t) => ({ ...t, depth: getDepth(t.id) })).filter((t) => t.depth + 1 === targetLevel);
    }
    return withDepth;
  }

  const childrenByParent = buildChildrenByParent(baseTasks);
  orderSiblingsForTree(childrenByParent, baseTasks, sortConfig, siblingTieBreak);

  const visibleTasks: TaskWithDepth[] = [];
  const stack = [...(childrenByParent.get(null) ?? [])].reverse().map((task) => ({ task, depth: 0 }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (projectTitleSkip?.(current.task)) {
      const ch = childrenByParent.get(current.task.id);
      if (ch?.length) {
        for (let index = ch.length - 1; index >= 0; index -= 1) {
          stack.push({ task: ch[index]!, depth: current.depth });
        }
        continue;
      }
    }

    const level = current.depth + 1;
    if (!levelFilter || level === targetLevel) {
      visibleTasks.push({ ...current.task, depth: current.depth });
    }

    if (!current.task.expanded) continue;

    const children = childrenByParent.get(current.task.id);
    if (!children || children.length === 0) continue;

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ task: children[index]!, depth: current.depth + 1 });
    }
  }

  return visibleTasks;
}
