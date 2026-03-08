/**
 * 표·간트 공통 레벨 색상 (빨·주·노·초·파 순).
 * 동일 RGB로 색과 농도를 맞춤.
 */
export const LEVEL_COLORS = [
  { r: 220, g: 38, b: 38 },   // 1: 빨강 (red-600)
  { r: 234, g: 88, b: 12 },   // 2: 주황 (orange-600)
  { r: 234, g: 179, b: 8 },   // 3: 노랑 (yellow-500)
  { r: 5, g: 150, b: 105 },   // 4: 초록 (emerald-600)
  { r: 37, g: 99, b: 235 },   // 5: 파랑 (blue-600)
] as const;

/** 6레벨 이상용 회색 */
export const LEVEL_DEFAULT = { r: 87, g: 83, b: 78 };

/** 표 행 배경용 동일 농도(알파) */
export const ROW_BG_ALPHA = 0.22;

export function getLevelRgb(level: number): { r: number; g: number; b: number } {
  const i = level - 1;
  if (i >= 0 && i < LEVEL_COLORS.length) return { ...LEVEL_COLORS[i] };
  return { ...LEVEL_DEFAULT };
}

export function levelBarBg(level: number): string {
  const { r, g, b } = getLevelRgb(level);
  return `rgb(${r}, ${g}, ${b})`;
}

export function levelRowBg(level: number): string {
  const { r, g, b } = getLevelRgb(level);
  return `rgba(${r}, ${g}, ${b}, ${ROW_BG_ALPHA})`;
}

export function levelBorderColor(level: number): string {
  const { r, g, b } = getLevelRgb(level);
  // 테두리용 약간 어둡게 (동일 색상, 낮은 밝기)
  const darken = (v: number) => Math.max(0, Math.floor(v * 0.7));
  return `rgb(${darken(r)}, ${darken(g)}, ${darken(b)})`;
}
