/**
 * Supabase Realtime(WebSocket·브로드캐스트) 사용량을 줄이기 위한 빌드 타임 정책.
 *
 * - VITE_BILLING_PLAN=free → Presence·셀 포커스·설명 Yjs 공동편집 등 Realtime 부가기능 비활성화
 * - VITE_REALTIME_ENABLED=false → 위와 동일(무료 Supabase 티어·연결 제한 대응용)
 */

function envLooksDisabled(v: string | undefined): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

/** 무료 플랜이거나 명시적으로 Realtime을 끈 빌드인지 */
export function isRealtimeMinimized(): boolean {
  const plan = String(import.meta.env.VITE_BILLING_PLAN ?? '')
    .trim()
    .toLowerCase();
  if (plan === 'free') return true;
  if (envLooksDisabled(import.meta.env.VITE_REALTIME_ENABLED)) return true;
  return false;
}
