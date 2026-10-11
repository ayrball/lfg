// Delivers queued notifications (notifications.pushed_at is null) to every
// device a player uses:
//   • website / PWA      → Web Push (VAPID)                 push_subscriptions
//   • Android app        → Firebase Cloud Messaging (HTTP v1) device_tokens
//   • iOS app            → Apple Push Notification service   device_tokens
//
// The app calls this right after an action that creates notifications, and the
// every-minute pg_cron job calls it as a safety net. It only ever sends rows
// the database itself queued, so it's safe for anyone to trigger.
//
// Secrets (npx supabase secrets set …) — each channel is optional:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT          (website)
//   FCM_SERVICE_ACCOUNT  (the Firebase service-account JSON)      (Android)
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 contents),
//   APNS_BUNDLE_ID (default com.pickupsports.app), APNS_SANDBOX=true for dev builds (iOS)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { importPKCS8, SignJWT } from 'npm:jose@5.9.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const env = (k: string) => Deno.env.get(k) ?? '';

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const webPushReady = Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
if (webPushReady) {
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
}

type Pending = {
  id: number;
  user_id: string;
  game_id: string | null;
  kind: string;
  title: string;
  body: string;
  starts_at: string | null;
};
type WebSub = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string };
type Device = { id: number; user_id: string; token: string; platform: 'android' | 'ios' };
type Result = 'ok' | 'gone' | 'error';

interface Message {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------------------
// Firebase Cloud Messaging (Android)
// ---------------------------------------------------------------------------

const fcmAccount = (() => {
  try {
    const raw = env('FCM_SERVICE_ACCOUNT');
    return raw ? (JSON.parse(raw) as { project_id: string; client_email: string; private_key: string }) : null;
  } catch {
    console.error('FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
})();
let fcmAccess: { token: string; exp: number } | null = null;
let fcmAccessInFlight: Promise<string> | null = null;

/** Cached OAuth token; concurrent sends share one in-flight request. */
function fcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmAccess && fcmAccess.exp - 60 > now) return Promise.resolve(fcmAccess.token);
  fcmAccessInFlight ??= mintFcmAccessToken().finally(() => (fcmAccessInFlight = null));
  return fcmAccessInFlight;
}

async function mintFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(fcmAccount!.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(fcmAccount!.client_email)
    .setSubject(fcmAccount!.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`FCM auth failed: ${data.error ?? res.status}`);
  fcmAccess = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return fcmAccess.token;
}

async function sendFcm(token: string, m: Message): Promise<Result> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmAccount!.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fcmAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: m.title, body: m.body },
        data: { url: m.url },
        android: { priority: 'high', notification: { tag: m.tag, sound: 'default' } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 404 || text.includes('UNREGISTERED') || (res.status === 400 && text.includes('registration token'))) return 'gone';
  console.error('FCM send failed', res.status, text.slice(0, 300));
  return 'error';
}

// ---------------------------------------------------------------------------
// Apple Push Notification service (iOS)
// ---------------------------------------------------------------------------

const apnsReady = Boolean(env('APNS_KEY_ID') && env('APNS_TEAM_ID') && env('APNS_PRIVATE_KEY'));
const apnsHost = env('APNS_SANDBOX') === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
let apnsJwt: { token: string; iat: number } | null = null;
let apnsInFlight: Promise<string> | null = null;

function apnsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt && now - apnsJwt.iat < 50 * 60) return Promise.resolve(apnsJwt.token); // Apple allows reuse for up to an hour
  apnsInFlight ??= signApnsToken().finally(() => (apnsInFlight = null));
  return apnsInFlight;
}

async function signApnsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const pem = env('APNS_PRIVATE_KEY').replace(/\\n/g, '\n');
  const key = await importPKCS8(pem, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env('APNS_KEY_ID') })
    .setIssuer(env('APNS_TEAM_ID'))
    .setIssuedAt(now)
    .sign(key);
  apnsJwt = { token, iat: now };
  return token;
}

