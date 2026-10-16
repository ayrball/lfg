import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dispatchPush, supabase } from '../lib/supabase';
import { DEFAULT_CENTER, useOrigin } from '../lib/useOrigin';
import { formatGameTime } from '../lib/format';
import type { Game } from '../lib/types';
import { GameForm, type GameFormValues } from '../components/GameForm';

interface Duplicate {
  values: GameFormValues;
  existing: Pick<Game, 'id' | 'title' | 'venue_name' | 'starts_at'> | null;
  existingId: string;
}

export function HostGame() {
  const navigate = useNavigate();
  const { origin } = useOrigin();
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);

  async function create(v: GameFormValues, allowDuplicate = false) {
    const { data, error } = await supabase.rpc('create_game', {
      p_sport: v.sport,
      p_title: v.title,
      p_description: v.description,
      p_venue_name: v.venue_name,
      p_venue_address: v.venue_address,
      p_lat: v.point!.lat,
      p_lng: v.point!.lng,
      p_starts_at: v.starts_at,
      p_duration_minutes: v.duration_minutes,
      p_min_players: v.min_players,
      p_max_players: v.max_players,
      p_skill_level: v.skill_level,
      p_ping_radius_miles: v.ping_radius_miles,
      p_checkin_radius_m: v.checkin_radius_m,
      p_allow_duplicate: allowDuplicate,
    });

    // The server spotted a game you already host here at about this time — ask first.
    if (error?.message === 'duplicate_game' && error.details) {
      const { data: existing } = await supabase
        .from('game_details')
        .select('id, title, venue_name, starts_at')
        .eq('id', error.details)
        .maybeSingle();
      setDuplicate({ values: v, existing: existing as Duplicate['existing'], existingId: error.details });
      return;
    }
    if (error) throw error;

    const { id, pinged } = data as { id: string; pinged: number };
    dispatchPush();
    navigate(`/games/${id}`, { replace: true, state: { justCreated: true, pinged } });
  }

  return (
    <div className="stack">
      <h1>Host a game</h1>
      <p className="muted">Players nearby who play this sport will get a ping.</p>
      <GameForm
        mode="create"
        fallbackCenter={origin ?? DEFAULT_CENTER}
        submitLabel="Create game & ping players"
        onSubmit={(v) => create(v)}
      />
      <DuplicateDialog
        duplicate={duplicate}
        onClose={() => setDuplicate(null)}
        onOpenExisting={(id) => navigate(`/games/${id}`)}
        onCreateAnyway={async (v) => {
          await create(v, true);
          setDuplicate(null);
        }}
      />
    </div>
  );
}

function DuplicateDialog({
  duplicate,
  onClose,
  onOpenExisting,
  onCreateAnyway,
}: {
  duplicate: Duplicate | null;
  onClose: () => void;
  onOpenExisting: (id: string) => void;
  onCreateAnyway: (v: GameFormValues) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (duplicate && !d.open) {
      setError(null);
      d.showModal();
    }
    if (!duplicate && d.open) d.close();
  }, [duplicate]);

  const existing = duplicate?.existing;

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {duplicate && (
        <div className="sheet__body">
          <h2>You're already hosting this game</h2>
          <p className="muted">
            {existing
              ? `"${existing.title}" at ${existing.venue_name} · ${formatGameTime(existing.starts_at)}`
              : 'You already host a game at this place around this time.'}
          </p>
          <p className="hint">Hosting it twice would ping nearby players twice and split the RSVPs.</p>
          <button className="btn btn--primary" onClick={() => onOpenExisting(duplicate.existingId)} disabled={busy}>
            Open that game
          </button>
          <button
            className="btn btn--outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onCreateAnyway(duplicate.values);
              } catch (e) {
                setError((e as { message?: string })?.message ?? String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Creating…' : 'Create another anyway'}
          </button>
          {error && <p className="error">{error}</p>}
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Go back and edit
          </button>
        </div>
      )}
    </dialog>
  );
}
