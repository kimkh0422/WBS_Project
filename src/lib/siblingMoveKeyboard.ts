import type { Task } from '../types';

export type SiblingMoveStep = { id: string; direction: 'up' | 'down' };

/**
 * 다중 선택 Alt+↑↓용: 동일 부모 형제 목록에서 선택 인덱스를 연속 구간으로 나눈 뒤,
 * 구간마다 위로는 첫 행·아래로는 마지막 행에 대해 한 번씩 스왑(moveTask와 동일 규칙).
 * 여러 구간은 `direction`에 맞는 순서로 나열된다(한 번의 배치 적용에 그대로 쓰면 됨).
 */
export function buildSiblingMoveStepsFromSelection(
  projectTasks: Task[],
  selectedIds: ReadonlySet<string>,
  direction: 'up' | 'down',
): SiblingMoveStep[] {
  const steps: SiblingMoveStep[] = [];
  if (selectedIds.size === 0) return steps;

  const parentVals = new Set<Task['parentId']>();
  for (const id of selectedIds) {
    const t = projectTasks.find((x) => x.id === id);
    if (t) parentVals.add(t.parentId);
  }

  for (const parentVal of parentVals) {
    const siblings = projectTasks.filter((t) => t.parentId === parentVal);
    const selectedIndices: number[] = [];
    for (let i = 0; i < siblings.length; i++) {
      if (selectedIds.has(siblings[i]!.id)) selectedIndices.push(i);
    }
    if (selectedIndices.length === 0) continue;
    selectedIndices.sort((a, b) => a - b);

    const runs: { start: number; end: number }[] = [];
    let rs = selectedIndices[0]!;
    let re = rs;
    for (let k = 1; k < selectedIndices.length; k++) {
      const cur = selectedIndices[k]!;
      if (cur === re + 1) {
        re = cur;
      } else {
        runs.push({ start: rs, end: re });
        rs = cur;
        re = cur;
      }
    }
    runs.push({ start: rs, end: re });

    const orderedRuns = direction === 'up' ? runs : [...runs].reverse();

    for (const run of orderedRuns) {
      if (direction === 'up') {
        if (run.start > 0) {
          steps.push({ id: siblings[run.start]!.id, direction: 'up' });
        }
      } else {
        if (run.end < siblings.length - 1) {
          steps.push({ id: siblings[run.end]!.id, direction: 'down' });
        }
      }
    }
  }

  return steps;
}

/**
 * `moveTask`와 동일한 프로젝트 스코프의 평탄 배열을 쓴다.
 * `currentProjectId === 'all'`일 때 선택이 한 프로젝트에만 속하지 않으면 null.
 */
export function resolveProjectTasksForSiblingMove(
  tasks: Task[],
  currentProjectId: string,
  selectedIds: ReadonlySet<string>,
): Task[] | null {
  if (currentProjectId !== 'all') {
    return tasks.filter((t) => t.projectId === currentProjectId);
  }
  const pids = new Set<string>();
  for (const id of selectedIds) {
    const t = tasks.find((x) => x.id === id);
    if (t) pids.add(t.projectId);
  }
  if (pids.size !== 1) return null;
  const onlyPid = pids.values().next().value as string;
  return tasks.filter((t) => t.projectId === onlyPid);
}
