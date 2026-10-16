import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SPORTS } from '../lib/sports';

const HOW_IT_WORKS = [
  {
    emoji: '📍',
    title: 'Host a game at a venue',
    text: 'Pick the sport, a park, court or field, the time, and how many players you need. LFG suggests sensible player counts for each sport.',
  },
  {
    emoji: '📣',
    title: 'Nearby players get pinged',
    text: 'Everyone who plays that sport and lives within your ping radius (5 to 50 miles) gets a notification, and the host sees how many were reached.',
  },
  {
    emoji: '🙋',
    title: 'Players RSVP',
    text: "Going, maybe, or can't go. When the game is full, new players join a waitlist and move up automatically if someone drops out.",
  },
  {
    emoji: '✅',
    title: 'Show up and check in',
    text: 'From 30 minutes before kickoff, players check in on site with their phone’s location, so everyone can see who has actually arrived.',
  },
];

const FEATURES = [
  {
    title: 'For players',
    items: [
      'A list and map of games near you, filtered by sport and distance',
      'Reminders an hour before games you’ve joined',
      'Game chat with everyone who’s coming',
      'Directions, sharing and add-to-calendar for every game',
    ],
  },
  {
    title: 'For hosts',
    items: [
      'Players pinged the moment you post a game',
      'An automatic waitlist, so spots refill on their own',
      'A heads-up when your game reaches its minimum, fills up, or is still short a few hours before',
      'Edit or cancel any time — players are told about cancellations and changes to the time or place',
    ],
  },
  {
    title: 'Safety & privacy',
    items: [
      'Your home area is only used to find games near you — other players never see it',
      'Report or block anyone; blocked players can’t join your games or see your messages',
      'Hosts can remove players from their games',
      'Daily ping limits and quiet hours, so notifications never get out of hand',
    ],
  },
];

const FAQ = [
  {
    q: 'What does LFG stand for?',
    a: 'Looking for game — the shout everyone knows from courts, fields and group chats when you need more players.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. Creating an account, hosting games and joining games are all free.',
  },
  {
    q: 'Which sports can I play?',
    a: `${SPORTS.filter((s) => s.id !== 'other').map((s) => s.label).join(', ')} — plus anything else under “Other”.`,
  },
  {
    q: 'Who can see where I live?',
    a: 'Nobody. The home area you set is private and only used to work out which nearby games to ping you about. You can pick a nearby park or intersection instead of your exact address. A game’s venue is shown to players, since that’s where you meet.',
  },
  {
    q: 'How do I stop getting too many notifications?',
    a: 'In your profile you can choose which sports you play, how far away games can be, a daily limit on pings, and quiet hours when new-game pings and chat go to your inbox without buzzing your phone.',
  },
  {
    q: 'What happens when a game is full?',
    a: 'You join the waitlist. If someone who’s going drops out, the first person waiting is moved in automatically and notified.',
  },
  {
    q: 'What is check-in for?',
    a: 'It lets everyone see who has actually arrived. Check-in opens 30 minutes before the game and only works within the venue’s check-in area, which the host sets to fit a single court, a sports complex or a big park.',
  },
  {
    q: 'Where can I use LFG?',
    a: 'On the web from any browser, and as an app on Android and iPhone. One account works everywhere, and games, RSVPs and chat stay in sync between devices. Notifications arrive in the app’s inbox, as browser notifications, and on phones where enabled.',
  },
  {
    q: 'Someone was rude or didn’t show up. What can I do?',
    a: 'Tap ⋯ next to their name in the roster or chat to report or block them. Reports are reviewed, and blocking takes effect immediately.',
  },
];

/**
 * "What is LFG?" — public explainer page. Rendered standalone for signed-out
 * visitors (with its own header) and inside the app layout when signed in.
 */
export function About({ standalone = false }: { standalone?: boolean }) {
  useEffect(() => {
    const prev = document.title;
    document.title = 'About LFG — Looking for game';
    return () => {
      document.title = prev;
    };
  }, []);

  const body = (
    <article className="about">
      <header className="about__hero">
        <p className="landing__sports" aria-hidden>
          {SPORTS.slice(0, 8).map((s) => s.emoji).join(' ')}
        </p>
        <h1>What is LFG?</h1>
        <p className="about__lead">
          <strong>LFG — Looking for game</strong> — is a free app for pickup sports. Want to play soccer but don’t
          have enough people? Host a game at a local park or court, and everyone nearby who plays gets pinged to come
          join. Or open the app and find a game that’s already starting near you.
        </p>
      </header>

      <section aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="about__steps">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title} className="card">
              <span className="about__step-num" aria-hidden>
                {s.emoji}
              </span>
              <div>
                <h3>
                  {i + 1}. {s.title}
                </h3>
                <p className="muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="features">
        <h2 id="features">What you get</h2>
        <div className="about__features">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <h3>{f.title}</h3>
              <ul>
                {f.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="faq">
        <h2 id="faq">Questions</h2>
        <div className="about__faq">
          {FAQ.map((f) => (
            <details key={f.q} className="card">
              <summary>{f.q}</summary>
              <p className="muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card about__cta">
        <h2>Ready to play?</h2>
        {standalone ? (
          <>
            <p className="muted">Create a free account and see what’s happening near you.</p>
            <Link to="/" className="btn btn--primary">
              Get started — it’s free
            </Link>
          </>
        ) : (
          <div className="landing__ctas">
            <Link to="/" className="btn btn--primary">
              Find a game
            </Link>
            <Link to="/host" className="btn btn--outline">
              Host a game
            </Link>
          </div>
        )}
      </section>
    </article>
  );

  if (!standalone) return body;

  return (
    <div className="landing">
      <header className="landing__nav">
        <Link to="/" className="brand">
          <img src="/logo.svg" alt="" width={28} height={28} />
          LFG
        </Link>
        <Link to="/login" className="btn btn--outline btn--sm">
          Sign in
        </Link>
      </header>
      {body}
      <footer className="landing__footer muted small">LFG · Looking for game</footer>
    </div>
  );
}
