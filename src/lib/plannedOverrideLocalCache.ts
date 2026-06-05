/**
 * 계획율 수동값(plannedProgressOverride) 로컬 캐시.
 *
 * 사용자 요구: "사용자가 입력한 계획율은 다른 로직에 의해 변경되지 않도록 강제".
 * DB 저장이 어떤 이유로든(권한·풀 race·컬럼 누락 등) 실패하더라도, 이 PC에서 입력한 값은
 * 항상 localStorage에 보존되고, task 로드/풀(pull) 후 자동으로 복원된다.
 *
 * 다중 클라이언트 동기화는 DB가 담당. 이 캐시는 "내가 입력한 값이 사라지지 않는다"는 보장만 추가한다.
 */
const STORAGE_KEY = 'wbs.plannedOverride.v1';

type Cache = Record<string, number | null>;

function read(): Cache {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Cache = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null) out[k] = null;
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function write(cache: Cache): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota */
  }
}

/** 한 작업의 수동 계획율 캐시값(없으면 undefined) */
export function getPlannedOverrideLocal(taskId: string): number | null | undefined {
  if (!taskId) return undefined;
  const cache = read();
  return Object.prototype.hasOwnProperty.call(cache, taskId) ? cache[taskId] : undefined;
}

/** 사용자가 입력한 수동값을 캐시에 저장 (숫자=값, null=명시적 자동 모드 복귀). */
export function setPlannedOverrideLocal(taskId: string, value: number | null): void {
  if (!taskId) return;
  const cache = read();
  cache[taskId] = value;
  write(cache);
}

/** 캐시에서 한 작업을 완전히 제거(예: 작업 삭제 시) */
export function clearPlannedOverrideLocal(taskId: string): void {
  if (!taskId) return;
  const cache = read();
  if (!Object.prototype.hasOwnProperty.call(cache, taskId)) return;
  delete cache[taskId];
  write(cache);
}

/**
 * task 배열에 캐시 값을 강제 적용.
 * - 캐시에 숫자가 있으면 task.plannedProgressOverride = 그 숫자
 * - 캐시에 null이 있으면 task.plannedProgressOverride = null (자동 모드)
 * - 캐시에 없으면 task의 기존 값 그대로
 *
 * DB에서 풀해온 직후에 호출해, 사용자가 입력한 값이 사라지지 않도록 한다.
 */
export function overlayPlannedOverrideFromLocal<T extends { id: string; plannedProgressOverride?: number | null }>(tasks: T[]): T[] {
  const cache = read();
  if (Object.keys(cache).length === 0) return tasks;
  return tasks.map((t) => {
    if (!Object.prototype.hasOwnProperty.call(cache, t.id)) return t;
    const cached = cache[t.id];
    if (cached === t.plannedProgressOverride) return t;
    return { ...t, plannedProgressOverride: cached };
  });
}
