import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import type { WorkEffortUnit } from '../types';
import { workEffortUnitShortSuffixKo } from './workEffortUnits';

export function formatMd(iso: string): string {
  if (!iso) return '';
  const head = iso.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  try {
    return format(parseISO(iso), 'yyyy-MM-dd', { locale: ko });
  } catch {
    return iso;
  }
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatMd(startIso)}~${formatMd(endIso)}`;
}

export function formatEffort(effort: unknown, unit: WorkEffortUnit = 'day'): string {
  const n = typeof effort === 'number' && Number.isFinite(effort) ? effort : undefined;
  if (n === undefined) return '';
  return `${n}${workEffortUnitShortSuffixKo(unit)}`;
}
