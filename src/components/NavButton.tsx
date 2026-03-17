import React from 'react';
import { cn } from '../lib/utils';

export interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  tourId?: string;
}

export function NavButton({ active, onClick, icon, label, title, tourId }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "nav-pill",
        active ? "nav-pill-active" : "nav-pill-inactive"
      )}
      title={title}
      data-tourid={tourId}
    >
      <span className="shrink-0">{icon}</span>
      <span className="inline whitespace-nowrap">{label}</span>
    </button>
  );
}
