import type { CSSProperties } from 'react';

/**
 * 상태(완료/진행 중 등) 색상: 프리셋(Tailwind 클래스) 또는 커스텀(hex) 지원.
 * 커스텀은 bg-[#hex] border-[#hex] 형식으로 저장되며, Tailwind 동적 클래스 대신 인라인 스타일로 적용.
 */

export function isCustomStatusColor(value: string): boolean {
  return /^bg-\[#[a-fA-F0-9]{6}\] border-\[#[a-fA-F0-9]{6}\]$/.test(value);
}

export function getStatusColorProps(value: string): {
  className?: string;
  style?: CSSProperties;
} {
  if (!value) return { className: 'bg-slate-50 border-slate-100' };
  if (!isCustomStatusColor(value)) return { className: value };
  const bgM = value.match(/bg-\[(#?[a-fA-F0-9]{6})\]/);
  const borderM = value.match(/border-\[(#?[a-fA-F0-9]{6})\]/);
  if (!bgM || !borderM) return { className: 'bg-slate-50 border-slate-100' };
  return {
    className: 'border',
    style: { backgroundColor: bgM[1], borderColor: borderM[1] },
  };
}
