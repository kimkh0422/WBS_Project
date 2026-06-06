/**
 * 가중치(task.weight) 로컬 캐시.
 *
 * 사용자 요구: "가중치도 입력된 값으로만 세팅. 자동으로 변경되어서는 안 됨".
 * DB 저장이 어떤 이유로든 실패하더라도, 이 PC에서 입력한 값은 항상 localStorage에 보존되고,
 * task 로드/풀(pull) 후 자동으로 복원된다.
 *
 * - 값이 숫자(0 이상) → 그 값으로 강제
 * - 값이 null → 사용자가 명시적으로 "가중치 없음(미지정)"으로 되돌림
 * - 캐시에 없음 → DB 값 사용
 */
const STORAGE_KEY = 'wbs.weight.v1';

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

export function getWeightLocal(taskId: string): number | null | undefined {
  if (!taskId) return undefined;
  const cache = read();
  return Object.prototype.hasOwnProperty.call(cache, taskId) ? cache[taskId] : undefined;
}

export function setWeightLocal(taskId: string, value: number | null): void {
  if (!taskId) return;
  const cache = read();
  cache[taskId] = value;
  write(cache);
}

export function clearWeightLocal(taskId: string): void {
  if (!taskId) return;
  const cache = read();
  if (!Object.prototype.hasOwnProperty.call(cache, taskId)) return;
  delete cache[taskId];
  write(cache);
}

/**
 * task 배열에 캐시 값을 강제 적용.
 * - 캐시에 숫자가 있으면 task.weight = 그 숫자
 * - 캐시에 null이 있으면 task.weight = undefined(=미지정, 공수로 대체됨)
 * - 캐시에 없으면 task의 기존 값 그대로
 *
 * DB에서 풀해온 직후에 호출해, 사용자가 입력한 가중치가 사라지지 않도록 한다.
 */
export function overlayWeightFromLocal<T extends { id: string; weight?: number | null }>(tasks: T[]): T[] {
  const cache = read();
  if (Object.keys(cache).length === 0) return tasks;
  return tasks.map((t) => {
    if (!Object.prototype.hasOwnProperty.call(cache, t.id)) return t;
    const cached = cache[t.id];
    // null → undefined로 변환(미지정 처리)
    const next = cached === null ? undefined : cached;
    if (next === t.weight) return t;
    return { ...t, weight: next };
  });
}
