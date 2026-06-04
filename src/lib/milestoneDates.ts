import type { Task } from '../types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type MilestoneInvariantOptions = {
  /** true면 이 행 아래에 하위 작업이 있다. 일정은 상위 롤업으로 시작≠종료가 될 수 있어 한 시점으로 강제하지 않는다. */
  hasChildTasks?: boolean;
};

/**
 * 마일스톤 작업: 시작일·종료일을 동일한 일자로 맞추고 공수는 0으로 둔다.
 * 유효한 날짜(YYYY-MM-DD)가 하나도 없으면 날짜는 그대로 두고 공수만 0으로 맞춘다.
 *
 * 하위 작업이 있는 요약 행에 `isMilestone`이 켜진 경우, 롤업으로 늘어난 종료일이
 * `시작일만 기준으로 덮어써지는` 문제를 막기 위해 날짜는 건드리지 않는다.
 */
export function applyMilestoneDateInvariant(task: Task, options?: MilestoneInvariantOptions): Task {
  if (!task.isMilestone) return task;

  if (options?.hasChildTasks) {
    if (task.workEffort === 0 || task.workEffort === undefined) return task;
    return { ...task, workEffort: 0 };
  }

  const rawS = (task.startDate ?? '').trim();
  const rawE = (task.endDate ?? '').trim();
  const sY = rawS.slice(0, 10);
  const eY = rawE.slice(0, 10);
  const sOk = YMD.test(sY);
  const eOk = YMD.test(eY);

  let startOut = task.startDate;
  let endOut = task.endDate;
  if (sOk || eOk) {
    const canonicalY = sOk ? sY : eY;
    const tail = sOk && rawS.length > 10 ? rawS.slice(10) : eOk && rawE.length > 10 ? rawE.slice(10) : '';
    const canonical = canonicalY + tail;
    startOut = canonical;
    endOut = canonical;
  }

  const next: Task = {
    ...task,
    startDate: startOut,
    endDate: endOut,
    workEffort: 0,
  };

  if (next.startDate === task.startDate && next.endDate === task.endDate && (task.workEffort === 0 || task.workEffort === undefined)) {
    return task;
  }
  return next;
}
