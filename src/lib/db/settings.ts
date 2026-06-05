import { supabase } from '../supabase';
import type { SettingsRow } from '../supabase';
import type { WBSSettings } from '../wbsSettings';
import { parseSettings } from '../wbsSettings';
import { requireSupabase } from './client';
import { toSettingsRow, fromSettingsRow } from './mappers';

export async function fetchSettings(): Promise<Partial<WBSSettings> | null> {
  requireSupabase();
  const { data, error } = await supabase!.from('wbs_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // DB row는 마이그레이션(allocation/deliverables 기본 숨김 등)을 거치지 않은 채 저장될 수 있음 → 항상 parse
  return parseSettings(fromSettingsRow(data as SettingsRow));
}

export async function fetchSettingsRow(): Promise<SettingsRow | null> {
  requireSupabase();
  const { data, error } = await supabase!.from('wbs_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;
  return (data as SettingsRow) ?? null;
}

export async function upsertSettings(settings: WBSSettings): Promise<void> {
  requireSupabase();
  const { error } = await supabase!.from('wbs_settings').upsert(toSettingsRow(settings));
  if (error) throw error;
}
