import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useOrigin } from '../lib/useOrigin';
import { RADIUS_OPTIONS, SPORTS } from '../lib/sports';
import type { Game, RsvpStatus } from '../lib/types';
import { GameCard } from '../components/GameCard';
import { GamesMap } from '../components/maps';

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function Feed() {
  const { session, settings } = useAuth();
  const me = session!.user.id;
  const { origin, mode, hasHome, locating, error: locError, locate, switchToHome } = useOrigin();

  const [tab, setTab] = useState<'nearby' | 'mine'>(() => loadPref('feed.tab', 'nearby'));
  const [view, setView] = useState<'list' | 'map'>(() => loadPref('feed.view', 'list'));
  const [sport, setSport] = useState<string>(() => loadPref('feed.sport', ''));
  const [radius, setRadius] = useState<number>(() => loadPref('feed.radius', settings?.notify_radius_miles ?? 10));

  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [games, setGames] = useState<Game[] | null>(null);
  const [mine, setMine] = useState<Record<string, RsvpStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Keep spot counts fresh: reload when the app comes back to the foreground,
  // every minute while open, and shortly after any game is created or changed.
  useEffect(() => {
    const bump = () => setRefreshKey((k) => k + 1);
    const onVisible = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => document.visibilityState === 'visible' && bump(), 60_000);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel('feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(bump, 1000);
      })
      .subscribe();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => savePref('feed.tab', tab), [tab]);
  useEffect(() => savePref('feed.view', view), [view]);
  useEffect(() => savePref('feed.sport', sport), [sport]);
  useEffect(() => savePref('feed.radius', radius), [radius]);

  // My RSVPs (for badges and the "My games" tab)
  useEffect(() => {
    supabase
      .from('rsvps')
      .select('game_id, status')
      .eq('user_id', me)
      .then(({ data }) => setMine(Object.fromEntries((data ?? []).map((r) => [r.game_id, r.status as RsvpStatus]))));
  }, [me, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      if (tab === 'nearby') {
        if (!origin) return setGames(null);
        const { data, error } = await supabase.rpc('nearby_games', {
          p_lat: origin.lat,
          p_lng: origin.lng,
          p_radius_miles: radius,
          p_sport: sport || null,
        });
        if (cancelled) return;
        if (error) setError(error.message);
        setGames((data as Game[]) ?? []);
      } else {
        const ids = Object.entries(mine)
          .filter(([, s]) => (when === 'past' ? s === 'going' : s !== 'declined' && s !== 'removed'))
          .map(([id]) => id);
        if (!ids.length) return setGames([]);
        const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
        const query = supabase.from('game_details').select('*').in('id', ids);
        const { data, error } =
          when === 'past'
            ? await query.lt('starts_at', new Date().toISOString()).order('starts_at', { ascending: false }).limit(50)
            : await query.gte('starts_at', sixHoursAgo).order('starts_at');
        if (cancelled) return;
        if (error) setError(error.message);
        const now = Date.now();
        const ended = (g: Game) => new Date(g.starts_at).getTime() + g.duration_minutes * 60_000 <= now;
        setGames(((data as Game[]) ?? []).filter((g) => (when === 'past' ? ended(g) : !ended(g))));
      }
      setRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, when, origin?.lat, origin?.lng, radius, sport, mine]);

  return (
    <div className="stack">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'nearby'} onClick={() => setTab('nearby')}>
          Nearby
        </button>
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          My games
        </button>
      </div>

      {tab === 'nearby' && (
        <>
          <div className="filters">
            <select value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
              <option value="">All sports</option>
              {SPORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.label}
                </option>
              ))}
            </select>
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance">
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  Within {r} mi
                </option>
              ))}
            </select>
            <div className="segmented segmented--sm">
              <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
              <button aria-pressed={view === 'map'} onClick={() => setView('map')}>
                Map
              </button>
            </div>
          </div>
          <p className="muted small">
            {origin ? (mode === 'home' ? 'Near your home location' : 'Near your current location') : 'Location needed'}
            {' · '}
            <button className="link" onClick={locate} disabled={locating}>
              {locating ? 'Locating…' : 'Use my location'}
            </button>
            {' · '}
            <button
              className="link"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                setRefreshKey((k) => k + 1);
              }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {hasHome && mode !== 'home' && (
              <>
                {' · '}
                <button className="link" onClick={switchToHome}>
                  Use home
                </button>
              </>
            )}
          </p>
          {locError && !origin && (
            <div className="card empty">
              <p>{locError}</p>
              <p>
                Or <Link to="/me">set a home location</Link> to see games near you.
              </p>
            </div>
          )}
        </>
      )}

      {tab === 'mine' && (
        <div className="row">
          <div className="segmented segmented--sm">
            <button aria-pressed={when === 'upcoming'} onClick={() => setWhen('upcoming')}>
              Upcoming
            </button>
            <button aria-pressed={when === 'past'} onClick={() => setWhen('past')}>
              Past
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {tab === 'nearby' && view === 'map' && origin ? (
        <GamesMap games={games ?? []} center={origin} radiusMiles={radius} />
      ) : games === null ? (
        origin || tab === 'mine' ? <p className="muted">Loading games…</p> : null
      ) : games.length === 0 ? (
        <div className="card empty">
          <p className="empty__emoji">🏟️</p>
          <p>
            {tab === 'nearby'
              ? 'No games nearby yet.'
              : when === 'past'
                ? "Games you've played will show up here."
                : "You haven't joined any upcoming games."}
          </p>
          {!(tab === 'mine' && when === 'past') && (
            <Link to="/host" className="btn btn--primary">
              Host a game
            </Link>
          )}
        </div>
      ) : (
        <div className="stack">
          {games.map((g) => (
            <GameCard key={g.id} game={g} from={origin} myStatus={mine[g.id]} past={tab === 'mine' && when === 'past'} />
          ))}
        </div>
      )}
    </div>
  );
}
