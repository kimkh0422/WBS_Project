import { parseISO, format, isValid } from 'date-fns';
import type { Task } from '../types';
import { addBusinessDaysEx, differenceInBusinessDaysEx, getBusinessDayStringsEx, getHolidaysForTaskDates } from './calendar';
import { applyMilestoneDateInvariant } from './milestoneDates';

/** 월별·빠른 선택 UI용 투입비율 옵션: 0~100% 정수 */
export const ALLOCATION_OPTIONS = Array.from({ length: 101 }, (_, i) => i);

/**
 * 의존성 그래프 기준 위상 정렬: 선행 작업이 먼저 오는 순서.
 * WBS 번호/표시 순서에서 선행작업이 같은 레벨에서 상위에 오도록 할 때 사용.
 * 사이클은 무시하고 진행.
 */
export function getTopologicalOrder(tasks: Task[]): string[] {
  const byId = new Map<string, Task>();
  tasks.forEach((t) => byId.set(t.id, t));

  const deps = new Map<string, string[]>();
  tasks.forEach((t) => {
    const preds = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (preds.length > 0) deps.set(t.id, preds);
  });

  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskIdsByInputOrder = tasks.map((t) => t.id);
  // 입력 순서 인덱스를 한 번만 맵으로 만들어 비교자에서 indexOf(O(n)) 호출을 제거 (대규모 의존성에서 O(n²·log n)→O(n·log n)).
  const inputOrderIndex = new Map<string, number>();
  taskIdsByInputOrder.forEach((id, i) => inputOrderIndex.set(id, i));
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return;
    visiting.add(id);
    const preds = deps.get(id) ?? [];
    const predsSorted = [...preds].sort((a, b) => (inputOrderIndex.get(a) ?? 0) - (inputOrderIndex.get(b) ?? 0));
    for (const predId of predsSorted) {
      visit(predId);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  for (const id of taskIdsByInputOrder) {
    visit(id);
  }
  return order;
}

/**
 * 크리티컬 패스(임계 경로) 계산: 슬랙이 0인 작업 ID 집합 반환.
 * 선행관계(FS)와 영업일 기준 기간으로 전진/후진 패스 후 슬랙 = LS - ES === 0 인 작업을 크리티컬로 간주.
 * 작업 기간은 공수가 아니라 실제 시작·종료일(영업일 간격)로 산정한다.
 */
export function getCriticalPathTaskIds(tasks: Task[]): Set<string> {
  if (tasks.length === 0) return new Set();
  const byId = new Map<string, Task>();
  tasks.forEach((t) => byId.set(t.id, t));

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  tasks.forEach((t) => {
    const deps = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (deps.length > 0) preds.set(t.id, deps);
    for (const p of deps) {
      if (!succs.has(p)) succs.set(p, []);
      succs.get(p)!.push(t.id);
    }
  });

  const order = getTopologicalOrder(tasks);
  const holidays = getHolidaysForTaskDates(tasks);

  const projectStart = tasks.reduce((min, t) => {
    const d = t.startDate;
    return !d || (min && d < min) ? min : d;
  }, '' as string);
  if (!projectStart) return new Set();

  const startDate = parseISO(projectStart);
  if (!isValid(startDate)) return new Set();

  function dateToIndex(dateStr: string): number {
    const d = parseISO(dateStr);
    if (!isValid(d)) return 0;
    return differenceInBusinessDaysEx(startDate, d, holidays);
  }

  // 작업 기간은 공수가 아니라 실제 시작·종료일의 영업일 간격으로 산정.
  const durationById = new Map<string, number>();
  for (const t of tasks) {
    let dur: number;
    if (t.isMilestone) {
      dur = 0;
    } else {
      const s = parseISO(t.startDate);
      const e = parseISO(t.endDate);
      dur = isValid(s) && isValid(e) ? Math.max(1, differenceInBusinessDaysEx(s, e, holidays)) : 1;
    }
    durationById.set(t.id, dur);
  }

  const ES = new Map<string, number>();
  const EF = new Map<string, number>();
  for (const id of order) {
    const task = byId.get(id);
    if (!task) continue;
    const duration = durationById.get(id) ?? 1;
    const predList = preds.get(id);
    const es = !predList || predList.length === 0 ? dateToIndex(task.startDate) : Math.max(...predList.map((p) => EF.get(p) ?? 0)) + 1;
    const ef = duration > 0 ? es + duration - 1 : es;
    ES.set(id, es);
    EF.set(id, ef);
  }

  const projectEnd = Math.max(...Array.from(EF.values()), 0);
  const LS = new Map<string, number>();
  const LF = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const duration = durationById.get(id) ?? 1;
    const succList = succs.get(id);
    const lf = !succList || succList.length === 0 ? projectEnd : Math.min(...succList.map((s) => LS.get(s) ?? projectEnd)) - 1;
    const ls = duration > 0 ? lf - duration + 1 : lf;
    LF.set(id, lf);
    LS.set(id, ls);
  }

  const critical = new Set<string>();
  for (const id of order) {
    const es = ES.get(id) ?? 0;
    const ls = LS.get(id) ?? 0;
    if (ls - es <= 0) critical.add(id);
  }
  return critical;
}

