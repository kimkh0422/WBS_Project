import { Task } from '../types';
import { round2 } from './utils';
import type { StatusConfig } from './wbsSettings';

function minIsoDate(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxIsoDate(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * 부모 작업의 시작일/종료일/진척률을 자식 기준으로 롤업.
 * @param forceProgress true: 자식 변경 전파 시 progressLocked 무시하고 항상 롤업
 *                      false(기본): DB 싱크/전체 재계산 시 progressLocked 존중
 * @param excludeParentIds 사용자가 직접 편집한 부모 작업 ID. 본인이면 갱신을 건너뛰되,
 *                        조상 롤업 재귀는 계속 진행한다(상위 영향은 따로 반영).
 */
export function syncParentRollups(
  allTasks: Task[],
  parentId: string | null,
  doneStatusIds?: Set<string>,
  forceProgress = false,
  excludeParentIds?: Set<string>,
): Task[] {
  if (!parentId) return allTasks;
  // 사용자가 막 편집한 부모는 자식 min/max로 덮어쓰지 않는다. 조상은 계속 롤업.
  if (excludeParentIds?.has(parentId)) {
    const parent = allTasks.find((t) => t.id === parentId);
    if (!parent) return allTasks;
    return syncParentRollups(allTasks, parent.parentId, doneStatusIds, forceProgress, excludeParentIds);
  }
  const children = allTasks.filter((t) => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  const starts = children.map((c) => c.startDate).filter(Boolean) as string[];
  const ends = children.map((c) => c.endDate).filter(Boolean) as string[];
  const minStart = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : undefined;
  const maxEnd = ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : undefined;

  let totalWeight = 0;
  let weightedProgressSum = 0;
  let simpleProgressSum = 0;

  for (const child of children) {
    // 공수(workEffort)는 부모에서 사용자가 직접 입력한 값을 유지하므로 롤업하지 않는다.
    // 대신 진행률 가중 평균 계산에 필요한 weight fallback으로만 effort를 사용한다.
    const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
    const weight = typeof child.weight === 'number' && Number.isFinite(child.weight) ? child.weight : effort;
    totalWeight += weight;
    const progress = typeof child.progress === 'number' && Number.isFinite(child.progress) ? child.progress : 0;
    weightedProgressSum += progress * weight;
    simpleProgressSum += progress;
  }

  const parent = allTasks.find((t) => t.id === parentId);
  if (!parent) return allTasks;

  let parentProgress: number | undefined;
  // 완료 상태인 경우 자식 롤업으로 덮어쓰지 않고 100% 유지
  if (doneStatusIds && parent.status && doneStatusIds.has(parent.status)) {
    parentProgress = 100;
  } else if (totalWeight > 0) {
    // 가중치 합이 100이 아니어도 Σ(p·w)/Σw 로 0~100% 범위의 가중평균
    parentProgress = Math.min(100, Math.max(0, Math.round(weightedProgressSum / totalWeight)));
  } else if (children.length > 0) {
    parentProgress = Math.min(100, Math.max(0, Math.round(simpleProgressSum / children.length)));
  }

  const lockedFields = new Set(parent.userLockedFields ?? []);
  // 부모 일정: 하위가 길어지면 상위 시작/종료도 함께 늘어남(바깥으로만 확장). 하위가 짧아져도 상위는 자동으로 줄이지 않음.
  let alignedStart = parent.startDate;
  let alignedEnd = parent.endDate;
  if (minStart !== undefined) {
    alignedStart = minIsoDate(parent.startDate, minStart) ?? minStart;
  }
  if (maxEnd !== undefined) {
    alignedEnd = maxIsoDate(parent.endDate, maxEnd) ?? maxEnd;
  }
  if (alignedStart && alignedEnd && alignedStart > alignedEnd) {
    alignedEnd = alignedStart;
  }
  const progressLocked = !forceProgress && lockedFields.has('progress');
  const shouldUpdate =
    parent.startDate !== alignedStart ||
    parent.endDate !== alignedEnd ||
    (!progressLocked && parentProgress !== undefined && parent.progress !== parentProgress);

  const updatedTasks = shouldUpdate
    ? allTasks.map((t) =>
        t.id === parentId
          ? {
              ...t,
              startDate: alignedStart,
              endDate: alignedEnd,
              ...(!progressLocked && parentProgress !== undefined ? { progress: parentProgress } : {}),
            }
          : t,
      )
    : allTasks;

  return syncParentRollups(updatedTasks, parent.parentId, doneStatusIds, forceProgress, excludeParentIds);
}

/**
 * 자식들의 상태(단계)를 기반으로 부모의 상태를 도출.
 * 규칙(우선순위):
 *  1) 자식이 모두 완료(progress=100) → 완료 상태
 *  2) 자식 중 진행 중(0<progress<100) 또는 일부만 완료 → 진행 중(중간) 상태
 *  3) 자식이 모두 시작 전(progress=0) → 시작 전 상태
 * 반환값: 부모로 설정할 status id, 결정 불가 시 null.
 */
export function deriveParentStatusFromChildren(childStatuses: string[], statusConfigs: StatusConfig[]): string | null {
  if (!Array.isArray(childStatuses) || childStatuses.length === 0) return null;
  if (!Array.isArray(statusConfigs) || statusConfigs.length === 0) return null;

  const configById = new Map<string, StatusConfig>(statusConfigs.map((c) => [c.id, c]));
  // 자식이 모두 같은 단계면 부모도 그 단계로 맞춘다.
  // (예: '검토자 완료'만 있는데 progress preset이 100이 아니거나, 완료형 상태가 여러 개일 때
  //  첫 번째 progress=100 상태로 잘못 붙거나 in-progress로 떨어지는 문제 방지)
  const uniqueChild = new Set(childStatuses);
  if (uniqueChild.size === 1) {
    const onlyId = [...uniqueChild][0]!;
    if (onlyId && configById.has(onlyId)) return onlyId;
  }

  const doneStatus = statusConfigs.find((c) => c.progress === 100);
  const todoStatus = statusConfigs.find((c) => c.progress === 0);
  // 중간 상태: 0 < progress < 100 중 가장 작은 progress 우선
  const inProgressStatus = [...statusConfigs]
    .filter((c) => typeof c.progress === 'number' && c.progress > 0 && c.progress < 100)
    .sort((a, b) => a.progress - b.progress)[0];

  let allDone = true;
  let allTodo = true;
  for (const sid of childStatuses) {
    const cfg = configById.get(sid);
    const p = typeof cfg?.progress === 'number' ? cfg.progress : 0;
    if (p !== 100) allDone = false;
    if (p !== 0) allTodo = false;
  }

  if (allDone && doneStatus) return doneStatus.id;
  if (allTodo && todoStatus) return todoStatus.id;
  if (inProgressStatus) return inProgressStatus.id;
  // 폴백: 다른 상태가 있으면 첫 번째 상태
  return statusConfigs[0]?.id ?? null;
}

/**
 * 자식의 단계(status) 변경을 부모(및 조상)로 롤업.
 * - 부모의 status를 자식들의 status를 기준으로 재계산하여 갱신
 * - 부모에 자식이 하나도 없으면 변경 없이 다음 조상으로 전파하지 않음
 * - syncProgress=true(기본): status 변경에 따라 status별 preset progress도 함께 적용 (linkStatusAndProgress 모드)
 * - syncProgress=false: status만 동기화하고 progress는 자식 가중평균 등 외부 롤업에 맡김 (단계만 표시 모드)
 */
export function syncParentStatus(allTasks: Task[], parentId: string | null, statusConfigs: StatusConfig[], syncProgress = true): Task[] {
  if (!parentId) return allTasks;
  if (!Array.isArray(statusConfigs) || statusConfigs.length === 0) return allTasks;

  const parent = allTasks.find((t) => t.id === parentId);
  if (!parent) return allTasks;
  const children = allTasks.filter((t) => t.parentId === parentId);
  if (children.length === 0) return allTasks;

  const derivedStatusId = deriveParentStatusFromChildren(
    children.map((c) => c.status),
    statusConfigs,
  );
  if (!derivedStatusId || derivedStatusId === parent.status) {
    // 부모 status 변경은 없지만, 상위 조상에 대해서도 동일하게 검사 전파
    return syncParentStatus(allTasks, parent.parentId, statusConfigs, syncProgress);
  }

  const newCfg = statusConfigs.find((c) => c.id === derivedStatusId);
  const lockedFields = new Set(parent.userLockedFields ?? []);
  const progressLocked = lockedFields.has('progress');
  const newProgress = syncProgress && !progressLocked && newCfg && typeof newCfg.progress === 'number' ? newCfg.progress : undefined;

  const nextTasks = allTasks.map((t) =>
    t.id === parentId
      ? {
          ...t,
          status: derivedStatusId,
          ...(newProgress !== undefined ? { progress: newProgress } : {}),
        }
      : t,
  );

  return syncParentStatus(nextTasks, parent.parentId, statusConfigs, syncProgress);
}

/**
 * 상위 작업 진척률을 수동 변경 시, 모든 하위 레벨을 비율 유지하여 재귀적으로 배분.
 * - 현재 자식들의 가중평균이 targetProgress가 되도록 각 자식 진척률을 비례 조정.
 * - 현재 평균이 0이면 모든 자식을 targetProgress로 설정.
 * - 각 자식의 하위에도 같은 방식으로 재귀 적용.
 */
export function distributeProgressDown(allTasks: Task[], parentId: string, targetProgress: number): Task[] {
  const children = allTasks.filter((t) => t.parentId === parentId);
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

  const currentAvg =
    totalWeight > 0
      ? weightedSum / totalWeight
      : children.reduce((s, c) => s + (typeof c.progress === 'number' ? c.progress : 0), 0) / children.length;

  let result = allTasks;
  for (const child of children) {
    let newChildProgress: number;
    if (currentAvg <= 0) {
      newChildProgress = targetProgress;
    } else {
      const childProgress = typeof child.progress === 'number' ? child.progress : 0;
      newChildProgress = Math.min(100, Math.max(0, Math.round((childProgress * targetProgress) / currentAvg)));
    }
    result = result.map((t) => (t.id === child.id ? { ...t, progress: newChildProgress } : t));
    result = distributeProgressDown(result, child.id, newChildProgress);
  }

  return result;
}

/**
 * (레거시) 같은 레벨 형제 가중치 합을 100으로 정규화한다.
 * 앱 로직에서는 더 이상 호출하지 않으며, 마이그레이션·테스트용으로만 유지한다.
 * - `preserveTaskId`가 주어지면: 해당 작업의 가중치는 사용자가 입력한 값으로 고정하고
 *   나머지 형제들에게 (100 - preservedWeight)를 기존 비율대로 비례 분배한다.
 * - `preserveTaskId`가 없으면: 모든 형제들의 가중치를 비율을 유지하면서 합 100으로 재조정한다.
 * - 기존 합이 0이거나 모두 미지정이면 균등 분배(100/n).
 */
export function rescaleSiblingsToSum100(
  tasks: Task[],
  projectId: string | null | undefined,
  parentId: string | null,
  preserveTaskId?: string,
): Task[] {
  if (!projectId) return tasks;
  const isSibling = (t: Task) => t.projectId === projectId && (t.parentId ?? null) === (parentId ?? null);

  const siblingsInOrder = tasks.filter(isSibling);
  if (siblingsInOrder.length === 0) return tasks;

  const getWeight = (t: Task): number => (typeof t.weight === 'number' && Number.isFinite(t.weight) ? t.weight : 0);

  // 단일 작업: 무조건 100
  if (siblingsInOrder.length === 1) {
    const only = siblingsInOrder[0]!;
    if (only.weight === 100) return tasks;
    return tasks.map((t) => (t.id === only.id ? { ...t, weight: 100 } : t));
  }

  let preserved: Task | undefined;
  let preservedWeight = 0;
  let others: Task[];
  if (preserveTaskId) {
    preserved = siblingsInOrder.find((t) => t.id === preserveTaskId);
    others = siblingsInOrder.filter((t) => t.id !== preserveTaskId);
    if (preserved) {
      preservedWeight = round2(Math.max(0, Math.min(100, getWeight(preserved))));
    }
  } else {
    others = siblingsInOrder;
  }

  const newWeights = new Map<string, number>();
  if (preserved) newWeights.set(preserved.id, preservedWeight);

  if (others.length > 0) {
    const remaining = round2(Math.max(0, 100 - preservedWeight));
    const othersSum = others.reduce((s, t) => s + getWeight(t), 0);
    let assigned = 0;
    for (let i = 0; i < others.length; i++) {
      const t = others[i]!;
      const isLast = i === others.length - 1;
      let w: number;
      if (othersSum > 0) {
        w = isLast ? round2(remaining - assigned) : round2((getWeight(t) / othersSum) * remaining);
      } else {
        w = isLast ? round2(remaining - assigned) : round2(remaining / others.length);
      }
      if (!isLast) assigned += w;
      newWeights.set(t.id, Math.max(0, w));
    }
  }

  let changed = false;
  const next = tasks.map((t) => {
    const nw = newWeights.get(t.id);
    if (nw === undefined) return t;
    if (t.weight === nw) return t;
    changed = true;
    return { ...t, weight: nw };
  });
  return changed ? next : tasks;
}

/**
 * 상위 작업 가중치 변경 시, 해당 노드의 모든 하위 레벨을 비율 유지하여 재귀적으로 재분배.
 * @deprecated 앱에서는 형제 가중치를 `rescaleSiblingsToSum100`으로 묶지 않으며, 이 함수도 사용하지 않는다.
 */
export function redistributeWeightsDown(tasks: Task[], parentId: string, parentWeight: number): Task[] {
  const children = tasks.filter((t) => t.parentId === parentId);
  if (children.length === 0) return tasks;

  const raw = (c: Task) =>
    typeof c.weight === 'number' && Number.isFinite(c.weight)
      ? c.weight
      : typeof c.workEffort === 'number' && Number.isFinite(c.workEffort)
        ? c.workEffort
        : 0;
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

  let nextTasks = tasks.map((t) => {
    const nw = newWeights[t.id];
    return nw !== undefined ? { ...t, weight: nw } : t;
  });

  for (const c of sortedChildren) {
    const hasGrandchildren = nextTasks.some((t) => t.parentId === c.id);
    if (hasGrandchildren) nextTasks = redistributeWeightsDown(nextTasks, c.id, newWeights[c.id] ?? 0);
  }

  return nextTasks;
}

/** 특정 프로젝트의 모든 부모 작업을 자식 기준으로 롤업 재계산.
 * @param excludeParentIds 사용자가 직접 편집한 부모 작업 ID들. 이 ID들은 롤업을 건너뛴다(자식 min/max로 덮어쓰지 않음). */
export function recomputeProjectRollups(
  allTasks: Task[],
  projectId: string,
  doneStatusIds?: Set<string>,
  excludeParentIds?: Set<string>,
): Task[] {
  if (!projectId || projectId === 'all') return allTasks;
  const projectTasks = allTasks.filter((t) => t.projectId === projectId);
  if (projectTasks.length === 0) return allTasks;

  const taskMap = new Map(projectTasks.map((t) => [t.id, t] as const));
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
    if (!t || !t.parentId || !taskMap.has(t.parentId)) {
      depthMemo.set(id, 0);
      return 0;
    }
    const d = getDepth(t.parentId) + 1;
    depthMemo.set(id, d);
    return d;
  };

  const parentIds = Array.from(hasChildren).sort((a, b) => getDepth(b) - getDepth(a));
  let next = allTasks;
  for (const pid of parentIds) {
    // 사용자가 직접 편집한 부모는 자식 min/max로 덮어쓰지 않음.
    // syncParentRollups에도 excludeParentIds를 전달해 자식 쪽에서의 재귀 롤업도 막는다.
    if (excludeParentIds?.has(pid)) continue;
    next = syncParentRollups(next, pid, doneStatusIds, false, excludeParentIds);
  }
  return next;
}

/** 모든 프로젝트에 대해 상위 작업의 시작일/종료일/진척률을 하위 작업 기준으로 롤업 */
export function applyRollupsToTasks(tasks: Task[], statusConfigs?: Array<{ id: string; progress?: number }>): Task[] {
  const doneStatusIds = statusConfigs ? new Set(statusConfigs.filter((c) => c.progress === 100).map((c) => c.id)) : undefined;
  const projectIds = Array.from(new Set(tasks.map((t) => t.projectId))).filter((id): id is string => Boolean(id) && id !== 'all');
  let result = tasks;
  for (const pid of projectIds) result = recomputeProjectRollups(result, pid, doneStatusIds);
  return result;
}
