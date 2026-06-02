import type { CSSProperties } from 'react';
import type { CellTextStyle, Task } from '../types';
import type { TableColumnId } from '../components/wbsTableTypes';

/** DB `custom_fields`에만 저장되는 내부 키(사용자 정의 컬럼 id와 충돌하지 않도록 함) */
export const WBS_INTERNAL_CELL_TEXT_STYLES_KEY = '__wbsCellTextStyles';

export function cellTextStyleToCss(style: CellTextStyle | undefined): CSSProperties {
  if (!style) return {};
  const o: CSSProperties = {};
  if (style.fontFamily?.trim()) o.fontFamily = style.fontFamily.trim();
  if (typeof style.fontSize === 'number' && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    o.fontSize = `${Math.min(48, Math.max(8, style.fontSize))}px`;
  }
  if (style.color?.trim()) o.color = style.color.trim();
  if (style.backgroundColor?.trim()) o.backgroundColor = style.backgroundColor.trim();
  if (style.bold) o.fontWeight = 700;
  if (style.italic) o.fontStyle = 'italic';
  const dec: string[] = [];
  if (style.underline) dec.push('underline');
  if (style.strikethrough) dec.push('line-through');
  if (dec.length > 0) o.textDecoration = dec.join(' ');
  return o;
}

/** 셀 서식 객체에서 빈 값·undefined 키를 제거 */
function pruneCellTextStyle(s: CellTextStyle): CellTextStyle | undefined {
  const out: CellTextStyle = {};
  if (s.fontFamily?.trim()) out.fontFamily = s.fontFamily.trim();
  if (typeof s.fontSize === 'number' && Number.isFinite(s.fontSize) && s.fontSize > 0) out.fontSize = s.fontSize;
  if (s.color?.trim()) out.color = s.color.trim();
  if (s.backgroundColor?.trim()) out.backgroundColor = s.backgroundColor.trim();
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.underline) out.underline = true;
  if (s.strikethrough) out.strikethrough = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 한 컬럼의 셀 서식을 갱신한다. `patch`가 null이면 해당 컬럼 서식 전체 삭제.
 * patch의 값이 undefined인 키는 기존에서 제거한다.
 */
export function mergeTaskCellTextStyles(
  task: Task,
  columnId: TableColumnId,
  patch: Partial<CellTextStyle> | null,
): { cellTextStyles: Record<string, CellTextStyle> | undefined } {
  const prevMap = { ...(task.cellTextStyles ?? {}) } as Record<string, CellTextStyle>;
  if (patch === null) {
    delete prevMap[columnId];
    return { cellTextStyles: Object.keys(prevMap).length > 0 ? prevMap : undefined };
  }
  const cur = { ...(prevMap[columnId] ?? {}) };
  for (const [k, v] of Object.entries(patch) as [keyof CellTextStyle, CellTextStyle[keyof CellTextStyle]][]) {
    if (v === undefined || v === false) {
      delete cur[k];
    } else {
      (cur as Record<string, unknown>)[k as string] = v;
    }
  }
  const pruned = pruneCellTextStyle(cur);
  if (pruned) prevMap[columnId] = pruned;
  else delete prevMap[columnId];
  return { cellTextStyles: Object.keys(prevMap).length > 0 ? prevMap : undefined };
}
