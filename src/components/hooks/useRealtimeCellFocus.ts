import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { TableColumnId } from '../wbsTableTypes';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

/** 다른 사용자의 셀 포커스 정보 (실시간 커서 표시용) */
export type OtherCellFocus = {
  userId: string;
  displayName: string;
  color: string;
  taskId: string;
  columnId: TableColumnId;
  ts: number;
};

interface UseRealtimeCellFocusParams {
  currentProjectId: string;
  currentUserId: string;
  currentUserDisplayName: string;
  tableEditMode: boolean;
  editingCell: { taskId: string; columnId: TableColumnId } | null;
  focusedCell: { taskId: string; columnId: TableColumnId } | null;
}

export function useRealtimeCellFocus({
  currentProjectId,
  currentUserId,
  currentUserDisplayName,
  tableEditMode,
  editingCell,
  focusedCell,
}: UseRealtimeCellFocusParams) {
  const focusChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const [otherCellFocus, setOtherCellFocus] = useState<OtherCellFocus[]>([]);
  const otherFocusByCellKey = useMemo(() => {
    const m = new Map<string, OtherCellFocus[]>();
    for (const f of otherCellFocus) {
      const k = `${f.taskId}::${f.columnId}`;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    }
    return m;
  }, [otherCellFocus]);

  const colorForUser = useCallback((uid: string) => {
    // deterministic palette
    const palette = ['#2563eb', '#16a34a', '#f97316', '#db2777', '#7c3aed', '#0ea5e9', '#ca8a04', '#dc2626'];
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return palette[h % palette.length]!;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!currentProjectId || currentProjectId === 'all') return;
    if (!currentUserId) return;

    const channel = supabase.channel(`wbs-focus-${currentProjectId}`, {
      config: {
        broadcast: { self: false },
      },
    });
    focusChannelRef.current = channel;

    const prune = (list: OtherCellFocus[]) => {
      const now = Date.now();
      return list.filter(x => now - x.ts < 15000); // 15s stale prune
    };

    channel.on('broadcast', { event: 'cell_focus' }, (payload) => {
      const raw = payload?.payload ?? payload;
      queueMicrotask(() => {
        const p = raw;
        const uid = String(p?.userId ?? '').trim();
        if (!uid || uid === currentUserId) return;
        const taskId = String(p?.taskId ?? '').trim();
        const columnId = String(p?.columnId ?? '').trim() as TableColumnId;
        if (!taskId || !columnId) return;
        const displayName = String(p?.displayName ?? '').trim() || '(이름 없음)';
        const color = String(p?.color ?? '').trim() || colorForUser(uid);
        setOtherCellFocus(prev => {
          const next = prune(prev);
          const without = next.filter(x => x.userId !== uid);
          return [...without, { userId: uid, displayName, color, taskId, columnId, ts: Date.now() }];
        });
      });
    });

    channel.on('broadcast', { event: 'cell_blur' }, (payload) => {
      const raw = payload?.payload ?? payload;
      queueMicrotask(() => {
        const p = raw;
        const uid = String(p?.userId ?? '').trim();
        if (!uid || uid === currentUserId) return;
        setOtherCellFocus(prev => prev.filter(x => x.userId !== uid));
      });
    });

    channel.subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        /* ignore */
      }
      focusChannelRef.current = null;
      setOtherCellFocus([]);
    };
  }, [currentProjectId, currentUserId, colorForUser]);

  // 내 포커스 전송 (focusedCell 우선, editingCell도 포함)
  useEffect(() => {
    const channel = focusChannelRef.current;
    if (!channel) return;
    if (!tableEditMode) return;
    if (!currentUserId) return;
    const cell = editingCell ?? focusedCell;
    const send = (event: 'cell_focus' | 'cell_blur', payload: Record<string, string>) => {
      try {
        channel.send({ type: 'broadcast', event, payload });
      } catch {
        /* ignore */
      }
    };
    if (!cell) {
      send('cell_blur', { userId: currentUserId });
      return;
    }
    const t = window.setTimeout(() => {
      send('cell_focus', {
        userId: currentUserId,
        displayName: currentUserDisplayName,
        color: colorForUser(currentUserId),
        taskId: cell.taskId,
        columnId: cell.columnId,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [tableEditMode, editingCell, focusedCell, currentUserId, currentUserDisplayName, colorForUser]);

  return { otherCellFocus, otherFocusByCellKey, colorForUser };
}
