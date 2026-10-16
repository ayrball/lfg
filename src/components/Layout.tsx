import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

function useUnreadCount(userId: string | undefined) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const load = () =>
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null)
        .then(({ count: c }) => setCount(c ?? 0));
    load();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
  return count;
}

export function Layout() {
  const { session } = useAuth();
  const unread = useUnreadCount(session?.user.id);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          LFG
        </Link>
        <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          🔔
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </Link>
      </header>
      <main className="content">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <nav className="tabbar">
        <NavLink to="/" end>
          <span aria-hidden>🗺️</span>
          Games
        </NavLink>
        <NavLink to="/host" className="tabbar__host">
          <span aria-hidden>＋</span>
          Host
        </NavLink>
        <NavLink to="/me">
          <span aria-hidden>👤</span>
          Profile
        </NavLink>
      </nav>
    </div>
  );
}
