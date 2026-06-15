/**
 * 진척률 부모 롤업(자식 → 부모) **이외**의 집계(요약 바·대시보드·주간 보고 등)에서만 쓰는 옵션.
 *
 * - `useWeightForProgressRollup = true` (기본): 진척·계획 **집계** 시 공수(workEffort) 가중 평균
 * - `useWeightForProgressRollup = false`: 집계 시 단순 평균 (공수 무시)
 *
 * **요약 행에 저장되는 부모 진척률**(`syncParentRollups`)은 Σ공수>0이면 항상 공수 가중 평균이며,
 * 이 토글과 무관합니다(완료 리프도 형제 대비 공수 비율만큼만 상위에 반영).
 *
 * localStorage에 저장돼 이 PC에서 영구 유지되고, 변경 시 'wbs:progressRollupOptionChanged' 이벤트를
 * window에 발행한다. WBSContext가 이를 감지해 setAllTasks([...prev])로 즉시 재계산을 트리거한다.
 */
const STORAGE_KEY = 'wbs.progressRollupUseWeight';
const CHANGE_EVENT = 'wbs:progressRollupOptionChanged';

let _useWeightForProgressRollup: boolean = (() => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === '0' ? false : true; // 기본 true
  } catch {
    return true;
  }
})();

export function getUseWeightForProgressRollup(): boolean {
  return _useWeightForProgressRollup;
}

export function setUseWeightForProgressRollup(value: boolean): void {
  const v = !!value;
  if (_useWeightForProgressRollup === v) return;
  _useWeightForProgressRollup = v;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
  } catch {
    /* ignore quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: v }));
  } catch {
    /* ignore */
  }
}

/** 옵션 변경 이벤트 구독 (cleanup 반환). */
export function onProgressRollupOptionChange(handler: (value: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const fn = (e: Event) => handler((e as CustomEvent).detail as boolean);
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}
