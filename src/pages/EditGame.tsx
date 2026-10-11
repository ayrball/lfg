import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { dispatchPush, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Game } from '../lib/types';
import { GameForm, type GameFormValues } from '../components/GameForm';

export function EditGame() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [game, setGame] = useState<Game | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from('game_details')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data }) => setGame(data as Game | null));
  }, [id]);

  async function save(v: GameFormValues) {
    const { error } = await supabase.rpc('update_game', {
      p_game_id: id,
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
      p_checkin_radius_m: v.checkin_radius_m,
    });
    if (error) throw error;
    dispatchPush();
    navigate(`/games/${id}`, { replace: true });
  }

  if (game === undefined) return <p className="muted">Loading…</p>;
  if (!game || game.host_id !== session?.user.id) {
    return (
      <div className="card empty">
        <p>You can only edit games you host.</p>
        <Link to={`/games/${id}`}>Back to game</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Edit game</h1>
      <GameForm mode="edit" initial={game} fallbackCenter={game} submitLabel="Save changes" onSubmit={save} />
    </div>
  );
}
