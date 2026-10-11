import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  // PKCE works the same on the website and inside the Android/iOS apps.
  auth: { flowType: 'pkce' },
});

/** Fire-and-forget: deliver any queued notifications as Web Push. */
export function dispatchPush() {
  supabase.functions.invoke('dispatch-push').catch(() => {
    // Push is best-effort; the in-app inbox still has the notification.
  });
}

/** Turn a Supabase/PostgREST error into a readable message. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
