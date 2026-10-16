// Bridges between the shared React app and the Android / iOS shells (Capacitor).
// On the website every helper here falls back to the normal browser behaviour.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { supabase } from './supabase';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'web' | 'android' | 'ios';

/** Custom URL scheme the apps register; used to return from Google sign-in. */
export const APP_SCHEME = 'com.ayrball.lfg';
export const OAUTH_REDIRECT = `${APP_SCHEME}://auth-callback`;

/**
 * Public website address. Share links, email confirmations and link previews
 * always point here (inside the apps, window.location is a local origin).
 */
export const SITE_URL = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/$/, '');

export function siteUrl(path: string) {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Open a link outside the app (maps, calendar…). */
export async function openExternal(url: string) {
  if (isNative) await Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

/** Native share sheet in the apps; Web Share API or clipboard on the website. Returns true if copied. */
export async function shareLink(opts: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'dismissed'> {
  if (isNative) {
    try {
      await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: 'Share game' });
      return 'shared';
    } catch {
      return 'dismissed';
    }
  }
  if (navigator.share) {
    try {
      await navigator.share(opts);
      return 'shared';
    } catch {
      return 'dismissed';
    }
  }
  await navigator.clipboard.writeText(`${opts.text}\n${opts.url}`);
  return 'copied';
}

/** Google sign-in: in the apps it opens the system browser and returns via the app scheme. */
export async function signInWithGoogle() {
  if (!isNative) {
    return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (!error && data.url) await Browser.open({ url: data.url, presentationStyle: 'popover' });
  return { data, error };
}

/** Where email confirmation links should land. */
export function emailRedirectUrl() {
  return isNative ? SITE_URL : window.location.href;
}

/**
 * Wire up app-level native events. `navigate` is the router's navigate function.
 * Returns a cleanup function.
 */
export function initNative(navigate: (path: string) => void): () => void {
  if (!isNative) return () => {};

  const handles: Promise<{ remove: () => Promise<void> }>[] = [];

  // Deep links: https://<site>/games/… (App Links / Universal Links) and the OAuth callback.
  handles.push(
    App.addListener('appUrlOpen', async ({ url }) => {
      try {
        const u = new URL(url);
        if (url.startsWith(OAUTH_REDIRECT)) {
          const code = u.searchParams.get('code');
          if (code) await supabase.auth.exchangeCodeForSession(code);
          await Browser.close().catch(() => {});
          navigate('/');
          return;
        }
        const path = `${u.pathname}${u.search}`;
        if (path && path !== '/') navigate(path);
      } catch {
        /* malformed link — ignore */
      }
    }),
  );

  // Android hardware back button: go back in the app, exit at the root.
  handles.push(
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.location.pathname !== '/') window.history.back();
      else void App.exitApp();
    }),
  );

  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyBar = () => void StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
  applyBar();
  dark.addEventListener('change', applyBar);

  void SplashScreen.hide().catch(() => {});

  return () => {
    dark.removeEventListener('change', applyBar);
    handles.forEach((h) => void h.then((x) => x.remove()));
  };
}
