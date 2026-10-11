import { useNavigate } from 'react-router-dom';
import { dispatchPush, supabase } from '../lib/supabase';
import { DEFAULT_CENTER, useOrigin } from '../lib/useOrigin';
import { GameForm, type GameFormValues } from '../components/GameForm';

export function HostGame() {
  const navigate = useNavigate();
  const { origin } = useOrigin();

  async function create(v: GameFormValues) {
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
    });
    if (error) throw error;
    const { id, pinged } = data as { id: string; pinged: number };
    dispatchPush();
    navigate(`/games/${id}`, { replace: true, state: { justCreated: true, pinged } });
  }

  return (
    <div className="stack">
      <h1>Host a game</h1>
      <p className="muted">Players nearby who play this sport will get a ping.</p>
      <GameForm mode="create" fallbackCenter={origin ?? DEFAULT_CENTER} submitLabel="Create game & ping players" onSubmit={create} />
    </div>
  );
}
