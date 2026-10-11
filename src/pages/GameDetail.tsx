import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { dispatchPush, errorMessage, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Game, Message, Rsvp, RsvpStatus } from '../lib/types';
import { skillLabel, sportInfo } from '../lib/sports';
import { buildIcs, formatTimeRange, gamePhase, googleCalendarUrl, timeAgo } from '../lib/format';
import { isNative, openExternal, shareLink, siteUrl } from '../lib/native';
import { directionsUrl, getCurrentPosition } from '../lib/geo';
import { VenueMap } from '../components/maps';
import { PlayerActions, type PlayerTarget } from '../components/PlayerActions';
import { useBlocks } from '../lib/safety';

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function GameDetail() {
  const { id } = useParams<{ id: string }>();
  const gameId = id!;
  const location = useLocation();
  const { session } = useAuth();
  const me = session!.user.id;
  const now = useNow();

  const [game, setGame] = useState<Game | null | undefined>(undefined);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const st = location.state as { justCreated?: boolean; pinged?: number } | null;
    if (!st?.justCreated) return null;
    if (!st.pinged) return 'Game created 🎉 Nobody nearby has signed up for this sport yet — share the link to get players.';
    return `Game created 🎉 We pinged ${st.pinged} player${st.pinged === 1 ? '' : 's'} nearby.`;
  });
  const [actionsFor, setActionsFor] = useState<PlayerTarget | null>(null);
  const { isBlocked, block, unblock } = useBlocks(me);

  const loadGame = useCallback(async () => {
    const { data } = await supabase.from('game_details').select('*').eq('id', gameId).maybeSingle();
    setGame((data as Game) ?? null);
  }, [gameId]);

  const loadRsvps = useCallback(async () => {
    const { data } = await supabase
      .from('rsvps')
      .select('*, profiles(display_name, skill_level)')
      .eq('game_id', gameId)
      .order('updated_at');
    setRsvps((data as Rsvp[]) ?? []);
  }, [gameId]);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(200);
    setMessages(((data as Message[]) ?? []).reverse());
  }, [gameId]);

  useEffect(() => {
    void loadGame();
    void loadRsvps();
    const channel = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps', filter: `game_id=eq.${gameId}` }, () => {
        void loadRsvps();
        void loadGame();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => void loadGame())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${gameId}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, loadGame, loadRsvps]);

  const myRsvp = rsvps.find((r) => r.user_id === me);
  const isHost = game?.host_id === me;
  const isParticipant = isHost || (myRsvp != null && myRsvp.status !== 'declined');

  useEffect(() => {
    if (isParticipant) void loadMessages();
  }, [isParticipant, loadMessages]);

  // Seeing the chat counts as reading its notifications, so the next message pings again.
  useEffect(() => {
    if (!isParticipant) return;
    void supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', me)
      .eq('game_id', gameId)
      .eq('kind', 'chat')
      .is('read_at', null);
  }, [isParticipant, messages.length, me, gameId]);

  const groups = useMemo(() => {
    const by = (s: RsvpStatus) => rsvps.filter((r) => r.status === s);
    return { going: by('going'), maybe: by('maybe'), waitlist: by('waitlist') };
  }, [rsvps]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rsvps) m.set(r.user_id, r.profiles?.display_name ?? 'Player');
    if (game) m.set(game.host_id, game.host_name);
    return m;
  }, [rsvps, game]);

  if (game === undefined) return <p className="muted">Loading…</p>;
  if (game === null)
    return (
      <div className="card empty">
        <p>This game doesn't exist or was removed.</p>
        <Link to="/">Back to games</Link>
      </div>
    );

  const sport = sportInfo(game.sport);
  const phase = gamePhase(game.starts_at, game.duration_minutes, now);
  const cancelled = game.status === 'cancelled';
  const finished = phase === 'finished';
  const spotsLeft = game.max_players - game.going_count;
  const waitPos = myRsvp?.status === 'waitlist' ? groups.waitlist.findIndex((r) => r.user_id === me) + 1 : 0;
  const removed = myRsvp?.status === 'removed';
  const canCheckIn = !cancelled && myRsvp?.status === 'going' && !myRsvp.checked_in_at && (phase === 'checkin' || phase === 'live');
  const shareUrl = siteUrl(`/games/${game.id}`);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const rsvp = (status: 'going' | 'maybe' | 'declined') =>
    run(status, async () => {
      const { data, error } = await supabase.rpc('set_rsvp', { p_game_id: game.id, p_status: status });
      if (error) throw error;
      dispatchPush();
      await Promise.all([loadRsvps(), loadGame()]);
      if (data === 'waitlist') return "The game is full — you're on the waitlist. We'll ping you if a spot opens.";
      if (data === 'going') return "You're in! See you there.";
    });

  const checkIn = () =>
    run('checkin', async () => {
      const pos = await getCurrentPosition();
      const { error } = await supabase.rpc('check_in', {
        p_game_id: game.id,
        p_lat: pos.lat,
        p_lng: pos.lng,
        p_accuracy_m: pos.accuracy ?? null,
      });
      if (error) throw error;
      await loadRsvps();
      return 'Checked in ✅ Have a great game!';
    });

  const cancelGame = () => {
    if (!confirm('Cancel this game? Everyone who RSVPed will be notified.')) return;
    void run('cancel', async () => {
      const { error } = await supabase.rpc('cancel_game', { p_game_id: game.id });
      if (error) throw error;
      dispatchPush();
      await loadGame();
      return 'Game cancelled. Players have been notified.';
    });
  };

  const share = async () => {
    const text = `${sport.emoji} ${game.title} — ${formatTimeRange(game.starts_at, game.duration_minutes)} at ${game.venue_name}`;
    if ((await shareLink({ title: game.title, text, url: shareUrl })) === 'copied') setNotice('Link copied to clipboard');
  };

  const removePlayer = async (userId: string) => {
    const { error } = await supabase.rpc('remove_player', { p_game_id: game.id, p_user_id: userId });
    if (error) throw error;
    dispatchPush();
    await Promise.all([loadRsvps(), loadGame()]);
    setNotice('Player removed.');
  };

  const addToCalendar = () => {
    if (isNative) {
      void openExternal(googleCalendarUrl(game, shareUrl));
      return;
    }
    const blob = new Blob([buildIcs(game, shareUrl)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${game.title.replace(/[^\w\- ]+/g, '').trim() || 'game'}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="stack">
      <section className="card game-hero">
        <div className="game-hero__head">
          <span className="game-hero__emoji" aria-hidden>
            {sport.emoji}
          </span>
          <div>
            <p className="muted small">
              {sport.label} · {skillLabel(game.skill_level)} · hosted by {isHost ? 'you' : game.host_name}
            </p>
            <h1>{game.title}</h1>
          </div>
        </div>
        {cancelled && <p className="banner banner--danger">This game was cancelled.</p>}
        {!cancelled && phase === 'live' && <p className="banner banner--live">🟢 Happening now</p>}
        {!cancelled && finished && <p className="banner">This game has finished.</p>}

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
              {game.going_count < game.min_players && <span className="muted"> · needs {game.min_players - game.going_count} more to run</span>}
              {spotsLeft <= 0 && game.waitlist_count > 0 && <span className="muted"> · {game.waitlist_count} on waitlist</span>}
            </dd>
          </div>
        </dl>
        {game.description && <p className="description">{game.description}</p>}

        <VenueMap point={game} emoji={sport.emoji} checkinRadius={game.checkin_radius_m} />

        <div className="actions">
          <a
            className="btn btn--ghost btn--sm"
            href={directionsUrl(game)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!isNative) return;
              e.preventDefault();
              void openExternal(directionsUrl(game));
            }}
          >
            🧭 Directions
          </a>
          <button className="btn btn--ghost btn--sm" onClick={share}>
            🔗 Share
          </button>
          {!cancelled && !finished && (
            <button className="btn btn--ghost btn--sm" onClick={addToCalendar}>
              📅 Calendar
            </button>
          )}
          {isHost && !cancelled && !finished && (
            <>
              <Link className="btn btn--ghost btn--sm" to={`/games/${game.id}/edit`}>
                ✏️ Edit
              </Link>
              <button className="btn btn--ghost btn--sm btn--danger" onClick={cancelGame} disabled={busy !== null}>
                Cancel game
              </button>
            </>
          )}
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {removed && <p className="banner banner--danger">The host removed you from this game.</p>}

      {!cancelled && !finished && !removed && (
        <section className="card">
          {isHost ? (
            <p>
              You're hosting. {canCheckIn ? 'Check in when you arrive.' : 'Share the link to fill spots faster.'}
            </p>
          ) : (
            <>
              <h2>Are you in?</h2>
              {waitPos > 0 && (
                <p className="muted">
                  You're #{waitPos} on the waitlist — you'll be moved in automatically if someone drops.
                </p>
              )}
              <div className="rsvp-buttons">
                <button
                  className={`btn ${myRsvp?.status === 'going' || myRsvp?.status === 'waitlist' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => rsvp('going')}
                  disabled={busy !== null}
                >
                  {myRsvp?.status === 'waitlist' ? '⏳ Waitlisted' : spotsLeft > 0 || myRsvp?.status === 'going' ? "✅ I'm in" : '⏳ Join waitlist'}
                </button>
                <button
                  className={`btn ${myRsvp?.status === 'maybe' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => rsvp('maybe')}
                  disabled={busy !== null}
                >
                  🤔 Maybe
                </button>
                <button
                  className={`btn ${myRsvp?.status === 'declined' ? 'btn--primary' : 'btn--outline'}`}
                  onClick={() => rsvp('declined')}
                  disabled={busy !== null}
                >
                  ✖ Can't go
                </button>
              </div>
            </>
          )}
          {myRsvp?.status === 'going' && (
            <div className="checkin">
              {myRsvp.checked_in_at ? (
                <p className="ok">✅ Checked in {timeAgo(myRsvp.checked_in_at)}</p>
              ) : canCheckIn ? (
                <button className="btn btn--primary btn--block" onClick={checkIn} disabled={busy !== null}>
                  {busy === 'checkin' ? 'Getting your location…' : "📍 Check in — I'm here"}
                </button>
              ) : (
                <p className="muted small">
                  Check-in opens 30 minutes before start, within {game.checkin_radius_m} m of the pin.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>
          Roster <span className="muted">({groups.going.length}/{game.max_players})</span>
        </h2>
        <Roster list={groups.going} hostId={game.host_id} me={me} showCheckIn onActions={setActionsFor} />
        {groups.maybe.length > 0 && (
          <>
            <h3>Maybe</h3>
            <Roster list={groups.maybe} hostId={game.host_id} me={me} onActions={setActionsFor} />
          </>
        )}
        {groups.waitlist.length > 0 && (
          <>
            <h3>Waitlist</h3>
            <Roster list={groups.waitlist} hostId={game.host_id} me={me} numbered onActions={setActionsFor} />
          </>
        )}
      </section>

      <section className="card">
        <h2>Game chat</h2>
        {isParticipant ? (
          <Chat
            gameId={game.id}
            me={me}
            messages={messages}
            names={names}
            disabled={cancelled}
            isBlocked={isBlocked}
            onActions={setActionsFor}
          />
        ) : (
          <p className="muted">RSVP to join the chat.</p>
        )}
      </section>

      <PlayerActions
        target={actionsFor}
        gameId={game.id}
        canRemove={isHost && actionsFor?.messageId === undefined}
        isBlocked={actionsFor ? isBlocked(actionsFor.userId) : false}
        onClose={() => setActionsFor(null)}
        onBlock={block}
        onUnblock={unblock}
        onRemove={removePlayer}
      />
    </div>
  );
}

function Roster({
  list,
  hostId,
  me,
  showCheckIn,
  numbered,
  onActions,
}: {
  list: Rsvp[];
  hostId: string;
  me: string;
  showCheckIn?: boolean;
  numbered?: boolean;
  onActions: (t: PlayerTarget) => void;
}) {
  if (!list.length) return <p className="muted">Nobody yet.</p>;
  return (
    <ul className="roster">
      {list.map((r, i) => {
        const name = r.profiles?.display_name ?? 'Player';
        return (
          <li key={r.user_id}>
            <span className="avatar" aria-hidden>
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="roster__name">
              {numbered && `${i + 1}. `}
              {name}
              {r.user_id === me && <span className="muted"> (you)</span>}
              {r.user_id === hostId && <span className="pill pill--host">Host</span>}
            </span>
            {showCheckIn && r.checked_in_at && (
              <span className="ok small" title={`Checked in ${timeAgo(r.checked_in_at)}`}>
                ✅ here
              </span>
            )}
            {r.user_id !== me && (
              <button
                className="icon-btn icon-btn--sm"
                aria-label={`Options for ${name}`}
                onClick={() => onActions({ userId: r.user_id, name })}
              >
                ⋯
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Chat({
  gameId,
  me,
  messages,
  names,
  disabled,
  isBlocked,
  onActions,
}: {
  gameId: string;
  me: string;
  messages: Message[];
  names: Map<string, string>;
  disabled: boolean;
  isBlocked: (userId: string) => boolean;
  onActions: (t: PlayerTarget) => void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view by scrolling the chat box only — never the page.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    const { error } = await supabase.from('messages').insert({ game_id: gameId, user_id: me, body: text });
    setSending(false);
    if (error) setError(error.message);
    else {
      setBody('');
      dispatchPush();
    }
  }

  return (
    <div className="chat">
      <div className="chat__log" ref={logRef}>
        {messages.length === 0 && <p className="muted">No messages yet. Say hi 👋</p>}
        {messages.map((m) => {
          const mine = m.user_id === me;
          const name = names.get(m.user_id) ?? 'Player';
          if (!mine && isBlocked(m.user_id)) {
            return (
              <p key={m.id} className="chat__hidden">
                Message from a blocked player
              </p>
            );
          }
          return (
            <div key={m.id} className={`chat__msg${mine ? ' chat__msg--me' : ''}`}>
              {!mine && (
                <span className="chat__name">
                  {name}
                  <button
                    className="chat__more"
                    aria-label={`Report or block ${name}`}
                    onClick={() => onActions({ userId: m.user_id, name, messageId: m.id })}
                  >
                    ⋯
                  </button>
                </span>
              )}
              <p>{m.body}</p>
              <span className="chat__time">{timeAgo(m.created_at)}</span>
            </div>
          );
        })}
      </div>
      {!disabled && (
        <form className="chat__form" onSubmit={send}>
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message the group…"
            maxLength={1000}
            aria-label="Message"
          />
          <button className="btn btn--primary" disabled={sending || !body.trim()}>
            Send
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
