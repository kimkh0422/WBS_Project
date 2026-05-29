const LAST_PULL_KEY = 'wbs-last-task-pull-at';
const PULL_COUNTER_KEY = 'wbs-task-pull-counter';

/** 증분 pull을 사용할 수 있는 최대 경과 시간(초). 초과 시 전체 조회로 폴백. */
export const INCREMENTAL_PULL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** updated_at 경계 중복 수신 방지용 오버랩(초). */
export const INCREMENTAL_PULL_OVERLAP_SEC = 60;

/** N회 증분 pull마다 id 매니페스트로 삭제 반영(전체 행 조회 없이). */
export const MANIFEST_EVERY_N_PULLS = 3;

export function getLastTaskPullAt(): string | null {
  try {
    const v = localStorage.getItem(LAST_PULL_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setLastTaskPullAt(iso: string): void {
  try {
    localStorage.setItem(LAST_PULL_KEY, iso);
  } catch {
    /* ignore */
  }
}

export function clearLastTaskPullAt(): void {
  try {
    localStorage.removeItem(LAST_PULL_KEY);
  } catch {
    /* ignore */
  }
}

export function getTaskPullCounter(): number {
  try {
    const n = Number(localStorage.getItem(PULL_COUNTER_KEY) ?? '0');
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 증가된 카운터 값 반환. */
export function bumpTaskPullCounter(): number {
  const next = getTaskPullCounter() + 1;
  try {
    localStorage.setItem(PULL_COUNTER_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function shouldRunTaskManifestThisPull(): boolean {
  return bumpTaskPullCounter() % MANIFEST_EVERY_N_PULLS === 0;
}

export function incrementalPullSinceIso(lastPullAt: string): string {
  const t = Date.parse(lastPullAt);
  if (!Number.isFinite(t)) return lastPullAt;
  return new Date(t - INCREMENTAL_PULL_OVERLAP_SEC * 1000).toISOString();
}

export function canUseIncrementalTaskPull(lastPullAt: string | null): boolean {
  if (!lastPullAt) return false;
  const t = Date.parse(lastPullAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= INCREMENTAL_PULL_MAX_AGE_MS;
}
