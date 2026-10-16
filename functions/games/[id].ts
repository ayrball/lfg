// Cloudflare Pages Function: serves the app for /games/:id with link-preview
// tags (title, time, spots left) so shared links unfurl nicely in WhatsApp,
// iMessage, Slack, etc. Any failure falls back to the plain app shell.
//
// Uses the same VITE_SUPABASE_URL / VITE_SUPABASE_KEY environment variables
// as the build — set them for both "Production" and "Preview" in Cloudflare.

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_KEY?: string;
  ASSETS: { fetch: (input: Request | string | URL) => Promise<Response> };
}

interface Context {
  request: Request & { cf?: { timezone?: string } };
  env: Env;
  params: { id?: string | string[] };
}

interface PublicGame {
  title: string;
  sport: string;
  venue_name: string;
  starts_at: string;
  going_count: number;
  max_players: number;
  status: string;
}

const EMOJI: Record<string, string> = {
  soccer: '⚽', basketball: '🏀', volleyball: '🏐', tennis: '🎾', pickleball: '🏓', football: '🏈',
  baseball: '⚾', ultimate: '🥏', cricket: '🏏', hockey: '🏒', badminton: '🏸', running: '🏃',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function describeGame(g: PublicGame, timeZone = 'UTC'): { title: string; description: string } {
  let when: string;
  try {
    when = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(g.starts_at));
  } catch {
    when = new Date(g.starts_at).toUTCString();
  }
  const spots = g.max_players - g.going_count;
  const status =
    g.status === 'cancelled' ? 'Cancelled' : spots > 0 ? `${spots} spot${spots === 1 ? '' : 's'} left` : 'Full — join the waitlist';
  return {
    title: `${EMOJI[g.sport] ?? '🏅'} ${g.title} · ${when}`,
    description: `${g.venue_name} · ${g.going_count}/${g.max_players} going · ${status}. Join on LFG.`,
  };
}

export function injectMeta(html: string, meta: { title: string; description: string; url: string; image: string }): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="LFG" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="description" content="${d}" />`,
  ].join('\n    ');
  return html
    .replace(/<meta (property="og:[^"]+"|name="(twitter:card|description)")[^>]*>\s*/g, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace('</head>', `    ${tags}\n  </head>`);
}

export async function onRequestGet({ request, env, params }: Context): Promise<Response> {
  const shell = await env.ASSETS.fetch(new URL('/', request.url));
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_KEY) return shell;

  try {
    const key = env.VITE_SUPABASE_KEY;
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy JWT anon key
    const res = await fetch(`${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/get_public_game`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_id: id }),
    });
    const game = ((await res.json()) as PublicGame[])[0];
    if (!res.ok || !game) return shell;

    const origin = new URL(request.url).origin;
    const html = injectMeta(await shell.text(), {
      ...describeGame(game, request.cf?.timezone),
      url: `${origin}/games/${id}`,
      image: `${origin}/pwa-512x512.png`,
    });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return shell;
  }
}
