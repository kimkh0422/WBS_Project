import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchProfileLevelColors, updateProfileLevelColors } from '../lib/db';
import { LEVEL_COLORS, LEVEL_DEFAULT, ROW_BG_ALPHA } from '../lib/levelColors';
import { isSupabaseConfigured } from '../lib/supabase';

export type RgbColor = { r: number; g: number; b: number };

const STORAGE_KEY = 'wbs-level-colors';

const DEFAULT_COLORS: RgbColor[] = [...LEVEL_COLORS];

function getLevelRgb(level: number, customColors: RgbColor[] | null): RgbColor {
  const i = level - 1;
  if (customColors && i >= 0 && i < customColors.length) return { ...customColors[i] };
  if (i >= 0 && i < DEFAULT_COLORS.length) return { ...DEFAULT_COLORS[i] };
  return { ...LEVEL_DEFAULT };
}

interface LevelColorsContextType {
  /** 사용자 맞춤 색상. null이면 기본값 사용 */
  levelColors: RgbColor[] | null;
  /** 레벨별 색상 업데이트 (저장 포함) */
  setLevelColors: (colors: RgbColor[]) => void;
  /** 기본값으로 복원 */
  resetToDefault: () => void;
  levelBarBg: (level: number) => string;
  levelRowBg: (level: number) => string;
  levelBorderColor: (level: number) => string;
}

const LevelColorsContext = createContext<LevelColorsContextType | undefined>(undefined);

export function LevelColorsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [levelColors, setLevelColorsState] = useState<RgbColor[] | null>(null);

  useEffect(() => {
    if (user && isSupabaseConfigured) {
      fetchProfileLevelColors(user.id).then((colors) => {
        setLevelColorsState(colors);
      }).catch(() => setLevelColorsState(null));
    } else {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0) {
            const valid = parsed.filter(
              (c): c is RgbColor =>
                c && typeof c === 'object' && typeof (c as any).r === 'number' && typeof (c as any).g === 'number' && typeof (c as any).b === 'number'
            );
            if (valid.length > 0) setLevelColorsState(valid);
          }
        }
      } catch {
        setLevelColorsState(null);
      }
    }
  }, [user?.id]);

  const setLevelColors = useCallback((colors: RgbColor[]) => {
    setLevelColorsState(colors.length > 0 ? colors : null);
    if (user && isSupabaseConfigured) {
      updateProfileLevelColors(user.id, colors).catch(() => {});
    } else {
      try {
        if (colors.length > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {}
    }
  }, [user?.id]);

  const resetToDefault = useCallback(() => {
    setLevelColorsState(null);
    if (user && isSupabaseConfigured) {
      updateProfileLevelColors(user.id, null).catch(() => {});
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user?.id]);

  const levelBarBg = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    return `rgb(${r}, ${g}, ${b})`;
  }, [levelColors]);

  const levelRowBg = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    return `rgba(${r}, ${g}, ${b}, ${ROW_BG_ALPHA})`;
  }, [levelColors]);

  const levelBorderColor = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    const darken = (v: number) => Math.max(0, Math.floor(v * 0.7));
    return `rgb(${darken(r)}, ${darken(g)}, ${darken(b)})`;
  }, [levelColors]);

  const value: LevelColorsContextType = {
    levelColors,
    setLevelColors,
    resetToDefault,
    levelBarBg,
    levelRowBg,
    levelBorderColor,
  };

  return (
    <LevelColorsContext.Provider value={value}>
      {children}
    </LevelColorsContext.Provider>
  );
}

export function useLevelColors() {
  const ctx = useContext(LevelColorsContext);
  if (ctx === undefined) {
    throw new Error('useLevelColors must be used within LevelColorsProvider');
  }
  return ctx;
}
