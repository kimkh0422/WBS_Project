import { supabase, isSupabaseConfigured } from '../supabase';

const SUPABASE_REQUIRED = 'Supabase 설정이 필요합니다. .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요.';

export function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(SUPABASE_REQUIRED);
  }
}

function rpcDisabledKey(fnName: string) {
  return `wbs.rpc.disabled.${fnName}`;
}

export function isRpcDisabled(fnName: string): boolean {
  try {
    return sessionStorage.getItem(rpcDisabledKey(fnName)) === '1';
  } catch {
    return false;
  }
}

export function disableRpc(fnName: string) {
  try {
    sessionStorage.setItem(rpcDisabledKey(fnName), '1');
  } catch {
    // ignore
  }
}

export function isRpcNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string; message?: string; details?: string };
  const status = e.status;
  const code = (e.code || '').toString();
  const msg = ((e.message || '') + ' ' + (e.details || '')).toLowerCase();
  return (
    status === 404 ||
    code === 'PGRST202' ||
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('could not find the function')
  );
}

export async function getAuthedUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** PostgREST PGRST204: select/upsert payload에 스키마에 없는 컬럼이 있을 때 */
export function getMissingColumnNameFromPgrst204(err: { code?: string; message?: string }): string | null {
  if (err.code !== 'PGRST204') return null;
  const msg = err.message ?? '';
  const m = msg.match(/could not find the '([^']+)' column/i);
  return m?.[1] ? String(m[1]) : null;
}

/** 쉼표 구분 select 목록에서 컬럼 한 개 제거(스키마 폴백용) */
export function stripSelectListColumn(selectList: string, column: string): string {
  const colLower = column.toLowerCase();
  return selectList
    .split(',')
    .map((s) => s.trim())
    .filter((c) => c.length > 0 && c.toLowerCase() !== colLower)
    .join(',');
}
