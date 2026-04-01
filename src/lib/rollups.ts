import { Task } from '../types';
import { round2 } from './utils';

/**
 * 부모 작업의 시작일/종료일/진척률을 자식 기준으로 롤업.
 * @param forceProgress true: 자식 변경 전파 시 progressLocked 무시하고 항상 롤업
 *                      false(기본): DB 싱크/전체 재계산 시 progressLocked 존중
 */
export function syncParentRollups(
  allTasks: Task[],
  parentId: string | null,
  doneStatusIds?: Set<string>,
  forceProgress = false
): Task[] {
  if (!parentId) return allTasks;
  const children = allTasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  let minStart = children[0].startDate;
  let maxEnd = children[0].endDate;
  let totalWeight = 0;
  let weightedProgressSum = 0;
  let simpleProgressSum = 0;

  for (const child of children) {
    if (child.startDate && child.startDate < minStart) minStart = child.startDate;
    if (child.endDate && child.endDate > maxEnd) maxEnd = child.endDate;
    // 공수(workEffort)는 부모에서 사용자가 직접 입력한 값을 유지하므로 롤업하지 않는다.
    // 대신 진행률 가중 평균 계산에 필요한 weight fallback으로만 effort를 사용한다.
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    const weight =
      typeof child.weight === 'number' && Number.isFinite(child.weight)
        ? child.weight
        : effort;
    totalWeight += weight;
    const progress = typeof child.progress === 'number' && Number.isFinite(child.progress) ? child.progress : 0;
    weightedProgressSum += progress * weight;
    simpleProgressSum += progress;
  }

  const parent = allTasks.find(t => t.id === parentId);
  if (!parent) return allTasks;

  let parentProgress: number | undefined;
  // 완료 상태인 경우 자식 롤업으로 덮어쓰지 않고 100% 유지
  if (doneStatusIds && parent.status && doneStatusIds.has(parent.status)) {
    parentProgress = 100;
  } else if (totalWeight > 0) {
    parentProgress = Math.round(weightedProgressSum / totalWeight);
  } else if (children.length > 0) {
    parentProgress = Math.round(simpleProgressSum / children.length);
  }

  const lockedFields = new Set(parent.userLockedFields ?? []);
  const startDateLocked = lockedFields.has('startDate');
  const endDateLocked = lockedFields.has('endDate');
  // forceProgress=true(자식 변경 전파): 잠금 무시하고 항상 롤업
  // forceProgress=false(DB싱크/전체 재계산): progressLocked 존중하여 수동 편집값 유지
  const progressLocked = !forceProgress && lockedFields.has('progress');
  const shouldUpdate =
    (!startDateLocked && parent.startDate !== minStart) ||
    (!endDateLocked && parent.endDate !== maxEnd) ||
    (!progressLocked && parentProgress !== undefined && parent.progress !== parentProgress);

  const updatedTasks = shouldUpdate
    ? allTasks.map(t =>
      t.id === parentId
        ? {
          ...t,
          ...(!startDateLocked ? { startDate: minStart } : {}),
          ...(!endDateLocked ? { endDate: maxEnd } : {}),
          ...(!progressLocked && parentProgress !== undefined ? { progress: parentProgress } : {}),
        }
        : t
    )
    : allTasks;

  return syncParentRollups(updatedTasks, parent.parentId, doneStatusIds, forceProgress);
}

/**
 * 상위 작업 진척률을 수동 변경 시, 모든 하위 레벨을 비율 유지하여 재귀적으로 배분.
 * - 현재 자식들의 가중평균이 targetProgress가 되도록 각 자식 진척률을 비례 조정.
 * - 현재 평균이 0이면 모든 자식을 targetProgress로 설정.
 * - 각 자식의 하위에도 같은 방식으로 재귀 적용.
 */
export function distributeProgressDown(allTasks: Task[], parentId: string, targetProgress: number): Task[] {
  const children = allTasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  let totalWeight = 0;
  let weightedSum = 0;
  for (const child of children) {
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    const weight = typeof child.weight === 'number' && Number.isFinite(child.weight) ? child.weight : effort;
    totalWeight += weight;
    const progress = typeof child.progress === 'number' && Number.isFinite(child.progress) ? child.progress : 0;
    weightedSum += progress * weight;
  }

  const currentAvg = totalWeight > 0
    ? weightedSum / totalWeight
    : children.reduce((s, c) => s + (typeof c.progress === 'number' ? c.progress : 0), 0) / children.length;

  let result = allTasks;
  for (const child of children) {
    let newChildProgress: number;
    if (currentAvg <= 0) {
      newChildProgress = targetProgress;
    } else {
      const childProgress = typeof child.progress === 'number' ? child.progress : 0;
      newChildProgress = Math.min(100, Math.max(0, Math.round(childProgress * targetProgress / currentAvg)));
    }
    result = result.map(t => t.id === child.id ? { ...t, progress: newChildProgress } : t);
    result = distributeProgressDown(result, child.id, newChildProgress);
  }

  return result;
}

