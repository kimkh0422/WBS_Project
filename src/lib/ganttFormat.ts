import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';

export function formatMd(iso: string): string {
  try {
    return format(parseISO(iso), 'M/d', { locale: ko });
  } catch {
    return iso;
  }
}

export function formatRange(startIso: string, endIso: string): string {
  return `${formatMd(startIso)}~${formatMd(endIso)}`;
}

export function formatEffort(effort: unknown): string {
  const n = typeof effort === 'number' && Number.isFinite(effort) ? effort : undefined;
  if (n === undefined) return '';
  return `${n}D`;
}
