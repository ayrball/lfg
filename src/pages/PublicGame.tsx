import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Game } from '../lib/types';
import { skillLabel, sportInfo } from '../lib/sports';
import { formatTimeRange, gamePhase } from '../lib/format';
import { directionsUrl } from '../lib/geo';
import { VenueMap } from '../components/maps';
import { Login } from './Login';

/** What a signed-out visitor sees when they open a shared game link. */
export function PublicGame({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .rpc('get_public_game', { p_id: gameId })
      .then(({ data }) => setGame(((data as Game[] | null) ?? [])[0] ?? null));
  }, [gameId]);

  if (game === undefined) return <div className="splash">Loading…</div>;
  if (game === null) return <Login />;

  const sport = sportInfo(game.sport);
  const phase = gamePhase(game.starts_at, game.duration_minutes);
  const spotsLeft = game.max_players - game.going_count;
  const closed = game.status === 'cancelled' || phase === 'finished';

  return (
    <div className="public-game">
      <section className="card game-hero">
        <div className="game-hero__head">
          <span className="game-hero__emoji" aria-hidden>
            {sport.emoji}
          </span>
          <div>
            <p className="muted small">
              {sport.label} · {skillLabel(game.skill_level)} · hosted by {game.host_name}
            </p>
            <h1>{game.title}</h1>
          </div>
        </div>
        {game.status === 'cancelled' && <p className="banner banner--danger">This game was cancelled.</p>}
        {game.status !== 'cancelled' && phase === 'finished' && <p className="banner">This game has finished.</p>}
        <dl className="facts">
          <div>
            <dt>When</dt>
            <dd>{formatTimeRange(game.starts_at, game.duration_minutes)}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>
              {game.venue_name}
              {game.venue_address && <span className="muted"> · {game.venue_address}</span>}
            </dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>
              {game.going_count}/{game.max_players} going
              {!closed && (
                <span className={spotsLeft > 0 ? 'ok' : 'warn'}>
                  {' · '}
                  {spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : 'full — join the waitlist'}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {game.description && <p className="description">{game.description}</p>}
        <VenueMap point={game} emoji={sport.emoji} />
        <a className="btn btn--ghost btn--sm" href={directionsUrl(game)} target="_blank" rel="noreferrer">
          🧭 Directions
        </a>
      </section>
      {!closed && <h2 className="public-game__cta">Sign in or create an account to join this game</h2>}
      <Login embedded />
    </div>
  );
}
