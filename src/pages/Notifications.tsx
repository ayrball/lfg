import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { AppNotification } from '../lib/types';
import { timeAgo } from '../lib/format';

const ICON: Record<string, string> = {
  new_game: '📣',
  needs_players: '🙌',
  needs_players_host: '📢',
  rsvp: '🙋',
  game_on: '✅',
  full: '🎉',
  promoted: '🎉',
  reminder: '⏰',
  chat: '💬',
  cancelled: '🚫',
  updated: '✏️',
  removed: '⛔',
};

export function Notifications() {
  const { session } = useAuth();
  const me = session!.user.id;
  const [items, setItems] = useState<AppNotification[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', me)
        .order('created_at', { ascending: false })
        .limit(100);
      setItems((data as AppNotification[]) ?? []);
      // Opening the inbox marks everything as read.
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null);
    })();
  }, [me]);

  if (items === null) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <h1>Notifications</h1>
      {items.length === 0 ? (
        <div className="card empty">
          <p className="empty__emoji">🔔</p>
          <p>Nothing yet. Set your home area and sports on your profile to get pinged about games nearby.</p>
        </div>
      ) : (
        <ul className="inbox">
          {items.map((n) => {
            const inner = (
              <>
                <span className="inbox__icon" aria-hidden>
                  {ICON[n.kind] ?? '🔔'}
                </span>
                <span className="inbox__text">
                  <strong>{n.title}</strong>
                  <span className="muted">{n.body}</span>
                </span>
                <span className="muted small">{timeAgo(n.created_at)}</span>
              </>
            );
            return (
              <li key={n.id} className={n.read_at ? '' : 'inbox--unread'}>
                {n.game_id ? <Link to={`/games/${n.game_id}`}>{inner}</Link> : <div>{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
