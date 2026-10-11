import { useState } from 'react';
import { Login } from './Login';
import { SPORTS } from '../lib/sports';

const ANDROID_URL = import.meta.env.VITE_ANDROID_URL;
const IOS_URL = import.meta.env.VITE_IOS_URL;

const STEPS = [
  { emoji: '📍', title: 'Host at a venue', text: 'Pick a park, court or field, set the time and how many players you need.' },
  { emoji: '📣', title: 'Nearby players get pinged', text: 'Everyone within your radius who plays that sport gets a notification.' },
  { emoji: '✅', title: 'RSVP, show up, check in', text: 'Spots fill automatically, the waitlist moves up, and players check in on site.' },
];

/** Public home page of the website (signed-out visitors). */
export function Landing() {
  const [showLogin, setShowLogin] = useState(false);

  if (showLogin) {
    return (
      <div className="landing">
        <button className="link landing__back" onClick={() => setShowLogin(false)}>
          ← Back
        </button>
        <Login />
      </div>
    );
  }

  return (
    <div className="landing">
      <header className="landing__nav">
        <span className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          Pickup
        </span>
        <button className="btn btn--outline btn--sm" onClick={() => setShowLogin(true)}>
          Sign in
        </button>
      </header>

      <section className="landing__hero">
        <p className="landing__sports" aria-hidden>
          {SPORTS.slice(0, 8).map((s) => s.emoji).join(' ')}
        </p>
        <h1>Never be short a player again.</h1>
        <p className="landing__lead">
          Host a pickup game at a local park or court and everyone nearby who plays gets pinged. Or find a game
          starting near you in minutes.
        </p>
        <div className="landing__ctas">
          <button className="btn btn--primary" onClick={() => setShowLogin(true)}>
            Find a game — it's free
          </button>
        </div>
      </section>

      <section className="landing__steps">
        {STEPS.map((s) => (
          <div key={s.title} className="card landing__step">
            <span className="landing__step-emoji" aria-hidden>
              {s.emoji}
            </span>
            <h2>{s.title}</h2>
            <p className="muted">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="card landing__apps">
        <h2>Play on any device</h2>
        <p className="muted">
          One account works on the web, Android and iPhone — games, RSVPs and chat stay in sync everywhere.
        </p>
        <div className="landing__store">
          <AppButton href={ANDROID_URL} label="Get it for Android" icon="🤖" />
          <AppButton href={IOS_URL} label="Get it for iPhone" icon="📱" />
          <button className="btn btn--outline" onClick={() => setShowLogin(true)}>
            🌐 Use it on the web
          </button>
        </div>
      </section>

      <footer className="landing__footer muted small">Pickup · Find your next game</footer>
    </div>
  );
}

function AppButton({ href, label, icon }: { href?: string; label: string; icon: string }) {
  if (!href) {
    return (
      <span className="btn btn--outline landing__soon" aria-disabled>
        {icon} {label} <span className="pill">Coming soon</span>
      </span>
    );
  }
  return (
    <a className="btn btn--primary" href={href} target="_blank" rel="noreferrer">
      {icon} {label}
    </a>
  );
}
