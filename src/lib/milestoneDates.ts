import type { Task } from '../types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 마일스톤 작업: 시작일·종료일을 동일한 일자로 맞추고 공수는 0으로 둔다.
 * 유효한 날짜(YYYY-MM-DD)가 하나도 없으면 날짜는 그대로 두고 공수만 0으로 맞춘다.
 */
export function applyMilestoneDateInvariant(task: Task): Task {
  if (!task.isMilestone) return task;

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
