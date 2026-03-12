import { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface PresenceUser {
  userId: string;
  displayName: string;
}

/**
 * Supabase Realtime Presence: 현재 프로젝트를 보고 있는 다른 사용자 목록.
 * projectId가 'all'이거나 빈 값이면 비활성화.
 */
export function usePresence(
  projectId: string,
  currentUserId: string | undefined,
  currentUserDisplayName: string
): { others: PresenceUser[] } {
  const [others, setOthers] = useState<PresenceUser[]>([]);
  const channelRef = useRef<{ untrack: () => Promise<void>; unsubscribe: () => void } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !projectId || projectId === 'all') {
      setOthers([]);
      return;
    }

    const channelName = `wbs-presence-${projectId}`;
    const channel = supabase!.channel(channelName, {
      config: {
        presence: {
          key: currentUserId ?? undefined, // 동일 사용자 중복 표시 방지
        },
      },
    });

    channelRef.current = channel;

    const updateOthers = () => {
      const state = channel.presenceState();
      const seen = new Set<string>();
      const list: PresenceUser[] = [];
      for (const key of Object.keys(state)) {
        const presences = state[key] as Array<{ user_id?: string; display_name?: string }>;
        for (const p of presences ?? []) {
          const uid = p?.user_id ?? key;
          if (uid === currentUserId) continue;
          if (seen.has(uid)) continue;
          seen.add(uid);
          list.push({
            userId: uid,
            displayName: (p?.display_name && String(p.display_name).trim()) || '(이름 없음)',
          });
        }
      }
      setOthers(list);
    };

    channel
      .on('presence', { event: 'sync' }, updateOthers)
      .on('presence', { event: 'join' }, updateOthers)
      .on('presence', { event: 'leave' }, updateOthers)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: currentUserId ?? '',
            display_name: currentUserDisplayName || '(이름 없음)',
          });
          updateOthers();
        }
      });

    return () => {
      channel.untrack().then(() => channel.unsubscribe());
      channelRef.current = null;
      setOthers([]);
    };
  }, [projectId, currentUserId, currentUserDisplayName]);

  return { others };
}
