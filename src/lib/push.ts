import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase';
import { isNative, platform } from './native';

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
// Native push needs Firebase (Android) / an APNs key (iOS) set up first — see README.
const nativePushEnabled = import.meta.env.VITE_NATIVE_PUSH === 'true';

export type PushState = 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

// ---------------------------------------------------------------------------
// Native (Android / iOS apps)
// ---------------------------------------------------------------------------

const NATIVE_FLAG = 'pickup.nativePush';

function readFlag() {
  try {
    return localStorage.getItem(NATIVE_FLAG) === 'on';
  } catch {
    return false;
  }
}
function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(NATIVE_FLAG, 'on');
    else localStorage.removeItem(NATIVE_FLAG);
  } catch {
    /* storage unavailable */
  }
}

/** Registers with FCM / APNs and resolves with the device token. */
function registerNative(): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      void ok.then((h) => h.remove());
      void bad.then((h) => h.remove());
      fn();
    };
    const ok = PushNotifications.addListener('registration', (t) => finish(() => resolve(t.value)));
    const bad = PushNotifications.addListener('registrationError', (e) =>
      finish(() => reject(new Error(e.error || 'Could not register for notifications'))),
    );
    PushNotifications.register().catch((e) => finish(() => reject(e)));
    setTimeout(() => finish(() => reject(new Error('Timed out registering for notifications'))), 15000);
  });
}

async function saveDeviceToken(token: string) {
  const { error } = await supabase.rpc('save_device_token', { p_token: token, p_platform: platform });
  if (error) throw error;
}

/** Re-register on app start so a refreshed token (or a new account on this phone) is saved. */
export async function refreshNativePush() {
  if (!isNative || !nativePushEnabled || !readFlag()) return;
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') return;
  try {
    await saveDeviceToken(await registerNative());
  } catch {
    /* best effort */
  }
}

/** Tapping a notification opens the game it's about. */
export function onNativeNotificationTap(navigate: (path: string) => void): () => void {
  if (!isNative || !nativePushEnabled) return () => {};
  const h = PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = (notification.data as { url?: string } | undefined)?.url;
    if (url) navigate(url);
  });
  return () => void h.then((x) => x.remove());
}

// ---------------------------------------------------------------------------
// Shared API used by the UI
// ---------------------------------------------------------------------------

export async function getPushState(): Promise<PushState> {
  if (isNative) {
    if (!nativePushEnabled) return 'not-configured';
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'denied') return 'denied';
    return perm.receive === 'granted' && readFlag() ? 'on' : 'off';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!vapidKey) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (isNative) {
    if (!nativePushEnabled) return 'not-configured';
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return perm.receive === 'denied' ? 'denied' : 'off';
    await saveDeviceToken(await registerNative());
    writeFlag(true);
    return 'on';
  }

  if (!vapidKey) return 'not-configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));

  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
  });
  if (error) throw error;
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (isNative) {
    try {
      const token = await registerNative();
      await supabase.from('device_tokens').delete().eq('token', token);
    } catch {
      /* already gone */
    }
    await PushNotifications.unregister().catch(() => {});
    writeFlag(false);
    return 'off';
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return 'off';
}
