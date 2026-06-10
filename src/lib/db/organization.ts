import { supabase } from '../supabase';
import { requireSupabase } from './client';

export interface OrgNodeRow {
  id: string;
  name: string;
  parent_id: string | null;
  department_aliases: string[] | null;
  sort_order: number;
}

export interface OrgMemberRow {
  id: string;
  name: string;
  department: string;
  position: string;
  gender: string;
  email: string | null;
  sort_order: number;
}

/** 조직 트리 노드를 정렬된 평탄 배열로 가져온다(parent → child 순서 보장 X). */
export async function fetchOrgNodes(): Promise<OrgNodeRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('org_nodes')
    .select('id, name, parent_id, department_aliases, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrgNodeRow[];
}

/** 조직 인원 전체 조회. sort_order 오름차순. */
export async function fetchOrgMembers(): Promise<OrgMemberRow[]> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('org_members')
    .select('id, name, department, position, gender, email, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrgMemberRow[];
}

/** 단일 org_member 의 email 만 갱신(관리자 전용). */
export async function updateOrgMemberEmail(id: string, email: string | null): Promise<void> {
  requireSupabase();
  const { error } = await supabase!
    .from('org_members')
    .update({ email: email && email.trim() ? email.trim() : null })
    .eq('id', id);
  if (error) throw error;
}

/** 단일 org_member 의 telegram_chat_id 만 갱신(관리자 전용).
 *  컬럼은 20260610140000_org_members_telegram_chat_id.sql 마이그레이션으로 추가 — 적용 전 DB에서는 에러. */
export async function updateOrgMemberTelegramChatId(id: string, chatId: string | null): Promise<void> {
  requireSupabase();
  const { error } = await supabase!
    .from('org_members')
    .update({ telegram_chat_id: chatId && chatId.trim() ? chatId.trim() : null })
    .eq('id', id);
  if (error) throw error;
}