/**
 * 선행관계(FS)에 따라 시작일을 일관되게 조정한다.
 * - 선행 작업 종료일 다음 영업일부터 시작.
 * - 시작일이 옮겨진 작업은 기존 영업일 기간(달력상 길이)을 유지해 종료일을 다시 계산한다.
 * - 상위 작업은 직속 하위 구간(min 시작 ~ max 종료)으로 맞춘다.
 *
 * 공수(workEffort)는 일정 계산에 전혀 관여하지 않는다 — 시작·종료·기간은 오직 날짜와 선행관계로만 결정된다.
 */
export function applyDependencySchedule(
  tasks: Task[],
  /** 이번에 delta로 옮긴 작업(34번+하위 등). 재계산에서 제외해 덮어쓰지 않음 */
  excludeFromRecalc?: Set<string>,
): Task[] {
  const byId = new Map<string, Task>();
  const result = tasks.map((t) => {
    const copy = { ...t };
    byId.set(copy.id, copy);
    return copy;
  });

  const deps = new Map<string, string[]>();
  result.forEach((t) => {
    const preds = t.dependencies?.filter((id) => byId.has(id)) ?? [];
    if (preds.length > 0) deps.set(t.id, preds);
  });
  const order = getTopologicalOrder(result);
  const holidays = getHolidaysForTaskDates(result);

  // 위상 순서대로: 선행 종료일 다음 영업일로 시작일 이동 → 기존 영업일 기간 유지로 종료일 산정
  for (const id of order) {
    const task = byId.get(id)!;
    if (excludeFromRecalc?.has(id)) continue;

    const predIds = deps.get(id);
    if (!predIds || predIds.length === 0) continue;

    let maxPredEnd = '';
    for (const predId of predIds) {
      const pred = byId.get(predId);
      if (!pred?.endDate) continue;
      if (!maxPredEnd || pred.endDate > maxPredEnd) maxPredEnd = pred.endDate;
    }
    if (!maxPredEnd) continue;

    task.startDate = format(addBusinessDaysEx(parseISO(maxPredEnd), 1, holidays), 'yyyy-MM-dd');

    // 옮긴 시작일 기준으로, 원래 입력돼 있던 영업일 기간만큼 종료일을 다시 잡는다(공수 미사용).
    const originalTask = tasks.find((t) => t.id === id);
    if (originalTask?.startDate && originalTask?.endDate) {
      const s = parseISO(originalTask.startDate);
      const e = parseISO(originalTask.endDate);
      if (isValid(s) && isValid(e)) {
        const durationDays = Math.max(1, differenceInBusinessDaysEx(s, e, holidays));
        task.endDate = format(addBusinessDaysEx(parseISO(task.startDate), durationDays - 1, holidays), 'yyyy-MM-dd');
      }
    }
  }

  // 상위 작업: 직속 자식 기간의 min(start)·max(end)에 맞춘다(하위가 짧아지면 상위도 줄어듦).
  const byParent = new Map<string | null, Task[]>();
  result.forEach((t) => {
    const pid = t.parentId ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(t);
  });
  const depthOrder = (parentId: string | null): string[] => {
    const children = byParent.get(parentId) ?? [];
    const ids: string[] = [];
    for (const c of children) {
      ids.push(c.id);
      ids.push(...depthOrder(c.id));
    }
    return ids;
  };
  const allIdsByDepth = depthOrder(null);
  for (let i = allIdsByDepth.length - 1; i >= 0; i--) {
    const id = allIdsByDepth[i];
    // 사용자가 직접 편집한 부모 작업(excludeFromRecalc)은 자식 min/max로 덮어쓰지 않는다.
    if (excludeFromRecalc?.has(id)) continue;
    const task = byId.get(id)!;
    const children = byParent.get(id) ?? [];
    if (children.length === 0) continue;
    const starts = children.map((c) => c.startDate).filter(Boolean) as string[];
    const ends = children.map((c) => c.endDate).filter(Boolean) as string[];
    if (starts.length > 0) {
      const minC = starts.reduce((a, b) => (a < b ? a : b));
      task.startDate = minC;
    }
    if (ends.length > 0) {
      const maxC = ends.reduce((a, b) => (a > b ? a : b));
      task.endDate = maxC;
    }
    if (task.startDate && task.endDate && task.startDate > task.endDate) {
      task.endDate = task.startDate;
    }
  }

  const hasChildIds = new Set<string>();
  for (const t of result) {
    if (t.parentId) hasChildIds.add(t.parentId);
  }
  return result.map((t) => applyMilestoneDateInvariant(t, { hasChildTasks: hasChildIds.has(t.id) }));
}

