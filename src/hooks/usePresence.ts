import { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface PresenceUser {
  userId: string;
  displayName: string;
}

const presenceEnabled = (() => {
  // 프로젝트에 vite env 타입 선언이 없어서(import.meta.env.*) TS 에러가 날 수 있음.
  // 런타임 동작만 필요하므로 안전하게 any로 접근.
  const v = String((import.meta as any)?.env?.VITE_ENABLE_PRESENCE ?? '').toLowerCase();
  return v === '1' || v === 'true';
})();

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
  const displayNameRef = useRef(currentUserDisplayName);
  const presenceSubscribedRef = useRef(false);
  displayNameRef.current = currentUserDisplayName;

  useEffect(() => {
    // Presence는 필수 기능이 아니므로, 연결 실패 시 콘솔이 도배되지 않도록 "자동 비활성화" 한다.
    // (환경에 따라 Realtime이 꺼져있거나 방화벽/프록시로 WebSocket이 차단될 수 있음)
    if (!presenceEnabled || !isSupabaseConfigured || !supabase || !projectId || projectId === 'all') {
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
    presenceSubscribedRef.current = false;

    const updateOthers = () => {
      queueMicrotask(() => {
        const state = channel.presenceState();
        const seen = new Set<string>();
        const list: PresenceUser[] = [];
        const selfId = currentUserId;
        for (const key of Object.keys(state)) {
          const presences = state[key] as Array<{ user_id?: string; display_name?: string }>;
          for (const p of presences ?? []) {
            const uid = p?.user_id ?? key;
            if (uid === selfId) continue;
            if (seen.has(uid)) continue;
            seen.add(uid);
            list.push({
              userId: uid,
              displayName: (p?.display_name && String(p.display_name).trim()) || '(이름 없음)',
            });
          }
        }
        setOthers(list);
      });
    };

    channel
      .on('presence', { event: 'sync' }, updateOthers)
      .on('presence', { event: 'join' }, updateOthers)
      .on('presence', { event: 'leave' }, updateOthers)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          presenceSubscribedRef.current = true;
          await channel.track({
            user_id: currentUserId ?? '',
            display_name: displayNameRef.current || '(이름 없음)',
          });
          updateOthers();
          return;
        }
        // 연결 실패/타임아웃/닫힘 상태에서는 채널을 제거해 재시도를 멈춘다.
        // (브라우저 콘솔에 WebSocket 에러가 반복적으로 찍히는 것을 방지)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          presenceSubscribedRef.current = false;
          const ch = channelRef.current;
          channelRef.current = null;
          setOthers([]);
          if (ch) {
            setTimeout(() => {
              try {
                supabase?.removeChannel(ch as any);
              } catch {
                // ignore
              }
            }, 0);
          }
        }
      });

    return () => {
      presenceSubscribedRef.current = false;
      channel.untrack().then(() => channel.unsubscribe());
      channelRef.current = null;
      setOthers([]);
    };
  }, [projectId, currentUserId]);

  // 표시 이름만 바뀌면 채널 재구독 없이 presence 갱신
  useEffect(() => {
    if (!presenceEnabled || !presenceSubscribedRef.current || !channelRef.current || !currentUserId) return;
    const ch = channelRef.current as { track: (payload: object) => Promise<void> };
    void ch.track({
      user_id: currentUserId,
      display_name: currentUserDisplayName || '(이름 없음)',
    });
  }, [currentUserDisplayName, currentUserId]);

  return { others };
}
