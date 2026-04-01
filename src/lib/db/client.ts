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
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
