import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface BlockedUser {
  blocked_id: string;
  display_name: string;
}

/** The current user's block list, with helpers to block / unblock. */
export function useBlocks(userId: string | undefined) {
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('blocks')
      .select('blocked_id, profiles!blocks_blocked_id_fkey(display_name)')
      .eq('blocker_id', userId);
    setBlocked(
      ((data ?? []) as unknown as { blocked_id: string; profiles: { display_name: string } | null }[]).map((b) => ({
        blocked_id: b.blocked_id,
        display_name: b.profiles?.display_name ?? 'Player',
      })),
    );
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const block = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('blocks').insert({ blocked_id: id });
      if (error && error.code !== '23505') throw error; // already blocked is fine
      await load();
    },
    [load],
  );

  const unblock = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('blocks').delete().eq('blocker_id', userId!).eq('blocked_id', id);
      if (error) throw error;
      await load();
    },
    [load, userId],
  );

  const isBlocked = useCallback((id: string) => blocked.some((b) => b.blocked_id === id), [blocked]);

  return { blocked, isBlocked, block, unblock };
}

export async function reportUser(input: {
  reportedUserId: string;
  reason: string;
  gameId?: string;
  messageId?: number;
}) {
  const { error } = await supabase.from('reports').insert({
    reported_user_id: input.reportedUserId,
    reason: input.reason.trim(),
    game_id: input.gameId ?? null,
    message_id: input.messageId ?? null,
  });
  if (error) throw error;
}
