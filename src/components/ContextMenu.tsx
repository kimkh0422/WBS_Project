import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
    danger?: boolean;
  }[];
}

export function ContextMenu({ x, y, onClose, actions }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Adjust position if it goes off-screen (basic implementation)
  const style = {
    top: y,
    left: x,
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action, index) => (
        <button
          key={index}
          onClick={() => {
            action.onClick();
            onClose();
          }}
          className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
            action.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
          }`}
        >
          {action.icon && <span className="w-4 h-4">{action.icon}</span>}
          {action.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
