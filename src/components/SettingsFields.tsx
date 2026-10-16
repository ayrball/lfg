import { useEffect, useState } from 'react';
import { SPORTS } from '../lib/sports';
import { getCurrentPosition } from '../lib/geo';
import { disablePush, enablePush, getPushState, isIos, isStandalone, type PushState } from '../lib/push';
import { DEFAULT_CENTER } from '../lib/useOrigin';
import { isNative } from '../lib/native';
import type { LatLng } from '../lib/types';
import { MapPicker } from './maps';
import { PlaceSearch } from './PlaceSearch';

export function SportsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="chips">
      {SPORTS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`chip${value.includes(s.id) ? ' chip--on' : ''}`}
          onClick={() => toggle(s.id)}
          aria-pressed={value.includes(s.id)}
        >
          {s.emoji} {s.label}
        </button>
      ))}
    </div>
  );
}

export function HomePicker({
  value,
  onChange,
  onError,
}: {
  value: LatLng | null;
  onChange: (v: LatLng | null) => void;
  onError: (msg: string) => void;
}) {
  const [locating, setLocating] = useState(false);
  return (
    <>
      <PlaceSearch near={value ?? undefined} onSelect={(p) => onChange({ lat: p.lat, lng: p.lng })} />
      <MapPicker value={value} fallbackCenter={value ?? DEFAULT_CENTER} onChange={onChange} emoji="🏠" />
      <div className="row">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={locating}
          onClick={async () => {
            setLocating(true);
            try {
              const p = await getCurrentPosition();
              onChange({ lat: p.lat, lng: p.lng });
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setLocating(false);
            }
          }}
        >
          {locating ? 'Locating…' : '📍 Use my current location'}
        </button>
        {value && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </>
  );
}

/** Turn Web Push on/off for this device, with platform-specific guidance. */
export function PushToggle({ onError }: { onError: (msg: string) => void }) {
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then(setPush);
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      setPush(push === 'on' ? await disablePush() : await enablePush());
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-box">
      {push === 'unsupported' &&
        (isIos() && !isStandalone() ? (
          <p className="hint">
            On iPhone, tap <strong>Share → Add to Home Screen</strong>, then open LFG from your home screen to turn on
            push notifications.
          </p>
        ) : (
          <p className="hint">This browser doesn't support push notifications. You'll still see them in the 🔔 inbox.</p>
        ))}
      {push === 'not-configured' && (
        <p className="hint">
          {isNative
            ? "Push notifications for the app aren't set up yet — you'll still see everything in the 🔔 inbox."
            : "Push isn't configured on this server yet (missing VAPID key)."}
        </p>
      )}
      {push === 'denied' && (
        <p className="hint">
          {isNative
            ? 'Notifications are turned off for LFG. Turn them on in your phone settings.'
            : "Notifications are blocked for this site. Allow them in your browser's site settings."}
        </p>
      )}
      {(push === 'on' || push === 'off') && (
        <button type="button" className={`btn btn--sm ${push === 'on' ? 'btn--outline' : 'btn--primary'}`} onClick={toggle} disabled={busy}>
          {push === 'on' ? '🔕 Turn off push on this device' : '🔔 Turn on push notifications'}
        </button>
      )}
      {push === 'on' && <p className="ok small">✓ Push is on for this device</p>}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

export function QuietHours({
  start,
  end,
  onChange,
}: {
  start: number | null;
  end: number | null;
  onChange: (start: number | null, end: number | null) => void;
}) {
  const on = start !== null && end !== null;
  return (
    <div className="stack stack--tight">
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => (e.target.checked ? onChange(22, 8) : onChange(null, null))} />
        Quiet hours — no push for new-game pings and chat
      </label>
      {on && (
        <div className="grid-2">
          <label>
            From
            <select value={start!} onChange={(e) => onChange(Number(e.target.value), end)}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Until
            <select value={end!} onChange={(e) => onChange(start, Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
