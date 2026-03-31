import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuAction {
  label?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: ContextMenuAction[];
}

export function ContextMenu({ x, y, onClose, actions }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const actionItems = actions.filter(a => !a.divider);
  const [focusIndex, setFocusIndex] = useState(-1);

  const adjustedPos = useCallback(() => {
    const el = menuRef.current;
    if (!el) return { top: y, left: x };
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (x + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
    if (y + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);
    return { top, left };
  }, [x, y]);

  const [pos, setPos] = useState({ top: y, left: x });

  useEffect(() => {
    requestAnimationFrame(() => setPos(adjustedPos()));
  }, [adjustedPos]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex(prev => {
          const len = actionItems.length;
          if (len === 0) return -1;
          if (e.key === 'ArrowDown') return prev < len - 1 ? prev + 1 : 0;
          return prev > 0 ? prev - 1 : len - 1;
        });
      }
      if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < actionItems.length) {
        e.preventDefault();
        actionItems[focusIndex].onClick?.();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, focusIndex, actionItems]);

  useEffect(() => {
    if (focusIndex < 0) return;
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-ctx-item]');
    buttons?.[focusIndex]?.focus();
  }, [focusIndex]);

  let actionIdx = -1;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
      style={pos}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action, index) => {
        if (action.divider) {
          return <hr key={index} className="my-1 border-t border-gray-200" />;
        }
        actionIdx++;
        const isFocused = actionIdx === focusIndex;
        return (
          <button
            key={index}
            role="menuitem"
            data-ctx-item
            onClick={() => {
              action.onClick?.();
              onClose();
            }}
            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors outline-none ${
              action.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
            } ${isFocused ? (action.danger ? 'bg-red-50' : 'bg-gray-50') : ''}`}
          >
            {action.icon && <span className="w-4 h-4">{action.icon}</span>}
            {action.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
