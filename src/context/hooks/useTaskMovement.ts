import { useCallback, useMemo, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import type { Task, FilterState, SortConfig, Project } from '../../types';
import { recomputeProjectRollups } from '../../lib/rollups';
import { buildVisibleTasks, primeWbsSiblingOrderTieBreak } from '../../lib/taskView';
import { isProjectTitleRootTask } from '../../lib/ensureProjectTopLevelName';

// 들여쓰기/내어쓰기/재배치 후 롤업은 진척·공수만 수행한다(skipScheduleRollup=true).
// 부모 시작일·종료일은 자동 변경하지 않음 — 표의 '일정 자동 맞춤' 메뉴로만 정렬.

export interface TaskMovementDeps {
  saveHistory: (label?: string) => void;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  currentProjectIdRef: MutableRefObject<string>;
  allTasksRef: MutableRefObject<Task[]>;
  /** 들여쓰기/내어쓰기 시 표시 순서를 맞추기 위해 프로젝트명 전용 루트 행을 표 순서에서 제외할 때 사용 */
  projectsRef: MutableRefObject<Project[]>;
  setTreeExpandLevel: (level: number) => void;
  /** 레벨 변경(들여쓰기/내어쓰기)도 로컬 변경으로 표시 — 저장 버튼 활성·백그라운드 풀의 덮어쓰기 방지 */
  bumpDirty: (...projectIds: string[]) => void;
}

/** Tab/Shift+Tab 시 표와 동일한 가정: 필터 없음·WBS 오름차순(키보드에서 레벨 변경 허용 조건과 맞춤) */
const LEVEL_OP_FILTERS: FilterState = {
  projectIds: 'all',
  status: 'all',
  assignee: '',
  startDate: '',
  endDate: '',
  milestoneOnly: false,
  issueOnly: false,
  level: 'all',
  pastDueOnly: false,
  completedThisWeekOnly: false,
  notStartedYetOnly: false,
  searchText: '',
  assigneeUnassignedOnly: false,
};

const WBS_SORT_ASC: SortConfig = { key: 'wbs', direction: 'asc' };

function stableVisibleIdsForMovement(projectTasks: Task[], projects: Project[]): string[] {
  const byId = new Map(projects.map((p) => [p.id, p] as const));
  return buildVisibleTasks(projectTasks, LEVEL_OP_FILTERS, WBS_SORT_ASC, {
    projectTitleSkip: (t) => isProjectTitleRootTask(t, byId.get(t.projectId)),
  }).map((t) => t.id);
}

function normalizeParentIdForReorder(parentId: Task['parentId']): string | null {
  if (parentId == null) return null;
  const v = String(parentId).trim();
  if (!v || v === 'null' || v === 'undefined') return null;
  return v;
}

const parentKey = (t: Task) => normalizeParentIdForReorder(t.parentId);

/** Alt+↑↓: 표시 순서 기준 형제와 평탄 배열에서 스왑할 인덱스 쌍 */
export function findSiblingSwapIndicesInFlatList(
  flatTasks: Task[],
  projectId: string,
  taskId: string,
  direction: 'up' | 'down',
  projects: Project[],
): { iA: number; iB: number } | null {
  const projectTasks = flatTasks.filter((t) => t.projectId === projectId);
  const task = projectTasks.find((t) => t.id === taskId);
  if (!task) return null;

  const stableIds = stableVisibleIdsForMovement(projectTasks, projects);
  const visIdx = (tid: string) => {
    const i = stableIds.indexOf(tid);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const pKey = parentKey(task);
  const siblings = projectTasks.filter((t) => parentKey(t) === pKey);
  siblings.sort((a, b) => visIdx(a.id) - visIdx(b.id));
  const idx = siblings.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  const swapWith = direction === 'up' ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return null;

  const iA = flatTasks.findIndex((t) => t.id === taskId);
  const iB = flatTasks.findIndex((t) => t.id === swapWith.id);
  if (iA === -1 || iB === -1 || iA === iB) return null;
  return { iA, iB };
}

export function swapTasksAtIndices(flatTasks: Task[], iA: number, iB: number): Task[] {
  const next = [...flatTasks];
  [next[iA], next[iB]] = [next[iB]!, next[iA]!];
  return next;
}

/**
 * Tab 다중 들여쓰기: 같은 부모·형제 목록에서 표시 순으로 붙어 있는 선택 행은 한 구간으로 묶고,
 * 구간 전체의 parentId를 "구간 첫 행의 바로 위 형제"로 맞춘다. 역순으로 한 행씩 들이면
 * 다음 행이 방금 들여진 행의 자식으로 붙어 계단식이 되는 문제를 막는다.
 * 표시 순서에서 띄어진 선택은 구간이 나뉘어 각각 1단계만 적용된다.
 */
function computeBulkIndentParentChanges(
  projectTasks: Task[],
  ids: string[],
  stableIds: string[],
): { parentChange: Map<string, string>; expandIds: Set<string> } | null {
  const selectedIds = new Set(ids);
  const visIdx = (tid: string) => {
    const i = stableIds.indexOf(tid);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const actionable = ids.filter((taskId) => {
    const task = projectTasks.find((t) => t.id === taskId);
    if (!task) return false;
    if (task.parentId && selectedIds.has(task.parentId)) return false;
    return true;
  });
  if (actionable.length === 0) return null;

  const ordered = [...actionable].sort((a, b) => visIdx(a) - visIdx(b));

  const siblingIdsSortedForParent = (pKey: string | null) => {
    const sibs = projectTasks.filter((t) => parentKey(t) === pKey);
    sibs.sort((a, b) => visIdx(a.id) - visIdx(b.id));
    return sibs.map((t) => t.id);
  };

  const adjacentInSiblingOrder = (upperId: string, lowerId: string) => {
    const tu = projectTasks.find((t) => t.id === upperId);
    const tl = projectTasks.find((t) => t.id === lowerId);
    if (!tu || !tl) return false;
    const pku = parentKey(tu);
    if (pku !== parentKey(tl)) return false;
    const sibIds = siblingIdsSortedForParent(pku);
    const iu = sibIds.indexOf(upperId);
    const il = sibIds.indexOf(lowerId);
    return il === iu + 1;
  };

  const segments: string[][] = [];
  let cur: string[] = [ordered[0]!];
  for (let i = 1; i < ordered.length; i++) {
    const prevId = ordered[i - 1]!;
    const id = ordered[i]!;
    if (adjacentInSiblingOrder(prevId, id)) cur.push(id);
    else {
      segments.push(cur);
      cur = [id];
    }
  }
  segments.push(cur);

  const parentChange = new Map<string, string>();
  const expandIds = new Set<string>();

  for (const seg of segments) {
    const firstId = seg[0]!;
    const task = projectTasks.find((t) => t.id === firstId);
    if (!task) continue;
    const pKey = parentKey(task);
    const sibs = projectTasks.filter((t) => parentKey(t) === pKey);
    sibs.sort((a, b) => visIdx(a.id) - visIdx(b.id));
    const idx = sibs.findIndex((t) => t.id === firstId);
    if (idx <= 0) continue;
    const newParent = sibs[idx - 1]!;
    for (const sid of seg) {
      parentChange.set(sid, newParent.id);
    }
    expandIds.add(newParent.id);
  }

  if (parentChange.size === 0) return null;
  return { parentChange, expandIds };
}

/**
 * 레벨 변경 직전 표시 순서(stableVisibleIds)를 유지하도록 평탄 배열을 재배열한다.
 * 부모는 항상 자식보다 앞에 와야 하므로, 우선순위 안에서 위상적으로 가능한 순서로 채운다.
 */
export function reorderProjectTasksForStableVisibleOrder(projectTasks: Task[], stableVisibleIds: string[]): Task[] {
  if (stableVisibleIds.length === 0) return projectTasks;
  const byId = new Map(projectTasks.map((t) => [t.id, t] as const));
  const priority: string[] = [];
  const seen = new Set<string>();
  for (const id of stableVisibleIds) {
    if (byId.has(id) && !seen.has(id)) {
      priority.push(id);
      seen.add(id);
    }
  }
  for (const t of projectTasks) {
    if (!seen.has(t.id)) {
      priority.push(t.id);
      seen.add(t.id);
    }
  }

  const out: Task[] = [];
  const placed = new Set<string>();
  const canPlace = (t: Task) => {
    const p = normalizeParentIdForReorder(t.parentId);
    return p === null || placed.has(p);
  };

  while (out.length < projectTasks.length) {
    let nextId: string | null = null;
    for (const id of priority) {
      if (placed.has(id)) continue;
      const t = byId.get(id);
      if (!t || !canPlace(t)) continue;
      nextId = id;
      break;
    }
    if (nextId === null) {
      const rest = projectTasks.filter((t) => !placed.has(t.id));
      const t = rest.find(canPlace);
      if (!t) return projectTasks;
      out.push(t);
      placed.add(t.id);
    } else {
      out.push(byId.get(nextId)!);
      placed.add(nextId);
    }
  }
  return out;
}

/**
 * 내어쓰기(Shift+Tab) 변환 — 대상의 레벨(parentId→조부모)만 한 단계 내린다.
 *
 * 정책(사용자 요구): "선택한 항목만 변경, 나머지(형제)는 불변". 그래서 대상 "뒤"의 형제를
 * 흡수하지 않는다. 표시는 평탄 배열을 트리 순회(DFS, 형제는 배열 순서)한 결과라, 뒤에 형제가
 * 있던 경우 대상이 그 형제들 서브트리 "아래"로 내려가 보일 수 있다(위치는 사용자가 수동 조정).
 * 마지막 자식(뒤 형제 없음)을 내어쓰면 제자리에서 레벨만 내려간다. 자기 하위 트리는 함께 따라온다.
 *
 * 다중 선택 시: 각 대상은 조부모로 한 단계 올라간다(부모도 함께 선택된 경우 각자 한 단계씩).
 *
 * 순수 함수(단위 테스트 대상). recomputeProjectRollups·setAllTasks 등 부수효과는 호출부가 담당.
 * @param projectTasks 한 프로젝트의 작업들(다른 프로젝트는 제외하고 넘길 것)
 * @param ids 내어쓸 대상 id들
 * @returns changed=false면 내어쓸 대상이 없어 변화 없음
 */
export function outdentTasksLevelOnly(projectTasks: Task[], ids: string[]): { tasks: Task[]; changed: boolean } {
  const parentChange = new Map<string, string | null>();
  for (const taskId of ids) {
    const task = projectTasks.find((t) => t.id === taskId);
    if (!task || !task.parentId) continue; // 루트는 더 못 올림
    const parent = projectTasks.find((t) => t.id === task.parentId);
    if (!parent) continue;
    parentChange.set(taskId, parent.parentId ?? null);
  }
  if (parentChange.size === 0) return { tasks: projectTasks, changed: false };
  const tasks = projectTasks.map((t) => (parentChange.has(t.id) ? { ...t, parentId: parentChange.get(t.id)! } : t));
  return { tasks, changed: true };
}

export function useTaskMovement(deps: TaskMovementDeps) {
  const { saveHistory, setAllTasks, currentProjectIdRef, allTasksRef, projectsRef, setTreeExpandLevel, bumpDirty } = deps;

  const moveTask = useCallback(
    (id: string, direction: 'up' | 'down') => {
      saveHistory();
      const changedRef = { current: false };
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const swap = findSiblingSwapIndicesInFlatList(prev, cpi, id, direction, projectsRef.current);
        if (!swap) return prev;
        changedRef.current = true;
        return swapTasksAtIndices(prev, swap.iA, swap.iB);
      });
      if (changedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  const applySiblingMoveSteps = useCallback(
    (steps: ReadonlyArray<{ id: string; direction: 'up' | 'down' }>) => {
      if (steps.length === 0) return;
      saveHistory();
      const changedRef = { current: false };
      setAllTasks((prev) => {
        let work = prev;
        const cpi = currentProjectIdRef.current;
        for (const step of steps) {
          const swap = findSiblingSwapIndicesInFlatList(work, cpi, step.id, step.direction, projectsRef.current);
          if (!swap) continue;
          changedRef.current = true;
          work = swapTasksAtIndices(work, swap.iA, swap.iB);
        }
        return work;
      });
      if (changedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  const reorderTask = useCallback(
    (id: string, overId: string) => {
      saveHistory();
      const changedRef = { current: false };
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const oldIndex = projectTasks.findIndex((t) => t.id === id);
        const newIndex = projectTasks.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const arr = [...projectTasks];
        const [moved] = arr.splice(oldIndex, 1);
        arr.splice(newIndex, 0, moved);
        changedRef.current = true;
        return [...otherTasks, ...arr];
      });
      if (changedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  const indentTask = useCallback(
    (id: string) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const stableIds = stableVisibleIdsForMovement(projectTasks, projectsRef.current);
        primeWbsSiblingOrderTieBreak(stableIds);
        const visIdx = (tid: string) => {
          const i = stableIds.indexOf(tid);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const task = projectTasks.find((t) => t.id === id);
        if (!task) return prev;
        const siblings = projectTasks.filter((t) => t.parentId === task.parentId);
        siblings.sort((a, b) => visIdx(a.id) - visIdx(b.id));
        const idx = siblings.findIndex((t) => t.id === id);
        if (idx <= 0) return prev;
        const newParent = siblings[idx - 1];
        const updated = projectTasks.map((t) => {
          if (t.id === id) return { ...t, parentId: newParent.id };
          if (t.id === newParent.id) return { ...t, expanded: true };
          return t;
        });
        const reordered = reorderProjectTasksForStableVisibleOrder(updated, stableIds);
        changed = true;
        return recomputeProjectRollups([...otherTasks, ...reordered], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  // 내어쓰기: parentId만 조부모로 내린 뒤, 레벨 변경 직전과 동일한 표시 행 순서로 평탄 배열을 강제 정렬한다.
  const outdentTask = useCallback(
    (id: string) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const stableIds = stableVisibleIdsForMovement(projectTasks, projectsRef.current);
        primeWbsSiblingOrderTieBreak(stableIds);
        const res = outdentTasksLevelOnly(projectTasks, [id]);
        if (!res.changed) return prev;
        changed = true;
        const reordered = reorderProjectTasksForStableVisibleOrder(res.tasks, stableIds);
        return recomputeProjectRollups([...otherTasks, ...reordered], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  const indentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const stableIds = stableVisibleIdsForMovement(projectTasks, projectsRef.current);
        primeWbsSiblingOrderTieBreak(stableIds);
        const bulk = computeBulkIndentParentChanges(projectTasks, ids, stableIds);
        if (!bulk) return prev;
        const { parentChange, expandIds } = bulk;
        const updated = projectTasks.map((t) => {
          if (parentChange.has(t.id)) return { ...t, parentId: parentChange.get(t.id)! };
          if (expandIds.has(t.id)) return { ...t, expanded: true };
          return t;
        });
        changed = true;
        const reordered = reorderProjectTasksForStableVisibleOrder(updated, stableIds);
        return recomputeProjectRollups([...otherTasks, ...reordered], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  // 내어쓰기(다중): outdentTask와 동일.
  const outdentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const stableIds = stableVisibleIdsForMovement(projectTasks, projectsRef.current);
        primeWbsSiblingOrderTieBreak(stableIds);
        const res = outdentTasksLevelOnly(projectTasks, ids);
        if (!res.changed) return prev;
        changed = true;
        const reordered = reorderProjectTasksForStableVisibleOrder(res.tasks, stableIds);
        return recomputeProjectRollups([...otherTasks, ...reordered], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, projectsRef, bumpDirty],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      setAllTasks((prev) => prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t)));
    },
    [setAllTasks],
  );

  /** 선택된 작업들의 트리 루트만 `newParentId` 아래로 한 번에 이동(히스토리 1회). */
  const reparentTaskRootsUnder = useCallback(
    (newParentId: string, orderedRootIds: string[]) => {
      if (orderedRootIds.length === 0) return;
      saveHistory();
      const changedRef = { current: false };
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const byId = new Map(projectTasks.map((t) => [t.id, t] as const));
        const rootSet = new Set(orderedRootIds);
        if (rootSet.has(newParentId)) return prev;
        if (!byId.has(newParentId)) return prev;

        const collectSubtreeIds = (root: string): Set<string> => {
          const acc = new Set<string>([root]);
          const stack = [root];
          while (stack.length) {
            const id = stack.pop()!;
            for (const t of projectTasks) {
              if (t.parentId === id && !acc.has(t.id)) {
                acc.add(t.id);
                stack.push(t.id);
              }
            }
          }
          return acc;
        };
        for (const r of orderedRootIds) {
          if (!byId.has(r)) return prev;
          if (collectSubtreeIds(r).has(newParentId)) return prev;
        }

        const updated = projectTasks.map((t) => {
          if (rootSet.has(t.id)) return { ...t, parentId: newParentId };
          if (t.id === newParentId) return { ...t, expanded: true };
          return t;
        });
        changedRef.current = true;
        return recomputeProjectRollups([...otherTasks, ...updated], cpi, undefined, undefined, true);
      });
      if (changedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  /** 루트 작업들을 `overId`와 같은 부모 아래로 옮기고, 평탄 배열에서 before/after 순서로 끼워 넣는다. */
  const moveTaskRootsSibling = useCallback(
    (orderedRootIds: string[], overId: string, position: 'before' | 'after') => {
      if (orderedRootIds.length === 0) return;
      saveHistory();
      const changedRef = { current: false };
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const rootSet = new Set(orderedRootIds);
        if (rootSet.has(overId)) return prev;

        const overTask = projectTasks.find((t) => t.id === overId);
        if (!overTask) return prev;
        const targetParent = overTask.parentId ?? null;

        const collectSubtreeIds = (root: string): Set<string> => {
          const acc = new Set<string>([root]);
          const stack = [root];
          while (stack.length) {
            const id = stack.pop()!;
            for (const t of projectTasks) {
              if (t.parentId === id && !acc.has(t.id)) {
                acc.add(t.id);
                stack.push(t.id);
              }
            }
          }
          return acc;
        };
        for (const r of orderedRootIds) {
          if (collectSubtreeIds(r).has(overId)) return prev;
        }

        const mapped = projectTasks.map((t) => (rootSet.has(t.id) ? { ...t, parentId: targetParent } : t));
        const rootsOrdered = orderedRootIds.map((id) => mapped.find((t) => t.id === id)).filter((t): t is Task => Boolean(t));
        if (rootsOrdered.length !== orderedRootIds.length) return prev;

        const withoutRoots = mapped.filter((t) => !rootSet.has(t.id));
        let insertIdx = withoutRoots.findIndex((t) => t.id === overId);
        if (insertIdx < 0) return prev;
        if (position === 'after') insertIdx += 1;
        const merged = [...withoutRoots.slice(0, insertIdx), ...rootsOrdered, ...withoutRoots.slice(insertIdx)];
        changedRef.current = true;
        return recomputeProjectRollups([...otherTasks, ...merged], cpi, undefined, undefined, true);
      });
      if (changedRef.current) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  const expandToLevel = useCallback(
    (level: number) => {
      const targetLevel = Math.max(1, Math.floor(level || 1));
      setTreeExpandLevel(targetLevel);
      saveHistory();
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const relevant = cpi === 'all' ? prev : prev.filter((t) => t.projectId === cpi);
        const relevantIds = new Set(relevant.map((t) => t.id));
        const taskMap = new Map<string, Task>(relevant.map((t) => [t.id, t] as const));
        const depthMemo = new Map<string, number>();
        const getDepth = (taskId: string): number => {
          const cached = depthMemo.get(taskId);
          if (cached !== undefined) return cached;
          const t = taskMap.get(taskId);
          if (!t || !t.parentId || !taskMap.has(t.parentId)) {
            depthMemo.set(taskId, 0);
            return 0;
          }
          const d = getDepth(t.parentId) + 1;
          depthMemo.set(taskId, d);
          return d;
        };
        const hasChildren = new Set<string>();
        for (const t of relevant) {
          if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId);
        }
        const result = prev.map((t) => {
          if (!relevantIds.has(t.id) || !hasChildren.has(t.id)) return t;
          const shouldExpand = getDepth(t.id) + 1 < targetLevel;
          if (!!t.expanded === shouldExpand) return t;
          return { ...t, expanded: shouldExpand };
        });
        return result;
      });
      bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, setTreeExpandLevel, bumpDirty],
  );

  return useMemo(
    () => ({
      moveTask,
      applySiblingMoveSteps,
      reorderTask,
      indentTask,
      outdentTask,
      indentTasks,
      outdentTasks,
      reparentTaskRootsUnder,
      moveTaskRootsSibling,
      toggleExpand,
      expandToLevel,
    }),
    [
      moveTask,
      applySiblingMoveSteps,
      reorderTask,
      indentTask,
      outdentTask,
      indentTasks,
      outdentTasks,
      reparentTaskRootsUnder,
      moveTaskRootsSibling,
      toggleExpand,
      expandToLevel,
    ],
  );
}
