import React from 'react';
import { cn } from '../lib/utils';

export interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  tourId?: string;
  /** true면 모바일(< md)에서 버튼 자체를 숨김 */
  mobileHidden?: boolean;
}

export function NavButton({ active, onClick, icon, label, title, tourId, mobileHidden }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn('nav-pill', active ? 'nav-pill-active' : 'nav-pill-inactive', mobileHidden && 'hidden md:inline-flex')}
      title={title}
      data-tourid={tourId}
    >
      <span className="shrink-0">{icon}</span>
      <span className="inline whitespace-nowrap">{label}</span>
    </button>
  );
}
