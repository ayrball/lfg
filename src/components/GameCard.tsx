import { Link } from 'react-router-dom';
import type { Game, LatLng, RsvpStatus } from '../lib/types';
import { skillLabel, sportInfo } from '../lib/sports';
import { formatGameTime, gamePhase } from '../lib/format';
import { distanceMiles, formatMiles } from '../lib/geo';

const STATUS_LABEL: Record<RsvpStatus, string> = {
  going: "You're going",
  maybe: 'Maybe',
  waitlist: 'Waitlisted',
  declined: "Can't go",
  removed: 'Removed',
};

export function GameCard({
  game,
  from,
  myStatus,
  past = false,
}: {
  game: Game;
  from?: LatLng | null;
  myStatus?: RsvpStatus;
  past?: boolean;
}) {
  const sport = sportInfo(game.sport);
  const spotsLeft = game.max_players - game.going_count;
  const phase = gamePhase(game.starts_at, game.duration_minutes);
  return (
    <Link to={`/games/${game.id}`} className="card game-card">
      <div className="game-card__emoji" aria-hidden>
        {sport.emoji}
      </div>
      <div className="game-card__body">
        <div className="game-card__top">
          <h3>{game.title}</h3>
          {!past && myStatus && myStatus !== 'declined' && myStatus !== 'removed' && (
            <span className={`pill pill--${myStatus}`}>{STATUS_LABEL[myStatus]}</span>
          )}
          {past && game.status === 'cancelled' && <span className="pill">Cancelled</span>}
        </div>
        <p className="game-card__time">
          {phase === 'live' && !past ? <span className="live-dot">Live now</span> : formatGameTime(game.starts_at)}
        </p>
        <p className="muted">
          {game.venue_name}
          {from && ` · ${formatMiles(distanceMiles(from, game))}`}
        </p>
        <div className="game-card__meta">
          <span>
            👥 {game.going_count}/{game.max_players}
          </span>
          {!past && (
            <span className={spotsLeft > 0 ? 'ok' : 'warn'}>
              {spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left` : `Full · ${game.waitlist_count} waiting`}
            </span>
          )}
          <span>{skillLabel(game.skill_level)}</span>
        </div>
      </div>
    </Link>
  );
}
