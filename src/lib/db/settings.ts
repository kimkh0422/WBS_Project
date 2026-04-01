import { supabase } from '../supabase';
import type { SettingsRow } from '../supabase';
import type { WBSSettings } from '../../context/WBSContext';
import { requireSupabase } from './client';
import { toSettingsRow, fromSettingsRow } from './mappers';

export async function fetchSettings(): Promise<Partial<WBSSettings> | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('wbs_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return data ? fromSettingsRow(data as SettingsRow) : null;
}

export async function fetchSettingsRow(): Promise<SettingsRow | null> {
  requireSupabase();
  const { data, error } = await supabase!
    .from('wbs_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return (data as SettingsRow) ?? null;
}

export async function upsertSettings(settings: WBSSettings): Promise<void> {
  requireSupabase();
  const { error } = await supabase!
    .from('wbs_settings')
    .upsert(toSettingsRow(settings));
  if (error) throw error;
}
