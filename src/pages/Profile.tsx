import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBlocks } from '../lib/safety';
import { RADIUS_OPTIONS, SKILLS } from '../lib/sports';
import type { LatLng, Skill } from '../lib/types';
import { HomePicker, PushToggle, QuietHours, SportsPicker } from '../components/SettingsFields';

const PING_LIMITS = [1, 3, 5, 10, 20];

export function Profile() {
  const { session, profile, settings, refresh } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [sports, setSports] = useState<string[]>(profile?.sports ?? []);
  const [skill, setSkill] = useState<Skill>(profile?.skill_level ?? 'any');
  const [home, setHome] = useState<LatLng | null>(
    settings?.home_lat != null && settings?.home_lng != null ? { lat: settings.home_lat, lng: settings.home_lng } : null,
  );
  const [radius, setRadius] = useState(settings?.notify_radius_miles ?? 10);
  const [notify, setNotify] = useState(settings?.notifications_enabled ?? true);
  const [quiet, setQuiet] = useState<[number | null, number | null]>([settings?.quiet_start ?? null, settings?.quiet_end ?? null]);
  const [maxPings, setMaxPings] = useState(settings?.max_pings_per_day ?? 5);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { blocked, unblock } = useBlocks(session?.user.id);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const uid = session!.user.id;
    const [p, s] = await Promise.all([
      supabase.from('profiles').update({ display_name: name.trim() || 'Player', sports, skill_level: skill }).eq('id', uid),
      supabase
        .from('user_settings')
        .update({
          home_lat: home?.lat ?? null,
          home_lng: home?.lng ?? null,
          notify_radius_miles: radius,
          notifications_enabled: notify,
          quiet_start: quiet[0],
          quiet_end: quiet[1],
          max_pings_per_day: maxPings,
        })
        .eq('user_id', uid),
    ]);
    setSaving(false);
    const err = p.error ?? s.error;
    setMsg(err ? { ok: false, text: err.message } : { ok: true, text: 'Saved ✓' });
    if (!err) await refresh();
  }

  const onError = (text: string) => setMsg({ ok: false, text });

  return (
    <form className="stack form" onSubmit={save}>
      <h1>Your profile</h1>

      <label>
        Display name
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>

      <fieldset>
        <legend>Sports you play</legend>
        <p className="hint">You'll only be pinged for these. Pick none to hear about everything.</p>
        <SportsPicker value={sports} onChange={setSports} />
      </fieldset>

      <label>
        Skill level
        <select value={skill} onChange={(e) => setSkill(e.target.value as Skill)}>
          {SKILLS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === 'any' ? 'Prefer not to say' : s.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Home area</legend>
        <p className="hint">
          Used to ping you about new games nearby. It's private — other players never see it. Pick a nearby
          intersection or park if you'd rather not use your exact address.
        </p>
        {!home && <p className="error">Without a home area you won't be pinged about new games.</p>}
        <HomePicker value={home} onChange={setHome} onError={onError} />
      </fieldset>

      <fieldset>
        <legend>Notifications</legend>
        <label className="toggle">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Ping me about new games near me
        </label>
        {notify && (
          <div className="grid-2">
            <label>
              Within
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} miles
                  </option>
                ))}
              </select>
            </label>
            <label>
              At most
              <select value={maxPings} onChange={(e) => setMaxPings(Number(e.target.value))}>
                {PING_LIMITS.map((n) => (
                  <option key={n} value={n}>
                    {n} ping{n === 1 ? '' : 's'} a day
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <QuietHours start={quiet[0]} end={quiet[1]} onChange={(a, b) => setQuiet([a, b])} />
        <PushToggle onError={onError} />
      </fieldset>

      {msg && <p className={msg.ok ? 'notice' : 'error'}>{msg.text}</p>}
      <button className="btn btn--primary btn--block" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>

      {blocked.length > 0 && (
        <fieldset>
          <legend>Blocked players</legend>
          <ul className="roster">
            {blocked.map((b) => (
              <li key={b.blocked_id}>
                <span className="avatar" aria-hidden>
                  {b.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="roster__name">{b.display_name}</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => unblock(b.blocked_id)}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <hr />
      <p className="muted small">
        Signed in as {session?.user.email} · <Link to="/about">About LFG</Link>
      </p>
      <button type="button" className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </form>
  );
}