/**
 * 상위→하위 균등 분배(스켈레톤 세팅 전용, 명시 실행).
 * 선택한 상위 작업의 기간을 **직속 하위에 순서대로 균등 분배**하고, 하위끼리 **선행관계(FS)** 로 연결한다.
 * 하위가 다시 하위를 가지면 그 구간 안에서 **재귀**로 같은 규칙을 적용한다.
 *
 * - 상위 작업 자신의 시작일·종료일은 **바꾸지 않는다**(사용자가 등록한 일정을 그대로 둠).
 * - **영업일**(주말·공휴일 제외) 기준으로 구간을 자른다. 나머지 영업일은 앞쪽 하위부터 하루씩 더 가져간다.
 * - 하위 수가 구간 영업일 수보다 많으면 각 하위에 1영업일씩 순차 배치한다(상위 종료일을 넘길 수 있음 — 드문 경우).
 * - 첫 하위의 선행관계는 보존하고, 둘째부터는 **직전 형제만** 선행으로 설정해 깔끔한 순차 체인을 만든다.
 * - 이정표(milestone) 하위는 종료일=시작일 불변식을 유지한다.
 *
 * 순수 함수: 입력 tasks를 변경하지 않고 갱신된 새 배열을 반환한다. 변경이 없으면 입력 배열을 그대로 반환.
 */
export function distributeChildrenEvenly(tasks: Task[], rootParentId: string, holidays?: Set<string>): Task[] {
  const root = tasks.find((t) => t.id === rootParentId);
  if (!root || !root.startDate || !root.endDate) return tasks;

  const hol = holidays ?? getHolidaysForTaskDates(tasks);

  // 부모 id → 직속 하위(입력 배열 순서 = 형제 표시 순서)
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    const pid = t.parentId;
    if (!pid) continue;
    let arr = childrenByParent.get(pid);
    if (!arr) childrenByParent.set(pid, (arr = []));
    arr.push(t);
  }

  const updates = new Map<string, Partial<Task>>();

  const distribute = (parentId: string, spanStartIso: string, spanEndIso: string) => {
    const kids = childrenByParent.get(parentId);
    if (!kids || kids.length === 0) return;
    const s = parseISO(spanStartIso);
    const e = parseISO(spanEndIso);
    if (!isValid(s) || !isValid(e) || s.getTime() > e.getTime()) return;

    const n = kids.length;
    const totalBiz = differenceInBusinessDaysEx(s, e, hol);
    const segments: Array<{ start: string; end: string }> = [];

    if (totalBiz >= n && totalBiz > 0) {
      // 구간 영업일을 n개 그룹으로 분할(앞쪽 rem개 그룹이 1일씩 더 가져감)
      const bizDays = getBusinessDayStringsEx(spanStartIso, totalBiz, hol);
      const base = Math.floor(totalBiz / n);
      const rem = totalBiz % n;
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const size = base + (i < rem ? 1 : 0);
        const startStr = bizDays[idx] ?? bizDays[bizDays.length - 1] ?? spanStartIso;
        const endStr = bizDays[Math.min(idx + size - 1, bizDays.length - 1)] ?? startStr;
        segments.push({ start: startStr, end: endStr });
        idx += size;
      }
    } else {
      // 하위 수 > 영업일 수: 각 1영업일씩 순차(상위 종료일을 넘길 수 있음)
      const bizDays = getBusinessDayStringsEx(spanStartIso, n, hol);
      for (let i = 0; i < n; i++) {
        const d = bizDays[i] ?? bizDays[bizDays.length - 1] ?? spanStartIso;
        segments.push({ start: d, end: d });
      }
    }

    for (let i = 0; i < n; i++) {
      const kid = kids[i];
      const seg = segments[i];
      updates.set(kid.id, { startDate: seg.start, endDate: seg.end, ...(i > 0 ? { dependencies: [kids[i - 1].id] } : {}) });
      distribute(kid.id, seg.start, seg.end);
    }
  };

  distribute(root.id, root.startDate.slice(0, 10), root.endDate.slice(0, 10));

  if (updates.size === 0) return tasks;

  const hasChildIds = new Set<string>();
  for (const t of tasks) {
    if (t.parentId) hasChildIds.add(t.parentId);
  }
  return tasks.map((t) => {
    const u = updates.get(t.id);
    const next = u ? { ...t, ...u } : t;
    return applyMilestoneDateInvariant(next, { hasChildTasks: hasChildIds.has(t.id) });
  });
}
