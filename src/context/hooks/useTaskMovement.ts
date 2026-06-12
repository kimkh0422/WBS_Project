import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task } from '../../types';
import { recomputeProjectRollups } from '../../lib/rollups';

// 들여쓰기/내어쓰기/재배치 후 롤업은 진척·공수만 수행한다(skipScheduleRollup=true).
// 부모 시작일·종료일은 자동 변경하지 않음 — 표의 '일정 자동 맞춤' 메뉴로만 정렬.

export interface TaskMovementDeps {
  saveHistory: () => void;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  currentProjectIdRef: MutableRefObject<string>;
  allTasksRef: MutableRefObject<Task[]>;
  setTreeExpandLevel: (level: number) => void;
  /** 레벨 변경(들여쓰기/내어쓰기)도 로컬 변경으로 표시 — 저장 버튼 활성·백그라운드 풀의 덮어쓰기 방지 */
  bumpDirty: () => void;
}

/**
 * 들여쓰기/내어쓰기 후 평탄 배열에서의 재배치.
 * 형제 표시 순서는 (선행작업이 없으면) 배열 순서를 따르는데, 하위 작업은 생성 시 배열 끝에
 * 추가된 경우가 많아 parentId만 바꾸면 레벨 변경된 작업이 새 형제들 맨 아래로 표시된다.
 * → 들여쓰기: 새 부모의 "마지막 자식"이 되도록 부모·기존 직계 자식들 뒤로 이동 (제자리 유지).
 *
 * ※ 내어쓰기는 재배치하지 않는다(outdentTask/outdentTasks 참고). 대상 "뒤"의 형제들을
 *    대상의 자식으로 흡수하면 배열 순서가 그대로라 트리 순회에서 모든 행이 제자리에 남고
 *    대상의 레벨만 한 단계 내려간다(MS Project식 Shift+Tab).
 */
function repositionAfter(tasks: Task[], taskId: string, afterIndexOf: (arr: Task[]) => number): Task[] {
  const moved = tasks.find((t) => t.id === taskId);
  if (!moved) return tasks;
  const without = tasks.filter((t) => t.id !== taskId);
  const anchorIdx = afterIndexOf(without);
  if (anchorIdx < 0) return tasks;
  return [...without.slice(0, anchorIdx + 1), moved, ...without.slice(anchorIdx + 1)];
}

/** 들여쓰기: 작업을 새 부모와 그 직계 자식들 중 가장 뒤 위치로 (= 마지막 자식) */
function repositionAsLastChild(tasks: Task[], taskId: string, newParentId: string): Task[] {
  return repositionAfter(tasks, taskId, (arr) => {
    let last = -1;
    arr.forEach((t, i) => {
      if (t.id === newParentId || t.parentId === newParentId) last = i;
    });
    return last;
  });
}

/**
 * 내어쓰기(Shift+Tab) 변환 — 대상의 레벨만 한 단계 내리고 표(트리)에서의 '행 위치'는 그대로 둔다.
 *
 * 표시는 평탄 배열을 트리 순회(DFS, 형제는 배열 순서)한 결과라, parentId만 조부모로 바꾸고
 * 재배치하면 대상이 옛 형제들의 서브트리 "아래"로 밀려난다(= 위치 변경 버그).
 * 이를 막기 위해 대상 "뒤"의 형제들을 대상의 자식으로 흡수한다: 배열 순서를 건드리지 않으므로
 * 트리 순회에서 대상과 흡수된 형제 모두 제자리에 남고, 대상의 레벨만 내려간다(MS Project식).
 *
 * 다중 선택 시: 각 대상은 조부모로 올라가고, 대상 "뒤"의 비선택 형제는 (다음 선택 형제 전까지)
 * 그 대상이 흡수한다. 부모도 함께 선택된 작업은 부모를 따라 내려가므로 건너뛴다(이중 적용 방지).
 *
 * 순수 함수(단위 테스트 대상). recomputeProjectRollups·setAllTasks 등 부수효과는 호출부가 담당.
 * @param projectTasks 한 프로젝트의 작업들(다른 프로젝트는 제외하고 넘길 것)
 * @param ids 내어쓸 대상 id들(표시 순서 권장)
 * @returns changed=false면 내어쓸 대상이 없어 변화 없음
 */
export function outdentTasksKeepingPosition(projectTasks: Task[], ids: string[]): { tasks: Task[]; changed: boolean } {
  const selectedIds = new Set(ids);
  const parentChange = new Map<string, string | null>();
  const capturedParents = new Set<string>(); // 형제를 새로 흡수한 대상 → 펼침
  for (const taskId of ids) {
    const task = projectTasks.find((t) => t.id === taskId);
    if (!task || !task.parentId) continue; // 루트는 더 못 올림
    if (selectedIds.has(task.parentId)) continue; // 부모도 함께 선택됨 → 부모 따라 내려감
    const parent = projectTasks.find((t) => t.id === task.parentId);
    if (!parent) continue;
    parentChange.set(taskId, parent.parentId ?? null);
    const siblings = projectTasks.filter((t) => t.parentId === task.parentId);
    const idx = siblings.findIndex((t) => t.id === taskId);
    for (let i = idx + 1; i < siblings.length; i += 1) {
      const sib = siblings[i];
      if (selectedIds.has(sib.id)) break; // 다음 선택 형제부터는 그쪽이 흡수
      parentChange.set(sib.id, taskId);
      capturedParents.add(taskId);
    }
  }
  if (parentChange.size === 0) return { tasks: projectTasks, changed: false };
  const tasks = projectTasks.map((t) => {
    const hasNewParent = parentChange.has(t.id);
    const gainsChildren = capturedParents.has(t.id);
    if (!hasNewParent && !gainsChildren) return t;
    return {
      ...t,
      ...(hasNewParent ? { parentId: parentChange.get(t.id)! } : null),
      ...(gainsChildren ? { expanded: true } : null),
    };
  });
  return { tasks, changed: true };
}

