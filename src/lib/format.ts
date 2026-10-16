const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today · 6:30 PM", "Tomorrow · 9:00 AM", "Sat, Oct 12 · 5:00 PM" */
export function formatGameTime(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : dayDate.format(d);
  return `${day} · ${time.format(d)}`;
}

export function formatTimeRange(iso: string, minutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${formatGameTime(iso)} – ${time.format(end)}`;
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Value for <input type="datetime-local"> in the user's timezone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type GamePhase = 'upcoming' | 'checkin' | 'live' | 'finished';

export function gamePhase(startsAt: string, durationMinutes: number, now = Date.now()): GamePhase {
  const start = new Date(startsAt).getTime();
  const end = start + durationMinutes * 60_000;
  if (now > end) return 'finished';
  if (now >= start) return 'live';
  if (now >= start - 30 * 60_000) return 'checkin';
  return 'upcoming';
}

/** Google Calendar "add event" link (used in the apps, where file downloads don't work). */
export function googleCalendarUrl(g: { title: string; venue_name: string; venue_address: string | null; starts_at: string; duration_minutes: number; description: string | null }, url: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(g.starts_at);
  const end = new Date(start.getTime() + g.duration_minutes * 60_000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: g.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: [g.venue_name, g.venue_address].filter(Boolean).join(', '),
    details: [g.description ?? '', url].filter(Boolean).join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Build an .ics calendar file for a game. */
export function buildIcs(g: { id: string; title: string; venue_name: string; venue_address: string | null; starts_at: string; duration_minutes: number; description: string | null }, url: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const start = new Date(g.starts_at);
  const end = new Date(start.getTime() + g.duration_minutes * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LFG//EN',
    'BEGIN:VEVENT',
    `UID:${g.id}@lfg`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(g.title)}`,
    `LOCATION:${esc([g.venue_name, g.venue_address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${esc([g.description ?? '', url].filter(Boolean).join('\n'))}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
