import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchProfileLevelColors, updateProfileLevelColors } from '../lib/db';
import { LEVEL_COLORS, LEVEL_DEFAULT, ROW_BG_ALPHA, ROW_BG_ALPHA_DARK } from '../lib/levelColors';
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
  /** 간트 바 테두리·라벨용 진한 색 (다크모드에서 약간 어둡게) */
  levelBarBg: (level: number) => string;
  /** 표 행 배경 (다크모드: 투명) */
  levelRowBg: (level: number) => string;
  /** 간트 바 채움색 (다크모드: 어두운 톤, 라이트: 반투명) */
  levelGanttBarFill: (level: number) => string;
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

  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  const levelBarBg = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    if (isDark()) {
      // 다크모드: 간트 바를 어둡고 탁하게 (밝기 50%, 채도 낮춤)
      const dim = (v: number) => Math.round(v * 0.45);
      return `rgb(${dim(r)}, ${dim(g)}, ${dim(b)})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
  }, [levelColors]);

  const levelRowBg = useCallback((level: number) => {
    if (isDark()) {
      // 다크모드: 표 행 배경은 투명 (레벨 구분은 왼쪽 테두리 색으로)
      return 'transparent';
    }
    const { r, g, b } = getLevelRgb(level, levelColors);
    return `rgba(${r}, ${g}, ${b}, ${ROW_BG_ALPHA})`;
  }, [levelColors]);

  /** 간트 바 채움색: 라이트=반투명 파스텔, 다크=어두운 톤 */
  const levelGanttBarFill = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    if (isDark()) {
      const dim = (v: number) => Math.round(v * 0.35);
      return `rgb(${dim(r)}, ${dim(g)}, ${dim(b)})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${ROW_BG_ALPHA})`;
  }, [levelColors]);

  const levelBorderColor = useCallback((level: number) => {
    const { r, g, b } = getLevelRgb(level, levelColors);
    if (isDark()) {
      // 다크모드: 테두리 색상은 유지하되 약간 어둡게
      const dim = (v: number) => Math.round(v * 0.6);
      return `rgb(${dim(r)}, ${dim(g)}, ${dim(b)})`;
    }
    const darken = (v: number) => Math.max(0, Math.floor(v * 0.7));
    return `rgb(${darken(r)}, ${darken(g)}, ${darken(b)})`;
  }, [levelColors]);

  const value: LevelColorsContextType = {
    levelColors,
    setLevelColors,
    resetToDefault,
    levelBarBg,
    levelRowBg,
    levelGanttBarFill,
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
