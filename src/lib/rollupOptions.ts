/**
 * 진척률 부모 롤업(자식 → 부모) 계산 옵션.
 *
 * - `useWeightForProgressRollup = true` (기본): 자식 progress의 가중평균(가중치 또는 공수로 가중)
 * - `useWeightForProgressRollup = false`: 자식 progress의 단순 평균 (가중치 무시)
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
