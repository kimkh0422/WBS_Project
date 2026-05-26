import { useCallback, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Task } from '../../types';
import { recomputeProjectRollups } from '../../lib/rollups';

export interface TaskMovementDeps {
  saveHistory: () => void;
  setAllTasks: Dispatch<SetStateAction<Task[]>>;
  currentProjectIdRef: MutableRefObject<string>;
  allTasksRef: MutableRefObject<Task[]>;
  setTreeExpandLevel: (level: number) => void;
}

export function useTaskMovement(deps: TaskMovementDeps) {
  const { saveHistory, setAllTasks, currentProjectIdRef, allTasksRef, setTreeExpandLevel } = deps;

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
        const updated = projectTasks.map((t) => {
          if (t.id === id) return { ...t, parentId: newParent.id };
          if (t.id === newParent.id) return { ...t, expanded: true };
          return t;
        });
        return recomputeProjectRollups([...otherTasks, ...updated], cpi);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  const outdentTask = useCallback(
    (id: string) => {
      saveHistory();
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        const projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const task = projectTasks.find((t) => t.id === id);
        if (!task || !task.parentId) return prev;
        const parent = projectTasks.find((t) => t.id === task.parentId);
        if (!parent) return prev;
        const updated = projectTasks.map((t) => (t.id === id ? { ...t, parentId: parent.parentId } : t));
        return recomputeProjectRollups([...otherTasks, ...updated], cpi);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  const indentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
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
          }
        }
        return recomputeProjectRollups([...otherTasks, ...projectTasks], cpi);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
  );

  const outdentTasks = useCallback(
    (ids: string[]) => {
      saveHistory();
      setAllTasks((prev) => {
        const cpi = currentProjectIdRef.current;
        let projectTasks = prev.filter((t) => t.projectId === cpi);
        const otherTasks = prev.filter((t) => t.projectId !== cpi);
        const selectedIds = new Set(ids);
        for (const taskId of ids) {
          const task = projectTasks.find((t) => t.id === taskId);
          if (!task || !task.parentId || selectedIds.has(task.parentId)) continue;
          const parent = projectTasks.find((t) => t.id === task.parentId);
          if (!parent) continue;
          projectTasks = projectTasks.map((t) => (t.id === taskId ? { ...t, parentId: parent.parentId } : t));
        }
        return recomputeProjectRollups([...otherTasks, ...projectTasks], cpi);
      });
    },
    [saveHistory, setAllTasks, currentProjectIdRef],
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
        return recomputeProjectRollups([...otherTasks, ...updated], cpi);
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
        return recomputeProjectRollups([...otherTasks, ...merged], cpi);
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
