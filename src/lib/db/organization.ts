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
    .select('id, name, department, position, gender, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrgMemberRow[];
}