export function useTaskMovement(deps: TaskMovementDeps) {
  const { saveHistory, setAllTasks, currentProjectIdRef, allTasksRef, setTreeExpandLevel, bumpDirty } = deps;

  const moveTask = useCallback(
    (id: string, direction: 'up' | 'down') => {
      saveHistory();
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const task = projectTasks.find((t) => t.id === id);
        if (!task) return prev;
        const siblings = projectTasks.filter((t) => t.parentId === task.parentId);
        const idx = siblings.findIndex((t) => t.id === id);
        const newProjectTasks = [...projectTasks];
        if (direction === 'up' && idx > 0) {
          const iA = projectTasks.findIndex((t) => t.id === task.id);
          const iB = projectTasks.findIndex((t) => t.id === siblings[idx - 1].id);
          [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
        } else if (direction === 'down' && idx < siblings.length - 1) {
          const iA = projectTasks.findIndex((t) => t.id === task.id);
          const iB = projectTasks.findIndex((t) => t.id === siblings[idx + 1].id);
          [newProjectTasks[iA], newProjectTasks[iB]] = [newProjectTasks[iB], newProjectTasks[iA]];
        } else return prev;
        return [...otherTasks, ...newProjectTasks];
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  const reorderTask = useCallback(
    (id: string, overId: string) => {
      saveHistory();
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
        return [...otherTasks, ...arr];
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  const indentTask = useCallback(
    (id: string) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const task = projectTasks.find((t) => t.id === id);
        if (!task) return prev;
        const siblings = projectTasks.filter((t) => t.parentId === task.parentId);
        const idx = siblings.findIndex((t) => t.id === id);
        if (idx <= 0) return prev;
        const newParent = siblings[idx - 1];
        let updated = projectTasks.map((t) => {
          if (t.id === id) return { ...t, parentId: newParent.id };
          if (t.id === newParent.id) return { ...t, expanded: true };
          return t;
        });
        updated = repositionAsLastChild(updated, id, newParent.id);
        changed = true;
        return recomputeProjectRollups([...otherTasks, ...updated], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  // 내어쓰기: 대상의 레벨만 한 단계 내리고 표에서의 '행 위치'는 그대로 둔다.
  // (핵심 로직은 outdentTasksKeepingPosition 참고 — 대상 "뒤"의 형제를 자식으로 흡수해 제자리 유지)
  const outdentTask = useCallback(
    (id: string) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const res = outdentTasksKeepingPosition(projectTasks, [id]);
        if (!res.changed) return prev;
        changed = true;
        return recomputeProjectRollups([...otherTasks, ...res.tasks], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  const indentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        let projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const selectedIds = new Set(ids);
        for (const taskId of ids) {
          const task = projectTasks.find((t) => t.id === taskId);
          if (!task || (task.parentId && selectedIds.has(task.parentId))) continue;
          const siblings = projectTasks.filter((t) => t.parentId === task.parentId);
          const idx = siblings.findIndex((t) => t.id === taskId);
          if (idx > 0) {
            const newParent = siblings[idx - 1];
            projectTasks = projectTasks.map((t) => {
              if (t.id === taskId) return { ...t, parentId: newParent.id };
              if (t.id === newParent.id) return { ...t, expanded: true };
              return t;
            });
            projectTasks = repositionAsLastChild(projectTasks, taskId, newParent.id);
            changed = true;
          }
        }
        if (!changed) return prev;
        return recomputeProjectRollups([...otherTasks, ...projectTasks], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
  );

  // 내어쓰기(다중): outdentTask와 같은 '흡수' 방식 — 행 위치는 그대로, 레벨만 한 단계 내림.
  const outdentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
      let changed = false;
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const res = outdentTasksKeepingPosition(projectTasks, ids);
        if (!res.changed) return prev;
        changed = true;
        return recomputeProjectRollups([...otherTasks, ...res.tasks], cpi, undefined, undefined, true);
      });
      if (changed) bumpDirty();
    },
    [saveHistory, setAllTasks, currentProjectIdRef, bumpDirty],
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
        return recomputeProjectRollups([...otherTasks, ...updated], cpi, undefined, undefined, true);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  /** 루트 작업들을 `overId`와 같은 부모 아래로 옮기고, 평탄 배열에서 before/after 순서로 끼워 넣는다. */
  const moveTaskRootsSibling = useCallback(
    (orderedRootIds: string[], overId: string, position: 'before' | 'after') => {
      if (orderedRootIds.length === 0) return;
      saveHistory();
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
        return recomputeProjectRollups([...otherTasks, ...merged], cpi, undefined, undefined, true);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
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
    },
    [saveHistory, setAllTasks, currentProjectIdRef, setTreeExpandLevel],
  );

  return {
    moveTask,
    reorderTask,
    indentTask,
    outdentTask,
    indentTasks,
    outdentTasks,
    reparentTaskRootsUnder,
    moveTaskRootsSibling,
    toggleExpand,
    expandToLevel,
  };
}
