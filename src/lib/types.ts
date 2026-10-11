export type Skill = 'any' | 'beginner' | 'intermediate' | 'advanced';
export type RsvpStatus = 'going' | 'maybe' | 'waitlist' | 'declined' | 'removed';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  sports: string[];
  skill_level: Skill;
  onboarded: boolean;
}

export interface UserSettings {
  user_id: string;
  home_lat: number | null;
  home_lng: number | null;
  notify_radius_miles: number;
  notifications_enabled: boolean;
  timezone: string;
  quiet_start: number | null;
  quiet_end: number | null;
  max_pings_per_day: number;
}

/** Row of the game_details view / nearby_games() RPC. */
export interface Game {
  id: string;
  host_id: string;
  host_name: string;
  sport: string;
  title: string;
  description: string | null;
  venue_name: string;
  venue_address: string | null;
  lat: number;
  lng: number;
  starts_at: string;
  duration_minutes: number;
  min_players: number;
  max_players: number;
  skill_level: Skill;
  ping_radius_miles: number;
  status: 'open' | 'cancelled';
  created_at: string;
  going_count: number;
  waitlist_count: number;
  checkin_radius_m: number;
}

export interface Rsvp {
  game_id: string;
  user_id: string;
  status: RsvpStatus;
  checked_in_at: string | null;
  created_at: string;
  updated_at: string;
  profiles: { display_name: string; skill_level: Skill } | null;
}

export interface Message {
  id: number;
  game_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface AppNotification {
  id: number;
  user_id: string;
  game_id: string | null;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Position extends LatLng {
  /** GPS accuracy radius in metres. */
  accuracy?: number;
}
