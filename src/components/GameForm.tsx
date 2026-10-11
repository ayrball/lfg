import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Game, LatLng, Skill } from '../lib/types';
import { CHECKIN_AREAS, RADIUS_OPTIONS, SKILLS, SPORTS, sportInfo } from '../lib/sports';
import { toLocalInput } from '../lib/format';
import { getCurrentPosition } from '../lib/geo';
import { MapPicker } from './maps';
import { PlaceSearch } from './PlaceSearch';

export interface GameFormValues {
  sport: string;
  title: string;
  description: string;
  venue_name: string;
  venue_address: string;
  point: LatLng | null;
  starts_at: string; // ISO
  duration_minutes: number;
  min_players: number;
  max_players: number;
  skill_level: Skill;
  ping_radius_miles: number;
  checkin_radius_m: number;
}

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

function defaultStart() {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

type Field = 'venue' | 'venue_name' | 'starts_at' | 'players';

export function GameForm({
  initial,
  mode,
  fallbackCenter,
  submitLabel,
  onSubmit,
}: {
  initial?: Game;
  mode: 'create' | 'edit';
  fallbackCenter: LatLng;
  submitLabel: string;
  onSubmit: (v: GameFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<GameFormValues>(() => {
    const sport = sportInfo(initial?.sport ?? 'soccer');
    return {
      sport: sport.id,
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      venue_name: initial?.venue_name ?? '',
      venue_address: initial?.venue_address ?? '',
      point: initial ? { lat: initial.lat, lng: initial.lng } : null,
      starts_at: initial?.starts_at ?? defaultStart().toISOString(),
      duration_minutes: initial?.duration_minutes ?? sport.duration,
      min_players: initial?.min_players ?? sport.min,
      max_players: initial?.max_players ?? sport.max,
      skill_level: initial?.skill_level ?? 'any',
      ping_radius_miles: initial?.ping_radius_miles ?? 10,
      checkin_radius_m: initial?.checkin_radius_m ?? 300,
    };
  });
  const [touchedSize, setTouchedSize] = useState(mode === 'edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: Field; text: string } | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng>(fallbackCenter);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const venueRef = useRef<HTMLFieldSetElement>(null);

  // The user's location usually arrives after the form mounts — follow it until a venue is picked.
  useEffect(() => {
    if (!v.point) setMapCenter(fallbackCenter);
  }, [fallbackCenter.lat, fallbackCenter.lng]);

  useEffect(() => {
    if (!error) return;
    const target = error.field === 'venue' || error.field === 'venue_name' ? venueRef.current : errorRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const set = <K extends keyof GameFormValues>(k: K, val: GameFormValues[K]) => setV((prev) => ({ ...prev, [k]: val }));
  const sport = sportInfo(v.sport);

  function pickSport(id: string) {
    const s = sportInfo(id);
    setV((prev) =>
      touchedSize
        ? { ...prev, sport: id }
        : { ...prev, sport: id, min_players: s.min, max_players: s.max, duration_minutes: s.duration },
    );
  }

  function validate(): { field: Field; text: string } | null {
    if (!v.point) return { field: 'venue', text: 'Pick the venue — search for it above, or tap the map.' };
    if (!v.venue_name.trim()) return { field: 'venue_name', text: 'Give the venue a name players will recognise.' };
    const start = new Date(v.starts_at).getTime();
    if (Number.isNaN(start)) return { field: 'starts_at', text: 'Pick a start date and time.' };
    if (mode === 'create' && start < Date.now() - 5 * 60_000) return { field: 'starts_at', text: 'The start time must be in the future.' };
    if (!(v.min_players >= 2) || !(v.max_players <= 100)) return { field: 'players', text: 'Players must be between 2 and 100.' };
    if (v.max_players < v.min_players) return { field: 'players', text: 'Max players must be at least the minimum.' };
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await onSubmit({ ...v, title: v.title.trim() || `${sport.label} pickup` });
    } catch (err) {
      setError({ text: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  async function useMyLocation() {
    try {
      const p = await getCurrentPosition();
      setMapCenter(p);
      set('point', { lat: p.lat, lng: p.lng });
    } catch (err) {
      setError({ field: 'venue', text: (err as Error).message });
    }
  }

  const fieldError = (f: Field) => (error?.field === f ? <p className="field-error">{error.text}</p> : null);

  return (
    <form className="form" onSubmit={submit} noValidate>
      {mode === 'create' && (
        <fieldset>
          <legend>Sport</legend>
          <div className="chips">
            {SPORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip${v.sport === s.id ? ' chip--on' : ''}`}
                aria-pressed={v.sport === s.id}
                onClick={() => pickSport(s.id)}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label>
        Title
        <input
          value={v.title}
          maxLength={80}
          placeholder={`${sport.label} pickup`}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>

      <fieldset ref={venueRef} className={error?.field === 'venue' || error?.field === 'venue_name' ? 'has-error' : ''}>
        <legend>Venue</legend>
        <PlaceSearch
          near={mapCenter}
          onSelect={(p) => {
            setV((prev) => ({
              ...prev,
              point: { lat: p.lat, lng: p.lng },
              venue_name: p.name,
              venue_address: p.address,
              // Big areas need a bigger check-in zone.
              checkin_radius_m: p.kind === 'Park' || p.kind === 'Area' ? 750 : prev.checkin_radius_m,
            }));
            setMapCenter(p);
            if (error?.field === 'venue') setError(null);
          }}
        />
        <MapPicker
          value={v.point}
          fallbackCenter={mapCenter}
          onChange={(p) => {
            set('point', p);
            if (error?.field === 'venue') setError(null);
          }}
          emoji={sport.emoji}
          radiusMeters={v.checkin_radius_m}
        />
        {fieldError('venue')}
        <div className="row">
          <p className="hint">Drag the pin onto the exact field or court. The circle is where players can check in.</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={useMyLocation}>
            📍 I'm here
          </button>
        </div>
        <label>
          Venue name
          <input
            value={v.venue_name}
            maxLength={120}
            placeholder="e.g. Riverside Park — Field 3"
            aria-invalid={error?.field === 'venue_name'}
            onChange={(e) => set('venue_name', e.target.value)}
          />
        </label>
        {fieldError('venue_name')}
        <label>
          <span>
            Address <span className="muted">(optional)</span>
          </span>
          <input value={v.venue_address} maxLength={240} onChange={(e) => set('venue_address', e.target.value)} />
        </label>
        <label>
          Check-in area
          <select value={v.checkin_radius_m} onChange={(e) => set('checkin_radius_m', Number(e.target.value))}>
            {CHECKIN_AREAS.map((a) => (
              <option key={a.m} value={a.m}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="grid-2">
        <label>
          Starts
          <input
            type="datetime-local"
            value={toLocalInput(new Date(v.starts_at))}
            min={mode === 'create' ? toLocalInput(new Date()) : undefined}
            aria-invalid={error?.field === 'starts_at'}
            onChange={(e) => e.target.value && set('starts_at', new Date(e.target.value).toISOString())}
          />
        </label>
        <label>
          Length
          <select
            value={v.duration_minutes}
            onChange={(e) => {
              setTouchedSize(true);
              set('duration_minutes', Number(e.target.value));
            }}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${d / 60} hr${d > 60 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min players
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={100}
            value={v.min_players}
            aria-invalid={error?.field === 'players'}
            onChange={(e) => {
              setTouchedSize(true);
              set('min_players', Number(e.target.value));
            }}
          />
        </label>
        <label>
          Max players
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={100}
            value={v.max_players}
            aria-invalid={error?.field === 'players'}
            onChange={(e) => {
              setTouchedSize(true);
              set('max_players', Number(e.target.value));
            }}
          />
        </label>
        <label>
          Skill level
          <select value={v.skill_level} onChange={(e) => set('skill_level', e.target.value as Skill)}>
            {SKILLS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {mode === 'create' && (
          <label>
            Ping players within
            <select value={v.ping_radius_miles} onChange={(e) => set('ping_radius_miles', Number(e.target.value))}>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(error?.field === 'starts_at' || error?.field === 'players') && (
        <p className="error" ref={errorRef}>
          {error.text}
        </p>
      )}

      <label>
        <span>
          Notes <span className="muted">(optional)</span>
        </span>
        <textarea
          rows={3}
          maxLength={1000}
          placeholder="Bring a light and a dark shirt. Ball provided."
          value={v.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>

      {error && !error.field && (
        <p className="error" ref={errorRef}>
          {error.text}
        </p>
      )}
      <button className="btn btn--primary btn--block" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
