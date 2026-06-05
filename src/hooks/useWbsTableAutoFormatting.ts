import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WBSSettings } from '../lib/wbsSettings';
import {
  getUserHidesTableAutoFormatting,
  setUserHidesTableAutoFormatting,
  subscribeTableAutoFormattingChanged,
} from '../lib/wbsTableDisplayPrefs';

/**
 * 작업표·간트에 적용할 자동 서식(레벨 배경, 완료 취소선·간트 완료 스타일) 표시 여부.
 * - 전역(`wbsSettings.showTableAutoFormatting`)이 false면 모두 끔.
 * - 전역이 true(기본)면 사용자는 이 기기에서만 숨길 수 있음.
 */
export function useWbsTableAutoFormatting(wbsSettings: WBSSettings | null | undefined) {
  const globalOn = wbsSettings?.showTableAutoFormatting !== false;
  const [userHides, setUserHides] = useState(getUserHidesTableAutoFormatting);

  useEffect(() => subscribeTableAutoFormattingChanged(() => setUserHides(getUserHidesTableAutoFormatting())), []);

  const showTableAutoFormatting = useMemo(() => globalOn && !userHides, [globalOn, userHides]);

  const setUserHide = useCallback((hide: boolean) => {
    setUserHidesTableAutoFormatting(hide);
    setUserHides(getUserHidesTableAutoFormatting());
  }, []);

  const toggleUserHide = useCallback(() => {
    setUserHidesTableAutoFormatting(!userHides);
    setUserHides(getUserHidesTableAutoFormatting());
  }, [userHides]);

  return { showTableAutoFormatting, globalAutoFormattingOn: globalOn, userHidesAutoFormatting: userHides, setUserHide, toggleUserHide };
}
