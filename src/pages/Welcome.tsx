import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { RADIUS_OPTIONS } from '../lib/sports';
import type { LatLng } from '../lib/types';
import { HomePicker, PushToggle, SportsPicker } from '../components/SettingsFields';

/** First-run setup: sports, home area and notifications — without these, nobody gets pinged. */
export function Welcome() {
  const { session, profile, settings, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [sports, setSports] = useState<string[]>(profile?.sports ?? []);
  const [home, setHome] = useState<LatLng | null>(
    settings?.home_lat != null && settings?.home_lng != null ? { lat: settings.home_lat, lng: settings.home_lng } : null,
  );
  const [radius, setRadius] = useState(settings?.notify_radius_miles ?? 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const uid = session!.user.id;
    const [p, s] = await Promise.all([
      supabase.from('profiles').update({ display_name: name.trim() || 'Player', sports, onboarded: true }).eq('id', uid),
      supabase
        .from('user_settings')
        .update({ home_lat: home?.lat ?? null, home_lng: home?.lng ?? null, notify_radius_miles: radius })
        .eq('user_id', uid),
    ]);
    const err = p.error ?? s.error;
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    await refresh();
  }

  const steps = ['Sports', 'Home area', 'Notifications'];

  return (
    <div className="welcome">
      <ol className="steps" aria-label="Setup progress">
        {steps.map((label, i) => (
          <li key={label} className={i === step ? 'steps__on' : i < step ? 'steps__done' : ''}>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="stack form">
          <h1>Welcome to LFG 👋</h1>
          <p className="muted">Tell us what you play and we'll ping you when a game starts nearby.</p>
          <label>
            Your name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          </label>
          <fieldset>
            <legend>What do you play?</legend>
            <SportsPicker value={sports} onChange={setSports} />
            <p className="hint">{sports.length ? `${sports.length} selected` : "Pick none and we'll tell you about every sport."}</p>
          </fieldset>
          <button className="btn btn--primary btn--block" onClick={() => setStep(1)}>
            Next
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="stack form">
          <h1>Where do you play?</h1>
          <p className="muted">
            We use this to find games near you. It's private — other players never see it. A nearby park or intersection
            works fine.
          </p>
          <HomePicker value={home} onChange={setHome} onError={setError} />
          <label>
            Ping me about games within
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn--ghost" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn btn--primary" onClick={() => setStep(2)} disabled={!home}>
              Next
            </button>
          </div>
          {!home && (
            <button className="link small" onClick={() => setStep(2)}>
              Skip — I'll just browse games for now
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="stack form">
          <h1>Get pinged when games pop up</h1>
          <p className="muted">
            Turn on notifications so you hear about new games nearby, waitlist spots opening up and changes to games
            you've joined. You can set quiet hours and a daily limit later in your profile.
          </p>
          <PushToggle onError={setError} />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="btn btn--ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn btn--primary" onClick={finish} disabled={busy}>
              {busy ? 'Saving…' : 'Find games'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