async function sendApns(token: string, m: Message): Promise<Result> {
  const res = await fetch(`${apnsHost}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsToken()}`,
      'apns-topic': env('APNS_BUNDLE_ID') || 'com.pickupsports.app',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(m.tag ? { 'apns-collapse-id': m.tag.slice(0, 64) } : {}),
    },
    body: JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default' }, url: m.url }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 410 || text.includes('BadDeviceToken') || text.includes('Unregistered')) return 'gone';
  console.error('APNs send failed', res.status, text.slice(0, 300));
  return 'error';
}

// ---------------------------------------------------------------------------

/** Native notifications are rendered by the OS, so format the start time on the server in the player's timezone. */
function withTime(n: Pending, timeZone: string | undefined): string {
  if (!n.starts_at) return n.body;
  try {
    const when = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: timeZone || 'UTC' })
      .format(new Date(n.starts_at));
    return [when, n.body].filter(Boolean).join(' · ');
  } catch {
    return n.body;
  }
}

function groupBy<T extends { user_id: string }>(rows: T[]) {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
  return m;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { data: pending, error } = await admin.rpc('claim_pending_pushes', { p_limit: 500 });
  if (error) return json({ error: error.message }, 500);
  const rows = (pending ?? []) as Pending[];
  if (rows.length === 0) return json({ sent: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [webRes, devRes, tzRes] = await Promise.all([
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds),
    admin.from('device_tokens').select('id, user_id, token, platform').in('user_id', userIds),
    admin.from('user_settings').select('user_id, timezone').in('user_id', userIds),
  ]);
  if (webRes.error || devRes.error) return json({ error: (webRes.error ?? devRes.error)!.message }, 500);

  const webByUser = groupBy((webRes.data ?? []) as WebSub[]);
  const devByUser = groupBy((devRes.data ?? []) as Device[]);
  const tz = new Map(((tzRes.data ?? []) as { user_id: string; timezone: string }[]).map((r) => [r.user_id, r.timezone]));

  const counts = { web: 0, android: 0, ios: 0, failed: 0 };
  const deadWeb = new Set<number>();
  const deadDevices = new Set<number>();
  const tasks: Promise<void>[] = [];

  for (const n of rows) {
    const url = n.game_id ? `/games/${n.game_id}` : '/notifications';
    const tag = n.game_id ? `game-${n.game_id}-${n.kind}` : undefined;

    if (webPushReady) {
      for (const s of webByUser.get(n.user_id) ?? []) {
        // The service worker formats starts_at in the browser's own timezone.
        const payload = JSON.stringify({ title: n.title, body: n.body, starts_at: n.starts_at, url, tag });
        tasks.push(
          webpush
            .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 })
            .then(() => void counts.web++)
            .catch((e: { statusCode?: number; message?: string }) => {
              if (e.statusCode === 404 || e.statusCode === 410) deadWeb.add(s.id);
              else {
                counts.failed++;
                console.error('web push failed', e.statusCode, e.message);
              }
            }),
        );
      }
    }

    const msg: Message = { title: n.title, body: withTime(n, tz.get(n.user_id)), url, tag };
    for (const d of devByUser.get(n.user_id) ?? []) {
      const send = d.platform === 'android' ? (fcmAccount ? sendFcm : null) : apnsReady ? sendApns : null;
      if (!send) continue;
      tasks.push(
        send(d.token, msg)
          .then((r) => {
            if (r === 'ok') counts[d.platform]++;
            else if (r === 'gone') deadDevices.add(d.id);
            else counts.failed++;
          })
          .catch((e) => {
            counts.failed++;
            console.error(`${d.platform} push failed`, (e as Error).message);
          }),
      );
    }
  }

  await Promise.all(tasks);
  if (deadWeb.size) await admin.from('push_subscriptions').delete().in('id', [...deadWeb]);
  if (deadDevices.size) await admin.from('device_tokens').delete().in('id', [...deadDevices]);
  return json({ ...counts, removed: deadWeb.size + deadDevices.size });
});