/**
 * 상위 작업 가중치 변경 시, 해당 노드의 모든 하위 레벨을 비율 유지하여 재귀적으로 재분배.
 */
export function redistributeWeightsDown(tasks: Task[], parentId: string, parentWeight: number): Task[] {
  const children = tasks.filter(t => t.parentId === parentId);
  if (children.length === 0) return tasks;

  const raw = (c: Task) =>
    typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : (typeof c.workEffort === 'number' && Number.isFinite(c.workEffort) ? c.workEffort : 0);
  const rawSum = children.reduce((s, c) => s + raw(c), 0);

  const orderIdx = new Map(children.map((c, i) => [c.id, i]));
  const sortedChildren = [...children].sort((a, b) => (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0));
  let assigned = 0;
  const newWeights: Record<string, number> = {};

  for (let i = 0; i < sortedChildren.length; i++) {
    const c = sortedChildren[i]!;
    const r = raw(c);
    let w: number;
    if (rawSum > 0) {
      w = i < sortedChildren.length - 1 ? round2((r / rawSum) * parentWeight) : round2(parentWeight - assigned);
      assigned += i < sortedChildren.length - 1 ? w : 0;
    } else {
      w = i < sortedChildren.length - 1 ? round2(parentWeight / children.length) : round2(parentWeight - assigned);
      assigned += i < sortedChildren.length - 1 ? w : 0;
    }
    newWeights[c.id] = w;
  }

  let nextTasks = tasks.map(t => {
    const nw = newWeights[t.id];
    return nw !== undefined ? { ...t, weight: nw } : t;
  });

  for (const c of sortedChildren) {
    const hasGrandchildren = nextTasks.some(t => t.parentId === c.id);
    if (hasGrandchildren) nextTasks = redistributeWeightsDown(nextTasks, c.id, newWeights[c.id] ?? 0);
  }

  return nextTasks;
}

/** 특정 프로젝트의 모든 부모 작업을 자식 기준으로 롤업 재계산 */
export function recomputeProjectRollups(allTasks: Task[], projectId: string, doneStatusIds?: Set<string>): Task[] {
  if (!projectId || projectId === 'all') return allTasks;
  const projectTasks = allTasks.filter(t => t.projectId === projectId);
  if (projectTasks.length === 0) return allTasks;

  const taskMap = new Map(projectTasks.map(t => [t.id, t] as const));
  const hasChildren = new Set<string>();
  for (const t of projectTasks) {
    if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId);
  }
  if (hasChildren.size === 0) return allTasks;

  const depthMemo = new Map<string, number>();
  const getDepth = (id: string): number => {
    const cached = depthMemo.get(id);
    if (cached !== undefined) return cached;
    const t = taskMap.get(id);
    if (!t || !t.parentId || !taskMap.has(t.parentId)) { depthMemo.set(id, 0); return 0; }
    const d = getDepth(t.parentId) + 1;
    depthMemo.set(id, d);
    return d;
  };

  const parentIds = Array.from(hasChildren).sort((a, b) => getDepth(b) - getDepth(a));
  let next = allTasks;
  for (const pid of parentIds) {
    next = syncParentRollups(next, pid, doneStatusIds);
  }
  return next;
}

/** 모든 프로젝트에 대해 상위 작업의 시작일/종료일/진척률을 하위 작업 기준으로 롤업 */
export function applyRollupsToTasks(tasks: Task[], statusConfigs?: Array<{ id: string; progress?: number }>): Task[] {
  const doneStatusIds = statusConfigs
    ? new Set(statusConfigs.filter(c => c.progress === 100).map(c => c.id))
    : undefined;
  const projectIds = Array.from(new Set(tasks.map(t => t.projectId))).filter(
    (id): id is string => Boolean(id) && id !== 'all'
  );
  let result = tasks;
  for (const pid of projectIds) result = recomputeProjectRollups(result, pid, doneStatusIds);
  return result;
}
